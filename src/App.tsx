import { useEffect, useState } from "react";
import { useDismiss } from "./ui/useDismiss";
import Tabs from "./ui/Tabs";
import { detectAgent, startAgentListeners } from "./ai/agent";
import { startMcp } from "./ai/mcp";
import { loadSkills } from "./ai/skills";
import CanvasView from "./canvas/CanvasView";
import { findProjects, flushPack, inTauri, newProject, openProject, openProjectAt, isCheckCopy, restoreLast, saveNow, startAutosave, trashList } from "./project/project";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ContextMenu from "./ui/ContextMenu";
import { installMenu } from "./ui/menu";
import { setMinimized } from "./ai/chat";
import { clampW, getLayout, isColorOpen, keepMode, modeOf, setLayout, useLayout } from "./ui/layout";
import Icon from "./ui/Icons";
import ChatHome from "./ui/ChatHome";
import VideoCut from "./ui/VideoCut";
import TimeStrip from "./ui/TimeStrip";
import { wireClips } from "./video/play";
import { wireKeys } from "./video/keys";
import ChatPanel from "./ui/ChatPanel";
import BeforeAfter from "./ui/BeforeAfter";
import ExportMenu from "./ui/ExportMenu";
import HistoryStrip from "./ui/HistoryStrip";
import Versions from "./ui/Versions";
import PresentView from "./ui/PresentView";
import SendCopy from "./ui/SendCopy";
import Update from "./ui/Update";
import Feedback, { askFeedback } from "./ui/Feedback";
import Settings from "./ui/Settings";
import LayersPanel from "./ui/LayersPanel";
import PropertiesPanel from "./ui/PropertiesPanel";
import Toolbar from "./ui/Toolbar";
import { useStore } from "./state/store";
import "./styles.css";

const STATUS: Record<string, string> = {
  unsaved: "Not saved",
  saving: "Saving...",
  saved: "Saved",
  error: "Could not save",
};

/** A thin handle on the edge of the canvas: drag it to make the panel next to it wider or narrower. */
function Grip({ side }: { side: "l" | "r" }) {
  const dock = useLayout((d) => d);
  // which panel is on this side of the canvas
  const key = (side === "l") !== dock.swapped ? "leftW" : "rightW";
  const hidden = key === "leftW" ? dock.leftHidden : dock.rightHidden;
  if (hidden) return null;
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = getLayout()[key];
    const move = (m: PointerEvent) => setLayout({ [key]: clampW(startW + (side === "l" ? m.clientX - startX : startX - m.clientX)) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <div className={`grip grip-${side}`} onPointerDown={down} onDoubleClick={() => setLayout({ [key]: key === "leftW" ? 232 : 248 })} title="Drag to resize. Double-click to reset." />;
}

wireClips();
wireKeys();

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export default function App() {
  const zoom = useStore((s) => s.viewport.zoom);
  const project = useStore((s) => s.project);
  // a project opens in the space it was left in, and another tab keeps its own
  const spaceMode = useLayout((d) => d.mode);
  useEffect(() => {
    if (!project.path) return;
    const m = modeOf(project.path) ?? "design";
    if (m !== getLayout().mode) setLayout({ mode: m });
  }, [project.path]);
  useEffect(() => {
    if (project.path) keepMode(project.path, spaceMode);
  }, [spaceMode]);
  const [zoomMenu, setZoomMenu] = useState(false);
  useDismiss(zoomMenu, () => setZoomMenu(false), ".zoomwrap.zoomonly");
  const [presenting, setPresenting] = useState(false);
  // there is no separate home any more: Chat is where your projects are
  const home = false;
  const setHome = (on: boolean) => on && setLayout({ space: "chat" });
  // in full screen there are no window buttons, so the name moves to the very left
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!inTauri()) return;
    const win = getCurrentWindow();
    const look = () => void win.isFullscreen().then(setFull).catch(() => undefined);
    look();
    let off: (() => void) | undefined;
    void win.onResized(look).then((f) => (off = f));
    return () => off?.();
  }, []);
  const [videoCut, setVideoCut] = useState(false);
  const [sending, setSending] = useState(false);
  const [settings, setSettings] = useState(false);
  const [check, setCheck] = useState(false);
  const dock = useLayout((d) => d);
  const hasFrames = useStore((s) => Object.values(s.timeline[s.cursor].doc.elements).some((e) => e.type === "frame"));
  // in Studio the chat waits folded away, unless the designer chose to keep it open there
  useEffect(() => {
    if (dock.space === "edit") setMinimized(!dock.editChatOpen);
  }, [dock.space]);
  // the AI asks something or suggests a change: in Video the right panel turns to the chat so it is seen
  useEffect(() => {
    const show = () => {
      const d = getLayout();
      if (d.space === "edit" && d.mode === "motion" && !d.rightHidden && d.videoTab !== "chat") setLayout({ videoTab: "chat" });
    };
    window.addEventListener("duet:show-chat", show);
    return () => window.removeEventListener("duet:show-chat", show);
  }, []);

  useEffect(() => {
    const stop = startAutosave();
    // every launch starts at your projects; the last one is a click away ("Back to ...")
    void restoreLast().then(() => {
      if (isCheckCopy()) return setCheck(true);
    });
    const stops: (() => void)[] = [];
    let alive = true;
    if (inTauri()) {
      // a project file double-clicked in Finder or Explorer
      void invoke<string | null>("launch_file").then((f) => f && void openProjectAt(f));
      void listen<string>("open-file", (e) => void openProjectAt(e.payload));
      // make sure the last save is in the file before the window closes
      // a slow or failed save must never keep the window open
      void getCurrentWindow().onCloseRequested(async (e) => {
        // an AI is still working: hide the window and let it finish; Duet quits when it is done
        if (await invoke<boolean>("keep_running_for_ai").catch(() => false)) {
          e.preventDefault();
        }
        await Promise.race([flushPack().catch(() => undefined), new Promise((done) => setTimeout(done, 4000))]);
      });
      // projects in Documents/Duet always show up in the list, even ones made before this app knew them
      void invoke<string>("default_projects_dir").then((d) => findProjects(d)).catch(() => undefined);
      // the trash clears out what is older than 30 days, now and once a day
      void trashList();
      const daily = setInterval(() => void trashList(), 24 * 60 * 60 * 1000);
      stops.push(() => clearInterval(daily));
      void installMenu();
      loadSkills();
      detectAgent();
      startMcp().then((f) => (alive ? stops.push(f) : f()));
      startAgentListeners().then((f) => (alive ? stops.push(f) : f()));
    }
    // the menu bar and other parts of the app ask for these
    const openHome = () => setLayout({ space: "chat" });
    const openPresent = () => setPresenting(true);
    const openSend = () => setSending(true);
    const openSettings = () => setSettings(true);
    const openVideoCut = () => setVideoCut(true);
    const rebuildMenu = () => void installMenu();
    window.addEventListener("duet:home", openHome);
    window.addEventListener("duet:present", openPresent);
    window.addEventListener("duet:send-copy", openSend);
    window.addEventListener("duet:settings", openSettings);
    window.addEventListener("duet:video-cut", openVideoCut);
    window.addEventListener("duet:recents", rebuildMenu);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "enter") {
        e.preventDefault();
        setPresenting(true);
      } else if (k === "s" && e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new Event("duet:versions"));
      } else if (k === "s") {
        e.preventDefault();
        saveNow();
      } else if (k === "o") {
        e.preventDefault();
        openProject();
      } else if (k === "n") {
        e.preventDefault();
        newProject();
      } else if (k === "1" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setLayout({ mode: "design" });
      } else if (k === "2" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setLayout({ mode: "motion" });
      } else if (k === "3" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setLayout({ mode: "photo" });
      } else if (k === ",") {
        e.preventDefault();
        setSettings(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      stops.forEach((f) => f());
      stop();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("duet:home", openHome);
      window.removeEventListener("duet:present", openPresent);
      window.removeEventListener("duet:send-copy", openSend);
      window.removeEventListener("duet:settings", openSettings);
      window.removeEventListener("duet:video-cut", openVideoCut);
      window.removeEventListener("duet:recents", rebuildMenu);
    };
  }, []);

  // The grid follows the panels: their widths, which side they are on, and whether they are shown.
  const lw = dock.leftHidden ? 0 : dock.leftW;
  const rw = dock.rightHidden ? 0 : dock.rightW;
  const chatting = dock.space === "chat";
  const timeMax = dock.timeMax && !chatting && dock.mode === "motion";
  const appStyle = chatting
    ? { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: `44px minmax(0, 1fr) ${dock.historyLine ? "48px" : "0"}`, gridTemplateAreas: '"top" "chathome" "hist"' }
    : {
    gridTemplateColumns: dock.swapped ? `auto ${rw}px 1fr ${lw}px` : `auto ${lw}px 1fr ${rw}px`,
    gridTemplateAreas: timeMax
      ? '"top top top top" "tools time time time" "tools time time time" "tools time time time" "hist hist hist hist"'
      : dock.swapped
      ? '"top top top top" "tools right tabs left" "tools right canvas left" "tools time time time" "hist hist hist hist"'
      : '"top top top top" "tools left tabs right" "tools left canvas right" "tools time time time" "hist hist hist hist"',

  };

  return (
    <div className={`app ${timeMax ? "time-max" : ""} ${dock.swapped ? "swapped" : ""} ${check ? "check" : ""} ${MAC ? "mac" : ""} ${full ? "fs" : ""} ${dock.historyLine ? "" : "no-hist"}`} style={appStyle}>
      {/* the top row: the name, how it is saved, the kind of work, and Export; on a Mac it shares the row with the window buttons */}
      <header className="top" data-tauri-drag-region>
        <div className="top-side" data-tauri-drag-region>
          <span className="logo" data-tauri-drag-region>
            Du<b>et</b>
            {check && <i className="checkmark" title="Duet dev, used only to build and check Duet itself. It never opens your projects by itself.">dev</i>}
            <i className="early-tag" title="Duet is in early access. Some things are unfinished and you may meet bugs. Save versions of work that matters.">Early access</i>
            <button className="early-tag feedback-tag" data-name="feedback" title="Tell the creator what went wrong or what you want. Cmd or Ctrl, Shift, F" onClick={askFeedback}>
              Feedback
            </button>
          </span>
          <span data-tauri-drag-region className={`status ${project.status}`} title={project.error ?? undefined}>
            {project.path ? STATUS[project.status] : "Not saved yet"}
          </span>
          <div className="pill mode-switch space-switch">
            <button className={chatting ? "active" : ""} data-name="space-chat" onClick={() => setLayout({ space: "chat" })} title="Your projects and the AI">
              Agent
            </button>
            <button className={chatting ? "" : "active"} data-name="space-edit" onClick={() => setLayout({ space: "edit" })} title="Every tool, to work on the design yourself">
              Studio
            </button>
          </div>
        </div>
        <div />
        <div className="top-side end" data-tauri-drag-region>
          {!chatting && (
          <div className="pill mode-switch kind-switch">
          <button
            className={dock.mode === "design" ? "active" : ""}
            data-name="mode-design"
            title="Design (Cmd or Ctrl 1)"
            onClick={() => setLayout({ mode: "design" })}
          >
            Design
          </button>
          <button
            className={dock.mode === "motion" ? "active" : ""}
            data-name="mode-motion"
            title="Video: edit, animate and tell the story over time (Cmd or Ctrl 2)"
            onClick={() => setLayout({ mode: "motion" })}
          >
            Video
          </button>
          <button
            className={dock.mode === "photo" ? "active" : ""}
            data-name="mode-photo"
            title="Photo (Cmd or Ctrl 3)"
            onClick={() => setLayout({ mode: "photo" })}
          >
            Photo
          </button>
        </div>
          )}
          {!chatting && dock.mode === "design" && (
            <button className="pill" disabled={!hasFrames} onClick={() => setPresenting(true)} title="Click through your screens (Cmd or Ctrl Enter)">
              Present
            </button>
          )}
          {!chatting && (
          <>
          <button className={`pill icon ${dock.leftHidden ? "" : "on"}`} title="Show or hide the layers panel" onClick={() => setLayout({ leftHidden: !dock.leftHidden })}>
            <Icon name="panel-left" size={15} />
          </button>
          <button className={`pill icon ${dock.rightHidden ? "" : "on"}`} title="Show or hide the design panel" onClick={() => setLayout({ rightHidden: !dock.rightHidden })}>
            <Icon name="panel-right" size={15} />
          </button>
          </>
          )}
          <ExportMenu />
          <div className="zoomwrap zoomonly">
            <button className="pill" onClick={() => setZoomMenu(!zoomMenu)} title="Zoom">
              {Math.round(zoom * 100)}%
            </button>
            {zoomMenu && (
              <div className="zmenu" onClick={() => setZoomMenu(false)}>
                <div onClick={() => window.dispatchEvent(new Event("duet:fit"))}>
                  Fit everything <kbd>Shift 1</kbd>
                </div>
                <div onClick={() => window.dispatchEvent(new CustomEvent("duet:fit-selection"))}>
                  Zoom to selection <kbd>Shift 2</kbd>
                </div>
                {[0.5, 1, 2].map((z) => (
                  <div key={z} onClick={() => window.dispatchEvent(new CustomEvent("duet:zoom", { detail: z }))}>
                    {z * 100}%
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>
      {/* in Edit, under it: the open projects like tabs in a browser, and the kind of work */}
      {!chatting && (
        <div className="tabbar">
          <Tabs home={home} setHome={setHome} />
        </div>
      )}
      {chatting ? (
        <ChatHome />
      ) : (
        <>
          <Toolbar />
          {!dock.leftHidden && <LayersPanel />}
          <main className="canvas">
            <CanvasView />
            <Grip side="l" />
            <Grip side="r" />
            {isColorOpen(dock) && <BeforeAfter />}
            {/* in Video the chat is a tab on the right panel instead of floating over the picture */}
            {(dock.mode !== "motion" || dock.rightHidden) && <ChatPanel />}
          </main>
          {!dock.rightHidden && <PropertiesPanel />}
          <TimeStrip />
        </>
      )}
      {dock.historyLine && <HistoryStrip />}
      <Versions />
      {presenting && <PresentView onClose={() => setPresenting(false)} />}
      <ContextMenu />
      {videoCut && <VideoCut onClose={() => setVideoCut(false)} />}
      {sending && <SendCopy onClose={() => setSending(false)} />}
      <Update />
      <Feedback />
      {settings && <Settings check={check} onClose={() => setSettings(false)} />}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useDismiss } from "./ui/useDismiss";
import { detectAgent, startAgentListeners, stopAll, workingNow } from "./ai/agent";
import { ask } from "./ui/dialog";
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
import { toggleTheme, useTheme } from "./ui/theme";
import Icon from "./ui/Icons";
import { ProjectsSidebar } from "./ui/ChatHome";
import SkillsPanel from "./ui/SkillsPanel";
import KindSwitch from "./ui/KindSwitch";
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
import Feedback from "./ui/Feedback";
import Settings from "./ui/Settings";
import Home from "./ui/Home";
import Kitchen from "./ui/Kitchen";
import LayersPanel from "./ui/LayersPanel";
import PropertiesPanel from "./ui/PropertiesPanel";
import Toolbar from "./ui/Toolbar";
import PageStrip from "./ui/PageStrip";
import { getState, useStore } from "./state/store";
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
  const [theme] = useTheme();
  useDismiss(zoomMenu, () => setZoomMenu(false), ".zoomwrap.zoomonly");
  const [presenting, setPresenting] = useState(false);
  // Home shows from the first moment, so the studio never flashes up empty while the last design loads behind it
  const [homeOpen, setHomeOpen] = useState(true);
  // the skills open as a page of their own, beside your projects, in any space
  const [skillsOpen, setSkillsOpen] = useState(false);
  useEffect(() => {
    const open = () => setSkillsOpen(true);
    window.addEventListener("duet:skills-page", open);
    return () => window.removeEventListener("duet:skills-page", open);
  }, []);
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
  useEffect(() => {
    const stop = startAutosave();
    // every launch starts at your projects; the last one is a click away ("Back to ...")
    void restoreLast().then(async () => {
      if (isCheckCopy()) setCheck(true);
      // a project file double-clicked in Finder or Explorer opens straight in, without Home
      const f = inTauri() ? await invoke<string | null>("launch_file").catch(() => null) : null;
      if (f) return (setHomeOpen(false), void openProjectAt(f));
    });
    const stops: (() => void)[] = [];
    let alive = true;
    if (inTauri()) {
      void listen<string>("open-file", (e) => void openProjectAt(e.payload));
      // make sure the last save is in the file before the window closes
      // a slow or failed save must never keep the window open
      void getCurrentWindow().onCloseRequested(async (e) => {
        // an AI is still working: say who, and let the designer choose to keep it going or stop it
        const who = workingNow();
        if (who.length) {
          const where = getState().project.name || "this design";
          const keep = await ask(`${who.join(" and ")} ${who.length > 1 ? "are" : "is"} still working on ${where}. Keep going in the background, or stop and close?`, {
            title: "Duet",
            kind: "warning",
            okLabel: "Keep going",
            cancelLabel: "Stop and close",
          });
          // kept: the window hides and Duet quits once the work is done
          if (keep && (await invoke<boolean>("keep_running_for_ai").catch(() => false))) e.preventDefault();
          if (!keep) await stopAll();
        } else if (await invoke<boolean>("keep_running_for_ai").catch(() => false)) {
          // Duet still saw an AI's call a moment ago, though none is named: let it finish quietly
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
    const openHome = () => setHomeOpen(true);
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
  // changing space leaves the page
  useEffect(() => setSkillsOpen(false), [dock.space]);
  const lw = dock.leftHidden ? 0 : dock.leftW;
  const rw = dock.rightHidden ? 0 : dock.rightW;
  // Kitchen, like Chat, is a whole page of its own: no tools or panels around it, only your projects on the left
  const cooking = dock.space === "kitchen";
  const hist = dock.historyLine ? "48px" : "0";
  const timeMax = dock.timeMax && !cooking && dock.mode === "motion";
  const appStyle = cooking
    ? { gridTemplateColumns: "auto minmax(0, 1fr)", gridTemplateRows: `44px minmax(0, 1fr) ${hist}`, gridTemplateAreas: '"top top" "projects kitchen" "hist hist"' }
    : {
    gridTemplateColumns: dock.swapped ? `auto 340px ${rw}px 1fr ${lw}px` : `auto 340px ${lw}px 1fr ${rw}px`,
    gridTemplateRows: `44px 40px minmax(0, 1fr) auto ${hist}`,
    gridTemplateAreas: timeMax
      ? '"top top top top top" "projects chat bar bar bar" "projects chat time time time" "projects chat time time time" "hist hist hist hist hist"'
      : dock.swapped
      ? '"top top top top top" "projects chat right bar left" "projects chat right canvas left" "projects chat time time time" "hist hist hist hist hist"'
      : '"top top top top top" "projects chat left bar right" "projects chat left canvas right" "projects chat time time time" "hist hist hist hist hist"',

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
          </span>
          <span data-tauri-drag-region className={`status ${project.status}`} title={project.error ?? undefined}>
            {project.path ? STATUS[project.status] : "Not saved yet"}
          </span>
          <div className="pill mode-switch space-switch">
            <button className={cooking ? "active" : ""} data-name="space-kitchen" onClick={() => setLayout({ space: "kitchen" })} title="Make work from recipes, step by step">
              Kitchen
            </button>
            <button className={cooking ? "" : "active"} data-name="space-edit" onClick={() => setLayout({ space: "edit" })} title="Every tool, to work on the design yourself">
              Studio
            </button>
          </div>
        </div>
        {/* the kind of work sits in the middle, so it stays put whatever the sides hold */}
        <div />
        <div className="top-side end" data-tauri-drag-region>
          <button
            className="pill icon theme-toggle"
            title={theme === "light" ? "Dark look" : "Light look"}
            onClick={toggleTheme}
            data-name="theme-toggle"
          >
            <Icon name={theme === "light" ? "moon" : "sun"} size={15} />
          </button>
          {!cooking && dock.mode === "design" && (
            <button className="pill" disabled={!hasFrames} onClick={() => setPresenting(true)} title="Click through your screens (Cmd or Ctrl Enter)">
              Present
            </button>
          )}
          {!cooking && (
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
      {/* in every space, down the left: your projects, open ones first; they take the place of tabs */}
      <ProjectsSidebar />
      {cooking ? (
        <Kitchen />
      ) : (
        <>
          {/* Studio's own bar, under the top bar: the tools on the left, the kind of work on the right */}
          <div className="studio-bar">
            <Toolbar row />
            <KindSwitch />
          </div>
          {/* the chat's own column, always in the same place */}
          <section className="studio-chat">
            <ChatPanel docked />
          </section>
          {!dock.leftHidden && <LayersPanel />}
          <main className="canvas">
            <CanvasView />
            <Grip side="l" />
            <Grip side="r" />
            {isColorOpen(dock) && <BeforeAfter />}
            <PageStrip />
          </main>
          {!dock.rightHidden && <PropertiesPanel />}
          <TimeStrip />
        </>
      )}
      {skillsOpen && (
        <section className="skills-page">
          <div className="skills-page-head">
            <h2>Skills</h2>
            <button className="pill" onClick={() => setSkillsOpen(false)}>
              Close
            </button>
          </div>
          <SkillsPanel />
        </section>
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
      {homeOpen && !cooking && <Home onClose={() => setHomeOpen(false)} />}
    </div>
  );
}

import PageFlipButton from "./ui/PageFlip";
import { useEffect, useState } from "react";
import { useDismiss } from "./ui/useDismiss";
import { detectAgent, startAgentListeners, stopAll, workingNow } from "./ai/agent";
import { ask } from "./ui/dialog";
import { startMcp } from "./ai/mcp";
import { loadSkills } from "./ai/skills";
import { loadScripts } from "./store/scripts";
import { loadKits } from "./store/kits";
import CanvasView from "./canvas/CanvasView";
import { findProjects, flushPack, inTauri, newProject, openProject, openProjectAt, isCheckCopy, restoreLast, saveNow, startAutosave, trashList } from "./project/project";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ContextMenu from "./ui/ContextMenu";
import { installMenu } from "./ui/menu";
import { setMinimized } from "./ai/chat";
import { clampW, fitStudio, getLayout, isColorOpen, keepMode, modeOf, setLayout, useLayout, useWindowWidth } from "./ui/layout";
import { toggleTheme, useTheme } from "./ui/theme";
import Icon from "./ui/Icons";
import { ProjectsSidebar, ProjectMenu } from "./ui/ChatHome";
import { renameProject } from "./project/project";
import { message } from "./ui/dialog";
import StorePage from "./ui/StorePage";
import KindSwitch from "./ui/KindSwitch";
import VideoCut from "./ui/VideoCut";
import TimeStrip from "./ui/TimeStrip";
import { wireClips } from "./video/play";
import { wireKeys } from "./video/keys";
import ChatPanel from "./ui/ChatPanel";
import PanelChat from "./ui/PanelChat";
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
import Kitchen, { RecipesPage } from "./ui/Kitchen";
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

/** The open project's name and the folder it is in. A click offers what can be done with the file; Rename edits the name right here. */
function FileName() {
  const project = useStore((s) => s.project);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  useEffect(() => setName(project.name), [project.name, renaming]);
  const file = project.file;
  const folder = file ? file.replace(/[\\/][^\\/]*$/, "").split(/[\\/]/).pop() : null;
  const done = async (keep: boolean) => {
    if (!renaming) return;
    setRenaming(false);
    if (!keep || !file || !name.trim() || name.trim() === project.name) return;
    const why = await renameProject(file, name);
    if (why) await message(why, { title: "Rename", kind: "warning" });
  };
  if (renaming)
    return (
      <input
        className="top-file-rename"
        autoFocus
        value={name}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void done(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") void done(false);
        }}
      />
    );
  return (
    <>
      <button
        className="top-file"
        data-name="top-file"
        title={file ?? "Not saved yet"}
        disabled={!file}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom + 4 });
        }}
      >
        <span className="top-file-name">{project.name}</span>
        {folder && <span className="top-file-folder">in {folder}</span>}
      </button>
      {menu && file && <ProjectMenu at={{ ...menu, r: { path: file, name: project.name, opened: 0 } }} onDone={() => setMenu(null)} onRename={() => setRenaming(true)} />}
    </>
  );
}

/** A thin handle on the edge of the canvas: drag it to make the panel next to it wider or narrower. */
function Grip({ side, lw, rw }: { side: "l" | "r"; lw: number; rw: number }) {
  const dock = useLayout((d) => d);
  // which panel is on this side of the canvas, and how wide it really is on this window
  const key = (side === "l") !== dock.swapped ? "leftW" : "rightW";
  const shown = key === "leftW" ? lw : rw;
  if (!shown) return null;
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = shown;
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
  const [recipesOpen, setRecipesOpen] = useState(false);
  useEffect(() => {
    const open = () => setSkillsOpen(true);
    const openRecipes = () => setRecipesOpen(true);
    window.addEventListener("duet:skills-page", open);
    window.addEventListener("duet:recipes-page", openRecipes);
    return () => {
      window.removeEventListener("duet:skills-page", open);
      window.removeEventListener("duet:recipes-page", openRecipes);
    };
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
    else setMinimized(false);
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
      void loadScripts();
      void loadKits();
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
  // on a small window the panels give way so the canvas keeps its room; nothing is saved, a wider window brings them back
  const win = useWindowWidth();
  const { lw, rw } = fitStudio(win, {
    projectsOpen: dock.projectsOpen.edit,
    chatCol: 0,
    lw: dock.leftHidden ? 0 : dock.leftW,
    rw: dock.rightHidden ? 0 : dock.rightW,
  });
  const leftOff = lw === 0;
  const rightOff = rw === 0;
  // the chat under the right panel, while that panel is shown; with the panel away it floats again
  const chatUnder = dock.chatInPanel && !rightOff;
  // Kitchen, like Chat, is a whole page of its own: no tools or panels around it, only your projects on the left
  const cooking = dock.space === "kitchen";
  // building a recipe full screen leaves only your projects and the top bar around it
  const recipeFull = cooking && dock.recipeFull && !!dock.recipeOn;
  const hist = dock.historyLine && !recipeFull ? "48px" : "0";
  // the chat has a column of its own on the left, or floats over the canvas
  // the chat floats over the canvas, or sits under the right panel
  const chatCol = 0;
  const timeMax = dock.timeMax && !cooking && dock.mode === "motion";
  const appStyle = cooking
    ? { gridTemplateColumns: "auto minmax(0, 1fr)", gridTemplateRows: `44px minmax(0, 1fr) ${hist}`, gridTemplateAreas: '"top top" "projects kitchen" "projects hist"' }
    : {
    gridTemplateColumns: dock.swapped ? `auto ${chatCol}px ${rw}px 1fr ${lw}px` : `auto ${chatCol}px ${lw}px 1fr ${rw}px`,
    // the tools float over the canvas like Kitchen's, so their row takes no room, except in the maximised timeline
    gridTemplateRows: `44px ${timeMax ? "40px" : "0px"} minmax(0, 1fr) auto ${hist}`,
    gridTemplateAreas: timeMax
      ? '"top top top top top" "projects chat bar bar bar" "projects chat time time time" "projects chat time time time" "projects hist hist hist hist"'
      : dock.swapped
      ? '"top top top top top" "projects chat right bar left" "projects chat right canvas left" "projects chat time time time" "projects hist hist hist hist"'
      : '"top top top top top" "projects chat left bar right" "projects chat left canvas right" "projects chat time time time" "projects hist hist hist hist"',

  };

  return (
    <div className={`app ${timeMax ? "time-max" : ""} ${dock.swapped ? "swapped" : ""} ${check ? "check" : ""} ${MAC ? "mac" : ""} ${full ? "fs" : ""} ${dock.historyLine && !recipeFull ? "" : "no-hist"}`} style={appStyle}>
      {/* the top row: the name, how it is saved, the kind of work, and Export; on a Mac it shares the row with the window buttons */}
      <header className="top" data-tauri-drag-region>
        <div className="top-side" data-tauri-drag-region>
          <span className="logo" data-tauri-drag-region>
            Du<b>et</b>
            {check && <i className="checkmark" title="Duet dev, used only to build and check Duet itself. It never opens your projects by itself.">dev</i>}
            <i className="early-tag" title="Duet is in early access. Some things are unfinished and you may meet bugs. Save versions of work that matters.">Early access</i>
          </span>
          <FileName />
          <span data-tauri-drag-region className={`status ${project.status}`} title={project.error ?? undefined}>
            {project.path ? STATUS[project.status] : "Not saved yet"}
          </span>
        </div>
        {/* Kitchen or Studio, the two ways to work, in the middle so it stays put whatever the sides hold */}
        <div className="pill mode-switch space-switch">
          <button className={cooking ? "active" : ""} data-name="space-kitchen" onClick={() => (setHomeOpen(false), setLayout({ space: "kitchen" }))} title="Work with AI agents: chat, mark what to change, or follow a recipe step by step">
            Kitchen
          </button>
          <button className={cooking ? "" : "active"} data-name="space-edit" onClick={() => (setHomeOpen(false), setLayout({ space: "edit" }))} title="Every tool, to work on the design yourself">
            Studio
          </button>
        </div>
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
          {/* a panel folded away for room comes back by putting the other one away */}
          <button
            className={`pill icon ${leftOff ? "" : "on"}`}
            title={!dock.leftHidden && leftOff ? "No room for the layers panel. Make the window wider, or click to put the design panel away" : "Show or hide the layers panel"}
            onClick={() => setLayout(!dock.leftHidden && leftOff ? { rightHidden: true } : { leftHidden: !dock.leftHidden })}
          >
            <Icon name="panel-left" size={15} />
          </button>
          <button
            className={`pill icon ${rightOff ? "" : "on"}`}
            title={!dock.rightHidden && rightOff ? "No room for the design panel. Make the window wider, or click to put the layers panel away" : "Show or hide the design panel"}
            onClick={() => setLayout(!dock.rightHidden && rightOff ? { leftHidden: true } : { rightHidden: !dock.rightHidden })}
          >
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
          {/* Studio's own bar, under the top bar: the tools; the kind of work lives at the top of the right panel, and waits here while that panel is hidden */}
          <div className="studio-bar">
            <Toolbar row />
            <PageFlipButton className="studio-flip" />
            {rightOff && <KindSwitch />}
          </div>
          {!leftOff && <LayersPanel />}
          <main className="canvas">
            <CanvasView />
            <Grip side="l" lw={lw} rw={rw} />
            <Grip side="r" lw={lw} rw={rw} />
            {isColorOpen(dock) && <BeforeAfter />}
            <PageStrip />
            {!chatUnder && <ChatPanel />}
          </main>
          {chatUnder ? (
            <div className="right-stack">
              <PropertiesPanel />
              <PanelChat />
            </div>
          ) : (
            !rightOff && <PropertiesPanel />
          )}
          <TimeStrip />
        </>
      )}
      {skillsOpen && <StorePage onClose={() => setSkillsOpen(false)} />}
      {recipesOpen && <RecipesPage onClose={() => setRecipesOpen(false)} />}
      {dock.historyLine && !recipeFull && <HistoryStrip />}
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

import { useEffect, useState } from "react";
import { ask } from "./dialog";
import { addTab, closeProject, closeTab, closeUntitled, getTabs, getUntitled, inTauri, isUntitled, liveKey, newDesignTab, openProjectAt, tabTitle } from "../project/project";
import { currentDoc, useStore } from "../state/store";
import { readyToLeave } from "../ai/agent";
import { useChat } from "../ai/chat";
import { outsideHomes } from "../ai/tools";

/**
 * The projects you have open, like tabs in a browser. One is on screen; the others wait with their
 * history, and an AI can keep working in one. A small dot shows where an AI is at work.
 * The home button shows all your projects; + starts a new design.
 */
export default function Tabs({ home, setHome }: { home: boolean; setHome: (on: boolean) => void }) {
  const project = useStore((s) => s.project);
  const empty = useStore((s) => currentDoc(s).rootIds.length === 0);
  const file = project.file;
  const [, again] = useState(0);
  const chatBusy = useChat((s) => s.busy);
  // an AI from outside says nothing when it stops, so look again now and then
  useEffect(() => {
    const t = setInterval(() => again((n) => n + 1), 3000);
    return () => clearInterval(t);
  }, []);
  const working = new Set([...outsideHomes(), ...(chatBusy ? [chatBusy] : [])]);
  useEffect(() => {
    const redo = () => again((n) => n + 1);
    window.addEventListener("duet:tabs", redo);
    window.addEventListener("duet:recents", redo);
    return () => {
      window.removeEventListener("duet:tabs", redo);
      window.removeEventListener("duet:recents", redo);
    };
  }, []);
  // the project you are in is always one of them
  useEffect(() => {
    if (file) addTab(file);
  }, [file]);
  // whatever project is open always has its tab, and so does each new design with no file yet
  const saved = file && !getTabs().includes(file) ? [...getTabs(), file] : getTabs();
  const list = [...saved, ...getUntitled()];
  const live = liveKey();
  // the plain empty start has no tab of its own until something is made in it
  const unsaved = !live && !(home && empty);

  const show = async (path: string) => {
    if (path === live || (await openProjectAt(path))) setHome(false);
  };

  /** What is left after the project on screen is closed: the next tab, or all your projects. */
  const afterClosing = async (rest: string[]) => {
    const next = rest[rest.length - 1];
    // a next project whose file cannot be found is not opened; the screen empties as if it were the last
    if (next && (await openProjectAt(next, true))) return void setHome(false);
    if (!(await readyToLeave(true))) return;
    await closeProject();
    setHome(true);
  };

  const closeSaved = async (path: string) => {
    // the chat's AI may be at work in this project, even when it is not on screen
    if (!(await readyToLeave(true, path))) return;
    const rest = list.filter((p) => p !== path);
    if (isUntitled(path)) {
      // work with no file is lost when its tab closes, so ask first if there is any
      const work = path === live ? !empty : true;
      if (work && inTauri() && !(await ask("This design has not been saved. Close it anyway?", { title: "Duet", kind: "warning", okLabel: "Close", cancelLabel: "Keep working" }))) return;
      closeUntitled(path);
    } else closeTab(path);
    if (path === live) void afterClosing(rest);
  };

  /** Unsaved work is lost when it is left, so ask first. */
  const okToLeaveUnsaved = async (question: string, okLabel: string) =>
    file || empty || !inTauri() ? true : ask(question, { title: "Duet", kind: "warning", okLabel, cancelLabel: "Keep working" });

  const closeUnsaved = async () => {
    // opening another project asks about unsaved work by itself, so ask here only when none is left
    if (!list.length && !(await okToLeaveUnsaved("Your current work has not been saved. Close it anyway?", "Close"))) return;
    await afterClosing(list);
  };

  /** + starts a new, empty design in its own tab, like a new tab in a browser. Every other tab keeps its work. */
  const startNew = async () => {
    await newDesignTab();
    setHome(false);
  };

  return (
    <div className="project-tabs" role="tablist" data-tauri-drag-region>
      {list.map((path) => {
        const on = !home && path === live;
        return (
          <div key={path} role="tab" aria-selected={on} className={`project-tab ${on ? "active" : ""}`} title={isUntitled(path) ? tabTitle(path) : path}>
            <button className="tab-name" onClick={() => void show(path)}>
              {working.has(path) && <i className="tab-busy" title="An AI is at work here" />}
              {tabTitle(path)}
            </button>
            <button className="tab-x" aria-label={`Close ${tabTitle(path)}`} onClick={() => void closeSaved(path)}>
              ×
            </button>
          </div>
        );
      })}
      {unsaved && (
        <div key="unsaved" role="tab" aria-selected={!home} className={`project-tab ${home ? "" : "active"}`} title={project.name}>
          <button className="tab-name" onClick={() => setHome(false)}>
            {project.name}
          </button>
          <button className="tab-x" aria-label={`Close ${project.name}`} onClick={() => void closeUnsaved()}>
            ×
          </button>
        </div>
      )}
      <button className="project-tab-add" aria-label="New design" title="New design" onClick={() => void startNew()}>
        +
      </button>
    </div>
  );
}

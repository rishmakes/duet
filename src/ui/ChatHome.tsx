import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Fragment, useEffect, useRef, useState } from "react";
import CanvasView from "../canvas/CanvasView";
import type { Recent } from "../project/project";
import { ask, message } from "@tauri-apps/plugin-dialog";
import type { Trashed } from "../project/project";
import { checkListed, closeProject, closeTab, copyProject, getTabs, listedProjects, moveProjectTo, renameProject, inTauri, newProject, openProjectAt, removeRecent, TRASH_DAYS, trashDelete, trashList, trashProject, trashRestore } from "../project/project";
import { getState, isParked, setViewport, useStore } from "../state/store";
import { closeTask, readyToLeave } from "../ai/agent";
import { AGENTS, showThread, useChat } from "../ai/chat";
import { agentColour } from "../ai/colours";
import ChatPanel from "./ChatPanel";
import ChatToolbar from "./ChatToolbar";
import TimeStrip from "./TimeStrip";
import Icon from "./Icons";
import { setLayout, useLayout } from "./layout";
import SkillsPanel from "./SkillsPanel";

/** How long ago, in plain words. */
function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const previews = new Map<string, string | null>();

/** The small picture saved with a project, if there is one. */
function usePreview(path: string): string | null {
  const [src, setSrc] = useState<string | null>(previews.get(path) ?? null);
  useEffect(() => {
    if (!path || !inTauri() || previews.has(path)) return;
    let alive = true;
    invoke<string>("read_binary_file", { path: `${path}/preview.png` })
      .then((b64) => {
        previews.set(path, `data:image/png;base64,${b64}`);
        if (alive) setSrc(previews.get(path) ?? null);
      })
      .catch(() => previews.set(path, null));
    return () => {
      alive = false;
    };
  }, [path]);
  return src;
}

/** Projects that match what was typed, newest first as they are kept. */
export function matchProjects<T extends { name: string }>(all: T[], typed: string): T[] {
  const t = typed.trim().toLowerCase();
  return t ? all.filter((r) => r.name.toLowerCase().includes(t)) : all;
}

export type ProjectSort = "recent" | "name";

/** Projects in the order asked for: last opened first, or by name. */
export function sortProjects<T extends { name: string; opened: number }>(all: T[], by: ProjectSort): T[] {
  return [...all].sort((a, b) => (by === "name" ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : b.opened - a.opened));
}

const SIZE_KEY = "duet:projects-size";
const readSize = (): number => {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return n >= 120 && n <= 360 ? n : 190;
  } catch {
    return 190;
  }
};

/** A dot for an open project: purple for the one on screen, white for one waiting in the background. */
function OpenDot({ on, open }: { on: boolean; open: boolean }) {
  if (!on && !open) return null;
  return <span className={`chathome-dot ${on ? "now" : ""}`} title={on ? "Open now" : "Open"} />;
}

/** One project as a picture card on the page of all projects. */
function ProjectTile({ r, on, open, onOpen, onMenu }: { r: Recent; on: boolean; open: boolean; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const own = usePreview(r.thumb ? "" : r.path);
  const src = r.thumb ?? own;
  return (
    <div
      className={`tile ${on ? "on" : ""} ${on || open ? "" : "shut"}`}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      title={r.path}
    >
      <div className="tile-pic">{src ? <img src={src} alt="" /> : null}</div>
      <div className="tile-text">
        <div className="chathome-name">{r.name}</div>
        <div className="chathome-when">{on ? "Open now" : open ? "Open" : ago(r.opened)}</div>
        <OpenDot on={on} open={open} />
      </div>
    </div>
  );
}

/** One project in the list: its picture, its name and when it was last opened. A dot says it is open. */
function ProjectRow({ r, on, open, onOpen, onMenu, renaming, onRenamed }: { r: Recent; on: boolean; open: boolean; onOpen: () => void; onMenu: (x: number, y: number) => void; renaming: boolean; onRenamed: () => void }) {
  const own = usePreview(r.thumb ? "" : r.path);
  const src = r.thumb ?? own;
  const [name, setName] = useState(r.name);
  useEffect(() => setName(r.name), [r.name, renaming]);
  const settled = useRef(false);
  useEffect(() => void (settled.current = false), [renaming]);
  // Enter or leaving the box keeps the new name, Escape keeps the old one; only the first of them counts
  const done = async (keep: boolean) => {
    if (settled.current) return;
    settled.current = true;
    onRenamed();
    if (!keep || !name.trim() || name.trim() === r.name) return;
    const why = await renameProject(r.path, name);
    if (why) await message(why, { title: "Rename", kind: "warning" });
  };
  return (
    <div
      className={`chathome-row ${on ? "on" : ""} ${on || open ? "" : "shut"}`}
      onClick={renaming ? undefined : onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      title={r.path}
    >
      <div className="chathome-thumb">{src ? <img src={src} alt="" /> : null}</div>
      <div className="chathome-meta">
        {renaming ? (
          <input
            className="chathome-name rename"
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
        ) : (
          <div className="chathome-name">{r.name}</div>
        )}
        <div className="chathome-when">{on ? "Open now" : open ? "Open" : ago(r.opened)}</div>
      </div>
      <OpenDot on={on} open={open} />
    </div>
  );
}

/** The chat's right edge: drag it to give the chat or the canvas more room. Double-click puts it back. */
function ChatWidthGrip() {
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const chat = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!chat) return;
    const startX = e.clientX;
    const move = (m: PointerEvent) => {
      // the canvas always keeps some room, and the chat never gets too narrow to read
      const most = window.innerWidth - chat.left - 240;
      setLayout({ homeChatW: Math.round(Math.max(320, Math.min(most, chat.width + m.clientX - startX))) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <div className="grip grip-r" data-name="chat-width" onPointerDown={down} onDoubleClick={() => setLayout({ homeChatW: 0 })} title="Drag to make the chat wider or narrower. Double-click to put it back." />;
}

/** What is in the trash: each can be put back, or deleted for good. */
function TrashView({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<Trashed[] | null>(null);
  const load = () => void trashList().then(setItems);
  useEffect(load, []);
  const left = (t: Trashed) => Math.max(1, Math.ceil(TRASH_DAYS - (Date.now() - t.trashed) / 86400000));
  return (
    <div className="chathome-skills">
      <div className="chathome-skills-head">
        <b>Trash</b>
        <button className="pill" onClick={onBack}>
          Back to chat
        </button>
      </div>
      <div className="trash-note">Projects stay here for {TRASH_DAYS} days, then they are cleared out.</div>
      <div className="trash-list">
        {items?.map((t) => (
          <div className="trash-row" key={t.id}>
            <div className="chathome-meta">
              <div className="chathome-name">{t.name}</div>
              <div className="chathome-when">
                {left(t)} {left(t) === 1 ? "day" : "days"} left
              </div>
            </div>
            <button
              className="pill"
              onClick={() =>
                void trashRestore(t.id)
                  .then(load)
                  .catch(() => undefined)
              }
            >
              <Icon name="restore" size={14} /> Put back
            </button>
            <button
              className="pill"
              onClick={async () => {
                if (!(await ask(`Delete “${t.name}” for good? It cannot be brought back.`, { title: "Duet", kind: "warning", okLabel: "Delete", cancelLabel: "Keep it" }))) return;
                await trashDelete(t.id).catch(() => undefined);
                load();
              }}
            >
              Delete now
            </button>
          </div>
        ))}
        {items && items.length === 0 && <div className="chathome-none">The trash is empty.</div>}
      </div>
    </div>
  );
}

/**
 * Chat: your projects down the left, the chat of the project you picked in the middle, and its
 * canvas on the right to watch. The canvas here only looks; changing it is for Edit.
 */
/** The project's main chat and its tasks, under it in the list. Each task shows its AI's colour, and whether it is at work or done. */
function TaskList({ project }: { project: string }) {
  const tasks = useChat((s) => s.tasks);
  const thread = useChat((s) => s.thread);
  const mine = tasks.filter((t) => t.project === project);
  if (!mine.length) return null;
  return (
    <div className="chathome-tasks">
      <div className={`chathome-task ${thread === null ? "on" : ""}`} onClick={() => showThread(null)}>
        <span className="chathome-task-name">Main chat</span>
      </div>
      {mine.map((t) => {
        const name = AGENTS.find((a) => a.id === t.agent)?.name ?? t.agent;
        return (
          <div key={t.key} className={`chathome-task ${thread === t.key ? "on" : ""}`} title={name} onClick={() => showThread(t.key)}>
            <span className="task-dot" style={{ backgroundColor: agentColour(name) }} />
            <span className="chathome-task-name">{t.title || "New task"}</span>
            {t.running ? <span className="task-working" title={`${name} is working`} /> : t.done ? <span className="task-done">done</span> : null}
            <button
              className="task-close"
              title="Close this task"
              onClick={async (e) => {
                e.stopPropagation();
                if (t.messages.length && !(await ask(`Close “${t.title || "New task"}”? Its conversation goes with it.${t.running ? ` ${name} stops working on it.` : ""}`, { title: "Duet", kind: "warning", okLabel: "Close task", cancelLabel: "Keep it" }))) return;
                void closeTask(t.key);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function ChatHome() {
  const current = useStore((s) => s.project);
  const [typed, setTyped] = useState("");
  // read again whenever the list or the open projects change: opening, closing, removing or trashing one
  const [, again] = useState(0);
  useEffect(() => {
    const redo = () => again((n) => n + 1);
    window.addEventListener("duet:tabs", redo);
    window.addEventListener("duet:recents", redo);
    // a file moved or deleted outside Duet leaves the list when Duet is looked at again
    const look = () => void checkListed();
    look();
    window.addEventListener("focus", look);
    return () => {
      window.removeEventListener("duet:tabs", redo);
      window.removeEventListener("duet:recents", redo);
      window.removeEventListener("focus", look);
    };
  }, []);
  const recents = listedProjects();
  const homeChatW = useLayout((d) => d.homeChatW);
  const mode = useLayout((d) => d.mode);
  const tabs = getTabs();
  const [skills, setSkills] = useState(false);
  const [trash, setTrash] = useState(false);
  const [searching, setSearching] = useState(false);
  const [all, setAll] = useState(false);
  const [size, setSizeState] = useState(readSize);
  const [sort, setSort] = useState<ProjectSort>("recent");
  const setSize = (n: number) => {
    setSizeState(n);
    try {
      localStorage.setItem(SIZE_KEY, String(n));
    } catch {
      /* nothing to do */
    }
  };
  const [menu, setMenu] = useState<{ x: number; y: number; r: Recent } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const warn = (title: string) => (why: string | null) => void (why && message(why, { title, kind: "warning" }));
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);
  // the canvas shows the whole design here, and the view goes back to where it was when you return to Edit
  useEffect(() => {
    const before = getState().viewport;
    const fit = setTimeout(() => window.dispatchEvent(new Event("duet:fit")), 120);
    return () => {
      clearTimeout(fit);
      setViewport(before);
    };
  }, [current.file]);
  const shown = matchProjects(recents, typed);

  /** Close a project: its tab goes, and if it was on screen the next one comes up, or none. */
  // open: on screen, in a tab, or waiting in memory with an AI still at work
  const isOpen = (path: string) => path === current.file || tabs.includes(path) || isParked(path);
  const leave = async (path: string) => {
    if (!(await readyToLeave(true, path))) return false;
    const next = path === current.file ? getTabs().filter((p) => p !== path).pop() : null;
    closeTab(path);
    if (path === current.file) {
      if (next) await openProjectAt(next, true);
      else await closeProject();
    }
    return true;
  };

  return (
    <div className="chathome" style={homeChatW ? { gridTemplateColumns: `276px ${homeChatW}px minmax(0, 1fr)` } : undefined}>
      <aside className="chathome-projects">
        <nav className="chathome-rail">
          <button className="rail-btn" title="New project" onClick={() => void newProject()} disabled={!inTauri()}>
            <Icon name="new-chat" size={18} />
          </button>
          <button
            className={`rail-btn ${searching ? "on" : ""}`}
            title="Search projects"
            onClick={() => {
              setSearching(!searching);
              setTyped("");
            }}
          >
            <Icon name="search" size={18} />
          </button>
          <button className={`rail-btn ${all ? "on" : ""}`} title="All projects" onClick={() => setAll(!all)}>
            <Icon name="grid" size={18} />
          </button>
          <span className="rail-gap" />
          <button
            className={`rail-btn ${skills ? "on" : ""}`}
            title="Skills"
            onClick={() => {
              setSkills(!skills);
              setTrash(false);
            }}
          >
            <Icon name="skills" size={18} />
          </button>
          <button
            className={`rail-btn ${trash ? "on" : ""}`}
            title="Trash"
            onClick={() => {
              setTrash(!trash);
              setSkills(false);
            }}
          >
            <Icon name="trash" size={18} />
          </button>
          <button className="rail-btn" title="Settings" onClick={() => window.dispatchEvent(new Event("duet:settings"))}>
            <Icon name="settings" size={18} />
          </button>
        </nav>
        <div className="chathome-body">
          {searching && (
            <label className="chathome-search">
              <Icon name="search" size={15} />
              <input autoFocus placeholder="Search projects" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </label>
          )}
          <div className="chathome-label">Projects</div>
          <div className="chathome-list">
            {shown.map((r) => (
              <Fragment key={r.path}>
                <ProjectRow
                  r={r}
                  on={r.path === current.file}
                  open={isOpen(r.path)}
                  onOpen={() => {
                    // picking a project always shows it, so the all projects view steps aside
                    setAll(false);
                    if (r.path !== current.file) void openProjectAt(r.path);
                  }}
                  onMenu={(x, y) => setMenu({ x, y, r })}
                  renaming={renaming === r.path}
                  onRenamed={() => setRenaming(null)}
                />
                {r.path === current.file && <TaskList project={r.path} />}
              </Fragment>
            ))}
            {shown.length === 0 && <div className="chathome-none">{recents.length ? "No project has that name." : "Your projects will be listed here."}</div>}
          </div>
        </div>
      </aside>
      {menu && (
        <div className="chathome-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <div
            onClick={() => {
              void revealItemInDir(menu.r.path);
              setMenu(null);
            }}
          >
            <Icon name="folder" size={15} /> Show in Finder
          </div>
          <div
            onClick={() => {
              setAll(false);
              setTyped("");
              setRenaming(menu.r.path);
              setMenu(null);
            }}
          >
            <Icon name="pen" size={15} /> Rename
          </div>
          <div
            onClick={() => {
              const r = menu.r;
              setMenu(null);
              void moveProjectTo(r.path).then(warn("Move to"));
            }}
            title="Move the file to another folder. Its history and conversation go with it."
          >
            <Icon name="move-to" size={15} /> Move to…
          </div>
          <div
            onClick={() => {
              const r = menu.r;
              setMenu(null);
              void copyProject(r.path).then(warn("Save a copy"));
            }}
            title="Save a second file somewhere else. This one stays as it is."
          >
            <Icon name="copy" size={15} /> Save a copy…
          </div>
          {isOpen(menu.r.path) && (
            <div
              onClick={() => {
                void leave(menu.r.path);
                setMenu(null);
              }}
              title="Your work is saved."
            >
              <Icon name="close" size={15} /> Close
            </div>
          )}
          <div
            onClick={() => {
              removeRecent(menu.r.path);
              setMenu(null);
            }}
            title="Takes it off this list. The file is not deleted."
          >
            <Icon name="unlist" size={15} /> Remove from list
          </div>
          <div
            onClick={async () => {
              const r = menu.r;
              setMenu(null);
              if (isOpen(r.path) && !(await leave(r.path))) return;
              await trashProject(r.path).catch((e) => message(`“${r.name}” could not be moved to the Trash. ${String(e)}`, { title: "Move to Trash", kind: "warning" }));
            }}
            title={`Kept ${TRASH_DAYS} days in the Trash, then cleared out.`}
          >
            <Icon name="trash" size={15} /> Move to Trash
          </div>
        </div>
      )}
      {all && (
        <section className="chathome-all">
          <div className="all-head">
            <b>All projects</b>
            <label className="chathome-search">
              <Icon name="search" size={15} />
              <input placeholder="Search projects" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </label>
            <select className="all-sort" value={sort} onChange={(e) => setSort(e.target.value as ProjectSort)} title="Order">
              <option value="recent">Last opened</option>
              <option value="name">Name</option>
            </select>
            <input className="all-size" type="range" min={120} max={360} step={10} value={size} onChange={(e) => setSize(Number(e.target.value))} title="Picture size" />
            <button className="pill" onClick={() => setAll(false)}>
              Back to chat
            </button>
          </div>
          <div className="all-body" style={{ ["--tile" as string]: `${size}px` }}>
            {sortProjects(shown, sort).map((r) => (
              <ProjectTile
                key={r.path}
                r={r}
                on={r.path === current.file}
                open={isOpen(r.path)}
                onOpen={() => {
                  if (r.path !== current.file) void openProjectAt(r.path);
                  setAll(false);
                }}
                onMenu={(x, y) => setMenu({ x, y, r })}
              />
            ))}
            {shown.length === 0 && <div className="chathome-none">{recents.length ? "No project has that name." : "Your projects will be listed here."}</div>}
          </div>
        </section>
      )}
      <section className="chathome-chat">
        <ChatWidthGrip />
        {trash ? (
          <TrashView onBack={() => setTrash(false)} />
        ) : skills ? (
          <div className="chathome-skills">
            <div className="chathome-skills-head">
              <b>Skills</b>
              <button className="pill" onClick={() => setSkills(false)}>
                Back to chat
              </button>
            </div>
            <SkillsPanel />
          </div>
        ) : (
          <ChatPanel docked />
        )}
      </section>
      <main className="canvas chathome-canvas">
        <div className="chathome-stage">
          <CanvasView />
          {/* the tools belong to the canvas, not to the list of all projects laid over it */}
          {!all && <ChatToolbar />}
        </div>
        {/* in Video, the timeline sits under the design, so the basics are here while talking to the AI */}
        {!all && mode === "motion" && <TimeStrip />}
      </main>
    </div>
  );
}

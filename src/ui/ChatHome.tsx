import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Fragment, useEffect, useRef, useState } from "react";
import type { Recent } from "../project/project";
import { ask, message } from "./dialog";
import type { Trashed } from "../project/project";
import { checkListed, closeProject, closeTab, closeUntitled, copyProject, getTabs, getUntitled, liveKey, newDesignTab, tabTitle, listedProjects, moveProjectTo, renameProject, inTauri, openProjectAt, removeRecent, TRASH_DAYS, trashDelete, trashList, trashProject, trashRestore } from "../project/project";
import { currentDoc, getState, isParked, useStore } from "../state/store";
import { closeTask, readyToLeave } from "../ai/agent";
import { AGENTS, showThread, useChat } from "../ai/chat";
import { agentColour } from "../ai/colours";
import Icon from "./Icons";
import { getLayout, setLayout, useLayout } from "./layout";
import { askToFindProject, takeFindProject } from "./findProject";
import { askFeedback } from "./Feedback";

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
export function usePreview(path: string): string | null {
  const [src, setSrc] = useState<string | null>(previews.get(path) ?? null);
  useEffect(() => {
    if (!path || !inTauri() || previews.has(path)) return;
    let alive = true;
    // the picture is kept inside the project file, so a project shows one without being opened first
    invoke<string | null>("project_preview", { file: path })
      .then((b64) => {
        previews.set(path, b64 ? `data:image/png;base64,${b64}` : null);
        if (alive) setSrc(previews.get(path) ?? null);
      })
      .catch(() => previews.set(path, null));
    return () => {
      alive = false;
    };
  }, [path]);
  return src;
}

/** Projects that match what was typed, by name or by the words inside them, newest first as they are kept. */
export function matchProjects<T extends { name: string; path: string }>(all: T[], typed: string, words?: (path: string) => string | undefined): T[] {
  const t = typed.trim().toLowerCase();
  return t ? all.filter((r) => r.name.toLowerCase().includes(t) || !!words?.(r.path)?.includes(t)) : all;
}

const words = new Map<string, string>();

/** What each listed project can be found by, read from inside its file. Read again for each new search, so recent work is found too. */
function useWords(paths: string[], searching: boolean): (path: string) => string | undefined {
  const [, again] = useState(0);
  const key = paths.join("\n");
  useEffect(() => {
    if (!searching || !inTauri()) return;
    words.clear();
    let alive = true;
    void (async () => {
      // a few at a time, so a long list does not hold everything else up
      for (let i = 0; i < paths.length && alive; i += 8) {
        await Promise.all(paths.slice(i, i + 8).map((file) => invoke<string | null>("project_words", { file }).then((w) => void (w && words.set(file, w)), () => undefined)));
        if (alive) again((n) => n + 1);
      }
    })();
    return () => {
      alive = false;
    };
  }, [searching, key]);
  return (path) => words.get(path);
}

/** A cross on an open project that closes it: purple for the one on screen, white for one waiting in the background. */
function CloseCross({ on, onClose }: { on: boolean; onClose: () => void }) {
  return (
    <button
      className={`chathome-close ${on ? "now" : ""}`}
      title="Close"
      aria-label="Close"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <Icon name="close" size={13} />
    </button>
  );
}

/** One project in the list: its picture, its name and when it was last opened. A dot says it is open. */
function ProjectRow({ r, on, open, compact, onOpen, onClose, onMenu, renaming, onRenamed }: { r: Recent; on: boolean; open: boolean; compact?: boolean; onOpen: () => void; onClose: () => void; onMenu: (x: number, y: number) => void; renaming: boolean; onRenamed: () => void }) {
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
      className={`chathome-row ${compact ? "compact" : ""} ${on ? "on" : ""} ${on || open ? "" : "shut"} ${r.missing ? "missing" : ""}`}
      onClick={renaming ? undefined : onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      title={r.path}
    >
      {!compact && <div className="chathome-thumb">{src ? <img src={src} alt="" /> : null}</div>}
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
        {(!compact || r.missing) && <div className="chathome-when">{r.missing ? "Cannot be found" : on ? "Open now" : open ? "Open" : ago(r.opened)}</div>}
      </div>
      {(on || open) && <CloseCross on={on} onClose={onClose} />}
    </div>
  );
}

function TrashRow({ t, card, picked, onPick, onTick, onSweep, onDone }: { t: Trashed; card?: boolean; picked: boolean; onPick: (e: React.MouseEvent) => void; onTick: () => void; onSweep: () => void; onDone: () => void }) {
  const src = usePreview(t.file);
  const left = Math.max(1, Math.ceil(TRASH_DAYS - (Date.now() - t.trashed) / 86400000));
  const folder = t.original.replace(/[\\/][^\\/]*$/, "").split(/[\\/]/).pop();
  const tickBox = (
    <button
      className={`trash-tick ${picked ? "on" : ""}`}
      role="checkbox"
      aria-checked={picked}
      aria-label={`Pick ${t.name}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        e.preventDefault();
        onTick();
      }}
    >
      {picked && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 5.2 4.1 7.3 8 2.8" />
        </svg>
      )}
    </button>
  );
  const when = `${folder ? `${folder} · ` : ""}${left} ${left === 1 ? "day" : "days"} left`;
  const actions = (
    <div className="trash-actions">
      <button
        className="trash-btn"
        title="Put back"
        aria-label="Put back"
        onClick={(e) => {
          e.stopPropagation();
          void trashRestore(t.id)
            .then(onDone)
            .catch((e) => message(`“${t.name}” could not be put back. ${String(e)}`, { title: "Put back", kind: "warning" }));
        }}
      >
        <Icon name="restore" size={14} />
      </button>
      <button
        className="trash-btn"
        title="Delete for good"
        aria-label="Delete for good"
        onClick={async (e) => {
          e.stopPropagation();
          if (!(await ask(`Delete “${t.name}” for good? It cannot be brought back.`, { title: "Duet", kind: "warning", okLabel: "Delete", cancelLabel: "Keep it" }))) return;
          await trashDelete(t.id).catch(() => undefined);
          onDone();
        }}
      >
        <Icon name="trash" size={14} />
      </button>
    </div>
  );
  // on Home the Trash is laid out like Recent work, one card per project
  if (card)
    return (
      <div className={`recent-card trash-card ${picked ? "on" : ""}`} title={t.original} onClick={onPick} onMouseEnter={onSweep}>
        <div className="recent-thumb">
          {tickBox}
          {actions}
          {src ? (
            <img src={src} alt="" />
          ) : (
            <div className="recent-thumb-blank">
              <Icon name="frame" size={26} />
            </div>
          )}
        </div>
        <div className="recent-info">
          <div className="recent-name">{t.name}</div>
          <div className="recent-meta">{when}</div>
        </div>
      </div>
    );
  return (
    <div className={`trash-row ${picked ? "on" : ""}`} title={t.original} onClick={onPick} onMouseEnter={onSweep}>
      {tickBox}
      <div className="chathome-thumb">{src ? <img src={src} alt="" /> : null}</div>
      <div className="chathome-meta">
        <div className="chathome-name">{t.name}</div>
        <div className="chathome-when">{when}</div>
      </div>
      {actions}
    </div>
  );
}

export function TrashView({ onBack, cards }: { onBack: () => void; cards?: boolean }) {
  const [items, setItems] = useState<Trashed[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const last = useRef<string | null>(null);
  const load = () =>
    void trashList().then((list) => {
      setItems(list);
      setPicked((p) => p.filter((id) => list.some((t) => t.id === id)));
    });
  useEffect(load, []);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".trash-row, .trash-card, .trash-foot, .sheet-back")) setPicked([]);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, []);
  // while the mouse is held after pressing a tick box: true ticks every box passed over, false clears it
  const sweep = useRef<boolean | null>(null);
  useEffect(() => {
    const up = () => void (sweep.current = null);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  const tick = (id: string) => {
    last.current = id;
    sweep.current = !picked.includes(id);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const swept = (id: string) => {
    if (sweep.current === null) return;
    const on = sweep.current;
    setPicked((p) => (on ? (p.includes(id) ? p : [...p, id]) : p.filter((x) => x !== id)));
  };
  const pick = (id: string, e: React.MouseEvent) => {
    const ids = (items ?? []).map((t) => t.id);
    if (e.shiftKey && last.current && ids.includes(last.current)) {
      const [a, b] = [ids.indexOf(last.current), ids.indexOf(id)].sort((x, y) => x - y);
      setPicked(ids.slice(a, b + 1));
      return;
    }
    last.current = id;
    if (e.metaKey || e.ctrlKey) setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    else setPicked((p) => (p.length === 1 && p[0] === id ? [] : [id]));
  };
  const named = (n: number) => (n === 1 ? "1 project" : `${n} projects`);
  const putBack = async (ids: string[]) => {
    for (const id of ids) {
      const t = items?.find((x) => x.id === id);
      await trashRestore(id).catch((e) => message(`“${t?.name ?? "A project"}” could not be put back. ${String(e)}`, { title: "Put back", kind: "warning" }));
    }
    load();
  };
  const deleteAll = async (ids: string[], what: string) => {
    if (!(await ask(`Delete ${what} for good? ${ids.length === 1 ? "It" : "They"} cannot be brought back.`, { title: "Duet", kind: "warning", okLabel: "Delete", cancelLabel: "Keep them" }))) return;
    for (const id of ids) await trashDelete(id).catch(() => undefined);
    load();
  };
  const foot = items && items.length > 0 && (
    <div className="trash-foot">
      {picked.length > 0 ? (
        <>
          <span>{picked.length} picked</span>
          <button className="pill" onClick={() => void putBack(picked)}>
            Put back
          </button>
          <button className="pill" onClick={() => void deleteAll(picked, named(picked.length))}>
            Delete
          </button>
        </>
      ) : (
        <button className="pill" onClick={() => void deleteAll(items.map((t) => t.id), `all ${named(items.length)} in the Trash`)}>
          Empty Trash
        </button>
      )}
    </div>
  );
  const rows = items?.map((t) => <TrashRow key={t.id} t={t} card={cards} picked={picked.includes(t.id)} onPick={(e) => pick(t.id, e)} onTick={() => tick(t.id)} onSweep={() => swept(t.id)} onDone={load} />);
  if (cards)
    return (
      <div className="trash-cards">
        <div className="trash-bar">
          <span className="trash-note">Projects stay here for {TRASH_DAYS} days, then they are cleared out.</span>
          {foot}
        </div>
        {items && items.length === 0 ? <div className="recents-empty">The Trash is empty.</div> : <div className="recents-grid">{rows}</div>}
      </div>
    );
  return (
    <div className="chathome-body trash-body">
      <div className="chathome-skills-head trash-head">
        <b>Trash</b>
        <button className="pill" onClick={onBack}>
          Back
        </button>
      </div>
      <div className="trash-note">Projects stay here for {TRASH_DAYS} days, then they are cleared out.</div>
      <div className="trash-list">
        {rows}
        {items && items.length === 0 && <div className="chathome-none">The trash is empty.</div>}
      </div>
      {foot}
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

/** Open: on screen, in a tab, or waiting in memory with an AI still at work. */
export const isProjectOpen = (path: string) => path === getState().project.file || getTabs().includes(path) || isParked(path);

/** Close a project: its tab goes, and if it was on screen the next one comes up, or none. */
export async function leaveProject(path: string): Promise<boolean> {
  if (!(await readyToLeave(true, path))) return false;
  const on = getState().project.file;
  const next = path === on ? getTabs().filter((p) => p !== path).pop() : null;
  closeTab(path);
  if (path === on) {
    if (!next || !(await openProjectAt(next, true))) await closeProject();
  }
  return true;
}

/** What can be done with a project, on a right click in a list of them: here and on Home. */
export function ProjectMenu({ at, onDone, onRename }: { at: { x: number; y: number; r: Recent }; onDone: () => void; onRename?: (path: string) => void }) {
  const warn = (title: string) => (why: string | null) => void (why && message(why, { title, kind: "warning" }));
  useEffect(() => {
    window.addEventListener("pointerdown", onDone);
    window.addEventListener("blur", onDone);
    return () => {
      window.removeEventListener("pointerdown", onDone);
      window.removeEventListener("blur", onDone);
    };
  }, [onDone]);
  return (
    <div className="chathome-menu" style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
      <div
        onClick={() => {
          void revealItemInDir(at.r.path);
          onDone();
        }}
      >
        <Icon name="folder" size={15} /> Show in Finder
      </div>
      {onRename && (
        <div
          onClick={() => {
            onRename(at.r.path);
            onDone();
          }}
        >
          <Icon name="pen" size={15} /> Rename
        </div>
      )}
      <div
        onClick={() => {
          const r = at.r;
          onDone();
          void moveProjectTo(r.path).then(warn("Move to"));
        }}
        title="Move the file to another folder. Its history and conversation go with it."
      >
        <Icon name="move-to" size={15} /> Move to…
      </div>
      <div
        onClick={() => {
          const r = at.r;
          onDone();
          void copyProject(r.path).then(warn("Save a copy"));
        }}
        title="Save a second file somewhere else. This one stays as it is."
      >
        <Icon name="copy" size={15} /> Save a copy…
      </div>
      {isProjectOpen(at.r.path) && (
        <div
          onClick={() => {
            void leaveProject(at.r.path);
            onDone();
          }}
          title="Your work is saved."
        >
          <Icon name="close" size={15} /> Close
        </div>
      )}
      <div
        onClick={() => {
          removeRecent(at.r.path);
          onDone();
        }}
        title="Takes it off this list. The file is not deleted."
      >
        <Icon name="unlist" size={15} /> Remove from list
      </div>
      <div
        onClick={async () => {
          const r = at.r;
          onDone();
          if (isProjectOpen(r.path) && !(await leaveProject(r.path))) return;
          await trashProject(r.path).catch((e) => message(`“${r.name}” could not be moved to the Trash. ${String(e)}`, { title: "Move to Trash", kind: "warning" }));
        }}
        title={`Kept ${TRASH_DAYS} days in the Trash, then cleared out.`}
      >
        <Icon name="trash" size={15} /> Move to Trash
      </div>
    </div>
  );
}


/** Close a new design with no file yet ("" is unsaved work on the plain start). Its work is lost, so ask first if there is any. */
async function closeDraft(key: string) {
  const live = liveKey();
  const others = [...getTabs(), ...getUntitled()].filter((p) => p !== key);
  const work = key === (live ?? "") ? currentDoc(getState()).rootIds.length > 0 : true;
  // opening another project asks about unsaved work on the plain start by itself
  const asks = !(key === "" && others.length);
  if (asks && work && inTauri() && !(await ask("This design has not been saved. Close it anyway?", { title: "Duet", kind: "warning", okLabel: "Close", cancelLabel: "Keep working" }))) return;
  if (key) closeUntitled(key);
  if (key !== (live ?? "")) return;
  const next = others[others.length - 1];
  if (next && (await openProjectAt(next, true))) return;
  if (!(await readyToLeave(true))) return;
  await closeProject();
}

/** A new design with no file yet, in the Projects list. */
function DraftRow({ k, on }: { k: string; on: boolean }) {
  const live = useStore((s) => s.project.name);
  const name = k ? tabTitle(k) : live;
  return (
    <div className={`chathome-row ${on ? "on" : ""}`} onClick={() => void (!on && openProjectAt(k))} title="Not saved yet">
      <div className="chathome-thumb" />
      <div className="chathome-meta">
        <div className="chathome-name">{name}</div>
        <div className="chathome-when">{on ? "Open now, not saved yet" : "Open, not saved yet"}</div>
      </div>
      <CloseCross on={on} onClose={() => void closeDraft(k)} />
    </div>
  );
}

/** An open project in the folded sidebar: its small picture, or its first letter. */
function FoldedProject({ k, on }: { k: string; on: boolean }) {
  const live = useStore((s) => s.project.name);
  const file = /\.duet$/i.test(k);
  const src = usePreview(file ? k : "");
  const name = k ? tabTitle(k) : live;
  return (
    <button className={`projects-strip-item ${on ? "on" : ""}`} title={name} aria-label={name} onClick={() => void (!on && openProjectAt(k))}>
      {src ? <img src={src} alt="" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
    </button>
  );
}

/**
 * Your projects, down the left of every space: the ones open at the top, then the rest.
 * It takes the place of tabs. Folded, it is a thin strip of the open ones and a +.
 */
export function ProjectsSidebar() {
  const space = useLayout((d) => d.space);
  const folded = useLayout((d) => !d.projectsOpen[d.space]);
  const fold = (open: boolean) => setLayout({ projectsOpen: { ...getLayout().projectsOpen, [space]: open } });
  // Home is a page of Studio's
  const goHome = () => {
    if (space !== "edit") setLayout({ space: "edit" });
    window.dispatchEvent(new Event("duet:home"));
  };
  // the skills are a page of their own, over whichever space you are in
  const openSkills = () => window.dispatchEvent(new Event("duet:skills-page"));
  const openRecipes = () => window.dispatchEvent(new Event("duet:recipes-page"));
  const empty = useStore((s) => currentDoc(s).rootIds.length === 0);
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
  const tabs = getTabs();
  const [trash, setTrash] = useState(false);
  const findBox = useRef<HTMLInputElement>(null);
  // the menu's Find a project puts the cursor here, whether this list was already showing or has just come up
  useEffect(() => {
    const find = () => void (takeFindProject() && findBox.current?.focus());
    find();
    window.addEventListener("duet:find-project", find);
    return () => window.removeEventListener("duet:find-project", find);
  }, []);
  const [menu, setMenu] = useState<{ x: number; y: number; r: Recent } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const wordsOf = useWords(recents.map((r) => r.path), typed.trim() !== "");
  // open projects stay together at the top in the order of the Studio tabs, so opening or closing one never shuffles the rest
  const rank = (path: string) => {
    const at = tabs.indexOf(path);
    return at >= 0 ? at : path === current.file || isParked(path) ? tabs.length : Infinity;
  };
  const shown = matchProjects(recents, typed, wordsOf)
    .map((r, i) => ({ r, i, k: rank(r.path) }))
    .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k - b.k))
    .map((x) => x.r);

  const isOpen = isProjectOpen;
  const leave = leaveProject;

  const live = liveKey();
  // new designs with no file yet sit at the top, and so does unsaved work on the plain start once something is made
  const drafts = [...getUntitled(), ...(!live && !empty ? [""] : [])];
  const opened = shown.filter((r) => isOpen(r.path));
  const openNow = opened;
  const rest = shown.filter((r) => !isOpen(r.path));
  const row = (r: Recent, compact = false) => (
    <Fragment key={r.path}>
      <ProjectRow
        r={r}
        compact={compact}
        on={r.path === current.file}
        open={isOpen(r.path)}
        onOpen={() => {
          if (r.path !== current.file) void openProjectAt(r.path);
        }}
        onClose={() => void leave(r.path)}
        onMenu={(x, y) => setMenu({ x, y, r })}
        renaming={renaming === r.path}
        onRenamed={() => setRenaming(null)}
      />
      {r.path === current.file && <TaskList project={r.path} />}
    </Fragment>
  );

  return (
    <>
      {folded ? (
        <aside className="projects-side folded">
          <nav className="chathome-rail">
            <button className="rail-btn" title="Show your projects" aria-label="Show your projects" onClick={() => fold(true)}>
              <Icon name="fold" size={18} className="fold-open" />
            </button>
            {/* the same things in the same order as the open panel, as icons */}
            <button className="rail-btn" title="New design" onClick={() => void newDesignTab()}>
              <Icon name="new-chat" size={18} />
            </button>
            <button className="rail-btn" title="Find a project" onClick={() => (fold(true), askToFindProject())}>
              <Icon name="search" size={18} />
            </button>
            <button className="rail-btn" title="Home" onClick={goHome}>
              <Icon name="home" size={18} />
            </button>
            <button className="rail-btn" title="Store" onClick={openSkills}>
              <Icon name="skills" size={18} />
            </button>
            <button className="rail-btn" title="Recipes" onClick={openRecipes}>
              <Icon name="list" size={18} />
            </button>
            <button className="rail-btn" title="Trash" onClick={() => (fold(true), setTrash(true))}>
              <Icon name="trash" size={18} />
            </button>
            {/* the open projects stand in for the list: one small picture each */}
            <div className="rail-projects">
              {drafts.map((key) => (
                <FoldedProject key={key || "start"} k={key} on={key === (live ?? "")} />
              ))}
              {opened.map((r) => (
                <FoldedProject key={r.path} k={r.path} on={r.path === current.file} />
              ))}
            </div>
            <button className="rail-btn" title="Tell the creator what went wrong or what you want. Cmd or Ctrl, Shift, F" onClick={askFeedback}>
              <Icon name="feedback" size={18} />
            </button>
            <button className="rail-btn" title="Settings" onClick={() => window.dispatchEvent(new Event("duet:settings"))}>
              <Icon name="settings" size={18} />
            </button>
          </nav>
        </aside>
      ) : (
        <aside className="projects-side open">
          <div className="side-head">
            <span>Projects</span>
            <button className="rail-btn" title="Fold away" aria-label="Fold away" onClick={() => fold(false)}>
              <Icon name="fold" size={16} />
            </button>
          </div>
          <div className="side-items">
            <button className="chathome-item" onClick={() => void newDesignTab()}>
              <Icon name="new-chat" size={16} />
              New design
            </button>
            <label className="chathome-item side-find">
              <Icon name="search" size={16} />
              <input
                ref={findBox}
                placeholder="Find a project"
                value={typed}
                onChange={(e) => (setTrash(false), setTyped(e.target.value))}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") {
                    setTyped("");
                    e.currentTarget.blur();
                  }
                }}
              />
            </label>
            <button className="chathome-item" onClick={goHome}>
              <Icon name="home" size={16} />
              Home
            </button>
            <button className="chathome-item" onClick={openSkills}>
              <Icon name="skills" size={16} />
              Store
            </button>
            <button className="chathome-item" onClick={openRecipes}>
              <Icon name="list" size={16} />
              Recipes
            </button>
            <button className={`chathome-item ${trash ? "on" : ""}`} onClick={() => setTrash(!trash)}>
              <Icon name="trash" size={16} />
              Trash
            </button>
          </div>
          {trash ? (
            <TrashView onBack={() => setTrash(false)} />
          ) : (
            <div className="chathome-body">
              <div className="chathome-list">
                {(drafts.length > 0 || openNow.length > 0) && <div className="chathome-label">Open</div>}
                {drafts.map((key) => (
                  <DraftRow key={key || "start"} k={key} on={key === (live ?? "")} />
                ))}
                {openNow.map((r) => row(r))}
                {rest.length > 0 && <div className="chathome-label">Recent</div>}
                {rest.map((r) => row(r, true))}
                {shown.length === 0 && <div className="chathome-none">{recents.length ? "No project has that in it." : "Your projects will be listed here."}</div>}
              </div>
            </div>
          )}
          <div className="side-foot">
            <button className="chathome-item" onClick={() => window.dispatchEvent(new Event("duet:settings"))}>
              <Icon name="settings" size={16} />
              Settings
            </button>
            <button className="rail-btn" title="Tell the creator what went wrong or what you want. Cmd or Ctrl, Shift, F" onClick={askFeedback}>
              <Icon name="feedback" size={16} />
            </button>
          </div>
        </aside>
      )}
      {menu && <ProjectMenu at={menu} onDone={() => setMenu(null)} onRename={(path) => (setTyped(""), setRenaming(path))} />}
    </>
  );
}

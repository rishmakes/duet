import { flushPictures, picturesIn, preloadPictures } from "./assets";
import { adoptFonts, fontFilesIn } from "./fonts";
import { renderPng } from "./exporter";
import { invoke } from "@tauri-apps/api/core";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { emptyDoc } from "../document/types";
import type { Doc } from "../document/types";
import { DesignFileError, parseDoc, serializeDoc } from "../document/serialize";
import { readyToLeave } from "../ai/agent";
import { AGENTS, conversationProject, forgetSteps, forgetTasks, getChat, moveConversationTo, restoreConversation, restoreTasks, showConversationFor, subscribeChat } from "../ai/chat";
import type { AgentId } from "../ai/chat";
import { loadThread, saveThread } from "../memory/files";
import { stepsLine } from "../memory/steps";
import { logError } from "../errorLog";
import { isUntitledName, nameFromWork } from "./naming";
import { lineTo } from "../state/directions";
import { keepable, packThread, readThread } from "../memory/thread";
import { dropParked, getState, isParked, parkedFiles, loadDoc, loadTimeline, onParkedChange, parkLive, parkedState, setEntryVersion, setProject, subscribe, unpark } from "../state/store";
import type { HistoryEntry } from "../state/store";

const FILE = "design.json";
const LAST_KEY = "duet:last-project";
const HISTORY_LIMIT = 300;

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const join = (dir: string, name: string) => (dir.endsWith("/") || dir.endsWith("\\") ? dir + name : `${dir}/${name}`);
const baseName = (p: string) => (p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p).replace(/\.duet$/i, "");
/** A project is a folder whose name ends in .duet. Add the ending if it was left off. */
const withExt = (p: string) => (/\.duet$/i.test(p) ? p : `${p}.duet`);

let lastSaved: Doc | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** Where the save window starts: the Duet folder in Documents, so projects end up in one place. */
async function startFolder(name: string): Promise<string> {
  try {
    return join(await invoke<string>("default_projects_dir"), name);
  } catch {
    return name;
  }
}

/** Look through a folder for Duet projects and add them to the list. Returns how many were found. */
export async function findProjects(root: string): Promise<number> {
  const found = await invoke<{ path: string; modified: number }[]>("find_projects", { root });
  const known = new Set(getRecents().map((r) => r.path));
  const add = found.filter((f) => !known.has(f.path));
  if (add.length) {
    const all = [...getRecents(), ...add.map((f) => ({ path: f.path, name: baseName(f.path), opened: f.modified }))];
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(all.sort((a, b) => b.opened - a.opened).slice(0, RECENT_MAX)));
    } catch {
      /* nothing to do */
    }
    window.dispatchEvent(new Event("duet:recents"));
  }
  return add.length;
}

/** Run saves one after another, so two saves never overlap. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

const committed = () => {
  const s = getState();
  return s.timeline[s.cursor].doc;
};

const RECENT_KEY = "duet:recent";
/** How many projects the list keeps. The same everywhere, so opening one never pushes others off. */
const RECENT_MAX = 200;

export interface Recent {
  path: string;
  name: string;
  /** A small picture of the first screen, as a data address. */
  thumb?: string;
  /** When it was last opened, as milliseconds. */
  opened: number;
  /** Its file is not where it was, and Duet could not find where it went. */
  missing?: boolean;
}

/** Every project you have made or opened here, newest first. */
/**
 * The projects to list: every open one, even one not on the list yet (a new project in Duet dev,
 * which never writes to the list), then the rest as they are kept.
 */
/** Listed files found missing on the last look, such as one moved to the Trash in Finder. They come back if the file does. */
const missing = new Set<string>();

/**
 * Look again at which listed files are still there. One renamed or moved outside Duet is found again
 * by its history and listed where it is now; one that cannot be found stays listed, marked missing.
 */
export async function checkListed() {
  if (!inTauri() || checking) return;
  checking = true;
  try {
    let changed = false;
    const live = getState().project.file;
    for (const path of new Set([...getRecents().map((r) => r.path), ...getTabs()])) {
      const there = (await invoke<boolean>("path_exists", { path }).catch(() => true)) === true;
      if (there) {
        if (missing.delete(path)) changed = true;
        continue;
      }
      if (missing.has(path)) continue;
      if (path === live) {
        await followLive();
        continue;
      }
      // a project waiting in a tab follows its file once it is back on screen
      const found = isParked(path) ? null : await findMoved(path);
      if (found) repoint(path, found);
      else missing.add(path);
      changed = true;
    }
    if (changed) window.dispatchEvent(new Event("duet:recents"));
  } finally {
    checking = false;
  }
}
let checking = false;

/** Where a project file went after it was renamed or moved outside Duet: its own folder and the Duet folder are looked through. */
async function findMoved(file: string): Promise<string | null> {
  try {
    const roots = [file.replace(/[\\/][^\\/]*$/, ""), await invoke<string>("default_projects_dir")];
    return (await invoke<string | null>("find_moved_project", { file, roots })) ?? null;
  } catch (e) {
    logError("find a moved project", e);
    return null;
  }
}

/** A project's file is somewhere else now: the list, the tabs and the last one opened follow it. */
export function repoint(from: string, to: string) {
  missing.delete(from);
  if (getTabs().includes(from)) setTabs([...new Set(getTabs().map((p) => (p === from ? to : p)))]);
  if (checkCopy) return;
  try {
    const list = getRecents();
    const moved = list.some((r) => r.path === to)
      ? list.filter((r) => r.path !== from)
      : list.map((r) => (r.path === from ? { ...r, path: to, name: baseName(to) } : r));
    localStorage.setItem(RECENT_KEY, JSON.stringify(moved));
    if (localStorage.getItem(LAST_KEY) === from) localStorage.setItem(LAST_KEY, to);
  } catch {
    /* private mode: the list is not kept */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("duet:recents"));
}

export function listedProjects(): Recent[] {
  // a project whose file cannot be found stays listed, marked, so it can be found again or let go
  const recents = getRecents().map((r) => (missing.has(r.path) ? { ...r, missing: true } : r));
  const known = new Set(recents.map((r) => r.path));
  const here = getState().project.file;
  const open = [...new Set([...(here ? [here] : []), ...getTabs(), ...parkedFiles()])]
    .filter((p) => !known.has(p) && /\.duet$/i.test(p))
    .map((path) => ({ path, name: baseName(path), opened: Date.now() }));
  return [...open, ...recents];
}

export function getRecents(): Recent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Recent[];
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: Recent[] = [];
    for (const r of raw) {
      if (!r || typeof r.path !== "string") continue;
      // only single .duet files are projects now
      if (!/\.duet$/i.test(r.path) || seen.has(r.path)) continue;
      seen.add(r.path);
      out.push(r);
    }
    return out;
  } catch {
    return [];
  }
}

export function removeRecent(path: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(getRecents().filter((r) => r.path !== path)));
  } catch {
    /* nothing to do */
  }
  window.dispatchEvent(new Event("duet:recents"));
}

/** Put a project on the list, newest first. Used when it comes back from the trash. */
function addRecent(path: string) {
  try {
    const rest = getRecents().filter((r) => r.path !== path);
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ path, name: baseName(path), opened: Date.now() }, ...rest].slice(0, RECENT_MAX)));
  } catch {
    /* nothing to do */
  }
  window.dispatchEvent(new Event("duet:recents"));
}

export interface Trashed {
  id: string;
  name: string;
  original: string;
  /** When it was moved to the trash, as milliseconds. */
  trashed: number;
}

/** Days a project stays in the trash before it is cleared out. */
export const TRASH_DAYS = 30;

/** Move a project to Duet's trash. It leaves the list and can be put back for 30 days. */
export async function trashProject(path: string) {
  // already gone from its folder: there is nothing to move, so it only leaves the list
  if ((await invoke<boolean>("path_exists", { path })) === true) await invoke("trash_project", { path });
  removeRecent(path);
  closeTab(path);
}

/** What is in the trash, newest first. Anything older than 30 days is cleared out on the way. */
export async function trashList(): Promise<Trashed[]> {
  try {
    return await invoke<Trashed[]>("trash_list");
  } catch {
    return [];
  }
}

export async function trashRestore(id: string) {
  addRecent(await invoke<string>("trash_restore", { id }));
}

export async function trashDelete(id: string) {
  await invoke("trash_delete", { id });
}

/** True in Duet dev, a second Duet used only to check work on Duet itself. Set once at launch. */
let checkCopy = false;
export const isCheckCopy = () => checkCopy;

/** Find out, before anything is opened, whether this is Duet dev. */
export async function learnCheckCopy(): Promise<boolean> {
  checkCopy = inTauri() && (await invoke<boolean>("check_copy").catch(() => false));
  return checkCopy;
}

// ---- open projects, shown as tabs. One is on screen; the others wait in memory with their history, and an AI can keep working in them ----
const TABS_KEY = "duet:tabs";
let tabs: string[] | null = null;

/** The projects you have open, in the order you opened them. */
export function getTabs(): string[] {
  if (tabs) return tabs;
  try {
    // Duet dev keeps its own open projects only until it closes, so reloading its code does not lose them
    const raw = JSON.parse((checkCopy ? sessionStorage : localStorage).getItem(TABS_KEY) ?? "[]");
    tabs = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string" && /\.duet$/i.test(p)) : [];
  } catch {
    tabs = [];
  }
  return tabs;
}

function setTabs(next: string[]) {
  tabs = next;
  try {
    // Duet dev shares this storage with the Duet a designer works in, and must leave it alone
    (checkCopy ? sessionStorage : localStorage).setItem(TABS_KEY, JSON.stringify(next));
  } catch {
    /* private mode: tabs last until Duet closes */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("duet:tabs"));
}

/** Put a project among the open ones. */
export function addTab(path: string) {
  if (!getTabs().includes(path)) setTabs([...getTabs(), path].slice(-12));
}

/** Take a project off the open ones. Returns the one to show next, if there is one. */
export function closeTab(path: string): string | null {
  if (isParked(path)) void forgetParked(path);
  const list = getTabs();
  const at = list.indexOf(path);
  const rest = list.filter((p) => p !== path);
  setTabs(rest);
  return rest[Math.min(at, rest.length - 1)] ?? null;
}

// ---- new designs with no file yet: each has its own tab too, kept while Duet is open ----

/** Tabs of work that has no file yet, in the order they were made. */
let untitled: string[] = [];
/** The tab of the work on screen when it has no file. Null for the plain empty start, which has no tab of its own. */
let untitledKey: string | null = null;
let untitledMade = 0;
/** Set when the tab on screen was closed: its work is let go, not put away, when the next one opens. */
let letGoLive = false;
export const getUntitled = () => untitled;
export const isUntitled = (key: string) => key.startsWith("untitled:");
/** The tab of the project on screen, or null for the plain empty start. */
export const liveKey = () => getState().project.file ?? untitledKey;

/** Give the work on screen a tab of its own. Its conversation goes with it. */
function giveUntitledTab(): string {
  untitledMade += 1;
  const key = `untitled:${untitledMade}`;
  untitled = [...untitled, key];
  untitledKey = key;
  moveConversationTo(key);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("duet:tabs"));
  return key;
}

/** Take a tab of unsaved work away: closed, or given a file. */
function dropUntitled(key: string) {
  untitled = untitled.filter((k) => k !== key);
  if (untitledKey === key) untitledKey = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("duet:tabs"));
}

const blank = () => {
  const s = getState();
  return s.timeline.length === 1 && committed().rootIds.length === 0;
};

/** What a tab shows as its name. */
export function tabTitle(key: string): string {
  if (!isUntitled(key)) return tabName(key);
  if (key === untitledKey) return getState().project.name;
  return parkedState(key)?.project.name ?? "Untitled";
}

/** A tab of unsaved work was closed. Its work is let go. */
export function closeUntitled(key: string) {
  if (key === untitledKey) letGoLive = true;
  if (isParked(key)) {
    dropParked(key);
    forgetSteps(key);
    forgetTasks(key);
  }
  dropUntitled(key);
}

export const tabName = (path: string) => getRecents().find((r) => r.path === path)?.name ?? baseName(path);

function remember(path: string | null) {
  if (path) addTab(path);
  try {
    // Duet dev shares this list with the Duet a designer works in, and must leave it alone
    if (!path || checkCopy) return;
    localStorage.setItem(LAST_KEY, path);
    const old = getRecents().find((r) => r.path === path);
    const rest = getRecents().filter((r) => r.path !== path);
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ path, name: baseName(path), opened: Date.now(), thumb: old?.thumb }, ...rest].slice(0, RECENT_MAX)));
    window.dispatchEvent(new Event("duet:recents"));
  } catch {
    /* private mode: nothing to remember */
  }
}

async function oops(text: string) {
  if (inTauri()) await message(text, { title: "Duet", kind: "error" });
  else console.error(text);
}

/** A small picture of the first screen, as PNG data. Null when there is nothing to show. */
async function previewPng(doc: Doc): Promise<string | null> {
  const id = doc.rootIds.find((i) => doc.elements[i]?.type === "frame" || doc.elements[i]?.type === "instance") ?? doc.rootIds[0];
  if (!id) return null;
  const el = doc.elements[id];
  await preloadPictures(doc);
  return renderPng(doc, id, Math.min(1, 360 / Math.max(el.width, el.height, 1)));
}

let previewTimer: ReturnType<typeof setTimeout> | undefined;
/** Drawing the preview takes a moment on a big design, so it waits until you pause, never during a save. */
function previewLater(path: string, doc: Doc) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const draw = () => void writePreview(path, doc);
    if (typeof requestIdleCallback === "function") requestIdleCallback(draw, { timeout: 4000 });
    else draw();
  }, 8000);
}

/** A small picture of the first screen, kept with the project in the list of projects. */
async function writePreview(path: string, doc: Doc) {
  try {
    const b64 = await previewPng(doc);
    if (!b64) return;
    await invoke("write_binary_file", { path: join(path, "preview.png"), dataBase64: b64 });
    const key = getState().project.file ?? path;
    const list = getRecents().map((r) => (r.path === key ? { ...r, thumb: `data:image/png;base64,${b64}` } : r));
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event("duet:recents"));
  } catch (e) {
    console.warn("Could not make a preview:", e);
  }
}

// ---- rename, move, copy ----

/** The project file being moved right now, if any. */
let moving: string | null = null;

/**
 * Rename or move a project file, open or not. Its history, conversation and tasks go with it.
 * A project open in another tab comes on screen first. Returns why it could not be done, or null.
 */
export async function moveProject(from: string, to: string): Promise<string | null> {
  if (!inTauri()) return "Projects can be renamed in the desktop app.";
  const target = withExt(to.trim());
  if (target === from) return null;
  if (getChat().busy !== null) return "An AI is still working. Wait for it or stop it first.";
  if (isParked(from) && !(await openProjectAt(from))) return null;
  if (getState().project.file === from) await saveNow();
  return enqueue(async () => {
    const here = getState().project.file === from;
    if (here) await packNow();
    moving = from;
    let work: string;
    try {
      work = await invoke<string>("move_project", { from, to: target });
    } catch (e) {
      return String(e);
    } finally {
      moving = null;
    }
    if (getState().project.file === from) {
      moveConversationTo(target);
      setProject({ path: work, file: target, name: baseName(target) });
    }
    if (getTabs().includes(from)) setTabs(getTabs().map((p) => (p === from ? target : p)));
    try {
      if (!checkCopy) {
        const list = getRecents().map((r) => (r.path === from ? { ...r, path: target, name: baseName(target) } : r));
        localStorage.setItem(RECENT_KEY, JSON.stringify(list));
        if (localStorage.getItem(LAST_KEY) === from) localStorage.setItem(LAST_KEY, target);
      }
    } catch {
      /* private mode: the list is not kept */
    }
    window.dispatchEvent(new Event("duet:recents"));
    return null;
  });
}

/** A new name for a project, in the same folder. */
export const renameProject = (file: string, name: string) => {
  const clean = name.replace(/[\\/:*?"<>|]+/g, " ").trim();
  if (!clean) return Promise.resolve("Give the project a name.");
  return moveProject(file, join(file.replace(/[\\/][^\\/]*$/, ""), `${clean}.duet`));
};

/**
 * Work an AI did in an Untitled project gets a name from what is in it, quietly, once. A project
 * someone has named is left alone. Only the project on screen, so nothing else comes on screen.
 */
export async function nameUntitledWork(file: string, firstAsk?: string) {
  const s = getState();
  if (!inTauri() || inTest || s.project.file !== file || !isUntitledName(s.project.name) || s.timeline.length <= 1) return;
  const name = nameFromWork(committed(), firstAsk);
  if (!name) return;
  try {
    const dir = file.replace(/[\\/][^\\/]*$/, "");
    for (let n = 1; n < 100; n++) {
      const target = join(dir, n === 1 ? `${name}.duet` : `${name} ${n}.duet`);
      if ((await invoke<boolean>("path_exists", { path: target })) === true) continue;
      const failed = await moveProject(file, target);
      if (failed) logError("name untitled work", failed);
      return;
    }
  } catch (e) {
    logError("name untitled work", e);
  }
}

/** Ask where to move a project, then move it. */
export async function moveProjectTo(file: string): Promise<string | null> {
  const picked = await once(() => save({ title: "Move to", defaultPath: file, filters: [{ name: "Duet project", extensions: ["duet"] }] }));
  return picked ? moveProject(file, picked) : null;
}

/**
 * Save a copy of a project somewhere else. The one on screen opens the Send a copy window, which
 * asks whether the history and the conversation go too; one that is not open is copied as it is.
 */
export async function copyProject(file: string): Promise<string | null> {
  if (!inTauri()) return "Copies can be saved in the desktop app.";
  if (isParked(file) && !(await openProjectAt(file))) return null;
  if (getState().project.file === file) {
    window.dispatchEvent(new Event("duet:send-copy"));
    return null;
  }
  const picked = await once(() => save({ title: "Save a copy", defaultPath: copyNameFor(file), filters: [{ name: "Duet project", extensions: ["duet"] }] }));
  if (!picked) return null;
  try {
    await invoke("copy_project", { from: file, to: withExt(picked) });
    return null;
  } catch (e) {
    return String(e);
  }
}

// ---- one file: the project is packed into its .duet file after every save ----
let packTimer: ReturnType<typeof setTimeout> | undefined;

/** Project files made in this session and not written yet. Only these may be made; any other is only written where it still is. */
const fresh = new Set<string>();
/** Said by the file side when a project file is no longer where it was. */
const LOST = "The project file is no longer where it was.";

async function packNow() {
  clearTimeout(packTimer);
  packTimer = undefined;
  const { path, file } = getState().project;
  // a file being moved is written again only once it has arrived
  if (!path || !file || file === moving) return;
  try {
    await invoke("pack_project", { dir: path, file, fresh: fresh.has(file) });
    fresh.delete(file);
  } catch (e) {
    // renamed, moved or deleted outside Duet: never written back where it was
    if (String(e) === LOST) await followLive();
    else throw e;
  }
}

/** Files Duet has already asked about this session, so the question comes once. */
const askedLost = new Set<string>();

/**
 * The file of the project on screen has gone. If it was renamed or moved, Duet follows it there and
 * keeps saving into it. If it cannot be found, the work stays safe here and the designer chooses where it goes.
 */
async function followLive() {
  const { path, file } = getState().project;
  if (!path || !file) return;
  const found = await findMoved(file);
  if (found) return void (await settleLive(file, found, false));
  setProject({ status: "error", error: "This project's file was moved or deleted outside Duet. Your work is safe here." });
  if (askedLost.has(file) || !inTauri()) return;
  askedLost.add(file);
  const here = await ask(`“${baseName(file)}” was moved, renamed or deleted outside Duet, and Duet could not find where it went. Your work and its history are safe here. Where should it be kept?`, {
    title: "Duet",
    kind: "warning",
    okLabel: "Save it where it was",
    cancelLabel: "Choose a place",
  });
  const picked = here ? file : await once(() => chooseFile("Keep this project"));
  if (picked && getState().project.file === file) await settleLive(file, picked, true);
}

/** The project on screen is kept in another file from now on, with its history and its conversation. */
async function settleLive(from: string, to: string, make: boolean) {
  const work = from === to ? getState().project.path! : await invoke<string>("follow_work_dir", { from, to });
  if (make) fresh.add(to);
  if (from !== to) moveConversationTo(to);
  setProject({ path: work, file: to, name: baseName(to), status: "saved", error: null });
  askedLost.delete(from);
  repoint(from, to);
  await packNow();
}

function schedulePack() {
  if (!getState().project.file) return;
  clearTimeout(packTimer);
  packTimer = setTimeout(() => void packNow().catch((e) => setProject({ status: "error", error: String(e) })), 1200);
}

/** Write the file right now if a write is waiting. Used when the window closes. */
export async function flushPack() {
  await flushThread();
  if (packTimer) await packNow().catch(() => undefined);
}

// ---- the conversation is kept with the project ----

let threadTimer: ReturnType<typeof setTimeout> | undefined;
/** The working folder a conversation is waiting to be written to. */
let threadFor: string | null = null;
/** What was last read from or written to a project's thread file, so nothing is written twice. */
let threadKept: { dir: string; text: string } | null = null;

/** The conversation changed. Write it into the project a moment later. */
function threadChanged() {
  const { path, file } = getState().project;
  // while another project is being opened the chat and the project do not match yet
  if (!path || file !== conversationProject()) return;
  threadFor = path;
  clearTimeout(threadTimer);
  threadTimer = setTimeout(() => void flushThread(), 800);
}

/** Write the conversation now if a write is waiting. Always called before the chat moves to another project. */
async function flushThread() {
  clearTimeout(threadTimer);
  threadTimer = undefined;
  const dir = threadFor;
  threadFor = null;
  if (!dir || getState().project.path !== dir) return;
  const chat = getChat();
  const project = conversationProject();
  const tasks = chat.tasks.filter((t) => t.project === project && t.messages.length).map((t) => ({ agent: t.agent, title: t.title, said: keepable(t.messages) }));
  // a project nobody has talked in gets no file
  if (!chat.messages.length && !chat.earlier.length && !tasks.length && !Object.keys(chat.names).length && threadKept?.dir !== dir) return;
  const text = packThread({ now: keepable(chat.messages), earlier: keepable(chat.earlier), tasks, names: chat.names });
  if (threadKept?.dir === dir && threadKept.text === text) return;
  try {
    await saveThread(dir, text);
    threadKept = { dir, text };
    schedulePack();
  } catch (e) {
    console.warn("The conversation could not be saved:", e);
  }
}

/** A project has just been opened. If Duet has nothing of its conversation, bring back what was saved with it. */
async function bringBackThread(dir: string) {
  if (getChat().messages.length || getChat().earlier.length) return;
  const text = await loadThread(dir);
  const thread = readThread(text);
  threadKept = text === null ? null : { dir, text: packThread(thread) };
  restoreConversation(thread.now, thread.earlier, thread.names);
  // a task whose AI is not one Duet knows any more is left out
  const known = (thread.tasks ?? []).filter((t) => AGENTS.some((a) => a.id === t.agent && a.runnable));
  restoreTasks(conversationProject(), known.map((t) => ({ agent: t.agent as AgentId, title: t.title, messages: t.said })));
}

async function writeDesign(path: string, doc: Doc) {
  await flushPictures(path, doc);
  await invoke("write_text_file", { path: join(path, FILE), contents: serializeDoc(doc) });
  previewLater(path, doc);
}

// ---- projects waiting in a tab are saved too: an AI may still be working in one ----

interface Kept {
  lastSaved: Doc | null;
  stepsKept: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
}
/** What has been saved of each project waiting in a tab. */
const parkedSaves = new Map<string, Kept>();

/** Save a waiting project's newest change, with a step in its history, and pack its file. */
function saveParked(file: string): Promise<void> {
  return enqueue(async () => {
    const s = parkedState(file);
    const kept = parkedSaves.get(file);
    const path = s?.project.path;
    if (!s || !kept || !path) return;
    clearTimeout(kept.timer);
    kept.timer = undefined;
    const doc = s.timeline[s.cursor].doc;
    if (doc === kept.lastSaved) return;
    const previous = kept.lastSaved;
    kept.lastSaved = doc;
    try {
      await flushPictures(path, doc);
      await invoke("write_text_file", { path: join(path, FILE), contents: serializeDoc(doc) });
      const names = stepsToKeep(s.timeline, s.cursor, kept.stepsKept);
      if (await recordStep(path, stepMessage(wentBackTo(s.timeline[s.cursor], s.cursor < s.timeline.length - 1), s.cursor < s.timeline.length - 1, names))) for (const n of names) kept.stepsKept.add(n);
      await invoke("pack_project", { dir: path, file });
    } catch (e) {
      kept.lastSaved = previous;
      console.warn("A project waiting in its tab could not be saved:", e);
    }
  });
}

let watchingParked = false;
function watchParked() {
  if (watchingParked) return;
  watchingParked = true;
  onParkedChange((file) => {
    const kept = parkedSaves.get(file);
    if (!kept) return;
    clearTimeout(kept.timer);
    kept.timer = setTimeout(() => void saveParked(file), 700);
  });
}

/** Put the project on screen away in its tab, saved, so another can come on screen. Says whether it could wait. */
async function parkCurrent(): Promise<boolean> {
  const { file, path } = getState().project;
  if (!file) {
    // work with no file waits in its own tab, even an empty one made with +; the plain empty start, or a closed tab, is let go
    if (letGoLive) {
      letGoLive = false;
      return false;
    }
    if (inTest || (!untitledKey && blank())) return false;
    const key = untitledKey ?? giveUntitledTab();
    await flushPack();
    parkLive(key);
    untitledKey = null;
    return true;
  }
  if (!path || !getTabs().includes(file)) return false;
  clearTimeout(timer);
  if (committed() !== lastSaved) await saveNow();
  await flushPack();
  if (!parkLive()) return false;
  watchParked();
  parkedSaves.set(file, { lastSaved, stepsKept });
  return true;
}

/** Bring a waiting project back on screen as it was: its history, its selection and its conversation. */
async function bringBack(file: string): Promise<boolean> {
  const kept = parkedSaves.get(file);
  if (kept?.timer) await saveParked(file);
  if (!(await parkCurrent())) await flushPack();
  showConversationFor(file);
  if (!unpark(file)) return false;
  parkedSaves.delete(file);
  lastSaved = kept?.lastSaved ?? committed();
  stepsKept = kept?.stepsKept ?? new Set();
  untitledKey = isUntitled(file) ? file : null;
  if (!untitledKey) remember(file);
  return true;
}

/** + in the tab row: the project on screen waits in its tab, and a new empty design opens in a tab of its own. */
export async function newDesignTab() {
  if (!getState().project.file && blank() && !inTest) {
    // already an empty design: it simply gets its tab
    if (!untitledKey) giveUntitledTab();
    return;
  }
  if (!(await parkCurrent())) await flushPack();
  const n = untitled.length + 1;
  showConversationFor("", true);
  setProject({ path: null, file: null, name: n > 1 ? `Untitled ${n}` : "Untitled", status: "unsaved", error: null });
  loadDoc(emptyDoc(), "New file");
  lastSaved = committed();
  clearTimeout(timer);
  giveUntitledTab();
}

/** A tab was closed: save what is waiting in it, then let it go. */
async function forgetParked(file: string) {
  await saveParked(file);
  const kept = parkedSaves.get(file);
  clearTimeout(kept?.timer);
  parkedSaves.delete(file);
  dropParked(file);
  forgetSteps(file);
  forgetTasks(file);
}

/** The text stored with each saved step. The first line is what the history strip shows. */
export function stepMessage(entry: Pick<HistoryEntry, "label" | "actor" | "by" | "from">, wentBack: boolean, names: string[] = []) {
  const label = wentBack ? `Went back to: ${entry.label}` : entry.label;
  const steps = stepsLine(names);
  // one line, so a name can never start a line of its own meaning
  const by = entry.actor === "ai" && entry.by ? `\nBy: ${entry.by.replace(/\s+/g, " ").trim()}` : "";
  const from = entry.from && stepsLine([entry.from]) ? `\nFrom: ${entry.from}` : "";
  return `${label}\n\nActor: ${entry.actor}${by}${steps ? `\n${steps}` : ""}${from}`;
}

/** Saved while looking at an earlier step, the saved step comes from that step, not from the newest one. */
const wentBackTo = (entry: HistoryEntry, wentBack: boolean): HistoryEntry => (wentBack && entry.step ? { ...entry, from: entry.step } : entry);

/** Names of steps that are already kept in a saved step of the open project. */
let stepsKept = new Set<string>();

/** The names of the steps on the way to here that no saved step holds yet, oldest first, so this one's own name comes last. */
export function stepsToKeep(timeline: Pick<HistoryEntry, "step" | "covers" | "from">[], cursor: number, kept: Set<string>): string[] {
  return lineTo(timeline, cursor).flatMap((i) => {
    const e = timeline[i];
    return e.step && !kept.has(e.step) ? [e.step] : [];
  });
}

/** Record the current design as a saved step. Never blocks or fails the save itself. Says whether a step was made. */
async function recordStep(path: string, text: string): Promise<boolean> {
  try {
    return (await invoke<boolean>("git_commit", { path, message: text })) === true;
  } catch (e) {
    console.warn("History could not record this step:", e);
    return false;
  }
}

async function startHistory(path: string, label: string) {
  try {
    await invoke("git_prepare", { path });
    await invoke("git_commit", { path, message: `${label}\n\nActor: you` });
  } catch (e) {
    console.warn("History could not start:", e);
  }
}

/** Write the current design now, and keep a step in the history. */
export function saveNow(): Promise<void> {
  return enqueue(async () => {
    const s = getState();
    const path = s.project.path;
    if (!path) return saveAs();
    const doc = committed();
    const entry = s.timeline[s.cursor];
    const wentBack = s.cursor < s.timeline.length - 1;
    const previous = lastSaved;
    lastSaved = doc; // set first, so the store update below does not look like a new change
    setProject({ status: "saving", error: null });
    try {
      await writeDesign(path, doc);
      const names = stepsToKeep(s.timeline, s.cursor, stepsKept);
      if (await recordStep(path, stepMessage(wentBackTo(entry, wentBack), wentBack, names))) for (const n of names) stepsKept.add(n);
      schedulePack();
      setProject({ status: committed() === doc ? "saved" : "unsaved" });
    } catch (e) {
      lastSaved = previous;
      setProject({ status: "error", error: String(e) });
    }
  });
}

/** Pick a folder for the current, unsaved work. */
let dialogOpen = false;
/** Run a dialog job once at a time, so a shortcut and its menu item cannot open it twice. */
async function once<T>(job: () => Promise<T>): Promise<T | undefined> {
  if (dialogOpen) return undefined;
  dialogOpen = true;
  try {
    return await job();
  } finally {
    dialogOpen = false;
  }
}

export async function saveAs() {
  await once(saveAsDialog);
}

/** Ask where to keep a project file. Returns the chosen path, or null. */
async function chooseFile(title: string): Promise<string | null> {
  const choice = await save({ title, defaultPath: await startFolder("My design.duet"), filters: [{ name: "Duet project", extensions: ["duet"] }] });
  if (!choice) return null;
  const picked = withExt(choice);
  if ((await invoke<boolean>("is_directory", { path: picked })) === true) {
    await oops("There is an older project folder with that name. Pick a different name.");
    return null;
  }
  return picked;
}

/** Make the project file and its working copy from a design. */
async function createProject(picked: string, doc: Doc, label: string) {
  stepsKept = new Set();
  fresh.add(picked);
  const work = await invoke<string>("fresh_work_dir", { file: picked });
  await writeDesign(work, doc);
  await startHistory(work, label);
  return work;
}

async function saveAsDialog() {
  if (!inTauri()) return;
  const picked = await chooseFile("Save your project");
  if (!picked) return;
  await saveTo(picked);
}

/**
 * Give work that has no file a home of its own, with no window to ask where: the Duet folder in
 * Documents, under the work's name. Anyone can do this, the designer or an AI, since nobody has to
 * answer anything. It can be renamed or moved later with Save as. Says whether the work now has a home.
 */
export function giveHome(): Promise<boolean> {
  if (getState().project.path) return Promise.resolve(true);
  if (!inTauri() || inTest) return Promise.resolve(false);
  // asked again while it is being done, it is done once
  homing ??= (async () => {
    try {
      await saveTo(await freePath(getState().project.name));
    } catch (e) {
      logError("give work a home", e);
    } finally {
      homing = null;
    }
    return !!getState().project.path;
  })();
  return homing;
}
let homing: Promise<boolean> | null = null;

async function saveTo(picked: string) {
  const doc = committed();
  try {
    const work = await createProject(picked, doc, "Start of project");
    lastSaved = doc;
    setProject({ path: work, file: picked, name: baseName(picked), status: "saved", error: null });
    moveConversationTo(picked);
    if (untitledKey) dropUntitled(untitledKey);
    threadChanged();
    await flushThread();
    await packNow();
    remember(picked);
    void writePreview(work, doc);
  } catch (e) {
    await oops(String(e));
  }
}

/** Start a new, empty project in a folder you choose. */
export async function newProject() {
  await once(newProjectDialog);
}

/** The first free "Untitled", "Untitled 2", … in the projects folder. */
const untitledPath = () => freePath("Untitled");

/** The first free "<name>", "<name> 2", … in the projects folder. */
async function freePath(name: string): Promise<string> {
  const dir = await invoke<string>("default_projects_dir");
  const clean = name.replace(/[\\/:*?"<>|]+/g, " ").trim();
  const held = new Set([getState().project.file, ...getTabs(), ...parkedFiles()]);
  // an untitled project takes the next free "Untitled"; any other name is kept as it is
  const base = !clean || /^Untitled( \d+)?$/.test(clean) ? "Untitled" : clean;
  for (let n = 1; n < 1000; n++) {
    const file = join(dir, n === 1 ? `${base}.duet` : `${base} ${n}.duet`);
    // a name an open project still goes by is taken, even when its file was moved away outside Duet
    if (held.has(file)) continue;
    if (!((await invoke<boolean>("path_exists", { path: file })) === true)) return file;
  }
  throw new Error("Too many projects with that name.");
}

async function newProjectDialog() {
  if (!inTauri()) return;
  const s = getState();
  if (!s.project.path && s.timeline.length > 1) {
    const go = await ask("Your current work has not been saved. Start a new project anyway?", {
      title: "Duet",
      kind: "warning",
      okLabel: "Start new",
      cancelLabel: "Cancel",
    });
    if (!go) return;
  }
  // an Untitled project nobody has touched is the new project already; making another would only pile up empty files
  if (/^Untitled( \d+)?$/.test(s.project.name) && s.timeline.length <= 1 && s.project.file) return;
  // no Save window: a new project starts at once in Documents/Duet, named "Untitled"
  const picked = await untitledPath().catch(() => null);
  if (!picked) return void (await oops("Duet could not find a place to keep the new project."));
  if (!getState().project.file && !(await readyToLeave())) return;
  try {
    const doc = emptyDoc();
    // the project being left waits in its tab; what was said in it goes into its file first
    if (!(await parkCurrent())) await flushPack();
    const work = await createProject(picked, doc, "New file");
    showConversationFor(picked, true);
    loadDoc(doc, "New file");
    lastSaved = committed();
    setProject({ path: work, file: picked, name: baseName(picked), status: "saved", error: null });
    await packNow();
    remember(picked);
  } catch (e) {
    await oops(String(e));
  }
}

// ---- a test design, for building Duet ----

const TEST_NAME = "Test design";
/** The project being opened right now, if any. */
let opening: Promise<unknown> = Promise.resolve();
/** The project file that was put away when a test design started. */
let leftForTest: string | null = null;
let inTest = false;

export const inTestDesign = () => inTest;

/**
 * Put the open project away and start a design that has no file, so nothing a test does is saved anywhere.
 * Returns a short message if it could not be done.
 */
export async function startTestDesign(doc: Doc = emptyDoc()): Promise<string | null> {
  // a project still being opened, such as the last one at launch, would land on top of the test design
  await opening.catch(() => undefined);
  const s = getState();
  if (!inTest) {
    if (!s.project.path && s.timeline.length > 1) return "There is work here that has not been saved. Save it first.";
    // no question on the screen here: whoever asked for a test design cannot answer one
    if (getChat().busy !== null) return "The AI in the chat is still working. Wait for it or stop it first.";
    clearTimeout(timer);
    // a change still waiting to be saved belongs to the project being put away
    if (s.project.path && committed() !== lastSaved) await saveNow();
    await flushPack();
    leftForTest = s.project.file;
  }
  inTest = true;
  showConversationFor(TEST_NAME, true);
  // the project lets go first, so the test design is never taken for a change to it
  setProject({ path: null, file: null, name: TEST_NAME, status: "unsaved", error: null });
  loadDoc(doc, TEST_NAME);
  lastSaved = committed();
  clearTimeout(timer);
  return null;
}

/**
 * Keep the test design as a project file, with no window to ask where. For mockups drawn in Duet dev.
 * The file must end in .duet and must not be there yet. Returns a short message if it could not be done.
 */
export async function keepTestDesign(file: string): Promise<string | null> {
  if (!inTest) return "There is no test design open.";
  if (!inTauri()) return "Saving works in the desktop app.";
  if (!file.toLowerCase().endsWith(".duet")) return "The file name must end in .duet.";
  if ((await invoke<boolean>("path_exists", { path: file })) === true) return "There is already a file with that name. Pick another name.";
  const doc = committed();
  try {
    const work = await createProject(file, doc, "Start of project");
    lastSaved = doc;
    inTest = false;
    setProject({ path: work, file, name: baseName(file), status: "saved", error: null });
    await packNow();
    remember(file);
    void writePreview(work, doc);
    return null;
  } catch (e) {
    return String(e);
  }
}

/** Close the project on screen and leave an empty, unsaved one behind it. Used when the last tab is closed. */
export async function closeProject() {
  // a project still in a tab waits there; what was said in the one being left goes into its file first
  if (!(await parkCurrent())) await flushPack();
  showConversationFor("", true);
  setProject({ path: null, file: null, name: "Untitled", status: "unsaved", error: null });
  loadDoc(emptyDoc(), "New file");
  lastSaved = committed();
  clearTimeout(timer);
}

/** Throw the test design away and bring back the project that was open before it. */
export async function leaveTestDesign(): Promise<string | null> {
  // after a test design was kept as a file there is still a project to go back to
  if (!inTest && !leftForTest && !checkCopy) return "There is no test design open.";
  inTest = false;
  await flushPack();
  const back = leftForTest;
  leftForTest = null;
  setProject({ path: null, file: null, name: "Untitled", status: "unsaved", error: null });
  loadDoc(emptyDoc(), "New file");
  lastSaved = committed();
  clearTimeout(timer);
  if (back && inTauri() && !(await openAny(back, true))) return `The project at ${back} could not be opened again.`;
  return null;
}

interface HistoryItem {
  hash: string;
  time: number;
  label: string;
  actor: string;
  by?: string | null;
  doc: string;
  versions: string[];
  steps?: string[];
  /** The step it was made on, when it started a new direction. */
  from?: string | null;
}

/** The saved steps of this project, oldest first. Empty if there is no history yet. */
async function readHistory(path: string): Promise<HistoryEntry[]> {
  try {
    const items = await invoke<HistoryItem[]>("git_history", { path, limit: HISTORY_LIMIT });
    const out: HistoryEntry[] = [];
    for (const i of items) {
      try {
        const names = i.steps ?? [];
        out.push({
          doc: parseDoc(i.doc),
          label: i.label,
          actor: i.actor === "ai" ? "ai" : "you",
          ...(i.actor === "ai" && i.by ? { by: i.by } : {}),
          time: i.time * 1000,
          version: i.versions[0],
          // a step saved before steps had names is known by what its saved step is called
          step: names.length ? names[names.length - 1] : i.hash,
          covers: names.length > 1 ? names.slice(0, -1) : undefined,
          ...(i.from ? { from: i.from } : {}),
        });
      } catch {
        /* skip a step whose file we cannot read */
      }
    }
    return out;
  } catch (e) {
    console.warn("Could not read history:", e);
    return [];
  }
}

async function loadFrom(path: string, quiet: boolean, file: string): Promise<boolean> {
  try {
    const design = join(path, FILE);
    if (!((await invoke<boolean>("path_exists", { path: design })) === true)) {
      if (!quiet) await oops(`There is no ${FILE} in that folder. Use New to start a project there, or pick a different folder.`);
      return false;
    }
    const doc = parseDoc(await invoke<string>("read_text_file", { path: design }));
    await adoptFonts(path);
    const entries = await readHistory(path);
    stepsKept = new Set(entries.flatMap((e) => [e.step, ...(e.covers ?? [])].filter((n): n is string => !!n)));
    // the project being left waits in its tab; what was said in it goes into its file first
    if (getState().project.file !== file && !(await parkCurrent())) await flushPack();
    showConversationFor(file);
    await bringBackThread(path);
    if (entries.length === 0) {
      loadDoc(doc);
      await startHistory(path, "Start of project");
    } else {
      const last = entries[entries.length - 1];
      // The file on disk can be newer than the last saved step (edited elsewhere, or the app closed mid-save).
      if (serializeDoc(last.doc) !== serializeDoc(doc)) {
        entries.push({ doc, label: "Opened with newer changes", actor: "you", time: Date.now() });
      }
      loadTimeline(entries);
    }
    lastSaved = committed();
    setProject({ path, file, name: baseName(file), status: "saved", error: null });
    remember(file);
    void writePreview(path, committed()); // older projects get their picture the first time they are opened
    return true;
  } catch (e) {
    if (!quiet) await oops(e instanceof DesignFileError ? e.message : String(e));
    return false;
  }
}

/**
 * Open a project you already know the folder of, such as one from the projects list. `closing` is set
 * when it opens because the tab before it was closed, so the questions speak of closing.
 */
export async function openProjectAt(path: string, closing = false): Promise<boolean> {
  if (!inTauri() && !isParked(path)) return false;
  // unsaved work waits in its own tab, and an AI keeps working in its own project; only the plain start has nowhere to wait
  if (!liveKey() && !(await readyToLeave(closing))) return false;
  // after closing a tab no question comes up: a next project that cannot be found is simply not opened
  return openAny(path, closing);
}

/** Open a project file. */
function openAny(path: string, quiet = false): Promise<boolean> {
  const job = openFile(path, quiet);
  opening = job;
  return job;
}

async function openFile(path: string, quiet: boolean): Promise<boolean> {
  if (isParked(path)) return bringBack(path);
  try {
    if ((await invoke<boolean>("is_directory", { path })) === true) {
      if (!quiet) await oops("Duet projects are single .duet files now. Choose a file that ends in .duet.");
      return false;
    }
    if ((await invoke<boolean>("path_exists", { path })) !== true) {
      const found = await findMoved(path);
      if (found) {
        repoint(path, found);
        return openFile(found, quiet);
      }
      missing.add(path);
      window.dispatchEvent(new Event("duet:recents"));
      return quiet ? false : findOrLetGo(path);
    }
    const work = await invoke<string>("unpack_project", { file: path });
    return loadFrom(work, quiet, path);
  } catch (e) {
    if (!quiet) await oops(String(e));
    return false;
  }
}

/** A listed project's file cannot be found. The designer points to it, or it leaves the list. */
async function findOrLetGo(path: string): Promise<boolean> {
  const find = await ask(`Duet cannot find “${baseName(path)}”. It was moved, renamed or deleted outside Duet.`, {
    title: "Duet",
    kind: "warning",
    okLabel: "Find it",
    cancelLabel: "Remove from list",
  });
  if (!find) {
    missing.delete(path);
    removeRecent(path);
    closeTab(path);
    return false;
  }
  const picked = await once(() => open({ title: `Find “${baseName(path)}”`, filters: [{ name: "Duet project", extensions: ["duet"] }] }));
  if (typeof picked !== "string") return false;
  repoint(path, picked);
  return openFile(picked, false);
}

/** Choose a project file and open it. */
export async function openProject() {
  await once(openProjectDialog);
}

async function openProjectDialog() {
  if (!inTauri()) return;
  const picked = await open({ directory: false, multiple: false, title: "Open a Duet project", filters: [{ name: "Duet project", extensions: ["duet"] }] });
  if (typeof picked === "string" && (getState().project.file || (await readyToLeave()))) await openAny(picked);
}

/** Save the design as plain data (a .json file), for people and programs that want it. */
export async function exportDesignData() {
  if (!inTauri()) return;
  const name = getState().project.name || "design";
  const target = await save({ title: "Export the design data", defaultPath: `${name}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (!target) return;
  try {
    await invoke("write_text_file", { path: target, contents: serializeDoc(committed()) });
  } catch (e) {
    await oops(String(e));
  }
}

/** What a copy carries besides the design as it is now. Both are left out unless asked for. */
export interface CopyChoice {
  /** The earlier steps and the named versions. */
  history: boolean;
  /** The conversation with the AI. */
  conversation: boolean;
}

/** The name a copy starts with: the project's own name with "copy" after it, in the same folder. */
export function copyNameFor(file: string): string {
  return file.replace(/(\.duet)?$/i, " copy.duet");
}

/**
 * Save a second project file to hand to someone else. The project you are working in is not changed
 * and stays open. Returns where the copy went, why it could not be made, or null if you backed out.
 */
export async function sendCopy(choice: CopyChoice): Promise<{ saved: string } | { why: string } | null> {
  if (!inTauri()) return { why: "Sending a copy works in the desktop app." };
  const result = await once(() => sendCopyDialog(choice));
  return result ?? null;
}

async function sendCopyDialog(choice: CopyChoice): Promise<{ saved: string } | { why: string } | null> {
  const { path, file } = getState().project;
  if (!path || !file) return { why: "Save your project first, then send a copy." };
  const target = await save({ title: "Send a copy", defaultPath: copyNameFor(file), filters: [{ name: "Duet project", extensions: ["duet"] }] });
  if (!target) return null;
  const picked = withExt(target);
  if (picked === file) return { why: "That is the project you are working in. Give the copy a different name." };
  if ((await invoke<boolean>("is_directory", { path: picked })) === true) return { why: "There is an older project folder with that name. Pick a different name." };
  // everything on the canvas is written into the working folder first, so the copy is made from what you see
  await saveNow();
  return enqueue(async () => {
    if (getState().project.path !== path) return { why: "Another project was opened. Send the copy again." };
    try {
      if (choice.conversation) await flushThread();
      const doc = committed();
      await flushPictures(path, doc);
      await invoke("pack_copy", {
        dir: path,
        file: picked,
        design: serializeDoc(doc),
        previewBase64: await previewPng(doc).catch(() => null),
        pictures: [...picturesIn(doc), ...fontFilesIn(doc)],
        history: choice.history,
        conversation: choice.conversation,
      });
      return { saved: picked };
    } catch (e) {
      return { why: String(e) };
    }
  });
}

/** On launch, go back to where you were. */
export async function restoreLast() {
  if (!inTauri()) return;
  // Duet dev never opens a designer's project by itself: two Duets on one project would fight over it
  if (await learnCheckCopy()) return;
  let path: string | null = null;
  try {
    path = localStorage.getItem(LAST_KEY);
  } catch {
    path = null;
  }
  if (path) await openAny(path, true);
}

/**
 * Give the current moment a name. Returns a short message if it could not be done.
 * Underneath this is a tag on the saved step. The designer only sees a name.
 */
export async function saveVersion(name: string): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return "Give this version a name.";
  if (!inTauri()) return "Versions work in the desktop app.";
  let path = getState().project.path;
  if (!path) {
    // a version needs a home, so the work gets one, with nothing to answer
    await giveHome();
    path = getState().project.path;
    if (!path) return "The version could not be saved. Save the project first, then try again.";
  }
  await saveNow();
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "version";
  try {
    await invoke("git_name_version", { path, tag: `v${Date.now()}-${slug}`, title: clean });
    schedulePack();
    setEntryVersion(getState().cursor, clean);
    return null;
  } catch (e) {
    return `Could not save the version: ${e}`;
  }
}

/** Save a moment after every change once the project has a home. */
export function startAutosave() {
  const stopThread = subscribeChat(threadChanged);
  const stopDesign = subscribe(() => {
    const s = getState();
    if (!s.project.path) {
      // an AI's work is never left without a home; the designer's own new work waits until they save it
      if (s.timeline[s.cursor].actor === "ai" && s.timeline.length > 1) void giveHome();
      return;
    }
    const doc = s.timeline[s.cursor].doc;
    if (doc === lastSaved) return;
    if (s.project.status !== "unsaved") setProject({ status: "unsaved" });
    clearTimeout(timer);
    timer = setTimeout(saveNow, 700);
  });
  return () => {
    stopThread();
    stopDesign();
  };
}

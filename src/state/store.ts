import type { Gap } from "../canvas/guides";
import { newStepId } from "../memory/steps";
import { childOf, parentOf } from "./directions";
import type { AbsNode } from "../document/path";
import { useSyncExternalStore } from "react";
import { commandLabel, runCommand } from "../commands";
import type { Actor, CommandName } from "../commands";
import { docAt, poseAt, settle } from "../document/time";
import { emptyDoc } from "../document/types";
import type { Doc, ElementType, Rect } from "../document/types";

export type Tool = "move" | "frame" | "rect" | "ellipse" | "text" | "hand" | "pen" | "zoom" | "comment" | "brush" | "eraser";

export interface HistoryEntry {
  doc: Doc;
  label: string;
  actor: Actor;
  /** Which AI tool made this step, when one did and said who it is. */
  by?: string;
  /** Milliseconds since 1970, when this step happened. */
  time: number;
  /** Set when this moment has been given a name, like "Client round 1". */
  version?: string;
  /** The step's own name, so what was said can point at it. */
  step?: string;
  /** Names of quick steps that were saved together with this one. */
  covers?: string[];
  /** The step this one was made on, when it starts a new direction. */
  from?: string;
  /** Where the saved step is kept, so a step opened without its design can fetch it. */
  hash?: string;
}

/**
 * A long history opens with the designs of only its newest steps. An older step holds this stand-in
 * until it is needed: going back to it fetches its design first. Never shown or saved.
 */
export const NOT_LOADED: Doc = Object.freeze({ version: 1, rootIds: Object.freeze([]) as unknown as string[], elements: Object.freeze({}) as Doc["elements"] }) as Doc;
export const isLoaded = (e: HistoryEntry) => e.doc !== NOT_LOADED;

/** Fetches a saved step's design from a project's folder. Set by the project code. */
let stepLoader: ((path: string, hash: string) => Promise<Doc>) | null = null;
export function setStepLoader(load: (path: string, hash: string) => Promise<Doc>) {
  stepLoader = load;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Overlay {
  draft: { type: ElementType; rect: Rect } | null;
  guidesX: number[];
  guidesY: number[];
  /** Measured gaps shown while something moves, with their sizes. */
  gaps: Gap[];
  /** The ruler guide being pulled right now: which way it runs and where. */
  guideNow: { axis: "x" | "y"; at: number } | null;
  marquee: Rect | null;
  hoverId: string | null;
  /** The line being drawn with the pen, in page pixels, and where the pointer is. */
  pen: { nodes: AbsNode[]; cursor: { x: number; y: number } | null } | null;
  /** The line whose points are being edited, and which points are chosen. */
  nodeEdit: { id: string; selected: number[] } | null;
  /** The angle being shown while something is turned by hand, or null. */
  turning: number | null;
  /** A prototype connection being dragged from a thing: where the pointer is, in page pixels, and the screen under it. */
  linkDrag: { from: string; x: number; y: number; to: string | null } | null;
}

export interface Project {
  /** Folder that holds design.json (for a single file project, its unpacked working copy). Null while the work has not been saved anywhere. */
  path: string | null;
  /** The single .duet file this project is saved in. Null for an older folder project. */
  file: string | null;
  name: string;
  status: "unsaved" | "saving" | "saved" | "error";
  error: string | null;
}

/** Where in time the canvas is showing a frame that plays. */
export interface Clock {
  /** The frame being played, or null when the canvas shows the design as it is. */
  scene: string | null;
  /** Seconds from the start of that frame. */
  t: number;
  playing: boolean;
}

export interface AiWork {
  ids: string[];
  /** A space on the page the AI has claimed before it changed anything, in page pixels. */
  area?: { x: number; y: number; width: number; height: number };
  /** The AI tool, as in history entries. */
  by?: string;
  /** When it last changed something. */
  at: number;
}

export interface State {
  project: Project;
  timeline: HistoryEntry[];
  cursor: number;
  /** Live preview while dragging. Not in history until committed. */
  transientDoc: Doc | null;
  selection: string[];
  /** What the AI has been pointed at. It only guides the AI; nothing outside it is blocked. */
  focus: string[];
  /** Where an AI is working right now, shown as a faint rectangle in its colour. Null when no AI is at work. */
  aiWork: AiWork | null;
  tool: Tool;
  viewport: Viewport;
  overlay: Overlay;
  editingId: string | null;
  clock: Clock;
}

const noOverlay = (): Overlay => ({ draft: null, guidesX: [], guidesY: [], gaps: [], guideNow: null, marquee: null, hoverId: null, pen: null, nodeEdit: null, turning: null, linkDrag: null });

const initial = (): State => ({
  project: { path: null, file: null, name: "Untitled", status: "unsaved", error: null },
  timeline: [{ doc: emptyDoc(), label: "New file", actor: "you", time: Date.now() }],
  cursor: 0,
  transientDoc: null,
  selection: [],
  focus: [],
  aiWork: null,
  tool: "move",
  viewport: { x: 160, y: 100, zoom: 1 },
  overlay: noOverlay(),
  editingId: null,
  clock: { scene: null, t: 0, playing: false },
});

let state: State = initial();
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

// ---- rooms: every open project keeps its design and history here, on screen or not ----

/** Projects open in a tab that is not on screen, by their file. An AI can keep working in one. */
const parked = new Map<string, State>();
/** Told the file of a project off screen whenever it changes, so it can be saved. */
const parkedListeners = new Set<(file: string) => void>();

/** One project's state, and how to change it. The project on screen is one; each project off screen is another. */
interface Box {
  get: () => State;
  set: (patch: Partial<State>) => void;
  live: boolean;
}
const liveBox: Box = { get: () => state, set, live: true };
function parkedBox(file: string): Box {
  return {
    get: () => parked.get(file) as State,
    set: (patch) => {
      parked.set(file, { ...(parked.get(file) as State), ...patch });
      parkedListeners.forEach((l) => l(file));
    },
    live: false,
  };
}

/** Put the project on screen away, whole, so it can come back as it was. It waits under its file, or the name of its tab when it has no file yet. */
export function parkLive(key: string | null = state.project.file): boolean {
  const file = key;
  if (!file) return false;
  parked.set(file, { ...state, transientDoc: null, aiWork: null, overlay: noOverlay(), editingId: null, clock: { ...state.clock, playing: false } });
  return true;
}

/** Bring a waiting project back on screen. Says whether it was waiting. */
export function unpark(file: string): boolean {
  const back = parked.get(file);
  if (!back) return false;
  parked.delete(file);
  openings++;
  state = { ...back, tool: state.tool };
  listeners.forEach((l) => l());
  return true;
}

export const isParked = (file: string) => parked.has(file);
export const parkedFiles = () => [...parked.keys()];
export const parkedState = (file: string): State | undefined => parked.get(file);
/** A tab was closed: forget its project. */
export const dropParked = (file: string) => parked.delete(file);
export function onParkedChange(l: (file: string) => void) {
  parkedListeners.add(l);
  return () => {
    parkedListeners.delete(l);
  };
}

export const getState = (): State => state;

export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export const currentDoc = (s: State = state): Doc => s.transientDoc ?? s.timeline[s.cursor].doc;

let seen: { doc: Doc; scene: string; t: number; out: Doc } | null = null;

/** The design as the canvas shows it: at the moment the clock is on, when a frame that plays is open. */
export function seenDoc(s: State = state): Doc {
  const doc = currentDoc(s);
  const { scene, t } = s.clock;
  if (!scene || !doc.elements[scene]?.duration) return doc;
  if (!seen || seen.doc !== doc || seen.scene !== scene || seen.t !== t) seen = { doc, scene, t, out: docAt(doc, scene, t) };
  return seen.out;
}

/** Changes that are about time itself. They are made to the design as it is, not as it looks at one moment. */
const ABOUT_TIME = new Set<CommandName>(["set_duration", "set_timing", "set_key", "set_keys", "key_now", "set_curve", "remove_key", "set_entrance", "split_at", "ripple_delete", "cut_ranges"]);

let posedCache: { doc: Doc; scene: string; t: number; out: Doc } | null = null;
function pose(doc: Doc, box: Box = liveBox): Doc {
  const { scene, t } = box.get().clock;
  if (!scene || !doc.elements[scene]?.duration) return doc;
  if (!posedCache || posedCache.doc !== doc || posedCache.scene !== scene || posedCache.t !== t) posedCache = { doc, scene, t, out: poseAt(doc, scene, t) };
  return posedCache.out;
}

/**
 * The design to work on by hand. While a frame that plays is open, things are where they are at the
 * moment the clock is on, so what is picked and dragged is what is seen. Otherwise it is the design itself.
 */
export const workDoc = (s: State = state): Doc => pose(currentDoc(s));

/** Run a change on what is seen at this moment, and put the result where it belongs in time. */
function runAtNow<N extends CommandName>(real: Doc, name: N, args: Parameters<typeof runCommand<N>>[2], box: Box = liveBox): Doc {
  if (ABOUT_TIME.has(name)) return runCommand(real, name, args);
  const posed = pose(real, box);
  const { clock } = box.get();
  return posed === real ? runCommand(real, name, args) : settle(real, posed, runCommand(posed, name, args), clock.scene as string, clock.t);
}

/** Test helper: reset everything. */
/** Goes up each time another design comes on screen. Saving a design for the first time does not count. */
let openings = 0;
export const openingNumber = () => openings;

export function resetStore() {
  parked.clear();
  resetStoreKeepingParked();
}

/** Test helper: start a fresh project on screen, leaving the ones waiting in tabs alone. */
export function resetStoreKeepingParked() {
  openings++;
  state = initial();
  lastNudge = null;
  listeners.forEach((l) => l());
}

/** What is still there to be picked. On another board nothing stays picked, since nothing from the last one is seen. */
function cleanSelection(sel: string[], doc: Doc, was?: Doc): string[] {
  if (was && was.board !== doc.board) return [];
  return sel.filter((id) => doc.elements[id]);
}

function commit(doc: Doc, label: string, actor: Actor, by?: string, box: Box = liveBox) {
  const s = box.get();
  const base = s.timeline[s.cursor].doc;
  if (doc === base) {
    box.set({ transientDoc: null });
    return;
  }
  // made on an earlier step, it starts a new direction; the steps after that one stay
  let before = s.timeline;
  let from: string | undefined;
  if (s.cursor < s.timeline.length - 1) {
    from = s.timeline[s.cursor].step ?? newStepId();
    if (!s.timeline[s.cursor].step) before = before.map((e, i) => (i === s.cursor ? { ...e, step: from } : e));
  }
  const timeline = before.concat({ doc, label, actor, ...(by ? { by } : {}), time: Date.now(), step: newStepId(), ...(from ? { from } : {}) });
  box.set({
    timeline,
    cursor: timeline.length - 1,
    transientDoc: null,
    selection: cleanSelection(s.selection, doc, base),
    focus: cleanSelection(s.focus, doc, base),
  });
}

// ---- commands ----

type ArgsOf<N extends CommandName> = Parameters<typeof runCommand<N>>[2];

/** Run a command and record it as one step in history. */
export function dispatch<N extends CommandName>(name: N, args: ArgsOf<N>, actor: Actor = "you", by?: string) {
  const doc = runAtNow(currentDoc(), name, args);
  commit(doc, commandLabel(name, args), actor, by);
}

/**
 * Switch between the open canvas and page view. It is only how the design is looked at, so it is kept with
 * the project but is never a step in history: every step already loaded takes it, and undo does not flip it back.
 */
export function setPagesView(on: boolean) {
  const timeline = state.timeline.map((e) => (isLoaded(e) ? { ...e, doc: runCommand(e.doc, "set_pages", { on }) } : e));
  set({ timeline });
}

/** Arrow presses closer together than this count as one step. Shorter than the wait before saving. */
const NUDGE_GAP = 600;
let lastNudge: { entry: HistoryEntry; ids: string } | null = null;

/** Move with the arrow keys. Holding a key, or tapping quickly, is one step in history, not one per press. */
export function nudge(ids: string[], dx: number, dy: number) {
  const args = { ids, dx, dy };
  const doc = runAtNow(currentDoc(), "move_elements", args);
  const here = state.timeline[state.cursor];
  const key = ids.join(",");
  const now = Date.now();
  const going = lastNudge && lastNudge.entry === here && lastNudge.ids === key && now - here.time < NUDGE_GAP;
  if (going && state.cursor > 0 && state.cursor === state.timeline.length - 1) {
    const entry = { ...here, doc, time: now };
    set({ timeline: state.timeline.slice(0, state.cursor).concat(entry), transientDoc: null });
  } else {
    commit(doc, commandLabel("move_elements", args), "you");
  }
  lastNudge = { entry: state.timeline[state.cursor], ids: key };
}

// ---- drags: preview without history, commit once at the end ----

/** The design a drag starts from, as it is seen at the moment the clock is on. */
export function dragBase(): Doc {
  return pose(state.timeline[state.cursor].doc);
}

export function dragPreview<N extends CommandName>(name: N, args: ArgsOf<N>) {
  set({ transientDoc: runAtNow(state.timeline[state.cursor].doc, name, args) });
}

/** Show a design that was worked out from `dragBase` or `workDoc`. */
export function dragPreviewDoc(doc: Doc) {
  const real = state.timeline[state.cursor].doc;
  const posed = pose(real);
  set({ transientDoc: posed === real ? doc : settle(real, posed, doc, state.clock.scene as string, state.clock.t) });
}

export function dragCommit(label: string, actor: Actor = "you") {
  if (state.transientDoc) commit(state.transientDoc, label, actor);
}

export function dragCancel() {
  set({ transientDoc: null });
}

// ---- project ----

export const setProject = (patch: Partial<Project>) => set({ project: { ...state.project, ...patch } });

/** Replace everything with a freshly opened document. History starts over. */
export function loadDoc(doc: Doc, label = "Opened") {
  openings++;
  set({
    timeline: [{ doc, label, actor: "you", time: Date.now() }],
    cursor: 0,
    transientDoc: null,
    selection: [],
    focus: [],
    aiWork: null,
    editingId: null,
    overlay: noOverlay(),
    clock: { scene: null, t: 0, playing: false },
  });
}

/** Replace everything with a history that was saved earlier. Lands on the newest step. */
export function loadTimeline(entries: HistoryEntry[]) {
  openings++;
  set({
    timeline: entries,
    cursor: entries.length - 1,
    transientDoc: null,
    selection: [],
    focus: [],
    aiWork: null,
    editingId: null,
    overlay: noOverlay(),
    clock: { scene: null, t: 0, playing: false },
  });
}

/** Mark a step as a named version. */
export function setEntryVersion(index: number, name: string) {
  set({ timeline: state.timeline.map((e, i) => (i === index ? { ...e, version: name } : e)) });
}

/** Bring an old design back as a new step. Nothing is lost. */
export function restoreDoc(doc: Doc, label: string, actor: Actor = "you", by?: string) {
  commit(doc, label, actor, by);
}

// ---- history ----

export function goTo(index: number, box: Box = liveBox) {
  const s = box.get();
  const i = Math.max(0, Math.min(s.timeline.length - 1, index));
  if (!isLoaded(s.timeline[i])) {
    void fetchStep(s.timeline[i], box).then((doc) => {
      const at = doc ? box.get().timeline.findIndex((e) => e.hash === s.timeline[i].hash && isLoaded(e)) : -1;
      if (at >= 0) goTo(at, box);
    });
    return;
  }
  const doc = s.timeline[i].doc;
  const was = s.timeline[s.cursor].doc;
  box.set({ cursor: i, transientDoc: null, selection: cleanSelection(s.selection, doc, was), focus: cleanSelection(s.focus, doc, was), editingId: null });
}

/** The design of a step, fetched from the project's folder when the step was opened without it. Null if it cannot be read. */
export async function stepDoc(entry: HistoryEntry, box: Box = liveBox): Promise<Doc | null> {
  return isLoaded(entry) ? entry.doc : fetchStep(entry, box);
}

async function fetchStep(entry: HistoryEntry, box: Box): Promise<Doc | null> {
  const path = box.get().project.path;
  if (!entry.hash || !path || !stepLoader) return null;
  try {
    const doc = await stepLoader(path, entry.hash);
    // keep it, so going back there again is instant; the history may have moved on meanwhile
    const now = box.get();
    if (now.timeline.includes(entry)) box.set({ timeline: now.timeline.map((e) => (e === entry ? { ...e, doc } : e)) });
    return doc;
  } catch (e) {
    console.warn("Could not read a saved step:", e);
    return null;
  }
}

/** Undo and redo follow the direction you are on. */
export const undo = () => state.cursor > 0 && goTo(parentOf(state.timeline, state.cursor));
export const canRedo = (s: State = state) => childOf(s.timeline, s.cursor) >= 0;
export const redo = () => canRedo() && goTo(childOf(state.timeline, state.cursor));

// ---- ui state ----

export const select = (ids: string[]) => set({ selection: ids });
/** Point the AI at these things, or at nothing. */
export const setFocus = (ids: string[]) => set({ focus: ids });

/** How long the AI's working area stays on the canvas after its last change. */
export const AI_WORK_SHOWN_MS = 12000;
let aiWorkTimer: ReturnType<typeof setTimeout> | undefined;
/** Whether an AI is still busy, so its working area stays up through long quiet stretches. Set by the chat. */
let stillBusy: () => boolean = () => false;
export const keepAiWorkWhile = (busy: () => boolean) => {
  stillBusy = busy;
};

function armAiWork() {
  clearTimeout(aiWorkTimer);
  const check = () => {
    const w = state.aiWork;
    if (!w) return;
    if (stillBusy() || Date.now() - w.at < AI_WORK_SHOWN_MS) aiWorkTimer = setTimeout(check, 2000);
    else set({ aiWork: null });
  };
  aiWorkTimer = setTimeout(check, 2000);
}

/** An AI just changed these. Changes close together in time make one working area. */
export function noteAiWork(ids: string[], by?: string) {
  if (!ids.length) return;
  const now = Date.now();
  const last = state.aiWork;
  const same = last && last.by === by && now - last.at < AI_WORK_SHOWN_MS;
  const all = same ? [...new Set([...last.ids, ...ids])] : ids;
  // once real work is on the page the area follows it; a claimed space still counts until then
  set({ aiWork: { ids: all.slice(-200), by, at: now, area: same && !last.ids.length ? last.area : undefined } });
  armAiWork();
}

/** An AI has claimed a space, or has just started: show its working area there before anything changes. */
export function noteAiArea(area: { x: number; y: number; width: number; height: number }, by?: string) {
  set({ aiWork: { ids: [], area, by, at: Date.now() } });
  armAiWork();
}

/** The AI is still at it (it asked or looked at something): keep its working area up. */
export function touchAiWork(by?: string) {
  const w = state.aiWork;
  if (!w || w.by !== by) return false;
  set({ aiWork: { ...w, at: Date.now() } });
  armAiWork();
  return true;
}
export const setTool = (tool: Tool) => set({ tool });
export const setViewport = (viewport: Viewport) => set({ viewport });
export const setOverlay = (patch: Partial<Overlay>) => set({ overlay: { ...state.overlay, ...patch } });
export const clearOverlay = () => set({ overlay: noOverlay() });
export const setEditing = (id: string | null) => set({ editingId: id });
export const setClock = (patch: Partial<Clock>) => set({ clock: { ...state.clock, ...patch } });

// ---- what an AI works on: its own project, on screen or not ----

/** The same changes as above, made to one project whether or not it is on screen. */
export interface Room {
  /** The project's file, or null for work that is not saved anywhere. */
  file: string | null;
  /** Whether it is the project on screen. */
  live: boolean;
  getState: () => State;
  currentDoc: () => Doc;
  dispatch: <N extends CommandName>(name: N, args: ArgsOf<N>, actor?: Actor, by?: string) => void;
  restoreDoc: (doc: Doc, label: string, actor?: Actor, by?: string) => void;
  goTo: (index: number) => void;
  /** A step's design, fetched first when the step was opened without it. */
  stepDoc: (entry: HistoryEntry) => Promise<Doc | null>;
  select: (ids: string[]) => void;
  noteAiWork: (ids: string[], by?: string) => void;
  noteAiArea: (area: { x: number; y: number; width: number; height: number }, by?: string) => void;
  touchAiWork: (by?: string) => boolean;
}

/** The project on screen. */
export const liveRoom: Room = {
  get file() {
    return state.project.file;
  },
  live: true,
  getState,
  currentDoc: () => currentDoc(),
  dispatch,
  restoreDoc,
  goTo: (i) => goTo(i),
  stepDoc: (e) => stepDoc(e),
  select,
  noteAiWork,
  noteAiArea,
  touchAiWork,
};

/** The project with this file, wherever it is. Null when it is neither on screen nor waiting in a tab. */
export function roomFor(file: string | null): Room | null {
  if (file === state.project.file) return liveRoom;
  if (!file || !parked.has(file)) return null;
  const box = parkedBox(file);
  return {
    file,
    live: false,
    getState: box.get,
    currentDoc: () => currentDoc(box.get()),
    dispatch: (name, args, actor = "you", by) => commit(runAtNow(currentDoc(box.get()), name, args, box), commandLabel(name, args), actor, by, box),
    restoreDoc: (doc, label, actor = "you", by) => commit(doc, label, actor, by, box),
    goTo: (i) => goTo(i, box),
    stepDoc: (e) => stepDoc(e, box),
    select: (ids) => box.set({ selection: ids }),
    // where an AI works is shown on the canvas, and this project is not on it
    noteAiWork: () => undefined,
    noteAiArea: () => undefined,
    touchAiWork: () => true,
  };
}

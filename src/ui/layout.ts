import { useSyncExternalStore } from "react";

/** Where the panels and the chat sit. Kept per person, on this computer. */

export type Corner = "tl" | "tr" | "bl" | "br";
export type Mode = "design" | "motion" | "photo";
/** Agent (called chat inside): talk to the AI beside your projects and watch the canvas. Studio (called edit inside): every tool. */
export type Space = "kitchen" | "edit";
export type TimeLook = "layers" | "cut";
/** What the right panel shows. Chat is a tab only in Video. */
export type RightTab = "properties" | "color" | "chat";

export interface TrackHeights {
  titles: number;
  clips: number;
  sound: number;
}

export interface Dock {
  leftW: number;
  rightW: number;
  leftHidden: boolean;
  rightHidden: boolean;
  /** Layers on the right and the design panel on the left. */
  swapped: boolean;
  /** Whether we are designing, making video or editing photos. */
  mode: Mode;
  /** Talking to the AI or working with the tools. */
  space: Space;
  /** The chat sits in a corner, or wherever it was dropped. */
  chat: { corner: Corner } | { x: number; y: number };
  /** How wide the chat is, and how tall its message area is. */
  chatW: number;
  chatH: number;
  timeLook: TimeLook;
  /** In the timeline, every thing that moves is opened into a row for each kind of change. */
  keysOpen: boolean;
  /** How tall the timeline's rows are, pulled by its top edge. */
  timeH: number;
  /** The history line along the bottom. Hidden unless asked for: the chat holds the history. */
  historyLine: boolean;
  /** Set once the designer turns the history line on or off themselves. Until then it is on. */
  historyLineChosen?: boolean;
  /** In each space, whether the Projects sidebar is open or folded to a thin strip. */
  projectsOpen: Record<Space, boolean>;
  /** In Colour, a change goes to every picture and clip in the scene, not only the picked ones. */
  gradeEvery: boolean;
  /** Rulers along the top and the left of the canvas, with the guides pulled out of them. */
  rulers: boolean;
  /** The timeline takes the whole window below the top bar, for a closer look. Never kept between runs. */
  timeMax: boolean;
  /** How wide the names beside the timeline's rows are, pulled by their right edge. */
  namesW: number;
  /** The comment pins on the canvas are put away. */
  commentsHidden: boolean;
  /** In Design, the right panel's Prototype tab is open: connections are drawn on the canvas, and the picked thing has a dot to drag onto a screen. */
  prototyping: boolean;
  /** A mouse wheel zooms, like in Adobe apps. A trackpad still slides the canvas. */
  wheelZooms: boolean;
  /** In each space, whether the chat stands in its own column on the left, or floats over the canvas. */
  chatDocked: Record<Space, boolean>;
  /** In Studio, the chat sits under the right panel instead, with a line to pull to make it taller or shorter. */
  chatInPanel: boolean;
  /** How tall the chat is under the right panel. */
  panelChatH: number;
  /** How wide Kitchen's chat column and recipe column are, pulled by their edges. */
  kitchenChatW: number;
  recipeW: number;
  /** The recipe takes all of Kitchen, to build and plan it. Never kept between runs. */
  recipeFull: boolean;
  /** Kitchen's recipe, or its chat, folded down to its bar. */
  recipeFolded: boolean;
  kitchenChatFolded: boolean;
  /** How tall the chat is under the recipe in Kitchen. */
  kitchenChatH: number;
  /** Kitchen's comments column is open, to read and resolve them. */
  kitchenComments: boolean;
  /** The recipe Kitchen is using, by its id. None: Kitchen is the chat and the design, nothing more. */
  recipeOn: string | null;
  /** The chat is open when Studio comes up. Off, it waits folded away until clicked. */
  editChatOpen: boolean;
  /** In Video, whether the right panel shows Properties, Colour or the chat. */
  videoTab: RightTab;
  /** In Photo, whether the right panel shows Properties or Colour. */
  photoTab: RightTab;
  /** How tall each kind of row in Edit starts. */
  trackH: TrackHeights;
  /** How tall a track in Edit is, by its id, once the designer has changed it. */
  rowH?: Record<string, number>;
}

const KEY = "duet:layout";
export const MIN_W = 180;
export const MAX_W = 460;
export const TRACK_MIN_H = 18;
export const TRACK_MAX_H = 240;
export const NO_HEIGHTS: Record<string, number> = {};
export const DEFAULT_TRACK_H: TrackHeights = {
  titles: 28,
  clips: 80,
  sound: 48,
};
export const defaults = (): Dock => ({
  leftW: 232,
  rightW: 248,
  leftHidden: false,
  rightHidden: false,
  swapped: false,
  mode: "design",
  space: "edit",
  chat: { corner: "br" },
  chatW: 320,
  chatH: 340,
  timeLook: "layers",
  keysOpen: false,
  timeH: 170,
  historyLine: true,
  projectsOpen: { kitchen: false, edit: false },
  gradeEvery: false,
  rulers: false,
  timeMax: false,
  namesW: 150,
  commentsHidden: false,
  prototyping: false,
  wheelZooms: true,
  editChatOpen: false,
  chatDocked: { kitchen: true, edit: false },
  chatInPanel: false,
  panelChatH: 360,
  recipeOn: null,
  kitchenComments: false,
  recipeFull: false,
  kitchenChatH: 380,
  recipeFolded: false,
  kitchenChatFolded: false,
  kitchenChatW: 360,
  recipeW: 560,
  videoTab: "properties",
  photoTab: "color",
  trackH: { ...DEFAULT_TRACK_H },
});
export const CHAT_MIN = { w: 280, h: 140 };
export const PANEL_CHAT_MIN = 160;
export const TIME_MIN_H = 72;

export function parseLayout(raw: unknown): Dock {
  if (raw && typeof raw === "object") {
    const rawMode = (raw as Record<string, unknown>).mode;
    const mode: Mode = rawMode === "motion" ? "motion" : rawMode === "photo" || rawMode === "color" ? "photo" : "design";
    const r = raw as Partial<Dock>;
    const timeLook: TimeLook = r.timeLook === "cut" ? "cut" : "layers";
    // Chat was a space of its own until 3 Nov 2026; it opens as Studio now
    const space: Space = r.space === "kitchen" ? "kitchen" : "edit";
    const videoTab: RightTab = r.videoTab === "color" ? "color" : "properties";
    const photoTab: RightTab = r.photoTab === "properties" ? "properties" : "color";
    // the history line was hidden by default before 0.12.1; it shows unless the designer hid it themselves
    const historyLine = r.historyLineChosen ? r.historyLine !== false : true;
    const rawTrackH = (r as Record<string, unknown>).trackH as Partial<TrackHeights> | undefined;
    const trackH: TrackHeights = {
      titles: typeof rawTrackH?.titles === "number" ? Math.max(18, Math.min(160, Math.round(rawTrackH.titles))) : DEFAULT_TRACK_H.titles,
      clips: typeof rawTrackH?.clips === "number" ? Math.max(36, Math.min(240, Math.round(rawTrackH.clips))) : DEFAULT_TRACK_H.clips,
      sound: typeof rawTrackH?.sound === "number" ? Math.max(24, Math.min(200, Math.round(rawTrackH.sound))) : DEFAULT_TRACK_H.sound,
    };
    const rowH: Record<string, number> = {};
    const rawRowH = (r as Record<string, unknown>).rowH;
    if (rawRowH && typeof rawRowH === "object")
      for (const [id, h] of Object.entries(rawRowH)) if (typeof h === "number" && Number.isFinite(h)) rowH[id] = Math.max(TRACK_MIN_H, Math.min(TRACK_MAX_H, Math.round(h)));
    const open = (r.projectsOpen ?? {}) as Partial<Record<Space, unknown>>;
    const projectsOpen = { kitchen: open.kitchen === true, edit: open.edit === true };
    const docked = (r.chatDocked ?? {}) as Partial<Record<Space, unknown>>;
    const chatDocked = { kitchen: docked.kitchen !== false, edit: docked.edit === true };
    const chatInPanel = r.chatInPanel === true;
    const panelChatH = typeof r.panelChatH === "number" && Number.isFinite(r.panelChatH) ? Math.max(PANEL_CHAT_MIN, Math.round(r.panelChatH)) : 360;
    const recipeOn = typeof r.recipeOn === "string" ? r.recipeOn : null;
    return { ...defaults(), ...r, recipeFull: false, projectsOpen, chatDocked, chatInPanel, panelChatH, recipeOn, prototyping: false, mode, space, timeLook, timeMax: false, videoTab, photoTab, historyLine, trackH, rowH };
  }
  return defaults();
}

function load(): Dock {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return parseLayout(raw);
  } catch {
    /* start fresh */
  }
  return defaults();
}

let state: Dock = load();
const listeners = new Set<() => void>();

export const getLayout = () => state;

export function setLayout(patch: Partial<Dock>) {
  if ("historyLine" in patch) patch = { ...patch, historyLineChosen: true };
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const resetLayout = () => setLayout(defaults());

export function useLayout<T>(selector: (d: Dock) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => selector(state),
  );
}

export const clampW = (n: number) => Math.max(MIN_W, Math.min(MAX_W, Math.round(n)));

/** Whether the Colour panel is open on the right in Video or Photo. */
export function isColorOpen(d: Dock): boolean {
  if (d.mode === "photo") return (d.photoTab ?? "color") === "color";
  if (d.mode === "motion") return d.videoTab === "color";
  return false;
}

/** Which tab the right panel is on for the given space (defaults to the active mode). */
export function rightTabOf(d: Dock, mode: Mode = d.mode): RightTab {
  if (mode === "photo") return d.photoTab ?? "color";
  if (mode === "motion") return d.videoTab ?? "properties";
  return "properties";
}

/** Each project keeps the space it was left in: Design, Video or Photo. Kept on this computer. */
const MODES = "duet:modes";
export function modeOf(path: string): Mode | null {
  try {
    const m = (JSON.parse(localStorage.getItem(MODES) ?? "{}") as Record<string, string>)[path];
    if (m === "design" || m === "motion" || m === "photo") return m;
    if (m === "color") return "photo";
    return null;
  } catch {
    return null;
  }
}
export function keepMode(path: string, mode: Mode) {
  try {
    const all = JSON.parse(localStorage.getItem(MODES) ?? "{}") as Record<string, Mode>;
    if (all[path] === mode) return;
    all[path] = mode;
    localStorage.setItem(MODES, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/* ---- a small window: the canvas keeps its room, and the panels give way ---- */

/** The canvas is never narrower than this. */
export const CANVAS_MIN = 480;
/** How wide the projects list is open, and folded to its strip of icons. */
export const PROJECTS_OPEN_W = 276;
export const PROJECTS_FOLDED_W = 44;

export interface StudioFit {
  /** 0 when the panel is folded away, by the designer or for room. */
  lw: number;
  rw: number;
}

/**
 * How Studio fits a window: the panels first shrink toward their smallest width, then the right panel folds away,
 * then Layers. Nothing is saved: a wider window brings them back. A panel the designer closed stays closed,
 * and the projects list stays as the designer left it.
 */
export function fitStudio(win: number, o: { projectsOpen: boolean; chatCol: number; lw: number; rw: number }): StudioFit {
  const tries: StudioFit[] = [
    { lw: o.lw, rw: o.rw },
    { lw: o.lw, rw: 0 },
    { lw: 0, rw: 0 },
  ];
  const room = win - (o.projectsOpen ? PROJECTS_OPEN_W : PROJECTS_FOLDED_W) - o.chatCol - CANVAS_MIN;
  for (const t of tries) {
    const want = t.lw + t.rw;
    if (want <= room) return t;
    const ws = [t.lw, t.rw];
    const mins = ws.map((w) => (w ? Math.min(w, MIN_W) : 0));
    const least = mins[0] + mins[1];
    if (least <= room) {
      const k = (room - least) / (want - least);
      const [lw, rw] = ws.map((w, i) => (w ? Math.floor(mins[i] + (w - mins[i]) * k) : 0));
      return { lw, rw };
    }
  }
  return tries[tries.length - 1];
}

/** How wide Kitchen's recipe or chat column can be: it shrinks toward its smallest width so the design keeps its room. */
export function fitKitchen(win: number, o: { projectsOpen: boolean; sideW: number; sideMin: number; comments: number }): number {
  const room = win - (o.projectsOpen ? PROJECTS_OPEN_W : PROJECTS_FOLDED_W) - o.comments - CANVAS_MIN;
  return Math.max(Math.min(o.sideW, room), Math.min(o.sideW, o.sideMin));
}

/** The window's width, kept up to date. */
let winW = typeof window !== "undefined" ? window.innerWidth : 1440;
const winSubs = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    winW = window.innerWidth;
    winSubs.forEach((f) => f());
  });
}
export function useWindowWidth(): number {
  return useSyncExternalStore(
    (f) => (winSubs.add(f), () => winSubs.delete(f)),
    () => winW,
    () => winW,
  );
}

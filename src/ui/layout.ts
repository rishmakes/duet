import { useSyncExternalStore } from "react";

/** Where the panels and the chat sit. Kept per person, on this computer. */

export type Corner = "tl" | "tr" | "bl" | "br";
export type Mode = "design" | "motion" | "photo";
/** Agent (called chat inside): talk to the AI beside your projects and watch the canvas. Studio (called edit inside): every tool. */
export type Space = "chat" | "edit";
export type TimeLook = "layers" | "cut";
export type RightTab = "properties" | "color";

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
  /** How wide the chat is in the Chat space, or 0 to share the room with the canvas as it comes. */
  homeChatW: number;
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
  /** A mouse wheel zooms, like in Adobe apps. A trackpad still slides the canvas. */
  wheelZooms: boolean;
  /** The chat is open when Studio comes up. Off, it waits folded away until clicked. */
  editChatOpen: boolean;
  /** In Video, whether the right panel shows Properties or Colour. */
  videoTab: RightTab;
  /** In Photo, whether the right panel shows Properties or Colour. */
  photoTab: RightTab;
  /** How tall each kind of row in Edit is. */
  trackH: TrackHeights;
}

const KEY = "duet:layout";
export const MIN_W = 180;
export const MAX_W = 460;
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
  homeChatW: 0,
  gradeEvery: false,
  rulers: false,
  timeMax: false,
  namesW: 150,
  commentsHidden: false,
  wheelZooms: true,
  editChatOpen: false,
  videoTab: "properties",
  photoTab: "color",
  trackH: { ...DEFAULT_TRACK_H },
});
export const CHAT_MIN = { w: 280, h: 140 };
export const TIME_MIN_H = 72;

export function parseLayout(raw: unknown): Dock {
  if (raw && typeof raw === "object") {
    const rawMode = (raw as Record<string, unknown>).mode;
    const mode: Mode = rawMode === "motion" ? "motion" : rawMode === "photo" || rawMode === "color" ? "photo" : "design";
    const r = raw as Partial<Dock>;
    const timeLook: TimeLook = r.timeLook === "cut" ? "cut" : "layers";
    const space: Space = r.space === "chat" ? "chat" : "edit";
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
    return { ...defaults(), ...r, mode, space, timeLook, timeMax: false, videoTab, photoTab, historyLine, trackH };
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

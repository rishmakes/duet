import { useSyncExternalStore } from "react";

/** Where the panels and the chat sit. Kept per person, on this computer. */

export type Corner = "tl" | "tr" | "bl" | "br";
export type Mode = "design" | "motion" | "color";
/** Project (called chat inside): talk to the AI beside your projects and watch the canvas. Edit: the tools. */
export type Space = "chat" | "edit";
export type TimeLook = "layers" | "cut";

export interface Dock {
  leftW: number;
  rightW: number;
  leftHidden: boolean;
  rightHidden: boolean;
  /** Layers on the right and the design panel on the left. */
  swapped: boolean;
  /** Whether we are designing, animating or changing colour. */
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
}

const KEY = "duet:layout";
export const MIN_W = 180;
export const MAX_W = 460;
export const defaults = (): Dock => ({ leftW: 232, rightW: 248, leftHidden: false, rightHidden: false, swapped: false, mode: "design", space: "edit", chat: { corner: "br" }, chatW: 320, chatH: 340, timeLook: "layers", keysOpen: false, timeH: 170, historyLine: false, homeChatW: 0, gradeEvery: false, rulers: false, timeMax: false, namesW: 150, commentsHidden: false });
export const CHAT_MIN = { w: 280, h: 140 };
export const TIME_MIN_H = 72;

function load(): Dock {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Dock> | null;
    if (raw && typeof raw === "object") {
      const mode: Mode = raw.mode === "motion" || raw.mode === "color" ? raw.mode : "design";
      const timeLook: TimeLook = raw.timeLook === "cut" ? "cut" : "layers";
      const space: Space = raw.space === "chat" ? "chat" : "edit";
      return { ...defaults(), ...raw, mode, space, timeLook, timeMax: false };
    }
  } catch {
    /* start fresh */
  }
  return defaults();
}

let state: Dock = load();
const listeners = new Set<() => void>();

export const getLayout = () => state;

export function setLayout(patch: Partial<Dock>) {
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

/** Each project keeps the space it was left in: Design, Motion or Colour. Kept on this computer. */
const MODES = "duet:modes";
export function modeOf(path: string): Mode | null {
  try {
    const m = (JSON.parse(localStorage.getItem(MODES) ?? "{}") as Record<string, Mode>)[path];
    return m === "design" || m === "motion" || m === "color" ? m : null;
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

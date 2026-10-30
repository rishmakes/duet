import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "../ui/dialog";
import { useSyncExternalStore } from "react";

/**
 * Cutting video: a list of clips, the part of each one to keep, and their order.
 * The first version joins the kept parts into one file. No text, effects or sound of its own yet.
 * The list is kept on this computer, not in a project.
 */

export interface Clip {
  id: string;
  /** The full path of the file on this computer. */
  path: string;
  name: string;
  /** Seconds. How long the whole file is. */
  duration: number;
  width: number;
  height: number;
  sound: boolean;
  /** Seconds into the file where the part to keep starts and ends. */
  start: number;
  end: number;
}

export type Shape = "first" | "tall" | "wide" | "square";

export interface Cut {
  clips: Clip[];
  /** The shape of the finished video. "first" follows the first clip. */
  shape: Shape;
}

export const SHAPES: { id: Shape; name: string; size?: [number, number] }[] = [
  { id: "first", name: "Same as the first clip" },
  { id: "tall", name: "Tall, for Reels and Shorts", size: [1080, 1920] },
  { id: "wide", name: "Wide, for YouTube", size: [1920, 1080] },
  { id: "square", name: "Square", size: [1080, 1080] },
];

/** The shortest part of a clip that can be kept, in seconds. */
export const SHORTEST = 0.1;

export const emptyCut = (): Cut => ({ clips: [], shape: "first" });

export interface Info {
  duration: number;
  width: number;
  height: number;
  sound: boolean;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function addClip(cut: Cut, path: string, info: Info, id: string): Cut {
  const clip: Clip = { id, path, name: fileName(path), ...info, start: 0, end: info.duration };
  return { ...cut, clips: [...cut.clips, clip] };
}

export function removeClip(cut: Cut, id: string): Cut {
  return { ...cut, clips: cut.clips.filter((c) => c.id !== id) };
}

/** Put a clip at another place in the order. `to` is where it ends up, counting from 0. */
export function moveClip(cut: Cut, id: string, to: number): Cut {
  const from = cut.clips.findIndex((c) => c.id === id);
  if (from < 0) return cut;
  const clips = cut.clips.filter((c) => c.id !== id);
  clips.splice(Math.max(0, Math.min(clips.length, to)), 0, cut.clips[from]);
  return { ...cut, clips };
}

/** Change where the kept part of a clip starts or ends. It always stays inside the file and never gets shorter than SHORTEST. */
export function trimClip(cut: Cut, id: string, part: { start?: number; end?: number }): Cut {
  return {
    ...cut,
    clips: cut.clips.map((c) => {
      if (c.id !== id) return c;
      let start = part.start ?? c.start;
      let end = part.end ?? c.end;
      start = Math.max(0, Math.min(start, c.duration - SHORTEST));
      end = Math.max(SHORTEST, Math.min(end, c.duration));
      // the edge being moved gives way, the other one stays where it was
      if (end - start < SHORTEST) part.start !== undefined ? (start = end - SHORTEST) : (end = start + SHORTEST);
      return { ...c, start, end };
    }),
  };
}

export const setShape = (cut: Cut, shape: Shape): Cut => ({ ...cut, shape });

/** How long the finished video will be, in seconds. */
export const totalLength = (cut: Cut) => cut.clips.reduce((sum, c) => sum + (c.end - c.start), 0);

/** The width and height of the finished video, or null while there is no clip. */
export function sizeOf(cut: Cut): [number, number] | null {
  const fixed = SHAPES.find((s) => s.id === cut.shape)?.size;
  if (fixed) return fixed;
  const first = cut.clips[0];
  return first ? [first.width, first.height] : null;
}

/** Seconds as a designer reads them: 0:07.5, 1:02.0. */
export function timeText(seconds: number): string {
  const s = Math.max(0, seconds);
  const whole = Math.floor(s / 60);
  return `${whole}:${(s - whole * 60).toFixed(1).padStart(4, "0")}`;
}

// ---- the list being cut, kept on this computer ----

const KEY = "duet.cut";
let cut: Cut = load();
const listeners = new Set<() => void>();

function load(): Cut {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Cut | null;
    if (saved && Array.isArray(saved.clips)) return { ...emptyCut(), ...saved };
  } catch {
    /* nothing kept, or private mode */
  }
  return emptyCut();
}

export const getCut = () => cut;

/** Replace the list. Use it with the functions above: setCut(trimClip(getCut(), id, { end: 4 })). */
export function setCut(next: Cut) {
  cut = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(cut));
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The list being cut, for the interface. It redraws when the list changes. */
export const useCut = () => useSyncExternalStore(subscribe, getCut);

// ---- the computer's side ----

const KINDS = ["mp4", "mov", "m4v", "webm", "mkv", "avi"];

/** True when this computer can cut video. If not, say so and offer nothing else. */
export const videoReady = () => invoke<boolean>("video_ready").catch(() => false);

/** The address the interface plays a clip from. */
export const srcOf = (clip: Clip) => convertFileSrc(clip.path);

/** Ask for video files and add them to the end. Returns a message for each file that could not be read. */
export async function addFiles(): Promise<string[]> {
  const picked = await open({ multiple: true, title: "Bring in clips", filters: [{ name: "Video", extensions: KINDS }] });
  const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
  const problems: string[] = [];
  for (const path of paths) {
    try {
      const info = await invoke<Info>("video_info", { path });
      setCut(addClip(getCut(), path, info, `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`));
    } catch (e) {
      problems.push(`${fileName(path)}: ${String(e)}`);
    }
  }
  return problems;
}

/** Ask where to save, then make the video. Returns the path of the file, or null if the designer backed out. Throws a message if it fails. */
export async function exportCut(): Promise<string | null> {
  const size = sizeOf(cut);
  if (!size) throw new Error("Add a clip first.");
  const out = await save({ title: "Save your video", defaultPath: "My video.mp4", filters: [{ name: "Video", extensions: ["mp4"] }] });
  if (!out) return null;
  const file = out.toLowerCase().endsWith(".mp4") ? out : `${out}.mp4`;
  await invoke("video_export", { clips: cut.clips.map((c) => ({ path: c.path, start: c.start, end: c.end })), width: size[0], height: size[1], out: file });
  return file;
}

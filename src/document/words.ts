import type { Doc, Transcript, Word } from "./types";
import { playsFile } from "./types";
import { frameTimeAt, spanOf } from "./time";

/**
 * The words of an edit (#340). Words belong to a recording; a clip is a window onto its file. So the
 * words of an edit are never stored, only read: for each clip, the words of its file that fall inside
 * the part it shows, placed at the moment of the frame they are heard. However the edit is cut, trimmed,
 * split or sped up, this is true, and nothing is heard again.
 */

/** A word as it is heard in a frame that plays. */
export interface EditWord {
  w: string;
  /** Seconds of the frame. */
  s: number;
  e: number;
  /** The clip or sound it is heard in. */
  clip: string;
  /** Seconds of its file, for cutting by the file. */
  fs: number;
  fe: number;
}

/** A stretch of a recording that no clip in the frame shows: words that were cut out. */
export interface CutOut {
  src: string;
  /** Seconds of the file. */
  s: number;
  e: number;
  words: string[];
}

/** The part of its file a clip shows, in seconds of the file. */
function shownPart(doc: Doc, clipId: string, sceneId: string): { from: number; to: number; at: number } | null {
  const el = doc.elements[clipId];
  const scene = doc.elements[sceneId];
  if (!el || !scene) return null;
  const span = spanOf(el, scene);
  const speed = el.speed || 1;
  return { from: el.clipFrom, to: el.clipFrom + (span.end - span.start) * speed, at: span.start };
}

/** A word counts as shown when most of it is: its middle is inside the part. */
const inside = (w: Word, from: number, to: number) => {
  const mid = (w.s + w.e) / 2;
  return mid >= from && mid < to;
};

/** Every clip and sound in a frame that has words, in the frame's own order. */
function clipsWithWords(doc: Doc, sceneId: string): string[] {
  const scene = doc.elements[sceneId];
  if (!scene) return [];
  return scene.childIds.filter((id) => {
    const el = doc.elements[id];
    return !!el && playsFile(el) && !el.hidden && !!doc.words?.[el.src];
  });
}

/** The words of the edit as it is now, in the order they are heard. */
export function wordsOfEdit(doc: Doc, sceneId: string): EditWord[] {
  const out: EditWord[] = [];
  for (const id of clipsWithWords(doc, sceneId)) {
    const el = doc.elements[id];
    const part = shownPart(doc, id, sceneId);
    const t = doc.words?.[el.src];
    if (!part || !t) continue;
    for (const w of t.words) {
      if (!inside(w, part.from, part.to)) continue;
      out.push({ w: w.w, s: round(frameTimeAt(el, part.at, w.s)), e: round(frameTimeAt(el, part.at, w.e)), clip: id, fs: w.s, fe: w.e });
    }
  }
  return out.sort((a, b) => a.s - b.s || a.e - b.e);
}

/** The stretches of each recording in the frame that no clip shows, with the words in them. */
export function cutOutOfEdit(doc: Doc, sceneId: string): CutOut[] {
  const bySrc = new Map<string, { from: number; to: number }[]>();
  for (const id of clipsWithWords(doc, sceneId)) {
    const part = shownPart(doc, id, sceneId);
    if (!part) continue;
    const src = doc.elements[id].src;
    bySrc.set(src, [...(bySrc.get(src) ?? []), part]);
  }
  const out: CutOut[] = [];
  for (const [src, parts] of bySrc) {
    const words = doc.words?.[src]?.words ?? [];
    let run: Word[] = [];
    const flush = () => {
      if (run.length) out.push({ src, s: run[0].s, e: run[run.length - 1].e, words: run.map((w) => w.w) });
      run = [];
    };
    for (const w of words) {
      if (parts.some((p) => inside(w, p.from, p.to))) flush();
      else run.push(w);
    }
    flush();
  }
  return out;
}

/** The doc with a recording's words set, or taken away when `transcript` is null. Never mutates. */
export function withWords(doc: Doc, src: string, transcript: Transcript | null): Doc {
  const words = { ...(doc.words ?? {}) };
  if (transcript) words[src] = { language: transcript.language, model: transcript.model, words: transcript.words.map((w) => ({ w: w.w, s: w.s, e: w.e })) };
  else delete words[src];
  if (Object.keys(words).length) return { ...doc, words };
  const { words: _w, ...rest } = doc;
  return rest;
}

/** Words read from a file, keeping only what makes sense. */
export function readWords(raw: unknown): Record<string, Transcript> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, Transcript> = {};
  for (const [src, t] of Object.entries(raw as Record<string, Partial<Transcript>>)) {
    if (!t || !Array.isArray(t.words)) continue;
    const words = t.words.filter((w): w is Word => !!w && typeof w.w === "string" && Number.isFinite(w.s) && Number.isFinite(w.e));
    out[src] = { language: typeof t.language === "string" ? t.language : "", model: typeof t.model === "string" ? t.model : "", words };
  }
  return Object.keys(out).length ? out : undefined;
}

const round = (n: number) => Math.round(n * 100) / 100;

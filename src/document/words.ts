import type { Doc, Transcript, Word } from "./types";
import { playsFile } from "./types";
import { frameTimeAt, spanOf } from "./time";
import { inEnglishLetters } from "./roman";

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

/** Seconds of quiet a cut by words keeps on each side, so the words left never sound clipped. */
export const BREATH = 0.15;

/**
 * The stretches of frame time to take out to cut words `from` to `to` (places in `words`, both kept in
 * the cut). A cut never starts or ends on a word: it starts a breath after the word before and ends a
 * breath before the word after, or halfway there when the gap is shorter. So the pause around the cut
 * words goes too, and the join is two short breaths. Cuts that touch become one.
 */
export function cutsForWords(words: EditWord[], picks: { from: number; to: number }[], keep = BREATH, length = Infinity, loud?: (t: number) => number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const p of [...picks].sort((a, b) => a.from - b.from)) {
    const first = words[p.from];
    const last = words[p.to];
    if (!first || !last || p.to < p.from) continue;
    const before = words[p.from - 1];
    const after = words[p.to + 1];
    let start = before ? between(before.e, first.s, keep, "after", loud) : Math.max(0, first.s - keep);
    let end = after ? between(last.e, after.s, keep, "before", loud) : Math.min(length, last.e + keep);
    // words the speech model gave no length still take a little time with them
    if (end - start < 0.02) {
      start = Math.max(0, Math.min(start, first.s) - 0.02);
      end = Math.min(length, Math.max(end, last.e) + 0.02);
    }
    const r = { start: round(start), end: round(end) };
    const prev = out[out.length - 1];
    if (prev && r.start <= prev.end) prev.end = Math.max(prev.end, r.end);
    else out.push(r);
  }
  return out;
}

/** How finely the quiet between two words is searched, in seconds: the loudness is read in these slices. */
const LISTEN_STEP = 0.05;
/** Seconds the search may reach past the edge the speech model gave a word, which is often a little off. */
const SLACK = 0.04;

/**
 * Where a cut sits between a word ending at `a` and one starting at `b`. With room, a breath away from the
 * word that stays (`side` says which one: the word "after" `a` or "before" `b`). In fast speech, with no room
 * for two breaths, the quietest moment between them when the sound can be heard, so the next word is never
 * clipped; else halfway.
 */
function between(a: number, b: number, keep: number, side: "after" | "before", loud?: (t: number) => number): number {
  const gap = Math.max(0, b - a);
  const breath = side === "after" ? a + Math.min(keep, gap / 2) : b - Math.min(keep, gap / 2);
  if (!loud || gap >= 2 * keep) return breath;
  const lo = a - SLACK;
  const hi = b + SLACK;
  let best = breath;
  let quiet = loud(breath);
  for (let t = lo; t <= hi + 1e-9; t += LISTEN_STEP / 2) {
    const v = loud(t);
    if (v < quiet || (v === quiet && Math.abs(t - breath) < Math.abs(best - breath))) {
      best = t;
      quiet = v;
    }
  }
  return Math.max(0, best);
}

/**
 * Where a clip's start or end may be trimmed to so it never clips a word (#340): in seconds of its file, a
 * breath before each word for a start, a breath after each word for an end, or halfway when words are closer.
 */
export function trimPoints(words: Word[], edge: "start" | "end", keep = BREATH): number[] {
  return words.map((w, i) => {
    if (edge === "start") {
      const prev = words[i - 1];
      return round(Math.max(0, prev ? w.s - Math.min(keep, Math.max(0, w.s - prev.e) / 2) : w.s - keep));
    }
    const next = words[i + 1];
    return round(next ? w.e + Math.min(keep, Math.max(0, next.s - w.e) / 2) : w.e + keep);
  });
}

/** A word as compared when checking the AI means the word it named: letters and digits only, lower case. */
export const plainWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** The doc with a recording's words set, or taken away when `transcript` is null. Never mutates. */
export function withWords(doc: Doc, src: string, transcript: Transcript | null): Doc {
  const words = { ...(doc.words ?? {}) };
  if (transcript) words[src] = { language: transcript.language, model: transcript.model, words: transcript.words.map((w) => ({ w: inEnglishLetters(w.w), s: w.s, e: w.e })) };
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
    const words = t.words.filter((w): w is Word => !!w && typeof w.w === "string" && Number.isFinite(w.s) && Number.isFinite(w.e)).map((w) => ({ ...w, w: inEnglishLetters(w.w) }));
    out[src] = { language: typeof t.language === "string" ? t.language : "", model: typeof t.model === "string" ? t.model : "", words };
  }
  return Object.keys(out).length ? out : undefined;
}

const round = (n: number) => Math.round(n * 100) / 100;

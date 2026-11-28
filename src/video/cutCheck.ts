import { fileTimeAt, spanOf } from "../document/time";
import { playsFile } from "../document/types";
import type { Doc, El, Word } from "../document/types";
import { hiddenHere, loudness } from "../document/tracks";
import { PEAK_SLICE } from "./faces";
import { SILENCE_DEFAULT } from "./silence";

/**
 * Check the cuts of a frame that plays (#148): at every place a clip starts or ends inside its
 * recording, is someone still speaking? Three witnesses, all in seconds of the recording: the voice
 * finder (where speech is, the most exact about edges), the words, and the loudness. A cut is bad when
 * the voice finder hears speech at it, or, without the finder, when a word is under it and it is loud.
 * Pure: the caller fetches what is heard.
 */

/** What is known about one recording. Any part may be missing. */
export interface Heard {
  /** Where someone speaks, [start, end] in seconds of the recording. */
  speech?: [number, number][];
  words?: Word[];
  /** Loudest level in each PEAK_SLICE of the recording, 0 to 255. */
  peaks?: Uint8Array;
}

export interface BadCut {
  clip: string;
  /** "end": the clip ends while someone speaks, chopping a word. "start": it starts in the middle of one. */
  edge: "start" | "end";
  /** Seconds of the frame. */
  at: number;
  /** Seconds of the recording. */
  file: number;
  /** Speech the cut falls in, in seconds of the recording. */
  speech?: [number, number];
  /** The word the cut falls in. */
  word?: Word;
  /** How loud it is at the cut, 0 to 9. */
  loud?: number;
  /** The nearest clean place before and after, in seconds of the recording. */
  earlier?: number;
  later?: number;
}

/** Room a cut needs from speech on each side, in seconds. */
export const ROOM = 0.03;
/** How far the search for a clean place reaches, in seconds. */
const REACH = 1.5;
const STEP = 0.01;

const loudAt = (peaks: Uint8Array | undefined, t: number) => (peaks?.length ? peaks[Math.max(0, Math.min(peaks.length - 1, Math.floor(t / PEAK_SLICE + 1e-6)))] : undefined);
const speechAt = (speech: [number, number][] | undefined, t: number) => speech?.find(([a, b]) => a < t + ROOM && b > t - ROOM);
const wordAt = (words: Word[] | undefined, t: number) => words?.find((w) => w.s + ROOM < t && w.e - ROOM > t);

/** Someone is speaking at this second of a recording, as far as what is known can tell. */
function speaking(h: Heard, t: number): boolean {
  if (h.speech) return !!speechAt(h.speech, t);
  const loud = loudAt(h.peaks, t);
  const word = !!wordAt(h.words, t);
  if (h.words && loud != null) return word && loud >= SILENCE_DEFAULT.quiet;
  return h.words ? word : loud != null && loud >= SILENCE_DEFAULT.quiet;
}

/** A clean place is not speech, not inside a word, and quiet. */
function clean(h: Heard, t: number): boolean {
  if (h.speech && speechAt(h.speech, t)) return false;
  if (wordAt(h.words, t)) return false;
  const loud = loudAt(h.peaks, t);
  return loud == null || loud < SILENCE_DEFAULT.quiet;
}

function nearestClean(h: Heard, t: number, dir: 1 | -1, length: number): number | undefined {
  for (let k = 1; k * STEP <= REACH; k++) {
    const u = round(t + dir * k * STEP);
    if (u < 0 || u > length) return undefined;
    if (clean(h, u)) return u;
  }
  return undefined;
}

/** The cuts in a frame that fall while someone speaks. `heard` holds what is known of each recording, by its path. */
export function checkCuts(doc: Doc, sceneId: string, heard: Map<string, Heard>): BadCut[] {
  const scene = doc.elements[sceneId];
  if (!scene || !(scene.duration > 0)) return [];
  const clips = scene.childIds.map((id) => doc.elements[id]).filter((el): el is El => !!el && playsFile(el) && !hiddenHere(doc, el) && loudness(doc, el) > 0);
  const parts = clips.map((el) => {
    const span = spanOf(el, scene);
    return { el, span, from: el.clipFrom, to: fileTimeAt(el, span.start, span.end) };
  });
  // a clip that goes on in the next one, from the same second of the same recording, is not a cut
  const goesOn = (src: string, file: number, frame: number, edge: "start" | "end") =>
    parts.some((p) => p.el.src === src && (edge === "end" ? Math.abs(p.from - file) < 0.02 && Math.abs(p.span.start - frame) < 0.02 : Math.abs(p.to - file) < 0.02 && Math.abs(p.span.end - frame) < 0.02));
  const out: BadCut[] = [];
  for (const { el, span, from, to } of parts) {
    const h = heard.get(el.src);
    if (!h) continue;
    const length = h.peaks?.length ? h.peaks.length * PEAK_SLICE : Infinity;
    const edges: { edge: "start" | "end"; at: number; file: number }[] = [];
    if (from > 0.02 && !goesOn(el.src, from, span.start, "start")) edges.push({ edge: "start", at: span.start, file: from });
    if (to < length - 0.05 && !goesOn(el.src, to, span.end, "end")) edges.push({ edge: "end", at: span.end, file: to });
    for (const e of edges) {
      if (!speaking(h, e.file)) continue;
      const loud = loudAt(h.peaks, e.file);
      out.push({
        clip: el.id,
        ...e,
        at: round(e.at),
        file: round(e.file),
        speech: speechAt(h.speech, e.file),
        word: wordAt(h.words, e.file),
        loud: loud == null ? undefined : Math.min(9, Math.round((loud / 255) * 9)),
        earlier: nearestClean(h, e.file, -1, length),
        later: nearestClean(h, e.file, 1, length),
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** One line for the AI about a bad cut. */
export function badCutLine(c: BadCut, name: string): string {
  const what = c.edge === "end" ? "ends while someone is still speaking: the word is chopped" : "starts while someone is already speaking: the word is clipped";
  const heard = [
    c.speech ? `voice ${c.speech[0].toFixed(2)}-${c.speech[1].toFixed(2)}` : "",
    c.word ? `word "${c.word.w}" ${c.word.s.toFixed(2)}-${c.word.e.toFixed(2)}` : "",
    c.loud != null ? `loudness ${c.loud} of 9` : "",
  ].filter(Boolean);
  const fix = [c.earlier != null ? `${c.earlier.toFixed(2)} (${sign(c.earlier - c.file)})` : "", c.later != null ? `${c.later.toFixed(2)} (${sign(c.later - c.file)})` : ""].filter(Boolean);
  return `${name} (${c.clip}) ${c.edge} at ${c.at.toFixed(2)} s of the frame, ${c.file.toFixed(2)} s of its recording, ${what}. Heard there: ${heard.join(", ") || "speech"}. ${fix.length ? `Clean at ${fix.join(" or ")} s of the recording.` : "No clean place within 1.5 s."}`;
}

const sign = (d: number) => `${d >= 0 ? "+" : "-"}${Math.abs(d).toFixed(2)}`;
const round = (n: number) => Math.round(n * 100) / 100;

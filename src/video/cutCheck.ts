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

type Edge = "start" | "end";

const loudAt = (peaks: Uint8Array | undefined, t: number) => (peaks?.length ? peaks[Math.max(0, Math.min(peaks.length - 1, Math.floor(t / PEAK_SLICE + 1e-6)))] : undefined);
/**
 * Speech that a cut at `t` harms: speech running across it, or speech within ROOM on the side the cut
 * throws away (after an end: the rest of the word is lost; before a start: a sliver of the word before
 * comes in). Speech on the side that is kept may come as close as it likes.
 */
const speechAt = (speech: [number, number][] | undefined, t: number, edge: Edge) =>
  speech?.find(([a, b]) => (edge === "end" ? a < t + ROOM && b > t - 0.005 : a < t + 0.005 && b > t - ROOM));
const wordAt = (words: Word[] | undefined, t: number) => words?.find((w) => w.s + ROOM < t && w.e - ROOM > t);

/** Someone is speaking at this cut, as far as what is known can tell. */
function speaking(h: Heard, t: number, edge: Edge): boolean {
  if (h.speech) return !!speechAt(h.speech, t, edge);
  const loud = loudAt(h.peaks, t);
  const word = !!wordAt(h.words, t);
  if (h.words && loud != null) return word && loud >= SILENCE_DEFAULT.quiet;
  return h.words ? word : loud != null && loud >= SILENCE_DEFAULT.quiet;
}

/** A clean place for this edge: no speech harmed, not inside a word, and quiet. */
function clean(h: Heard, t: number, edge: Edge): boolean {
  if (h.speech && speechAt(h.speech, t, edge)) return false;
  if (wordAt(h.words, t)) return false;
  const loud = loudAt(h.peaks, t);
  return loud == null || loud < SILENCE_DEFAULT.quiet;
}

function nearestClean(h: Heard, t: number, edge: Edge, dir: 1 | -1, length: number): number | undefined {
  for (let k = 1; k * STEP <= REACH; k++) {
    const u = round(t + dir * k * STEP);
    if (u < 0 || u > length) return undefined;
    if (clean(h, u, edge)) return u;
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
    // loudness 9 is this recording's loudest
    const most = h.peaks?.length ? Math.max(1, ...h.peaks) : 255;
    const edges: { edge: Edge; at: number; file: number }[] = [];
    if (from > 0.02 && !goesOn(el.src, from, span.start, "start")) edges.push({ edge: "start", at: span.start, file: from });
    if (to < length - 0.05 && !goesOn(el.src, to, span.end, "end")) edges.push({ edge: "end", at: span.end, file: to });
    for (const e of edges) {
      if (!speaking(h, e.file, e.edge)) continue;
      const loud = loudAt(h.peaks, e.file);
      out.push({
        clip: el.id,
        ...e,
        at: round(e.at),
        file: round(e.file),
        speech: speechAt(h.speech, e.file, e.edge),
        word: wordAt(h.words, e.file),
        loud: loud == null ? undefined : Math.min(9, Math.round((loud / most) * 9)),
        earlier: nearestClean(h, e.file, e.edge, -1, length),
        later: nearestClean(h, e.file, e.edge, 1, length),
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** One line for the AI about a bad cut. */
export function badCutLine(c: BadCut, name: string): string {
  // speech across the cut is a word cut in two; speech only on the side cut away is a word just beside it
  const across = !c.speech || (c.speech[0] < c.file && c.speech[1] > c.file);
  const what =
    c.edge === "end"
      ? across
        ? "ends while someone is still speaking: the word is chopped"
        : "ends right as the next word begins: the start of it may be heard"
      : across
        ? "starts while someone is already speaking: the word is clipped"
        : "starts right as a word ends: the end of it may be heard";
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

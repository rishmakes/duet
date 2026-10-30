import { fileTimeAt, spanOf } from "../document/time";
import { playsFile } from "../document/types";
import type { Doc } from "../document/types";
import { PEAK_SLICE } from "./faces";
import { hiddenHere, loudness } from "../document/tracks";

/** How a pause is found: quieter than `quiet` (0 to 255, as the loudness is drawn) for at least `shortest` seconds. */
export interface SilenceChoice {
  quiet: number;
  shortest: number;
  /** Seconds of quiet left on each side of a cut, so words do not sound clipped. */
  keep: number;
}

export const SILENCE_DEFAULT: SilenceChoice = { quiet: 40, shortest: 0.5, keep: 0.1 };

/**
 * The pauses in a frame that plays, in its own time. A moment is quiet when every clip heard then is
 * quiet; `peaks` holds each file's loudness by its path. With `ids`, only those clips are listened to.
 */
export function findSilences(doc: Doc, sceneId: string, peaks: Map<string, Uint8Array>, choice: SilenceChoice, ids?: string[]): { start: number; end: number }[] {
  const scene = doc.elements[sceneId];
  if (!scene || !(scene.duration > 0)) return [];
  const heard = scene.childIds
    .map((id) => doc.elements[id])
    .filter((el) => el && playsFile(el) && !hiddenHere(doc, el) && loudness(doc, el) > 0 && (peaks.get(el.src)?.length ?? 0) > 0 && (!ids || ids.includes(el.id)));
  if (!heard.length) return [];
  const spans = heard.map((el) => ({ el, ...spanOf(el, scene), loud: peaks.get(el.src)! }));
  // only the time some listened clip covers counts; elsewhere there is nothing to judge
  const from = Math.min(...spans.map((s) => s.start));
  const to = Math.max(...spans.map((s) => s.end));
  const out: { start: number; end: number }[] = [];
  let quietFrom: number | null = null;
  const close = (t: number) => {
    if (quietFrom === null) return;
    const start = quietFrom + choice.keep;
    const end = t - choice.keep;
    if (t - quietFrom >= choice.shortest && end - start > 0.05) out.push({ start: round(start), end: round(end) });
    quietFrom = null;
  };
  for (let k = 0; from + k * PEAK_SLICE < to; k++) {
    // counted in slices, not added up, so the time does not drift over a long clip
    const t = from + k * PEAK_SLICE;
    let top = 0;
    for (const s of spans) {
      if (t < s.start || t >= s.end) continue;
      const i = Math.floor(fileTimeAt(s.el, s.start, t) / PEAK_SLICE + 1e-6);
      top = Math.max(top, s.loud[Math.max(0, Math.min(s.loud.length - 1, i))]);
    }
    if (top < choice.quiet) quietFrom ??= t;
    else close(t);
  }
  close(to);
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

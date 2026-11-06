import { spanOf, valueAt, withKey } from "./time";
import { trackOf } from "./tracks";
import type { Doc, El, Key } from "./types";

/** Quieter than this many decibels counts as silent. */
export const QUIETEST_DB = -60;

/** A volume from 0 to 1 in decibels, where 1 is the file as it is (0 dB). Silent is minus infinity. */
export const toDb = (v: number) => (v <= 0 ? -Infinity : 20 * Math.log10(v));
export const fromDb = (db: number) => (db <= QUIETEST_DB ? 0 : Math.min(1, Math.pow(10, db / 20)));
/** How a volume reads to a person: "0 dB", "-6 dB", "Silent". */
export const dbText = (v: number) => (v <= fromDb(QUIETEST_DB) ? "Silent" : `${Math.round(toDb(v) * 10) / 10} dB`);

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** The clip's own volume at a moment of its frame, before fades and its track. */
export const volumeAt = (el: El, t: number) => clamp(el.keys.volume?.length ? valueAt(el.keys.volume, t) : el.volume);

/** How far its fades let it be heard at a moment, from 0 to 1. The sound rises quickly and settles, and dies away the same way. */
export function fadeAt(el: El, span: { start: number; end: number }, t: number) {
  const len = span.end - span.start;
  const fin = Math.min(el.fadeIn || 0, len);
  const fout = Math.min(el.fadeOut || 0, len);
  let g = 1;
  if (fin > 0 && t < span.start + fin) g *= Math.sin((Math.max(0, t - span.start) / fin) * (Math.PI / 2));
  if (fout > 0 && t > span.end - fout) g *= Math.sin((Math.max(0, span.end - t) / fout) * (Math.PI / 2));
  return clamp(g);
}

/** How loud a clip or sound is heard at a moment, from 0 to 1: its track, its volume over time and its fades together. */
export function gainAt(doc: Doc, el: El, scene: El, t: number) {
  const track = trackOf(doc, el);
  if (track?.silent) return 0;
  return clamp((track?.volume ?? 1) * volumeAt(el, t) * fadeAt(el, spanOf(el, scene), t));
}

/** Whether its loudness changes while it plays, so a single number cannot say it. */
export const gainMoves = (el: El) => !!el.keys.volume?.length || (el.fadeIn || 0) > 0 || (el.fadeOut || 0) > 0;

/**
 * How loud it is from one moment of the frame to another, as straight pieces: [seconds from `from`, gain].
 * Fine enough to hear no steps, few enough to write out. Export uses it.
 */
export function gainPoints(doc: Doc, el: El, scene: El, from: number, to: number): [number, number][] {
  const step = 0.05;
  const dense: [number, number][] = [];
  for (let t = from; t < to; t += step) dense.push([t, gainAt(doc, el, scene, t)]);
  dense.push([to, gainAt(doc, el, scene, to - 0.0005)]);
  // keep only the points a straight line between their neighbours would miss
  const out: [number, number][] = [dense[0]];
  let kept = 0;
  for (let i = 1; i < dense.length - 1; i++) {
    const a = dense[kept];
    const c = dense[i + 1];
    // a long steady stretch still gets a point now and then, so this stays quick
    let fits = i - kept < 100;
    for (let j = kept + 1; fits && j <= i; j++) {
      const [t, g] = dense[j];
      const line = a[1] + ((c[1] - a[1]) * (t - a[0])) / (c[0] - a[0]);
      if (Math.abs(line - g) > 0.004) {
        fits = false;
        break;
      }
    }
    if (!fits) {
      out.push(dense[i]);
      kept = i;
    }
  }
  out.push(dense[dense.length - 1]);
  return out.map(([t, g]) => [Math.round((t - from) * 1000) / 1000, Math.round(g * 10000) / 10000]);
}

/**
 * Its volume keys after making one stretch of time louder or quieter by some decibels, with short
 * ramps outside the stretch so it never jumps. Points already inside the stretch move with it.
 */
export function dipKeys(el: El, scene: El, a: number, b: number, db: number): Key[] {
  const span = spanOf(el, scene);
  const lo = Math.max(span.start, Math.min(a, b));
  const hi = Math.min(span.end, Math.max(a, b));
  if (hi - lo < 0.02) return el.keys.volume ?? [];
  const ramp = Math.min(0.3, (hi - lo) / 4);
  const r = (t: number) => Math.round(t * 1000) / 1000;
  const before = Math.max(span.start, lo - ramp);
  const after = Math.min(span.end, hi + ramp);
  const f = Math.pow(10, db / 20);
  const old = el.keys.volume ?? [];
  const at = (t: number) => volumeAt(el, t);
  let keys = old.filter((k) => k.t < before - 0.004 || k.t > after + 0.004);
  if (before < lo - 0.004) keys = withKey(keys, { t: r(before), v: at(before), ease: "linear" });
  keys = withKey(keys, { t: r(lo), v: clamp(at(lo) * f), ease: "in-out" });
  for (const k of old) if (k.t > lo + 0.004 && k.t < hi - 0.004) keys = withKey(keys, { ...k, v: clamp(k.v * f) });
  keys = withKey(keys, { t: r(hi), v: clamp(at(hi) * f), ease: "linear" });
  if (after > hi + 0.004) keys = withKey(keys, { t: r(after), v: at(after), ease: "in-out" });
  return keys;
}

/**
 * How loud a clip's file is, second by second of its frame, for an AI that cannot hear: one digit
 * per second (0 is silence, 9 the loudest in this clip), and the moments where it suddenly gets louder.
 * `peaks` is the file's loudest level in each slice of `slice` seconds, 0 to 255.
 */
export function loudnessMap(el: El, span: { start: number; end: number }, peaks: Uint8Array, slice: number) {
  const seconds: number[] = [];
  for (let t = Math.floor(span.start); t < span.end; t++) {
    const a = Math.max(t, span.start);
    const b = Math.min(t + 1, span.end);
    const fa = el.clipFrom + (a - span.start) * (el.speed || 1);
    const fb = el.clipFrom + (b - span.start) * (el.speed || 1);
    let top = 0;
    for (let i = Math.max(0, Math.floor(fa / slice)); i < Math.min(peaks.length, Math.ceil(fb / slice)); i++) top = Math.max(top, peaks[i]);
    seconds.push(top);
  }
  const most = Math.max(1, ...seconds);
  const digits = seconds.map((v) => Math.min(9, Math.round((v / most) * 9)));
  const first = Math.floor(span.start);
  const rises = digits.flatMap((d, i) => (i > 0 && d - digits[i - 1] >= 3 ? [first + i] : []));
  return { fromSecond: first, levels: digits.join(""), getsLouderAt: rises };
}

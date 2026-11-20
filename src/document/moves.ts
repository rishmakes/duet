import { spanOf } from "./time";
import type { CutMove, CutMoveKind, Doc, El } from "./types";

/**
 * Transitions at cuts. A transition belongs to the clip coming in: it says how the picture changes from the
 * clip that ends where this one starts, on the same track. It lasts `seconds`, half before the cut and half
 * after, and the clips keep their places on the timeline. A dissolve shows both clips at once for its length,
 * so the clip going out shows on past its end and the clip coming in shows before its start, from the footage
 * past each end of the cut. Where a file has no footage there, its end picture holds still.
 * Nothing here draws; it answers which clips show at a moment, and how.
 */

export const CUT_MOVE_NAMES: Record<CutMoveKind, string> = {
  dissolve: "Dissolve",
  "dip-black": "Dip to Black",
  "dip-white": "Dip to White",
};
/** How long a new transition lasts, and the shortest and longest it can be, in seconds. */
export const CUT_MOVE_SECONDS = 0.5;
export const CUT_MOVE_MIN = 0.1;
export const CUT_MOVE_MAX = 2;

/** How close the end of one clip and the start of the next must be to count as a cut, in seconds: under a picture. */
const TOUCH = 0.02;

/** The clip that ends where this one starts, on the same track: the other side of its cut. */
export function clipBefore(doc: Doc, el: El, scene: El): El | null {
  if (el.type !== "video" || !el.parentId) return null;
  const parent = doc.elements[el.parentId];
  if (!parent) return null;
  const at = spanOf(el, scene).start;
  let best: El | null = null;
  let gap = TOUCH;
  for (const id of parent.childIds) {
    const o = doc.elements[id];
    if (!o || o.id === el.id || o.type !== "video" || (o.track ?? "") !== (el.track ?? "")) continue;
    const s = spanOf(o, scene);
    if (s.start >= at) continue;
    const d = Math.abs(s.end - at);
    if (d <= gap) {
      best = o;
      gap = d;
    }
  }
  return best;
}

/** The clips in a frame that have a cut just before them, in the order they are listed. */
export function cutsIn(doc: Doc, scene: El): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    for (const c of doc.elements[id]?.childIds ?? []) {
      const el = doc.elements[c];
      if (!el) continue;
      if (clipBefore(doc, el, scene)) out.push(c);
      walk(c);
    }
  };
  walk(scene.id);
  return out;
}

/** How long a transition really lasts: never longer than either clip, so each half fits inside its clip. */
export function moveLength(move: CutMove, before: El, after: El, scene: El): number {
  const a = spanOf(before, scene);
  const b = spanOf(after, scene);
  return Math.max(0, Math.min(move.seconds, a.end - a.start, b.end - b.start));
}

/** One clip's part in one transition. */
interface Part {
  kind: CutMoveKind;
  /** The clip going out, or the clip coming in. */
  role: "out" | "in";
  /** Whether this clip is drawn over the other one. */
  front: boolean;
  from: number;
  to: number;
}

/** Each clip in a transition: the time it shows, from before its start to past its end, and its parts. */
interface Shown {
  start: number;
  end: number;
  parts: Part[];
}

const plans = new WeakMap<Doc, Map<string, Map<string, Shown>>>();

/** Every clip of a frame that is in a transition. Worked out once for each design, as it is asked for at every picture. */
function planOf(doc: Doc, scene: El): Map<string, Shown> {
  let byScene = plans.get(doc);
  if (!byScene) plans.set(doc, (byScene = new Map()));
  const known = byScene.get(scene.id);
  if (known) return known;
  const plan = new Map<string, Shown>();
  const entry = (el: El) => {
    let s = plan.get(el.id);
    if (!s) {
      const span = spanOf(el, scene);
      plan.set(el.id, (s = { start: span.start, end: span.end, parts: [] }));
    }
    return s;
  };
  const walk = (id: string) => {
    for (const c of doc.elements[id]?.childIds ?? []) {
      const b = doc.elements[c];
      if (!b) continue;
      walk(c);
      if (!b.cutIn) continue;
      const a = clipBefore(doc, b, scene);
      if (!a) continue;
      const len = moveLength(b.cutIn, a, b, scene);
      if (len < 0.02) continue;
      const cut = spanOf(b, scene).start;
      const from = cut - len / 2;
      const to = cut + len / 2;
      const siblings = doc.elements[b.parentId ?? ""]?.childIds ?? [];
      // what comes later in the list is drawn over what comes before
      const bFront = siblings.indexOf(b.id) > siblings.indexOf(a.id);
      const kind = b.cutIn.kind;
      const sa = entry(a);
      const sb = entry(b);
      sa.parts.push({ kind, role: "out", front: !bFront, from, to });
      sb.parts.push({ kind, role: "in", front: bFront, from, to });
      if (kind === "dissolve") {
        sa.end = Math.max(sa.end, to);
        sb.start = Math.min(sb.start, from);
      }
    }
  };
  walk(scene.id);
  byScene.set(scene.id, plan);
  return plan;
}

/** The time a thing shows in its frame: its own span, widened where a dissolve shows it past its ends. */
export function shownSpanOf(doc: Doc, el: El, scene: El): { start: number; end: number } {
  const s = el.type === "video" ? planOf(doc, scene).get(el.id) : undefined;
  return s ? { start: s.start, end: s.end } : spanOf(el, scene);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** Slow at both ends, quick through the middle. */
const smooth = (p: number) => p * p * (3 - 2 * p);

/**
 * How a clip looks at one moment because of its transitions: how much of it shows (1 is all), and how much
 * a dip covers it with colour. Null when no transition touches it then.
 */
export function cutLookAt(doc: Doc, el: El, scene: El, t: number): { show: number; wash?: { color: string; amount: number } } | null {
  if (el.type !== "video") return null;
  const s = planOf(doc, scene).get(el.id);
  if (!s) return null;
  let show = 1;
  let wash: { color: string; amount: number } | undefined;
  for (const p of s.parts) {
    if (t < p.from || t >= p.to) continue;
    const len = p.to - p.from;
    if (p.kind === "dissolve") {
      // only the clip in front fades; the one behind stays whole, so the picture never dims in the middle
      const k = smooth(clamp01((t - p.from) / len));
      if (p.front) show *= p.role === "in" ? k : 1 - k;
    } else {
      const mid = p.from + len / 2;
      const half = len / 2;
      const amount = p.role === "out" ? (t < mid ? smooth(clamp01((t - p.from) / half)) : 0) : t >= mid ? smooth(clamp01(1 - (t - mid) / half)) : 0;
      if (amount > (wash?.amount ?? 0)) wash = { color: p.kind === "dip-white" ? "#ffffff" : "#000000", amount };
    }
  }
  return { show, ...(wash ? { wash } : {}) };
}

/**
 * Whether a transition has to hold a still picture because a file has no footage past the cut, given the
 * files' lengths in seconds. Used to tell the designer; the picture itself just holds.
 */
export function holdsStill(doc: Doc, after: El, scene: El, fileLength: (src: string) => number): boolean {
  const before = clipBefore(doc, after, scene);
  if (!before || !after.cutIn || after.cutIn.kind !== "dissolve") return false;
  const half = moveLength(after.cutIn, before, after, scene) / 2;
  const a = spanOf(before, scene);
  const afterA = (fileLength(before.src) - (before.clipFrom + (a.end - a.start) * (before.speed || 1))) / (before.speed || 1);
  const beforeB = after.clipFrom / (after.speed || 1);
  return afterA < half - 0.01 || beforeB < half - 0.01;
}

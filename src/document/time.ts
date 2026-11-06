import { fromAbs, toAbs } from "./path";
import type { Doc, El, Key, Moving, ShapeKey } from "./types";
import { MOVING } from "./types";

/**
 * Time. A frame on the page with a length plays like a video, and the things in it are what is seen:
 * each has a second it appears and a second it leaves, and its position, size, opacity and turn can
 * change in between. Nothing here draws. It only answers what the design looks like at one moment.
 */

const EASE: Record<Key["ease"], (p: number) => number> = {
  linear: (p) => p,
  in: (p) => p * p * p,
  out: (p) => 1 - (1 - p) ** 3,
  "in-out": (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
};

/** Ready shapes for the speed of a move, as handles. The first four are what `ease` names; the rest are for a designer to pick. */
export const CURVES = {
  steady: [0, 0, 1, 1],
  gentle: [0.65, 0, 0.35, 1],
  snappy: [0.16, 1, 0.3, 1],
  bouncy: [0.34, 1.56, 0.64, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;
export type CurveName = keyof typeof CURVES;

/** How far along a move is, from how far along its time is, through a curve with two handles. */
export function curveAt(c: readonly [number, number, number, number], p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const [x1, y1, x2, y2] = c;
  const bez = (a: number, b: number, s: number) => 3 * a * (1 - s) * (1 - s) * s + 3 * b * (1 - s) * s * s + s * s * s;
  // find the point along the curve where time is p, then read how far along it is there
  let lo = 0;
  let hi = 1;
  let s = p;
  for (let i = 0; i < 30; i++) {
    const x = bez(x1, x2, s);
    if (Math.abs(x - p) < 1e-5) break;
    if (x < p) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return bez(y1, y2, s);
}

/** The changes over time a designer thinks of as one thing, in the order they are listed. */
export const KEY_GROUPS: { name: string; props: Moving[] }[] = [
  { name: "Position", props: ["x", "y"] },
  { name: "Size", props: ["width", "height"] },
  { name: "Opacity", props: ["opacity"] },
  { name: "Rotation", props: ["rotation"] },
];

/** The value at one moment. Before the first key it holds the first value, after the last it holds the last. */
export function valueAt(keys: Key[], t: number): number {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t > b.t) continue;
    const a = keys[i - 1];
    const p = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    return a.v + (b.v - a.v) * (b.curve ? curveAt(b.curve, p) : (EASE[b.ease] ?? EASE.linear)(p));
  }
  return keys[keys.length - 1].v;
}

/**
 * The list with this key added, in order of time. A key at the same moment is replaced.
 * `keepShape` is for changing the value of a moment by hand: the speed shape the designer gave it stays.
 */
export function withKey(keys: Key[], key: Key, keepShape = false): Key[] {
  const old = keepShape && !key.curve ? keys.find((k) => Math.abs(k.t - key.t) <= 0.004)?.curve : undefined;
  return keys
    .filter((k) => Math.abs(k.t - key.t) > 0.004)
    .concat(old ? { ...key, curve: old } : key)
    .sort((a, b) => a.t - b.t);
}

/** The frame that plays this thing: the frame on the page it sits in, when that frame has a length. */
export function sceneOf(doc: Doc, id: string): El | null {
  let el: El | undefined = doc.elements[id];
  while (el?.parentId) el = doc.elements[el.parentId];
  return el && el.type === "frame" && el.duration > 0 ? el : null;
}

/** The second a thing appears and the second it leaves, inside the frame that plays it. */
export function spanOf(el: El, scene: El): { start: number; end: number } {
  const start = Math.min(el.start, scene.duration);
  return { start, end: el.end > start ? Math.min(el.end, scene.duration) : scene.duration };
}

/**
 * The one rule for a clip or sound: which second of its file is heard or seen at a moment of the
 * frame, and the other way round. `from` is the moment the clip appears in the frame (its span start).
 * Everything that plays, exports, trims or splits a clip asks here, so they cannot disagree.
 */
export const fileTimeAt = (el: El, from: number, t: number) => el.clipFrom + (t - from) * (el.speed || 1);
export const frameTimeAt = (el: El, from: number, file: number) => from + (file - el.clipFrom) / (el.speed || 1);

/** Whether anything at all changes over time on this thing. */
export const moves = (el: El) => MOVING.some((p) => el.keys[p]?.length) || !!el.shapeKeys?.length;

/** The shape keys with one added, in order of time. A key at the same moment is replaced. */
export function withShapeKey(keys: ShapeKey[], key: ShapeKey): ShapeKey[] {
  return keys
    .filter((k) => Math.abs(k.t - key.t) > 0.004)
    .concat(key)
    .sort((a, b) => a.t - b.t);
}

/** The outline at one moment: blended point by point between the two keys around it. It holds the earlier shape when the point counts differ. */
export function outlineAt(keys: ShapeKey[], t: number): ShapeKey["points"] {
  if (t <= keys[0].t) return keys[0].points;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t > b.t) continue;
    const a = keys[i - 1];
    if (a.points.length !== b.points.length) return t >= b.t ? b.points : a.points;
    const p = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    const k = b.curve ? curveAt(b.curve, p) : (EASE[b.ease] ?? EASE.linear)(p);
    const mix = (u: number, v: number) => u + (v - u) * k;
    return a.points.map((n, j) => {
      const m = b.points[j];
      return { x: mix(n.x, m.x), y: mix(n.y, m.y), ix: mix(n.ix, m.ix), iy: mix(n.iy, m.iy), ox: mix(n.ox, m.ox), oy: mix(n.oy, m.oy) };
    });
  }
  return keys[keys.length - 1].points;
}

/** The outline of a drawn shape as shape keys record it, in pixels inside its parent. */
export const outlineOf = (el: El): ShapeKey["points"] => toAbs(el, el.x, el.y);

/** One thing as it is at one moment. The same object comes back when nothing on it changes over time. */
export function elAt(el: El, t: number): El {
  if (!moves(el)) return el;
  const out = { ...el };
  if (el.type === "path" && el.shapeKeys?.length) Object.assign(out, fromAbs(outlineAt(el.shapeKeys, t)));
  for (const p of MOVING) {
    const keys = el.keys[p];
    if (keys?.length) {
      const v = valueAt(keys, t);
      // a bouncy shape overshoots: opacity stays between clear and solid, and a size never goes below a pixel
      out[p] = p === "opacity" || p === "volume" ? Math.min(1, Math.max(0, v)) : p === "width" || p === "height" ? Math.max(1, v) : v;
    }
  }
  return out;
}

/**
 * The design as it looks at one moment of a frame that plays. Things that have not appeared yet or
 * have left are taken out, and what changes over time is set to its value at that moment.
 */
export function docAt(doc: Doc, sceneId: string, t: number): Doc {
  const scene = doc.elements[sceneId];
  if (!scene || scene.type !== "frame" || !(scene.duration > 0)) return doc;
  const elements = { ...doc.elements };
  const walk = (id: string) => {
    const el = elements[id];
    const kept = el.childIds.filter((c) => {
      const child = doc.elements[c];
      if (!child) return false;
      const span = spanOf(child, scene);
      // the last moment still shows what was there at the end
      return t >= span.start && (t < span.end || (t >= scene.duration && span.end >= scene.duration));
    });
    if (kept.length !== el.childIds.length) {
      // a mask whose pictures have all left has only its shape left, which would show as a plain solid
      const emptied = el.mask && el.childIds.length > 1 && kept.length < 2;
      elements[id] = { ...el, childIds: kept, ...(emptied ? { hidden: true } : {}) };
    }
    for (const c of kept) {
      elements[c] = elAt(doc.elements[c], t);
      walk(c);
    }
  };
  walk(sceneId);
  return { ...doc, elements };
}

export const ENTRANCES = ["none", "fade", "slide-left", "slide-right", "slide-up", "slide-down", "grow"] as const;
export type Entrance = (typeof ENTRANCES)[number];

/**
 * The keys that make a thing arrive or leave in a ready-made way. Arriving is written at its first
 * moments and leaving at its last, and whatever was written there before for the same properties goes.
 */
export function entranceKeys(el: El, scene: El, when: "in" | "out", kind: Entrance, seconds: number): El["keys"] {
  const { start, end } = spanOf(el, scene);
  const len = Math.min(seconds, (end - start) / 2);
  const [a, b] = when === "in" ? [start, start + len] : [end - len, end];
  const keys: El["keys"] = {};
  const inside = (k: Key) => k.t >= a - 0.004 && k.t <= b + 0.004;
  // clear this stretch of time first, on everything a ready-made arrival can touch
  for (const p of MOVING) {
    const left = (el.keys[p] ?? []).filter((k) => !inside(k) || (p !== "opacity" && p !== "x" && p !== "y" && p !== "width" && p !== "height"));
    if (left.length) keys[p] = left;
  }
  const put = (p: Moving, away: number, home: number) => {
    const [first, last] = when === "in" ? [away, home] : [home, away];
    let list = keys[p] ?? [];
    list = withKey(list, { t: a, v: first, ease: "linear" });
    list = withKey(list, { t: b, v: last, ease: when === "in" ? "out" : "in" });
    keys[p] = list;
  };
  const far = 80;
  if (kind === "fade") put("opacity", 0, el.opacity);
  if (kind === "slide-left") (put("x", el.x + far, el.x), put("opacity", 0, el.opacity));
  if (kind === "slide-right") (put("x", el.x - far, el.x), put("opacity", 0, el.opacity));
  if (kind === "slide-up") (put("y", el.y + far, el.y), put("opacity", 0, el.opacity));
  if (kind === "slide-down") (put("y", el.y - far, el.y), put("opacity", 0, el.opacity));
  if (kind === "grow") {
    put("width", el.width * 0.8, el.width);
    put("height", el.height * 0.8, el.height);
    put("x", el.x + el.width * 0.1, el.x);
    put("y", el.y + el.height * 0.1, el.y);
    put("opacity", 0, el.opacity);
  }
  // a key that only repeats the resting value on its own says nothing
  for (const p of MOVING) if (keys[p]?.length === 1 && keys[p]![0].v === el[p]) delete keys[p];
  return keys;
}

/** Which ready-made way a thing arrives or leaves, read back from what it does at that end of its time. */
export function entranceOf(el: El, scene: El, when: "in" | "out"): Entrance {
  const { start, end } = spanOf(el, scene);
  // the value a property has at the very edge, when it differs from where it rests
  const edge = (p: Moving): number | null => {
    const keys = el.keys[p];
    if (!keys || keys.length < 2) return null;
    const k = when === "in" ? keys[0] : keys[keys.length - 1];
    const at = when === "in" ? start : end;
    return Math.abs(k.t - at) < 0.01 && Math.abs(k.v - el[p]) > 0.001 ? k.v : null;
  };
  if (edge("width") !== null) return "grow";
  const x = edge("x");
  if (x !== null) return x > el.x ? "slide-left" : "slide-right";
  const y = edge("y");
  if (y !== null) return y > el.y ? "slide-up" : "slide-down";
  return edge("opacity") !== null ? "fade" : "none";
}

/** Everything inside a frame, at any depth. */
function inside(doc: Doc, sceneId: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    for (const c of doc.elements[id]?.childIds ?? []) {
      out.push(c);
      walk(c);
    }
  };
  walk(sceneId);
  return out;
}

/**
 * The design with everything that changes over time set to its value at one moment. Nothing is
 * hidden. This is the design as a person meets it on the canvas while the clock is on that moment,
 * so it is the one a change by hand is made to. `settle` then puts that change where it belongs.
 */
export function poseAt(doc: Doc, sceneId: string, t: number): Doc {
  const scene = doc.elements[sceneId];
  if (!scene || !(scene.duration > 0)) return doc;
  let elements: Doc["elements"] | null = null;
  for (const id of inside(doc, sceneId)) {
    const el = doc.elements[id];
    if (!moves(el)) continue;
    elements ??= { ...doc.elements };
    elements[id] = elAt(el, t);
  }
  return elements ? { ...doc, elements } : doc;
}

/**
 * Put a change that was made at one moment where it belongs. `real` is the design before, `posed`
 * is what the change was made to, `out` is the result. A property that changes over time gets a
 * key at that moment and keeps its resting value. Everything else is kept as the change left it.
 */
export function settle(real: Doc, posed: Doc, out: Doc, sceneId: string, t: number): Doc {
  if (out === posed) return real;
  if (posed === real) return out;
  const at = Math.round(t * 1000) / 1000;
  const elements = { ...out.elements };
  for (const id of inside(real, sceneId)) {
    const was = real.elements[id];
    const shown = posed.elements[id];
    const now = out.elements[id];
    if (!now) continue;
    if (!moves(was)) {
      // the first outline change of a mask's shape, after the moment it appears, starts it moving: it keeps the old shape until now
      const first = spanOf(was, real.elements[sceneId]).start;
      if (was.type === "path" && isMaskShape(real, id) && at > first + 0.004 && JSON.stringify(outlineOf(now)) !== JSON.stringify(outlineOf(was))) {
        const keys = [{ t: first, points: outlineOf(was).map(roundNode), ease: "in-out" as const }, { t: at, points: outlineOf(now).map(roundNode), ease: "in-out" as const }];
        elements[id] = { ...now, shapeKeys: keys, x: was.x, y: was.y, width: was.width, height: was.height, nodes: was.nodes };
      }
      continue;
    }
    const el = { ...now, keys: { ...now.keys } };
    for (const p of MOVING) {
      if (!was.keys[p]?.length) continue;
      if (now[p] !== shown[p] && el.keys[p]?.length) el.keys[p] = withKey(el.keys[p]!, { t: at, v: now[p], ease: "in-out" }, true);
      el[p] = was[p];
    }
    if (was.shapeKeys?.length) {
      // a drawn shape whose outline was changed gets a key at this moment, and keeps its resting outline
      const moved = JSON.stringify(outlineOf(now)) !== JSON.stringify(outlineOf(shown));
      if (moved) {
        el.shapeKeys = withShapeKey(now.shapeKeys, { t: at, points: outlineOf(now).map(roundNode), ease: "in-out" });
        Object.assign(el, { x: was.x, y: was.y, width: was.width, height: was.height, nodes: was.nodes });
      }
    }
    elements[id] = el;
  }
  return { ...out, elements };
}

/** Is this the shape a mask group shows its contents through? */
const isMaskShape = (doc: Doc, id: string) => {
  const parent = doc.elements[doc.elements[id]?.parentId ?? ""];
  return !!parent?.mask && parent.childIds[0] === id;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const roundNode = (n: ShapeKey["points"][number]) => ({ x: r2(n.x), y: r2(n.y), ix: r2(n.ix), iy: r2(n.iy), ox: r2(n.ox), oy: r2(n.oy) });

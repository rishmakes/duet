import { keepInPlace, turnVector } from "../document/geometry";
import type { Rect } from "../document/types";

export type HandleKey = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLES: { key: HandleKey; fx: number; fy: number; cursor: string }[] = [
  { key: "nw", fx: 0, fy: 0, cursor: "nwse-resize" },
  { key: "n", fx: 0.5, fy: 0, cursor: "ns-resize" },
  { key: "ne", fx: 1, fy: 0, cursor: "nesw-resize" },
  { key: "e", fx: 1, fy: 0.5, cursor: "ew-resize" },
  { key: "se", fx: 1, fy: 1, cursor: "nwse-resize" },
  { key: "s", fx: 0.5, fy: 1, cursor: "ns-resize" },
  { key: "sw", fx: 0, fy: 1, cursor: "nesw-resize" },
  { key: "w", fx: 0, fy: 0.5, cursor: "ew-resize" },
];

/** How far the typing box reaches out from the words' own box, in screen pixels: its border and padding together. */
export const EDIT_EDGE = 3.5;
/** The typing box's border is 1.5 pixels wide, so its outline runs through the middle of it. */
const TYPING_BORDER = 1.5;

/** The box the handles sit on while words are typed: the outline of the typing box, which is a little outside the words' own box. */
export function typingBox(r: Rect): Rect {
  const out = EDIT_EDGE - TYPING_BORDER / 2;
  return { x: r.x - out, y: r.y - out, width: r.width + out * 2, height: r.height + out * 2 };
}

/** How far outside a corner, in screen pixels, the pointer can be and still turn the shape. */
export const TURN_REACH = 22;

const RESIZE_CURSORS = ["nwse-resize", "ns-resize", "nesw-resize", "ew-resize"];

/** The resize cursor for a handle, pointing the right way when the shape is turned. */
export function handleCursor(key: HandleKey, deg = 0): string {
  const i = HANDLES.findIndex((h) => h.key === key) + Math.round(deg / 45);
  return RESIZE_CURSORS[((i % 4) + 4) % 4];
}

/** The pointer shown where dragging turns the shape: a small curved arrow of our own. */
export const TURN_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cg fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 15a8 8 0 0 1 14 0M19 15v-5M19 15h-5' stroke='%23fff' stroke-width='4.5'/%3E%3Cpath d='M5 15a8 8 0 0 1 14 0M19 15v-5M19 15h-5' stroke='%231b1b1f' stroke-width='2'/%3E%3C/g%3E%3C/svg%3E\") 12 12, grab";

export interface ResizeOptions {
  /** Shift: keep the shape's proportions. */
  keepRatio?: boolean;
  /** Option or Alt: grow or shrink from the centre instead of the opposite edge. */
  fromCenter?: boolean;
}

/** New rectangle after dragging a handle by (dx, dy). Flips cleanly past the opposite edge. */
export function resizeRect(orig: Rect, key: HandleKey, dx: number, dy: number, opts: ResizeOptions = {}): Rect {
  const ox = orig.x;
  const oy = orig.y;
  const ow = orig.width;
  const oh = orig.height;
  const cx = ox + ow / 2;
  const cy = oy + oh / 2;
  const hasX = key.includes("w") || key.includes("e");
  const hasY = key.includes("n") || key.includes("s");

  let left = ox;
  let right = ox + ow;
  let top = oy;
  let bottom = oy + oh;
  const mirror = !!opts.fromCenter;
  if (key.includes("w")) {
    left += dx;
    if (mirror) right -= dx;
  }
  if (key.includes("e")) {
    right += dx;
    if (mirror) left -= dx;
  }
  if (key.includes("n")) {
    top += dy;
    if (mirror) bottom -= dy;
  }
  if (key.includes("s")) {
    bottom += dy;
    if (mirror) top -= dy;
  }

  if (opts.keepRatio && ow > 0 && oh > 0) {
    const w = right - left;
    const h = bottom - top;
    const sx = Math.abs(w) / ow;
    const sy = Math.abs(h) / oh;
    const s = hasX && hasY ? Math.max(sx, sy) : hasX ? sx : sy;
    const nw = ow * s;
    const nh = oh * s;
    const dirX = hasX && w < 0 ? -1 : 1;
    const dirY = hasY && h < 0 ? -1 : 1;
    if (mirror || !hasX) {
      left = cx - nw / 2;
      right = cx + nw / 2;
    } else if (key.includes("e")) {
      left = ox;
      right = ox + dirX * nw;
    } else {
      right = ox + ow;
      left = right - dirX * nw;
    }
    if (mirror || !hasY) {
      top = cy - nh / 2;
      bottom = cy + nh / 2;
    } else if (key.includes("s")) {
      top = oy;
      bottom = oy + dirY * nh;
    } else {
      bottom = oy + oh;
      top = bottom - dirY * nh;
    }
  }

  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.max(1, Math.abs(right - left)),
    height: Math.max(1, Math.abs(bottom - top)),
  };
}

/** The same, for a shape that is turned. The pointer's movement is read along the shape's own sides, and what you are not dragging stays put. */
export function resizeTurned(orig: Rect, deg: number, key: HandleKey, dx: number, dy: number, opts: ResizeOptions = {}): Rect {
  if (!deg) return resizeRect(orig, key, dx, dy, opts);
  const d = turnVector(dx, dy, -deg);
  return keepInPlace(orig, resizeRect(orig, key, d.x, d.y, opts), deg);
}

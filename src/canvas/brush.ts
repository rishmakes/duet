import { turnOf, turnPoint, worldPos } from "../document/geometry";
import type { Doc, El } from "../document/types";

/**
 * Brush math and engine functions for photo painting and erasing.
 * All internal stroke coordinates are in picture-file pixels.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileInfo {
  key: string;
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Calculates radial dab alpha with cosine falloff:
 * - Inside (1 - softness) of radius, alpha is 1.
 * - From (1 - softness) to radius, falls off with a smooth cosine to 0.
 * - Outside radius, alpha is 0.
 */
export function dabAlpha(r: number, radius: number, softness: number): number {
  if (r >= radius) return 0;
  if (r <= 0) return 1;
  const s = Math.max(0, Math.min(1, softness));
  const inner = (1 - s) * radius;
  if (r <= inner) return 1;
  const t = (r - inner) / (radius - inner);
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/**
 * Pressure scaling for dab diameter:
 * - Pen: e.pressure with p^1.35 scaling size down to 20% (0.2 + 0.8 * p^1.35).
 * - Mouse or other inputs: always 1.
 */
export function pressureScale(pressure: number, pointerType?: string): number {
  if (pointerType !== "pen") return 1;
  const p = Math.max(0, Math.min(1, pressure));
  return 0.2 + 0.8 * Math.pow(p, 1.35);
}

/**
 * Exponential point smoothing with factor (default 0.5).
 */
export function smoothPoint(prev: Point, curr: Point, factor = 0.5): Point {
  return {
    x: prev.x + factor * (curr.x - prev.x),
    y: prev.y + factor * (curr.y - prev.y),
  };
}

/**
 * Dab spacing is 12% of diameter.
 */
export function dabSpacing(diameter: number): number {
  return Math.max(0.5, diameter * 0.12);
}

/**
 * Steps along a line from p0 to p1 placing dabs at regular spacing,
 * accounting for distance carried over from previous events.
 */
export function stepDabs(
  p0: Point,
  p1: Point,
  carry: number,
  spacing: number,
): { dabs: { x: number; y: number; t: number }[]; carry: number } {
  const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (dist <= 0) return { dabs: [], carry };

  const dabs: { x: number; y: number; t: number }[] = [];
  let d = spacing - carry;
  while (d <= dist) {
    const t = d / dist;
    dabs.push({
      x: p0.x + t * (p1.x - p0.x),
      y: p0.y + t * (p1.y - p0.y),
      t,
    });
    d += spacing;
  }

  const lastDistance = dabs.length > 0 ? d - spacing : -carry;
  const nextCarry = dist - lastDistance;
  return { dabs, carry: Math.max(0, nextCarry) };
}

/**
 * Maps pointer coordinates from world to picture-file pixels.
 * Uses worldPos, rotation around center, and cover fit (Math.max(w/pw, h/ph), centred, cropped).
 */
export function worldToFile(
  world: Point,
  el: El,
  doc: Doc,
  picSize: [number, number],
): Point {
  const [pw, ph] = picSize;
  if (pw <= 0 || ph <= 0) return { x: 0, y: 0 };
  const wpos = worldPos(doc, el.id);
  const cx = wpos.x + el.width / 2;
  const cy = wpos.y + el.height / 2;
  const turn = turnOf(el);
  const unrotated = turn ? turnPoint(world.x, world.y, cx, cy, -turn) : world;
  const lx = unrotated.x - wpos.x;
  const ly = unrotated.y - wpos.y;
  const scale = Math.max(el.width / pw, el.height / ph) || 1;
  const w = pw * scale;
  const h = ph * scale;
  const offX = (el.width - w) / 2;
  const offY = (el.height - h) / 2;
  return {
    x: (lx - offX) / scale,
    y: (ly - offY) / scale,
  };
}

/**
 * Maps coordinates from picture-file pixels back to world coordinates.
 */
export function fileToWorld(
  file: Point,
  el: El,
  doc: Doc,
  picSize: [number, number],
): Point {
  const [pw, ph] = picSize;
  if (pw <= 0 || ph <= 0) return { x: 0, y: 0 };
  const wpos = worldPos(doc, el.id);
  const scale = Math.max(el.width / pw, el.height / ph) || 1;
  const w = pw * scale;
  const h = ph * scale;
  const offX = (el.width - w) / 2;
  const offY = (el.height - h) / 2;
  const lx = offX + file.x * scale;
  const ly = offY + file.y * scale;
  const unrotated = { x: wpos.x + lx, y: wpos.y + ly };
  const turn = turnOf(el);
  const cx = wpos.x + el.width / 2;
  const cy = wpos.y + el.height / 2;
  return turn ? turnPoint(unrotated.x, unrotated.y, cx, cy, turn) : unrotated;
}

/**
 * Returns the cover scale of a picture inside an element: scale = max(w/pw, h/ph).
 */
export function pictureCoverScale(el: El, picSize: [number, number]): number {
  const [pw, ph] = picSize;
  return pw > 0 && ph > 0 ? Math.max(el.width / pw, el.height / ph) : 1;
}

export function parseColor(c: string): [number, number, number] {
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16) || 0,
        parseInt(hex[1] + hex[1], 16) || 0,
        parseInt(hex[2] + hex[2], 16) || 0,
      ];
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16) || 0,
        parseInt(hex.slice(2, 4), 16) || 0,
        parseInt(hex.slice(4, 6), 16) || 0,
      ];
    }
  }
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (m) {
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return [0, 0, 0];
}

/**
 * Pre-renders a circular dab of the given diameter, softness, and colour into an offscreen canvas.
 */
export function renderDabCanvas(
  diameter: number,
  softness: number,
  colour: string,
): HTMLCanvasElement {
  const d = Math.max(1, Math.ceil(diameter));
  if (typeof document === "undefined") {
    return { width: d, height: d } as HTMLCanvasElement;
  }
  const canvas = document.createElement("canvas");
  canvas.width = d;
  canvas.height = d;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const [r, g, b] = parseColor(colour);
  const img = ctx.createImageData(d, d);
  const data = img.data;
  const radius = diameter / 2;
  const cx = d / 2;
  const cy = d / 2;

  for (let y = 0; y < d; y++) {
    const dy = y + 0.5 - cy;
    for (let x = 0; x < d; x++) {
      const dx = x + 0.5 - cx;
      const dist = Math.hypot(dx, dy);
      const alpha = dabAlpha(dist, radius, softness);
      const idx = (y * d + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Expands bounding box r1 to enclose r2.
 */
export function expandBox(r1: Box | null, r2: Box): Box {
  if (!r1) return { ...r2 };
  const minX = Math.min(r1.x, r2.x);
  const minY = Math.min(r1.y, r2.y);
  const maxX = Math.max(r1.x + r1.width, r2.x + r2.width);
  const maxY = Math.max(r1.y + r1.height, r2.y + r2.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Finds the PAINT_TILE (256) tiles touched by a stroke's bounding box,
 * clamped to the picture dimensions. Edge tiles may be smaller than 256.
 */
export function touchedTiles(
  box: Box,
  fileWidth: number,
  fileHeight: number,
  tileSize = 256,
): TileInfo[] {
  if (fileWidth <= 0 || fileHeight <= 0) return [];
  const minX = Math.max(0, Math.min(fileWidth, Math.floor(box.x)));
  const minY = Math.max(0, Math.min(fileHeight, Math.floor(box.y)));
  const maxX = Math.max(0, Math.min(fileWidth, Math.ceil(box.x + box.width)));
  const maxY = Math.max(0, Math.min(fileHeight, Math.ceil(box.y + box.height)));
  if (maxX <= minX || maxY <= minY) return [];

  const startCol = Math.floor(minX / tileSize);
  const endCol = Math.min(Math.floor((fileWidth - 1) / tileSize), Math.floor((maxX - 1) / tileSize));
  const startRow = Math.floor(minY / tileSize);
  const endRow = Math.min(Math.floor((fileHeight - 1) / tileSize), Math.floor((maxY - 1) / tileSize));

  const tiles: TileInfo[] = [];
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const tx = c * tileSize;
      const ty = r * tileSize;
      const tw = Math.min(tileSize, fileWidth - tx);
      const th = Math.min(tileSize, fileHeight - ty);
      tiles.push({
        key: `${c},${r}`,
        col: c,
        row: r,
        x: tx,
        y: ty,
        width: tw,
        height: th,
      });
    }
  }
  return tiles;
}

import { onOpenBoard } from "../document/boards";
import { isDerived } from "../document/components";
import { worldRect } from "../document/geometry";
import type { Doc, El, Rect } from "../document/types";
import type { State } from "../state/store";
import { getLayout } from "../ui/layout";

/** How far right of the picked thing the dot to drag a connection from sits, in screen pixels. */
const DOT_OUT = 16;
const DOT_R = 6;

const toScreen = (s: State, r: Rect): Rect => ({ x: r.x * s.viewport.zoom + s.viewport.x, y: r.y * s.viewport.zoom + s.viewport.y, width: r.width * s.viewport.zoom, height: r.height * s.viewport.zoom });

/** Whether this thing does something in Present. */
export const isLinked = (doc: Doc, el: El | undefined): el is El => !!el && (el.linkKind === "back" || (!!el.link && doc.elements[el.link]?.type === "frame"));

/** The dot on the picked thing that a connection is dragged from, in screen pixels. Only while connections are shown. */
export function linkDot(s: State, doc: Doc): { x: number; y: number; id: string } | null {
  if (!getLayout().prototyping || getLayout().mode !== "design" || s.selection.length !== 1) return null;
  const id = s.selection[0];
  if (!doc.elements[id] || isDerived(id)) return null;
  const r = toScreen(s, worldRect(doc, id));
  return { x: r.x + r.width + DOT_OUT, y: r.y + r.height / 2, id };
}

export const onLinkDot = (dot: { x: number; y: number } | null, sx: number, sy: number) => !!dot && Math.hypot(sx - dot.x, sy - dot.y) <= DOT_R + 4;

/** The screen at a spot on the page: a top-level frame on the open board, front first. */
export function screenAt(doc: Doc, x: number, y: number, not?: string): string | null {
  for (const id of [...doc.rootIds].reverse()) {
    const el = doc.elements[id];
    if (!el || el.type !== "frame" || el.hidden || id === not) continue;
    if (x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height) return id;
  }
  return null;
}

/** The screen a thing sits on. */
export function screenOf(doc: Doc, id: string): string {
  let el = doc.elements[id];
  while (el?.parentId && doc.elements[el.parentId]) el = doc.elements[el.parentId];
  return el.id;
}

function curve(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: Rect | { x: number; y: number }, colour: string, dashed: boolean, label: string) {
  // into the nearer side of the screen, level with where the line starts when it can be
  const box = "width" in to ? to : { ...to, width: 0, height: 0 };
  const right = box.x + box.width / 2 < from.x;
  const ex = right ? box.x + box.width : box.x;
  const ey = box.height ? Math.max(box.y + 16, Math.min(box.y + box.height - 16, from.y)) : box.y;
  const bend = Math.max(40, Math.abs(ex - from.x) / 2);
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1.5;
  if (dashed) ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.bezierCurveTo(from.x + bend, from.y, right ? ex + bend : ex - bend, ey, ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(from.x, from.y, 3, 0, Math.PI * 2);
  ctx.fill();
  // the arrow points into the screen
  const dir = right ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - dir * 8, ey - 4.5);
  ctx.lineTo(ex - dir * 8, ey + 4.5);
  ctx.closePath();
  ctx.fill();
  if (label) {
    ctx.font = "500 11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(label).width + 12;
    const mx = (from.x + ex) / 2 - w / 2;
    const my = (from.y + ey) / 2;
    ctx.beginPath();
    ctx.roundRect(mx, my - 9, w, 18, 9);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, mx + 6, my + 0.5);
  }
  ctx.restore();
}

/** What a connection does, in a few words, when it is not a plain click to another screen. */
function wordsFor(el: El): string {
  const when = el.trigger === "hover" ? "On hover" : "";
  const what = el.linkKind === "overlay" ? "on top" : "";
  return [when, what].filter(Boolean).join(", ");
}

/** Prototype connections, on the Prototype tab: a line from each thing to the screen it opens. Back buttons get a small Back tag instead. */
export function drawLinks(ctx: CanvasRenderingContext2D, s: State, doc: Doc, colour: string) {
  if (getLayout().mode !== "design") return;
  const here = onOpenBoard(doc);
  // only on the Prototype tab: while designing, nothing about prototypes shows
  if (!getLayout().prototyping) return;
  const ids = [...here];
  const drag = s.overlay.linkDrag;
  for (const id of ids) {
    const el = doc.elements[id];
    if (!isLinked(doc, el) || el.hidden || (drag && drag.from === id)) continue;
    const r = toScreen(s, worldRect(doc, id));
    const from = { x: r.x + r.width, y: r.y + r.height / 2 };
    if (el.linkKind === "back") {
      curve(ctx, from, { x: from.x + 36, y: from.y }, colour, el.trigger === "hover", "");
      ctx.save();
      ctx.font = "500 11px system-ui, sans-serif";
      ctx.fillStyle = colour;
      ctx.textBaseline = "middle";
      ctx.fillText(el.trigger === "hover" ? "Back, on hover" : "Back", from.x + 42, from.y + 0.5);
      ctx.restore();
      continue;
    }
    const target = el.link as string;
    if (!here.has(target) || target === screenOf(doc, id)) continue;
    curve(ctx, from, toScreen(s, worldRect(doc, target)), colour, el.trigger === "hover", wordsFor(el));
  }
  if (drag) {
    const r = toScreen(s, worldRect(doc, drag.from));
    const from = { x: r.x + r.width, y: r.y + r.height / 2 };
    if (drag.to) {
      const t = toScreen(s, worldRect(doc, drag.to));
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.strokeRect(t.x, t.y, t.width, t.height);
      ctx.restore();
      curve(ctx, from, t, colour, false, "");
    } else {
      curve(ctx, from, { x: drag.x * s.viewport.zoom + s.viewport.x, y: drag.y * s.viewport.zoom + s.viewport.y }, colour, false, "");
    }
  }
  const dot = linkDot(s, doc);
  if (dot && !drag) {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, DOT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

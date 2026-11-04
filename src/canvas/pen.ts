import { newId } from "../commands";
import { fromAbs } from "../document/path";
import type { AbsNode } from "../document/path";
import { frameAt, worldPos } from "../document/geometry";
import { workDoc, dispatch, getState, select, setOverlay, setTool } from "../state/store";

/**
 * The pen. Click to place a corner point. Click and drag to pull out a smooth curve.
 * Click the first point to close the shape. Enter or double-click ends an open line. Escape ends it too and keeps it, or lets the pen go when only one point is down.
 */

type P = { x: number; y: number };

const draft = () => getState().overlay.pen;
export const penActive = () => !!draft() && draft()!.nodes.length > 0;

/** How close, in screen pixels, a click must be to the first point to close the shape. */
const CLOSE_PX = 9;

export function penDown(p: P, zoom: number): number | null {
  const cur = draft()?.nodes ?? [];
  if (cur.length >= 2 && Math.hypot(p.x - cur[0].x, p.y - cur[0].y) * zoom <= CLOSE_PX) {
    penFinish(true);
    return null;
  }
  const next: AbsNode[] = [...cur, { x: p.x, y: p.y, ix: 0, iy: 0, ox: 0, oy: 0 }];
  setOverlay({ pen: { nodes: next, cursor: p } });
  return next.length - 1;
}

/** Dragging after a click pulls out a smooth curve: one handle out, the opposite handle in. */
export function penDrag(index: number, p: P, zoom: number) {
  const d = draft();
  if (!d || !d.nodes[index]) return;
  const n = d.nodes[index];
  const dx = p.x - n.x;
  const dy = p.y - n.y;
  const small = Math.hypot(dx, dy) * zoom < 3;
  const nodes = d.nodes.map((m, i) => (i === index ? { ...m, ox: small ? 0 : dx, oy: small ? 0 : dy, ix: small ? 0 : -dx, iy: small ? 0 : -dy } : m));
  setOverlay({ pen: { nodes, cursor: p } });
}

export function penHover(p: P) {
  const d = draft();
  if (d && d.nodes.length) setOverlay({ pen: { nodes: d.nodes, cursor: p } });
}

export function penBack() {
  const d = draft();
  if (!d) return;
  const nodes = d.nodes.slice(0, -1);
  setOverlay({ pen: nodes.length ? { nodes, cursor: d.cursor } : null });
}

export function penCancel() {
  setOverlay({ pen: null });
}

/** Turn the drawn points into a line on the page. */
export function penFinish(closed: boolean, backToMove = true) {
  const d = draft();
  setOverlay({ pen: null });
  if (!d) return;
  // a double-click leaves two points on the same spot
  const nodes = d.nodes.filter((n, i, all) => i === 0 || Math.hypot(n.x - all[i - 1].x, n.y - all[i - 1].y) > 0.5);
  if (nodes.length < 2) return;
  const doc = workDoc();
  const parentId = frameAt(doc, nodes[0].x, nodes[0].y);
  const parent = parentId ? worldPos(doc, parentId) : { x: 0, y: 0 };
  const shape = fromAbs(nodes);
  const id = newId("path");
  dispatch("create_element", {
    id,
    type: "path",
    parentId,
    x: shape.x - parent.x,
    y: shape.y - parent.y,
    width: shape.width,
    height: shape.height,
    props: { nodes: shape.nodes, closed: closed && nodes.length > 2 },
  });
  select([id]);
  if (backToMove) setTool("move");
}

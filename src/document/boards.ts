import { descendants } from "./geometry";
import type { Board, Comment, CommentMark, Doc } from "./types";

/** Every board in the file, the open one with its things filled in. A file with one canvas has one board. */
export function boardsOf(doc: Doc): Required<Board>[] {
  if (!doc.boards?.length) return [{ id: "board-1", name: "Board 1", rootIds: doc.rootIds }];
  return doc.boards.map((b) => ({ id: b.id, name: b.name, rootIds: b.id === doc.board ? doc.rootIds : (b.rootIds ?? []) }));
}

/** The board that is open. */
export const openBoard = (doc: Doc): string => (doc.boards?.length ? (doc.board ?? doc.boards[0].id) : "board-1");

/** Everything on the open board, tops and what is inside them. Things on other boards are left out. */
export function onOpenBoard(doc: Doc): Set<string> {
  const out = new Set<string>();
  for (const id of doc.rootIds) {
    out.add(id);
    for (const d of descendants(doc, id)) out.add(d);
  }
  return out;
}

/** The board a thing sits on, found from its top. */
export function boardOfElement(doc: Doc, id: string): string | null {
  let el = doc.elements[id];
  while (el?.parentId) el = doc.elements[el.parentId];
  if (!el) return null;
  return boardsOf(doc).find((b) => b.rootIds.includes(el.id))?.id ?? null;
}

/** The comments pinned on the open board. */
export const commentsHere = (doc: Doc): Comment[] => (doc.comments ?? []).filter((c) => pinnedOn(c, openBoard(doc)));

/** Whether a comment was pinned on this board. */
export const pinnedOn = (c: Comment, board: string): boolean => (c.board ?? "board-1") === board;

/** Plain words for what a comment marks on the canvas. */
export function describeMark(mark?: CommentMark | null): string | undefined {
  if (!mark || !Array.isArray(mark.points) || mark.points.length < 2) return undefined;
  if (mark.kind === "box" && mark.points.length >= 4) {
    const x1 = Math.round(Math.min(mark.points[0], mark.points[2]));
    const y1 = Math.round(Math.min(mark.points[1], mark.points[3]));
    const x2 = Math.round(Math.max(mark.points[0], mark.points[2]));
    const y2 = Math.round(Math.max(mark.points[1], mark.points[3]));
    return `marks the box ${x1},${y1} to ${x2},${y2}`;
  }
  if (mark.kind === "arrow" && mark.points.length >= 4) {
    const fromX = Math.round(mark.points[0]);
    const fromY = Math.round(mark.points[1]);
    const toX = Math.round(mark.points[2]);
    const toY = Math.round(mark.points[3]);
    return `arrow from ${fromX},${fromY} to ${toX},${toY}`;
  }
  if (mark.kind === "free" && mark.points.length >= 2) {
    let minX = mark.points[0];
    let maxX = mark.points[0];
    let minY = mark.points[1];
    let maxY = mark.points[1];
    for (let i = 0; i < mark.points.length; i += 2) {
      const x = mark.points[i];
      const y = mark.points[i + 1];
      if (Number.isFinite(x)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
      if (Number.isFinite(y)) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return `freehand around ${Math.round(minX)},${Math.round(minY)} to ${Math.round(maxX)},${Math.round(maxY)}`;
  }
  return undefined;
}

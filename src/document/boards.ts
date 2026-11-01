import { descendants } from "./geometry";
import type { Board, Comment, Doc } from "./types";

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

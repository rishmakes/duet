import { boardsOf, openBoard } from "../document/boards";
import { isDerived } from "../document/components";
import { descendants, topLevelOnly, worldBounds, worldPos } from "../document/geometry";
import type { Board, Doc } from "../document/types";
import { newId } from "./index";

export interface AddBoardArgs {
  id?: string;
  name?: string;
}

export interface OpenBoardArgs {
  id: string;
}

export interface RenameBoardArgs {
  id: string;
  name: string;
}

export interface DeleteBoardArgs {
  id: string;
}

export interface MoveBoardArgs {
  id: string;
  toIndex: number;
}

export interface MoveToBoardArgs {
  ids: string[];
  /** The board they go to. */
  board: string;
}

/** The boards as they are kept in the file: the open one keeps its things in the design's rootIds. */
function keep(doc: Doc, boards: Required<Board>[], open: string, rootIds: string[]): Doc {
  if (boards.length <= 1) {
    // one board left is a plain canvas again
    const { boards: _b, board: _o, ...rest } = doc;
    return { ...rest, rootIds: boards[0]?.rootIds ?? rootIds };
  }
  return {
    ...doc,
    boards: boards.map((b) => (b.id === open ? { id: b.id, name: b.name } : { id: b.id, name: b.name, rootIds: b.rootIds })),
    board: open,
    rootIds,
  };
}

/** A new empty board, opened at once. A file with one canvas keeps what it had as Board 1. Never mutates. */
export function addBoard(doc: Doc, args: AddBoardArgs = {}): Doc {
  const boards = boardsOf(doc);
  const id = args.id ?? newId("board");
  if (boards.some((b) => b.id === id)) return doc;
  let n = boards.length + 1;
  while (boards.some((b) => b.name === `Board ${n}`)) n++;
  const name = args.name?.trim() || `Board ${n}`;
  return keep(doc, [...boards, { id, name, rootIds: [] }], id, []);
}

/** Show another board. Never mutates. */
export function openBoardCmd(doc: Doc, args: OpenBoardArgs): Doc {
  const boards = boardsOf(doc);
  const to = boards.find((b) => b.id === args.id);
  if (!to || to.id === openBoard(doc)) return doc;
  return keep(doc, boards, to.id, to.rootIds);
}

export function renameBoard(doc: Doc, args: RenameBoardArgs): Doc {
  const name = args.name.trim();
  if (!name || !doc.boards?.some((b) => b.id === args.id && b.name !== name)) return doc;
  return { ...doc, boards: doc.boards.map((b) => (b.id === args.id ? { ...b, name } : b)) };
}

/** Take a board away with everything on it. The last board cannot go. The one next to it opens if it was open. */
export function deleteBoard(doc: Doc, args: DeleteBoardArgs): Doc {
  const boards = boardsOf(doc);
  const at = boards.findIndex((b) => b.id === args.id);
  if (at < 0 || boards.length <= 1) return doc;
  const gone = boards[at];
  const elements = { ...doc.elements };
  for (const id of gone.rootIds) {
    for (const d of descendants(doc, id)) delete elements[d];
    delete elements[id];
  }
  const left = boards.filter((b) => b.id !== gone.id);
  const open = openBoard(doc) === gone.id ? left[Math.min(at, left.length - 1)] : left.find((b) => b.id === openBoard(doc))!;
  return keep({ ...doc, elements }, left, open.id, open.rootIds);
}

export function moveBoard(doc: Doc, args: MoveBoardArgs): Doc {
  const boards = boardsOf(doc);
  const from = boards.findIndex((b) => b.id === args.id);
  const to = Math.max(0, Math.min(boards.length - 1, args.toIndex));
  if (from < 0 || from === to) return doc;
  const order = [...boards];
  const [b] = order.splice(from, 1);
  order.splice(to, 0, b);
  return keep(doc, order, openBoard(doc), doc.rootIds);
}

/** Space left between what is already on a board and what arrives. */
const ARRIVE_GAP = 200;

/**
 * Move things from the open board to another one, with everything inside them. They land to the right
 * of what is already there, keeping where they sit among themselves. Never mutates.
 */
export function moveToBoard(doc: Doc, args: MoveToBoardArgs): Doc {
  const boards = boardsOf(doc);
  const target = boards.find((b) => b.id === args.board);
  if (!target || target.id === openBoard(doc)) return doc;
  const ids = topLevelOnly(doc, args.ids.filter((id) => doc.elements[id] && !isDerived(id)));
  if (!ids.length) return doc;
  const elements = { ...doc.elements };
  let rootIds = [...doc.rootIds];
  const moved = ids.map((id) => ({ id, at: worldPos(doc, id) }));
  // what is on the board already, so the new things land beside it
  const there = target.rootIds.map((id) => worldBounds(doc, id));
  const mine = ids.map((id) => worldBounds(doc, id));
  const left = Math.min(...mine.map((r) => r.x));
  const top = Math.min(...mine.map((r) => r.y));
  const dx = there.length ? Math.max(...there.map((r) => r.x + r.width)) + ARRIVE_GAP - left : 0;
  const dy = there.length ? Math.min(...there.map((r) => r.y)) - top : 0;
  for (const { id, at } of moved) {
    const el = doc.elements[id];
    if (el.parentId && elements[el.parentId]) {
      const p = elements[el.parentId];
      elements[el.parentId] = { ...p, childIds: p.childIds.filter((c) => c !== id) };
    } else rootIds = rootIds.filter((c) => c !== id);
    elements[id] = { ...el, parentId: null, x: at.x + dx, y: at.y + dy };
  }
  const next = boards.map((b) => (b.id === target.id ? { ...b, rootIds: [...b.rootIds, ...ids] } : b));
  return keep({ ...doc, elements }, next, openBoard(doc), rootIds);
}

import { describe, expect, it } from "vitest";
import { runCommand } from "./index";
import { boardsOf, commentsHere, onOpenBoard, openBoard } from "../document/boards";
import { parseDoc, serializeDoc } from "../document/serialize";
import { emptyDoc } from "../document/types";
import type { Doc } from "../document/types";

/** A plain file with a frame holding a rectangle, and a loose ellipse. */
function plain(): Doc {
  let d = runCommand(emptyDoc(), "create_element", { id: "f", type: "frame", x: 0, y: 0, width: 400, height: 300 });
  d = runCommand(d, "create_element", { id: "r", type: "rect", x: 10, y: 10, width: 50, height: 50, parentId: "f" });
  return runCommand(d, "create_element", { id: "e", type: "ellipse", x: 600, y: 0, width: 80, height: 80 });
}

describe("boards", () => {
  it("a plain file is one board", () => {
    const d = plain();
    expect(boardsOf(d)).toEqual([{ id: "board-1", name: "Board 1", rootIds: ["f", "e"] }]);
    expect(openBoard(d)).toBe("board-1");
  });

  it("a new board keeps what was there as Board 1 and opens empty", () => {
    const d = plain();
    const next = runCommand(d, "add_board", { id: "b2", name: "Old website" });
    expect(next.rootIds).toEqual([]);
    expect(next.board).toBe("b2");
    expect(boardsOf(next).map((b) => [b.id, b.name, b.rootIds])).toEqual([
      ["board-1", "Board 1", ["f", "e"]],
      ["b2", "Old website", []],
    ]);
    expect(next.elements.f).toBeDefined();
    expect(d.boards).toBeUndefined(); // no mutation
    expect(d.rootIds).toEqual(["f", "e"]);
  });

  it("opening a board shows only its things", () => {
    let d = runCommand(plain(), "add_board", { id: "b2" });
    d = runCommand(d, "create_element", { id: "t", type: "text", x: 0, y: 0, width: 40, height: 20 });
    const back = runCommand(d, "open_board", { id: "board-1" });
    expect(back.rootIds).toEqual(["f", "e"]);
    expect([...onOpenBoard(back)].sort()).toEqual(["e", "f", "r"]);
    expect(boardsOf(back).find((b) => b.id === "b2")?.rootIds).toEqual(["t"]);
    expect(runCommand(back, "open_board", { id: "board-1" })).toBe(back);
    expect(runCommand(back, "open_board", { id: "nope" })).toBe(back);
  });

  it("gives the next free name", () => {
    let d = runCommand(plain(), "add_board", {});
    d = runCommand(d, "add_board", {});
    expect(boardsOf(d).map((b) => b.name)).toEqual(["Board 1", "Board 2", "Board 3"]);
  });

  it("renames and reorders", () => {
    let d = runCommand(plain(), "add_board", { id: "b2" });
    d = runCommand(d, "rename_board", { id: "board-1", name: "  New design " });
    d = runCommand(d, "move_board", { id: "b2", toIndex: 0 });
    expect(boardsOf(d).map((b) => b.name)).toEqual(["Board 2", "New design"]);
    expect(d.board).toBe("b2");
    expect(runCommand(d, "rename_board", { id: "b2", name: " " })).toBe(d);
  });

  it("deleting a board takes everything on it and opens the one beside it", () => {
    let d = runCommand(plain(), "add_board", { id: "b2" });
    d = runCommand(d, "create_element", { id: "t", type: "text", x: 0, y: 0, width: 40, height: 20 });
    const next = runCommand(d, "delete_board", { id: "board-1" });
    expect(next.elements.f).toBeUndefined();
    expect(next.elements.r).toBeUndefined();
    expect(next.elements.t).toBeDefined();
    // one board left is a plain canvas again
    expect(next.boards).toBeUndefined();
    expect(next.rootIds).toEqual(["t"]);
    expect(runCommand(next, "delete_board", { id: "board-1" })).toBe(next);
  });

  it("moves things to another board, out of their frame, beside what is there", () => {
    let d = runCommand(plain(), "add_board", { id: "b2" });
    d = runCommand(d, "create_element", { id: "t", type: "text", x: 0, y: 0, width: 40, height: 20 });
    d = runCommand(d, "open_board", { id: "board-1" });
    const next = runCommand(d, "move_to_board", { ids: ["r", "e"], board: "b2" });
    expect(next.rootIds).toEqual(["f"]);
    expect(next.elements.f.childIds).toEqual([]);
    expect(next.elements.r.parentId).toBeNull();
    // they keep their places among themselves and land 200 to the right of the text
    expect(next.elements.r.x).toBe(240);
    expect(next.elements.e.x).toBe(240 + 590);
    expect(boardsOf(next).find((b) => b.id === "b2")?.rootIds).toEqual(["t", "r", "e"]);
    expect(runCommand(d, "move_to_board", { ids: ["r"], board: "board-1" })).toBe(d);
  });

  it("comments stay on the board they were pinned on", () => {
    let d = runCommand(plain(), "add_comment", { x: 1, y: 1, text: "old" });
    d = runCommand(d, "add_board", { id: "b2" });
    d = runCommand(d, "add_comment", { x: 1, y: 1, text: "new" });
    expect(commentsHere(d).map((c) => c.text)).toEqual(["new"]);
    expect(commentsHere(runCommand(d, "open_board", { id: "board-1" })).map((c) => c.text)).toEqual(["old"]);
  });

  it("saves and opens boards", () => {
    let d = runCommand(plain(), "add_board", { id: "b2", name: "Ideas" });
    d = runCommand(d, "create_element", { id: "t", type: "text", x: 0, y: 0, width: 40, height: 20 });
    const text = serializeDoc(d);
    const raw = JSON.parse(text);
    expect(raw.boards).toEqual([{ id: "board-1", name: "Board 1", rootIds: ["f", "e"] }, { id: "b2", name: "Ideas" }]);
    expect(raw.board).toBe("b2");
    const back = parseDoc(text);
    expect(back.rootIds).toEqual(["t"]);
    expect(boardsOf(back)).toEqual(boardsOf(d));
    expect(serializeDoc(back)).toBe(text);
  });

  it("a plain file saves as it did before", () => {
    expect(JSON.parse(serializeDoc(plain())).boards).toBeUndefined();
  });

  it("opening a file drops a board's tops that are missing or on another board", () => {
    const d = runCommand(plain(), "add_board", { id: "b2" });
    const raw = JSON.parse(serializeDoc(d));
    raw.boards[0].rootIds = ["f", "gone"];
    raw.boards.push({ id: "b3", name: "Twice", rootIds: ["f"] });
    const back = parseDoc(JSON.stringify(raw));
    expect(boardsOf(back).map((b) => b.rootIds)).toEqual([["f"], [], []]);
  });
});

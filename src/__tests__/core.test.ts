import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../commands";
import { descendants, frameAt, hitTest, snapRect, topLevelOnly, worldPos, worldRect } from "../document/geometry";
import { emptyDoc } from "../document/types";
import { picturesIn } from "../project/assets";
import { copyNameFor, stepMessage, stepsToKeep } from "../project/project";
import { findStep, newStepId, stepsLine, wordsBehind } from "../memory/steps";
import { leftOut } from "../ui/SendCopy";
import { richParts } from "../ui/rich";
import { defaultLayout, relayout } from "../document/layout";
import { distanceToLine, flatten, fromAbs, isSmooth, nearestOnLine, pathData, removeNode, removeNodes, splitSegment, toggleSmooth } from "../document/path";
import { resizeRect } from "../canvas/handles";
import { outline } from "../ai/outline";
import { wrapLines } from "../canvas/text";
import {
  currentDoc,
  dispatch,
  dragBase,
  dragCommit,
  dragPreview,
  getState,
  goTo,
  nudge,
  redo,
  resetStore,
  undo,
} from "../state/store";

const frame = (id = "f1") =>
  runCommand(emptyDoc(), "create_element", { id, type: "frame", x: 100, y: 50, width: 300, height: 400 });

describe("commands", () => {
  it("creates a root element", () => {
    const doc = frame();
    expect(doc.rootIds).toEqual(["f1"]);
    expect(doc.elements.f1.name).toBe("Frame 1");
  });

  it("does not mutate the old document", () => {
    const a = frame();
    const b = runCommand(a, "move_elements", { ids: ["f1"], dx: 10, dy: 0 });
    expect(a.elements.f1.x).toBe(100);
    expect(b.elements.f1.x).toBe(110);
  });

  it("nests children with positions relative to the frame", () => {
    let doc = frame();
    doc = runCommand(doc, "create_element", { id: "r1", type: "rect", x: 20, y: 30, width: 50, height: 50, parentId: "f1" });
    expect(doc.elements.f1.childIds).toEqual(["r1"]);
    expect(worldPos(doc, "r1")).toEqual({ x: 120, y: 80 });
    doc = runCommand(doc, "move_elements", { ids: ["f1"], dx: 10, dy: 10 });
    expect(worldPos(doc, "r1")).toEqual({ x: 130, y: 90 });
  });

  it("deletes a frame together with its children", () => {
    let doc = frame();
    doc = runCommand(doc, "create_element", { id: "r1", type: "rect", x: 0, y: 0, width: 10, height: 10, parentId: "f1" });
    doc = runCommand(doc, "delete_elements", { ids: ["f1"] });
    expect(doc.rootIds).toEqual([]);
    expect(Object.keys(doc.elements)).toEqual([]);
  });

  it("removes a child from its parent when deleted", () => {
    let doc = frame();
    doc = runCommand(doc, "create_element", { id: "r1", type: "rect", x: 0, y: 0, width: 10, height: 10, parentId: "f1" });
    doc = runCommand(doc, "delete_elements", { ids: ["r1"] });
    expect(doc.elements.f1.childIds).toEqual([]);
  });

  it("resizes with a minimum of 1", () => {
    const doc = runCommand(frame(), "resize_element", { id: "f1", x: 0, y: 0, width: -5, height: 0 });
    expect(doc.elements.f1.width).toBe(1);
    expect(doc.elements.f1.height).toBe(1);
  });

  it("sets properties on several elements", () => {
    let doc = frame("a");
    doc = runCommand(doc, "create_element", { id: "b", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    doc = runCommand(doc, "set_props", { ids: ["a", "b"], props: { fill: "#ff0000" } });
    expect(doc.elements.a.fill).toBe("#ff0000");
    expect(doc.elements.b.fill).toBe("#ff0000");
  });

  it("serialises to plain JSON and back", () => {
    const doc = frame();
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});

describe("geometry", () => {
  const doc = (() => {
    let d = frame();
    d = runCommand(d, "create_element", { id: "r1", type: "rect", x: 10, y: 10, width: 100, height: 100, parentId: "f1" });
    d = runCommand(d, "create_element", { id: "e1", type: "ellipse", x: 500, y: 500, width: 100, height: 100 });
    return d;
  })();

  it("hits the deepest element", () => {
    expect(hitTest(doc, 150, 100)).toBe("r1");
    expect(hitTest(doc, 350, 400)).toBe("f1");
    expect(hitTest(doc, 0, 0)).toBeNull();
  });

  it("respects the round shape of an ellipse", () => {
    expect(hitTest(doc, 550, 550)).toBe("e1");
    expect(hitTest(doc, 502, 502)).toBeNull();
  });

  it("finds the frame under a point", () => {
    expect(frameAt(doc, 150, 100)).toBe("f1");
    expect(frameAt(doc, 550, 550)).toBeNull();
  });

  it("lists descendants", () => {
    expect(descendants(doc, "f1")).toEqual(["r1"]);
  });

  it("drops children whose parent is also selected", () => {
    expect(topLevelOnly(doc, ["f1", "r1", "e1"])).toEqual(["f1", "e1"]);
  });

  it("computes world rectangles", () => {
    expect(worldRect(doc, "r1")).toEqual({ x: 110, y: 60, width: 100, height: 100 });
  });

  it("snaps edges that are close and ignores far ones", () => {
    const near = snapRect({ x: 103, y: 0, width: 50, height: 50 }, [{ x: 100, y: 500, width: 10, height: 10 }], 6);
    expect(near.dx).toBe(2); // nearest edge is the other box's centre at 105
    expect(near.guidesX).toEqual([105]);
    const far = snapRect({ x: 130, y: 0, width: 50, height: 50 }, [{ x: 100, y: 500, width: 10, height: 10 }], 6);
    expect(far.dx).toBe(0);
    expect(far.guidesX).toEqual([]);
  });

  it("snaps centres", () => {
    const r = snapRect({ x: 41, y: 0, width: 20, height: 20 }, [{ x: 0, y: 500, width: 100, height: 10 }], 6);
    expect(r.dx).toBe(-1);
    expect(r.guidesX).toEqual([50]);
  });
});

describe("resize handles", () => {
  const r = { x: 100, y: 100, width: 100, height: 50 };
  it("drags the south-east corner", () => {
    expect(resizeRect(r, "se", 20, 10)).toEqual({ x: 100, y: 100, width: 120, height: 60 });
  });
  it("drags the north-west corner", () => {
    expect(resizeRect(r, "nw", 10, 10)).toEqual({ x: 110, y: 110, width: 90, height: 40 });
  });
  it("flips past the opposite edge", () => {
    expect(resizeRect(r, "e", -150, 0)).toEqual({ x: 50, y: 100, width: 50, height: 50 });
  });
  it("keeps the proportions with Shift, following the bigger change", () => {
    // 100 by 50, pulled 40 wide and 0 tall: the height follows, so it stays 2 to 1
    expect(resizeRect(r, "se", 40, 0, { keepRatio: true })).toEqual({ x: 100, y: 100, width: 140, height: 70 });
    // pulled mostly tall: the width follows
    expect(resizeRect(r, "se", 0, 50, { keepRatio: true })).toEqual({ x: 100, y: 100, width: 200, height: 100 });
  });
  it("keeps the proportions from an edge handle too, around the middle of the other side", () => {
    expect(resizeRect(r, "e", 100, 0, { keepRatio: true })).toEqual({ x: 100, y: 75, width: 200, height: 100 });
    expect(resizeRect(r, "s", 0, 50, { keepRatio: true })).toEqual({ x: 75 - 25 + 0, y: 100, width: 200, height: 100 });
  });
  it("grows from the centre with Option", () => {
    expect(resizeRect(r, "e", 20, 0, { fromCenter: true })).toEqual({ x: 80, y: 100, width: 140, height: 50 });
    expect(resizeRect(r, "nw", -10, -10, { fromCenter: true })).toEqual({ x: 90, y: 90, width: 120, height: 70 });
  });
  it("does both with Shift and Option: even scaling around the centre", () => {
    expect(resizeRect(r, "se", 50, 0, { keepRatio: true, fromCenter: true })).toEqual({ x: 50, y: 75, width: 200, height: 100 });
  });
  it("still flips and stays proportional when pulled past the other side", () => {
    const f = resizeRect(r, "se", -200, -100, { keepRatio: true });
    expect(f.width / f.height).toBeCloseTo(2);
    expect(f.x).toBeLessThan(100);
  });
});

describe("store and history", () => {
  beforeEach(() => resetStore());

  it("records each command as one history step", () => {
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    dispatch("move_elements", { ids: ["a"], dx: 5, dy: 5 });
    expect(getState().timeline.map((t) => t.label)).toEqual(["New file", "Add rectangle", "Move element"]);
  });

  it("counts quick arrow presses as one step, and a press after a pause as a new one", () => {
    const clock = vi.spyOn(Date, "now");
    clock.mockReturnValue(1000);
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    dispatch("create_element", { id: "b", type: "rect", x: 50, y: 0, width: 10, height: 10 });
    for (let i = 1; i <= 5; i++) {
      clock.mockReturnValue(1000 + i * 100);
      nudge(["a"], 1, 0);
    }
    expect(getState().timeline.map((t) => t.label)).toEqual(["New file", "Add rectangle", "Add rectangle", "Move element"]);
    expect(currentDoc().elements.a.x).toBe(5);
    undo();
    expect(currentDoc().elements.a.x).toBe(0);
    redo();
    clock.mockReturnValue(3000);
    nudge(["a"], 0, 10);
    expect(getState().timeline).toHaveLength(5);
    clock.mockReturnValue(3100);
    nudge(["b"], 1, 0);
    expect(getState().timeline).toHaveLength(6);
    clock.mockReturnValue(3200);
    dispatch("set_props", { ids: ["b"], props: { name: "Box" } });
    clock.mockReturnValue(3300);
    nudge(["b"], 1, 0);
    expect(getState().timeline).toHaveLength(8);
    expect(currentDoc().elements).toMatchObject({ a: { x: 5, y: 10 }, b: { x: 52 } });
    clock.mockRestore();
  });

  it("undoes, redoes and jumps", () => {
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    dispatch("move_elements", { ids: ["a"], dx: 5, dy: 5 });
    undo();
    expect(currentDoc().elements.a.x).toBe(0);
    redo();
    expect(currentDoc().elements.a.x).toBe(5);
    goTo(0);
    expect(currentDoc().rootIds).toEqual([]);
  });

  it("keeps the later steps as another direction when you change something after undo", () => {
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    dispatch("move_elements", { ids: ["a"], dx: 5, dy: 5 });
    undo();
    dispatch("move_elements", { ids: ["a"], dx: 1, dy: 1 });
    expect(getState().timeline.length).toBe(4);
    expect(getState().timeline[3].from).toBe(getState().timeline[1].step);
    expect(currentDoc().elements.a.x).toBe(1);
    // undo follows this direction, back to where it started, and redo comes back to it
    undo();
    expect(getState().cursor).toBe(1);
    redo();
    expect(getState().cursor).toBe(3);
    // the old direction is still there
    goTo(2);
    expect(currentDoc().elements.a.x).toBe(5);
    undo();
    expect(getState().cursor).toBe(1);
  });

  it("a whole drag is a single history step", () => {
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    const before = getState().timeline.length;
    for (let i = 1; i <= 30; i++) dragPreview("move_elements", { ids: ["a"], dx: i, dy: 0 });
    expect(getState().timeline.length).toBe(before);
    expect(currentDoc().elements.a.x).toBe(30);
    expect(dragBase().elements.a.x).toBe(0);
    dragCommit("Move element");
    expect(getState().timeline.length).toBe(before + 1);
    expect(currentDoc().elements.a.x).toBe(30);
  });

  it("tags who made each change", () => {
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 }, "ai");
    expect(getState().timeline[1].actor).toBe("ai");
  });

  it("clears a selection that no longer exists after undo", () => {
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    undo();
    expect(getState().selection).toEqual([]);
  });
});

import { DesignFileError, parseDoc, serializeDoc } from "../document/serialize";
import { whiteBalance } from "../canvas/grade";
import gradeFixtures from "../document/grade-fixtures.json";

describe("design file", () => {
  const sample = () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "z-frame", type: "frame", x: 0, y: 0, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "a-rect", type: "rect", x: 5, y: 5, width: 50, height: 50, parentId: "z-frame" });
    return d;
  };

  it("round-trips exactly", () => {
    const doc = sample();
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it("writes elements sorted by id, so diffs stay small", () => {
    const keys = Object.keys(JSON.parse(serializeDoc(sample())).elements);
    expect(keys).toEqual(["a-rect", "z-frame"]);
  });

  it("gives the same text for the same design", () => {
    expect(serializeDoc(sample())).toBe(serializeDoc(sample()));
  });

  it("fills in missing properties from older files", () => {
    const text = JSON.stringify({ version: 1, rootIds: ["a"], elements: { a: { type: "rect", x: 1, y: 2 } } });
    const doc = parseDoc(text);
    expect(doc.elements.a.width).toBe(100);
    expect(doc.elements.a.childIds).toEqual([]);
  });

  it("rejects things that are not design files", () => {
    expect(() => parseDoc("hello")).toThrow(DesignFileError);
    expect(() => parseDoc("{}")).toThrow(DesignFileError);
    expect(() => parseDoc(JSON.stringify({ version: 1, rootIds: ["x"], elements: {} }))).toThrow(DesignFileError);
    expect(() => parseDoc(JSON.stringify({ version: 1, rootIds: [], elements: { a: { type: "star" } } }))).toThrow(DesignFileError);
  });
});

describe("arrange_elements", () => {
  const base = () => {
    let d = frame();
    for (const id of ["a", "b", "c", "d"]) d = runCommand(d, "create_element", { id, type: "rect", x: 0, y: 0, width: 10, height: 10, parentId: "f1" });
    return d;
  };
  const order = (to: "up" | "down" | "top" | "bottom", ids: string[]) => runCommand(base(), "arrange_elements", { ids, to }).elements.f1.childIds;

  it("moves one step forward or back", () => {
    expect(order("up", ["b"])).toEqual(["a", "c", "b", "d"]);
    expect(order("down", ["c"])).toEqual(["a", "c", "b", "d"]);
  });

  it("moves all the way to the front or back, keeping their own order", () => {
    expect(order("top", ["a", "c"])).toEqual(["b", "d", "a", "c"]);
    expect(order("bottom", ["b", "d"])).toEqual(["b", "d", "a", "c"]);
  });

  it("moves several side by side together", () => {
    expect(order("up", ["a", "b"])).toEqual(["c", "a", "b", "d"]);
  });

  it("changes nothing when already at the front", () => {
    const d = base();
    expect(runCommand(d, "arrange_elements", { ids: ["d"], to: "up" })).toBe(d);
  });
});

describe("reparent_elements", () => {
  const base = () => {
    let d = emptyDoc();
    d = runCommand(d, "create_element", { id: "f1", type: "frame", x: 100, y: 100, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "f2", type: "frame", x: 600, y: 0, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "r1", type: "rect", x: 20, y: 20, width: 50, height: 50, parentId: "f1" });
    d = runCommand(d, "create_element", { id: "free", type: "rect", x: 650, y: 40, width: 50, height: 50 });
    return d;
  };

  it("moves a shape into a frame and keeps it where it looks", () => {
    const doc = runCommand(base(), "reparent_elements", { ids: ["free"], parentId: "f2" });
    expect(doc.elements.free.parentId).toBe("f2");
    expect(doc.elements.f2.childIds).toEqual(["free"]);
    expect(doc.rootIds).toEqual(["f1", "f2"]);
    expect(worldPos(doc, "free")).toEqual({ x: 650, y: 40 });
  });

  it("moves a shape out of a frame to the page", () => {
    const doc = runCommand(base(), "reparent_elements", { ids: ["r1"], parentId: null });
    expect(doc.elements.r1.parentId).toBeNull();
    expect(doc.elements.f1.childIds).toEqual([]);
    expect(doc.rootIds).toContain("r1");
    expect(worldPos(doc, "r1")).toEqual({ x: 120, y: 120 });
  });

  it("moves between frames", () => {
    const doc = runCommand(base(), "reparent_elements", { ids: ["r1"], parentId: "f2" });
    expect(doc.elements.f1.childIds).toEqual([]);
    expect(doc.elements.f2.childIds).toEqual(["r1"]);
    expect(worldPos(doc, "r1")).toEqual({ x: 120, y: 120 });
  });

  it("refuses to create something inside a shape that is not a frame", () => {
    const d = runCommand(emptyDoc(), "create_element", { id: "r", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    expect(runCommand(d, "create_element", { id: "x", type: "rect", x: 0, y: 0, width: 5, height: 5, parentId: "r" })).toBe(d);
  });

  it("refuses to put a frame inside itself or its own child", () => {
    const d = base();
    expect(runCommand(d, "reparent_elements", { ids: ["f1"], parentId: "f1" })).toBe(d);
    const nested = runCommand(d, "reparent_elements", { ids: ["f2"], parentId: "f1" });
    expect(runCommand(nested, "reparent_elements", { ids: ["f1"], parentId: "f2" })).toBe(nested);
  });

  it("refuses a parent that is not a frame", () => {
    const d = base();
    expect(runCommand(d, "reparent_elements", { ids: ["free"], parentId: "r1" })).toBe(d);
  });

  it("reorders inside the same list", () => {
    let d = base();
    d = runCommand(d, "create_element", { id: "r2", type: "rect", x: 0, y: 0, width: 10, height: 10, parentId: "f1" });
    d = runCommand(d, "create_element", { id: "r3", type: "rect", x: 0, y: 0, width: 10, height: 10, parentId: "f1" });
    expect(d.elements.f1.childIds).toEqual(["r1", "r2", "r3"]);
    const front = runCommand(d, "reparent_elements", { ids: ["r1"], parentId: "f1" });
    expect(front.elements.f1.childIds).toEqual(["r2", "r3", "r1"]);
    const back = runCommand(d, "reparent_elements", { ids: ["r3"], parentId: "f1", index: 0 });
    expect(back.elements.f1.childIds).toEqual(["r3", "r1", "r2"]);
  });

  it("moves several at once, keeping their order", () => {
    let d = base();
    d = runCommand(d, "create_element", { id: "r2", type: "rect", x: 0, y: 0, width: 10, height: 10, parentId: "f1" });
    const doc = runCommand(d, "reparent_elements", { ids: ["r1", "r2"], parentId: "f2" });
    expect(doc.elements.f2.childIds).toEqual(["r1", "r2"]);
    expect(doc.elements.f1.childIds).toEqual([]);
  });
});

import { describeSkill, toDuetSkill } from "../ai/skills";

describe("skill files", () => {
  it("reads the heading and summary of a Duet skill", () => {
    const d = describeSkill("# Spacing\nA steady rhythm.\n\n- Use 8 px.", "x");
    expect(d.name).toBe("Spacing");
    expect(d.summary).toBe("A steady rhythm.");
  });

  it("converts a skill with front matter into Duet's shape", () => {
    const text = "---\nname: diagnostic-sales-architect\ndescription: Find one leak. Then ask one question.\n---\n\n# Ignored title\n\nRule one.\nRule two.\n";
    const s = toDuetSkill(text, "fallback");
    expect(s.name).toBe("diagnostic-sales-architect");
    expect(s.body.startsWith("# diagnostic-sales-architect\nFind one leak.")).toBe(true);
    expect(s.body).toContain("Rule one.");
    expect(s.body).not.toContain("Ignored title");
  });

  it("falls back to the file name when there is no title", () => {
    expect(toDuetSkill("Just some rules.", "my-rules").name).toBe("my-rules");
  });
});

import { extractPayload, payloadToText, textToPayload } from "../document/clipboard";

describe("copy and paste", () => {
  const base = () => {
    let d = emptyDoc();
    d = runCommand(d, "create_element", { id: "f1", type: "frame", x: 100, y: 100, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "f2", type: "frame", x: 600, y: 100, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "b", type: "rect", x: 20, y: 20, width: 50, height: 50, parentId: "f1", props: { link: "f2", name: "Button" } });
    d = runCommand(d, "create_element", { id: "t", type: "text", x: 5, y: 5, width: 40, height: 20, parentId: "f1" });
    return d;
  };

  it("picks up an element with everything inside it", () => {
    const d = runCommand(emptyDoc(), "create_element", { id: "f", type: "frame", x: 0, y: 0, width: 200, height: 200 });
    const d2 = runCommand(d, "create_element", { id: "r", type: "rect", x: 1, y: 1, width: 10, height: 10, parentId: "f" });
    const p = extractPayload(d2, ["f", "r"])!;
    expect(p.rootIds).toEqual(["f"]);
    expect(Object.keys(p.elements).sort()).toEqual(["f", "r"]);
  });

  it("pastes new copies with new ids and keeps the structure", () => {
    const d = base();
    const p = extractPayload(d, ["f1"])!;
    const out = runCommand(d, "paste_elements", { payload: p, parentId: null, dx: 500, dy: 0, idMap: { f1: "new-f1", b: "new-b", t: "new-t" } });
    expect(out.rootIds).toEqual(["f1", "f2", "new-f1"]);
    expect(out.elements["new-f1"].childIds).toEqual(["new-b", "new-t"]);
    expect(out.elements["new-b"].parentId).toBe("new-f1");
    expect(out.elements["new-f1"].x).toBe(600);
    expect(Object.keys(out.elements).length).toBe(Object.keys(d.elements).length + 3);
  });

  it("puts a duplicate right above its original, not on top of everything", () => {
    const d = base();
    const p = extractPayload(d, ["f1"])!;
    const out = runCommand(d, "paste_elements", { payload: p, parentId: null, dx: 16, dy: 16, idMap: { f1: "new-f1", b: "new-b", t: "new-t" }, above: true });
    expect(out.rootIds).toEqual(["f1", "new-f1", "f2"]);
  });

  it("does not change the original", () => {
    const d = base();
    const p = extractPayload(d, ["b"])!;
    const out = runCommand(d, "paste_elements", { payload: p, parentId: "f2", dx: 0, dy: 0 });
    expect(out.elements.f1.childIds).toEqual(["b", "t"]);
    expect(out.elements.f2.childIds.length).toBe(1);
  });

  it("keeps a pasted piece where it looked, even inside another frame", () => {
    const d = base();
    const p = extractPayload(d, ["b"])!; // sits at world 120,120
    const out = runCommand(d, "paste_elements", { payload: p, parentId: "f2", dx: 0, dy: 0, idMap: { b: "nb" } });
    expect(worldPos(out, "nb")).toEqual({ x: 120, y: 120 });
  });

  it("points a link at the copy when both were copied together", () => {
    const d = base();
    const p = extractPayload(d, ["f1", "f2"])!;
    const out = runCommand(d, "paste_elements", { payload: p, parentId: null, dx: 0, dy: 700, idMap: { f1: "n1", f2: "n2", b: "nb" } });
    expect(out.elements.nb.link).toBe("n2");
  });

  it("keeps a link to a screen that was not copied", () => {
    const d = base();
    const p = extractPayload(d, ["b"])!;
    const out = runCommand(d, "paste_elements", { payload: p, parentId: "f1", dx: 16, dy: 16, idMap: { b: "nb" } });
    expect(out.elements.nb.link).toBe("f2");
  });

  it("refuses to paste into something that is not a frame", () => {
    const d = base();
    const p = extractPayload(d, ["b"])!;
    expect(runCommand(d, "paste_elements", { payload: p, parentId: "b" })).toBe(d);
  });

  it("travels as text and rejects anything else", () => {
    const d = base();
    const p = extractPayload(d, ["b"])!;
    expect(textToPayload(payloadToText(p))).toEqual(p);
    expect(textToPayload("hello")).toBeNull();
    expect(textToPayload('{"duet":2}')).toBeNull();
  });
});

import { toSvg } from "../document/svg";

describe("SVG export", () => {
  const sample = () => {
    let d = emptyDoc();
    d = runCommand(d, "create_element", { id: "f", type: "frame", x: 50, y: 50, width: 200, height: 100, props: { fill: "#ffffff", radius: 12 } });
    d = runCommand(d, "create_element", { id: "b", type: "rect", x: 10, y: 10, width: 80, height: 30, parentId: "f", props: { fill: "#e8743b", radius: 8, shadow: { x: 0, y: 4, blur: 12, color: "#00000040" } } });
    d = runCommand(d, "create_element", { id: "g", type: "ellipse", x: 120, y: 10, width: 40, height: 40, parentId: "f", props: { gradient: { from: "#ff0000", to: "#0000ff", angle: 90 } } });
    d = runCommand(d, "create_element", { id: "t", type: "text", x: 10, y: 60, width: 100, height: 20, parentId: "f", props: { text: "Tom & <Jerry>", fontSize: 14 } });
    return d;
  };

  it("draws the element at the corner of its own picture", () => {
    const svg = toSvg(sample(), "f");
    expect(svg).toContain('width="200" height="100" viewBox="0 0 200 100"');
    expect(svg).toContain('<rect x="0" y="0" width="200" height="100" rx="12"');
  });

  it("puts children inside, clipped to the frame", () => {
    const svg = toSvg(sample(), "f");
    expect(svg).toContain("<clipPath");
    expect(svg).toContain('<rect x="10" y="10" width="80" height="30" rx="8"');
  });

  it("includes gradients and shadows", () => {
    const svg = toSvg(sample(), "f");
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain("feDropShadow");
    expect(svg).toContain('flood-opacity="0.251"');
  });

  it("escapes text", () => {
    const svg = toSvg(sample(), "f");
    expect(svg).toContain("Tom &amp; &lt;Jerry&gt;");
    expect(svg).not.toContain("<Jerry>");
  });

  it("is well formed", () => {
    const svg = toSvg(sample(), "f");
    expect(svg.startsWith("<svg")).toBe(true);
    expect((svg.match(/<g[ >]/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
  });
});

import { linkAt, linkInfoAt, startFrame } from "../ui/PresentView";

describe("present mode", () => {
  const flow = () => {
    let d = emptyDoc();
    d = runCommand(d, "create_element", { id: "home", type: "frame", x: 0, y: 0, width: 300, height: 600 });
    d = runCommand(d, "create_element", { id: "order", type: "frame", x: 400, y: 0, width: 300, height: 600 });
    d = runCommand(d, "create_element", { id: "btn", type: "rect", x: 20, y: 500, width: 260, height: 50, parentId: "home", props: { link: "order" } });
    d = runCommand(d, "create_element", { id: "label", type: "text", x: 10, y: 10, width: 60, height: 20, parentId: "btn" as never });
    return d;
  };

  it("follows a link when the linked thing is clicked", () => {
    expect(linkAt(flow(), "home", 100, 520)).toBe("order");
  });

  it("ignores clicks on things with no link", () => {
    expect(linkAt(flow(), "home", 100, 100)).toBeNull();
  });

  it("uses the link of something that holds what was clicked", () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "a", type: "frame", x: 0, y: 0, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "b", type: "frame", x: 400, y: 0, width: 300, height: 300 });
    d = runCommand(d, "create_element", { id: "card", type: "frame", x: 10, y: 10, width: 200, height: 100, parentId: "a", props: { link: "b" } });
    d = runCommand(d, "create_element", { id: "inner", type: "text", x: 5, y: 5, width: 50, height: 20, parentId: "card" });
    expect(linkAt(d, "a", 20, 20)).toBe("b");
  });

  it("starts on the selected screen, or the screen holding the selection", () => {
    const d = flow();
    expect(startFrame(d, ["order"])).toBe("order");
    expect(startFrame(d, ["btn"])).toBe("home");
    expect(startFrame(d, [])).toBe("home");
  });

  it("ignores a link to something that is not a screen", () => {
    let d = flow();
    d = runCommand(d, "set_props", { ids: ["btn"], props: { link: "label" } });
    expect(linkAt(d, "home", 100, 520)).toBeNull();
  });
});

describe("images", () => {
  const withImage = () =>
    runCommand(frame(), "create_element", {
      id: "pic",
      type: "image",
      parentId: "f1",
      x: 10,
      y: 10,
      width: 120,
      height: 80,
      props: { src: "assets/abc123.png", name: "Photo" },
    });

  it("keeps the picture's place in the project through save and open", () => {
    const back = parseDoc(serializeDoc(withImage()));
    expect(back.elements.pic.type).toBe("image");
    expect(back.elements.pic.src).toBe("assets/abc123.png");
  });

  it("leaves old designs without a picture field, so their files do not change", () => {
    expect(serializeDoc(frame())).not.toContain('"src"');
  });

  it("opens files that have no src at all", () => {
    const text = serializeDoc(frame());
    expect(parseDoc(text).elements.f1.src).toBe("");
  });

  it("writes a picture into the SVG export, clipped to its box", () => {
    const svg = toSvg(withImage(), "f1");
    expect(svg).toContain("<clipPath");
  });
});

describe("drawn lines", () => {
  const corner = (x: number, y: number) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 });

  it("fits a box around the points and keeps them as fractions of it", () => {
    const shape = fromAbs([corner(100, 50), corner(300, 50), corner(300, 250)]);
    expect([shape.x, shape.y, shape.width, shape.height]).toEqual([100, 50, 200, 200]);
    expect(shape.nodes[1]).toMatchObject({ x: 1, y: 0 });
    expect(shape.nodes[2]).toMatchObject({ x: 1, y: 1 });
  });

  it("includes curve handles in the box", () => {
    const shape = fromAbs([{ x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 100 }, corner(100, 0)]);
    expect(shape.height).toBe(100);
  });

  it("writes straight pieces as L and curved pieces as C", () => {
    expect(pathData([corner(0, 0), corner(10, 0)], false)).toBe("M0 0L10 0");
    const curved = pathData([{ x: 0, y: 0, ix: 0, iy: 0, ox: 5, oy: 5 }, corner(10, 0)], false);
    expect(curved).toContain("C5 5");
  });

  it("closes a shape with Z", () => {
    expect(pathData([corner(0, 0), corner(10, 0), corner(10, 10)], true).endsWith("Z")).toBe(true);
  });

  it("finds a thin line under the pointer and ignores empty space next to it", () => {
    const shape = fromAbs([corner(0, 0), corner(200, 0)]);
    let d = runCommand(frame("f"), "create_element", {
      id: "ln",
      type: "path",
      parentId: "f",
      x: shape.x,
      y: 100,
      width: shape.width,
      height: shape.height,
      props: { nodes: shape.nodes, closed: false },
    });
    // frame f sits at 100,50 so the line is at 100,150 on the page
    expect(hitTest(d, 200, 152)).toBe("ln");
    expect(hitTest(d, 200, 200)).toBe("f");
    d = runCommand(d, "set_props", { ids: ["ln"], props: { closed: true } });
    expect(hitTest(d, 200, 150.5)).toBe("ln");
  });

  it("saves and reopens a drawn line", () => {
    const shape = fromAbs([corner(0, 0), corner(50, 80)]);
    const d = runCommand(emptyDoc(), "create_element", {
      id: "ln",
      type: "path",
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      props: { nodes: shape.nodes, closed: false },
    });
    expect(parseDoc(serializeDoc(d)).elements.ln.nodes).toEqual(shape.nodes);
  });
});

describe("editing the points of a line", () => {
  const corner = (x: number, y: number) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 });

  it("adds a point in the middle of a straight piece", () => {
    const r = splitSegment([corner(0, 0), corner(100, 0)], false, 0, 0.5);
    expect(r.nodes).toHaveLength(3);
    expect(r.nodes[1]).toMatchObject({ x: 50, y: 0 });
    expect(r.index).toBe(1);
  });

  it("splits a curve without changing its shape", () => {
    const a = { x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 60 };
    const b = { x: 100, y: 0, ix: 0, iy: 60, ox: 0, oy: 0 };
    const before = flatten([a, b], false, 40);
    const r = splitSegment([a, b], false, 0, 0.5);
    const after = flatten(r.nodes, false, 20);
    const worst = Math.max(...after.map((p) => distanceToLine(p.x, p.y, before)));
    expect(worst).toBeLessThan(0.6);
  });

  it("adds a point on the closing piece at the end", () => {
    const r = splitSegment([corner(0, 0), corner(100, 0), corner(100, 100)], true, 2, 0.5);
    expect(r.index).toBe(3);
    expect(r.nodes[3]).toMatchObject({ x: 50, y: 50 });
  });

  it("finds the closest piece of the line", () => {
    const hit = nearestOnLine([corner(0, 0), corner(100, 0), corner(100, 100)], false, 100, 60);
    expect(hit.segment).toBe(1);
    expect(hit.distance).toBeLessThan(1);
  });

  it("turns a corner into a smooth join and back", () => {
    const nodes = [corner(0, 0), corner(50, 0), corner(100, 50)];
    const smooth = toggleSmooth(nodes, false, 1);
    expect(isSmooth(smooth[1])).toBe(true);
    const back = toggleSmooth(smooth, false, 1);
    expect(isSmooth(back[1])).toBe(false);
    expect(back[1].ox).toBe(0);
  });

  it("will not remove points below the minimum", () => {
    expect(removeNode([corner(0, 0), corner(1, 1)], false, 0)).toHaveLength(2);
    expect(removeNode([corner(0, 0), corner(1, 1), corner(2, 0)], true, 0)).toHaveLength(3);
    expect(removeNode([corner(0, 0), corner(1, 1), corner(2, 0)], false, 1)).toHaveLength(2);
  });

  it("removes several points at once and respects minimum point counts", () => {
    const line = [corner(0, 0), corner(10, 0), corner(20, 0), corner(30, 0)];
    expect(removeNodes(line, false, [1, 2])).toHaveLength(2);
    expect(removeNodes(line, false, [0, 1, 2])).toHaveLength(4); // would leave 1 point on open line, refused
    const loop = [corner(0, 0), corner(10, 0), corner(20, 0), corner(30, 0), corner(40, 0)];
    expect(removeNodes(loop, true, [1, 2])).toHaveLength(3);
    expect(removeNodes(loop, true, [1, 2, 3])).toHaveLength(5); // would leave 2 points on closed line, refused
  });

  it("selects, toggles, nudges, and deletes multiple points in store", () => {
    resetStore();
    const corner = (x: number, y: number) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 });
    const shape = fromAbs([corner(0, 0), corner(50, 0), corner(100, 0), corner(150, 0)]);
    dispatch("create_element", {
      id: "p1",
      type: "path",
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      props: { nodes: shape.nodes, closed: false },
    });
    enterNodeEdit("p1");
    expect(getState().overlay.nodeEdit?.selected).toEqual([]);

    selectNodes([0, 2]);
    expect(getState().overlay.nodeEdit?.selected).toEqual([0, 2]);

    toggleNode(1);
    expect(getState().overlay.nodeEdit?.selected).toEqual([0, 2, 1]);
    toggleNode(0);
    expect(getState().overlay.nodeEdit?.selected).toEqual([2, 1]);

    // Nudge selected points [2, 1] by 10px horizontally
    nudgeSelectedNodes(10, 0);
    const doc = currentDoc();
    const pts = toAbs(doc.elements.p1, doc.elements.p1.x, doc.elements.p1.y);
    expect(pts[0].x).toBeCloseTo(0, 1);
    expect(pts[1].x).toBeCloseTo(60, 1);
    expect(pts[2].x).toBeCloseTo(110, 1);
    expect(pts[3].x).toBeCloseTo(150, 1);

    // Delete selected points
    deleteSelectedNodes();
    const afterDelete = currentDoc();
    expect(afterDelete.elements.p1.nodes).toHaveLength(2);
    expect(getState().overlay.nodeEdit?.selected).toEqual([]);
    exitNodeEdit();
    expect(getState().overlay.nodeEdit).toBeNull();
  });
});

describe("auto layout", () => {
  const stack = (layout: Partial<NonNullable<import("../document/types").El["layout"]>> = {}) => {
    let d = frame("box"); // 300 by 400 at 100,50
    for (const [id, w, h] of [["a", 100, 40], ["b", 80, 60], ["c", 120, 20]] as const) {
      d = runCommand(d, "create_element", { id, type: "rect", parentId: "box", x: 0, y: 0, width: w, height: h });
    }
    return runCommand(d, "set_props", { ids: ["box"], props: { layout: { ...defaultLayout(), ...layout } } });
  };
  const at = (d: ReturnType<typeof stack>, id: string) => [d.elements[id].x, d.elements[id].y];

  it("stacks children in a column with a gap and padding", () => {
    const d = stack({ dir: "column", gap: 10, padX: 20, padY: 30 });
    expect(at(d, "a")).toEqual([20, 30]);
    expect(at(d, "b")).toEqual([20, 80]);
    expect(at(d, "c")).toEqual([20, 150]);
  });

  it("lines children up in a row", () => {
    const d = stack({ dir: "row", gap: 8, padX: 10, padY: 10 });
    expect(at(d, "a")).toEqual([10, 10]);
    expect(at(d, "b")).toEqual([118, 10]);
    expect(at(d, "c")).toEqual([206, 10]);
  });

  it("centres children across the direction", () => {
    const d = stack({ dir: "column", align: "center", padX: 0, padY: 0, gap: 0 });
    expect(d.elements.a.x).toBe(100); // (300 - 100) / 2
    expect(d.elements.b.x).toBe(110);
  });

  it("spreads children with equal space between", () => {
    const d = stack({ dir: "column", justify: "between", padX: 0, padY: 0, gap: 0 });
    expect(d.elements.a.y).toBe(0);
    expect(d.elements.c.y).toBe(380); // 400 - 20
    expect(d.elements.b.y).toBe(180); // equal gaps of 140: 40 + 140
  });

  it("hugs its content", () => {
    const d = stack({ dir: "column", gap: 10, padX: 20, padY: 30, hug: true });
    expect(d.elements.box.height).toBe(30 + 40 + 10 + 60 + 10 + 20 + 30);
    expect(d.elements.box.width).toBe(20 + 120 + 20);
  });

  it("stretches children across the frame", () => {
    const d = stack({ dir: "column", align: "stretch", padX: 10, padY: 0, gap: 0 });
    expect(d.elements.a.width).toBe(280);
    expect(d.elements.c.width).toBe(280);
  });

  it("lets a child grow to fill the free space", () => {
    let d = stack({ dir: "column", gap: 0, padX: 0, padY: 0 });
    d = runCommand(d, "set_props", { ids: ["b"], props: { grow: 1 } });
    expect(d.elements.b.height).toBe(400 - 40 - 20);
    expect(d.elements.c.y).toBe(380);
  });

  it("reorders when a child is moved past another", () => {
    let d = stack({ dir: "column", gap: 0, padX: 0, padY: 0 });
    d = runCommand(d, "move_elements", { ids: ["a"], dx: 0, dy: 200 });
    expect(d.elements.box.childIds).toEqual(["b", "c", "a"]);
  });

  it("changes nothing when no frame uses it", () => {
    const d = frame("plain");
    expect(relayout(d)).toBe(d);
  });

  it("saves and reopens a layout, and leaves other files unchanged", () => {
    const d = stack({ dir: "row" });
    expect(parseDoc(serializeDoc(d)).elements.box.layout?.dir).toBe("row");
    expect(serializeDoc(frame())).not.toContain('"layout"');
  });
});

describe("wrapping in auto layout", () => {
  it("puts selected siblings in a new frame that hugs them", () => {
    let d = frame("box");
    d = runCommand(d, "create_element", { id: "a", type: "rect", parentId: "box", x: 20, y: 30, width: 50, height: 50 });
    d = runCommand(d, "create_element", { id: "b", type: "rect", parentId: "box", x: 120, y: 40, width: 60, height: 40 });
    d = runCommand(d, "wrap_in_layout", { ids: ["a", "b"], frameId: "wrap" });
    expect(d.elements.a.parentId).toBe("wrap");
    expect(d.elements.box.childIds).toEqual(["wrap"]);
    expect(d.elements.wrap.layout?.hug).toBe(true);
    expect(d.elements.wrap.layout?.dir).toBe("row");
    // 50 + 12 + 60 wide, as tall as the tallest
    expect([d.elements.wrap.width, d.elements.wrap.height]).toEqual([122, 50]);
    expect([d.elements.wrap.x, d.elements.wrap.y]).toEqual([20, 30]);
  });

  it("will not wrap things that live in different frames", () => {
    let d = runCommand(frame("one"), "create_element", { id: "two", type: "frame", x: 500, y: 0, width: 100, height: 100 });
    d = runCommand(d, "create_element", { id: "a", type: "rect", parentId: "one", x: 0, y: 0, width: 10, height: 10 });
    d = runCommand(d, "create_element", { id: "b", type: "rect", parentId: "two", x: 0, y: 0, width: 10, height: 10 });
    const same = runCommand(d, "wrap_in_layout", { ids: ["a", "b"], frameId: "wrap" });
    expect(same.elements.wrap).toBeUndefined();
  });
});

describe("groups and locking", () => {
  const scene = () => {
    let d = frame("box"); // 300 by 400 at 100,50
    d = runCommand(d, "create_element", { id: "a", type: "rect", parentId: "box", x: 20, y: 30, width: 50, height: 50 });
    d = runCommand(d, "create_element", { id: "b", type: "rect", parentId: "box", x: 120, y: 40, width: 60, height: 40 });
    return d;
  };

  it("groups siblings into one thing that is exactly as big as they are", () => {
    const d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    expect(d.elements.box.childIds).toEqual(["g"]);
    expect(d.elements.g.type).toBe("group");
    expect([d.elements.g.x, d.elements.g.y, d.elements.g.width, d.elements.g.height]).toEqual([20, 30, 160, 50]);
    expect([d.elements.a.x, d.elements.a.y]).toEqual([0, 0]);
    expect([d.elements.b.x, d.elements.b.y]).toEqual([100, 10]);
  });

  it("keeps the same picture on the page after grouping and ungrouping", () => {
    let d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    d = runCommand(d, "ungroup", { ids: ["g"] });
    expect(d.elements.g).toBeUndefined();
    expect(d.elements.box.childIds).toEqual(["a", "b"]);
    expect([d.elements.a.x, d.elements.a.y]).toEqual([20, 30]);
    expect([d.elements.b.x, d.elements.b.y]).toEqual([120, 40]);
  });

  it("moves everything inside when the group moves, and refits when a child moves", () => {
    let d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    d = runCommand(d, "move_elements", { ids: ["g"], dx: 10, dy: 0 });
    expect(worldRect(d, "a").x).toBe(100 + 30);
    d = runCommand(d, "move_elements", { ids: ["b"], dx: 50, dy: 0 });
    expect(d.elements.g.width).toBe(210);
  });

  it("scales what is inside when the group is resized", () => {
    let d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    d = runCommand(d, "resize_element", { id: "g", x: 20, y: 30, width: 320, height: 100 });
    expect([d.elements.a.width, d.elements.a.height]).toEqual([100, 100]);
    expect(d.elements.b.x).toBe(200);
    expect(d.elements.g.width).toBe(320);
  });

  it("picks the whole group when you click inside it, and a single child when you dig in", () => {
    const d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    // a sits at 120,80 on the page (box 100,50 + 20,30)
    expect(hitTest(d, 130, 90)).toBe("g");
    expect(hitTest(d, 130, 90, new Set(), true)).toBe("a");
  });

  it("clicks go through a locked frame to what is inside it, and to what is behind it", () => {
    let d = scene();
    d = runCommand(d, "set_props", { ids: ["box"], props: { locked: true } });
    expect(hitTest(d, 130, 90)).toBe("a"); // the picture inside is still pickable
    expect(hitTest(d, 380, 400)).toBeNull(); // empty frame area: nothing to pick
  });

  it("groups things from different frames at the level they share, and they stay where they were", () => {
    let d = runCommand(scene(), "create_element", { id: "two", type: "frame", x: 600, y: 0, width: 100, height: 100 });
    d = runCommand(d, "create_element", { id: "c", type: "rect", parentId: "two", x: 5, y: 5, width: 10, height: 10 });
    const before = { a: worldRect(d, "a"), c: worldRect(d, "c") };
    const g = runCommand(d, "group_elements", { ids: ["a", "c"], groupId: "g" });
    expect(g.elements.g.parentId).toBeNull();
    expect(g.elements.g.childIds).toEqual(["a", "c"]);
    expect(worldRect(g, "a")).toEqual(before.a);
    expect(worldRect(g, "c")).toEqual(before.c);
    expect(g.elements.box.childIds).not.toContain("a");
    // the group sits just above the frame that held the highest one
    expect(g.rootIds.indexOf("g")).toBe(g.rootIds.indexOf("two") + 1);
    const back = runCommand(g, "ungroup", { ids: ["g"] });
    expect(worldRect(back, "a")).toEqual(before.a);
    expect(worldRect(back, "c")).toEqual(before.c);
  });

  it("groups a thing inside a frame with one outside it, on the page", () => {
    let d = runCommand(scene(), "create_element", { id: "out", type: "rect", x: 900, y: 900, width: 10, height: 10 });
    const before = worldRect(d, "a");
    d = runCommand(d, "group_elements", { ids: ["a", "out"], groupId: "g" });
    expect(d.elements.g.parentId).toBeNull();
    expect(worldRect(d, "a")).toEqual(before);
    expect(d.rootIds[d.rootIds.length - 1]).toBe("g");
  });

  it("removes a group left empty when all its things are grouped elsewhere", () => {
    let d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "inner" });
    d = runCommand(d, "create_element", { id: "out", type: "rect", x: 900, y: 900, width: 10, height: 10 });
    d = runCommand(d, "group_elements", { ids: ["a", "b", "out"], groupId: "g" });
    expect(d.elements.inner).toBeUndefined();
    expect(d.elements.box.childIds).not.toContain("inner");
    expect(d.elements.g.childIds).toEqual(["a", "b", "out"]);
  });

  it("saves groups and locks, and leaves other files unchanged", () => {
    let d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    d = runCommand(d, "set_props", { ids: ["a"], props: { locked: true } });
    const back = parseDoc(serializeDoc(d));
    expect(back.elements.g.type).toBe("group");
    expect(back.elements.a.locked).toBe(true);
    expect(serializeDoc(frame())).not.toContain('"locked"');
  });

  it("draws a group into the SVG export", () => {
    const d = runCommand(scene(), "group_elements", { ids: ["a", "b"], groupId: "g" });
    expect(toSvg(d, "box")).toContain("<g>");
  });

  it("a hidden thing cannot be picked, is left out of the SVG, and shows again with one Undo", () => {
    const shown = scene();
    const d = runCommand(shown, "set_props", { ids: ["a"], props: { hidden: true }, label: "Hide" });
    // a sits at 120,80 on the page; with it hidden the click lands on the frame
    expect(hitTest(shown, 130, 90)).toBe("a");
    expect(hitTest(d, 130, 90)).toBe("box");
    const rects = (svg: string) => (svg.match(/<rect /g) ?? []).length;
    expect(rects(toSvg(d, "box"))).toBe(rects(toSvg(shown, "box")) - 1);
    expect(shown.elements.a.hidden).toBe(false);
  });

  it("grades a picture or clip, keeps the numbers in range, and resets with null", () => {
    let d = frame();
    d = runCommand(d, "create_element", { id: "p", type: "image", parentId: "f1", x: 0, y: 0, width: 50, height: 50 });
    d = runCommand(d, "create_element", { id: "r", type: "rect", parentId: "f1", x: 0, y: 0, width: 50, height: 50 });
    const before = d;
    d = runCommand(d, "set_grade", { ids: ["p", "r"], grade: { exposure: -9, contrast: 30 } });
    expect(before.elements.p.grade).toBeNull();
    expect(d.elements.p.grade).toMatchObject({ exposure: -5, contrast: 30, saturation: 0 });
    // a shape has no picture to grade
    expect(d.elements.r.grade).toBeNull();
    d = runCommand(d, "set_grade", { ids: ["p"], grade: { saturation: 20 } });
    expect(d.elements.p.grade).toMatchObject({ exposure: -5, contrast: 30, saturation: 20 });
    expect(serializeDoc(d)).toContain('"grade"');
    expect(parseDoc(serializeDoc(d)).elements.p.grade).toEqual(d.elements.p.grade);
    d = runCommand(d, "set_grade", { ids: ["p"], grade: null });
    expect(d.elements.p.grade).toBeNull();
    expect(serializeDoc(d)).not.toContain('"grade"');
    // every control back at zero is the same as no grade
    const z = runCommand(before, "set_grade", { ids: ["p"], grade: { exposure: 1 } });
    expect(runCommand(z, "set_grade", { ids: ["p"], grade: { exposure: 0 } }).elements.p.grade).toBeNull();
  });

  it("works out white balance exactly as the export engine does", () => {
    for (const c of gradeFixtures.balance) {
      const m = whiteBalance(c.temperature, c.tint);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(m[i][j]).toBeCloseTo(c.matrix[i][j], 4);
    }
    // no change at all is no change
    const same = whiteBalance(0, 0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(same[i][j]).toBeCloseTo(i === j ? 1 : 0, 6);
  });

  it("saves hidden only when it is set", () => {
    const d = runCommand(scene(), "set_props", { ids: ["a"], props: { hidden: true } });
    expect(parseDoc(serializeDoc(d)).elements.a.hidden).toBe(true);
    expect(serializeDoc(scene())).not.toContain('"hidden"');
    expect(outline(d)).toContain("hidden");
  });
});

describe("components", () => {
  const withButton = () => {
    let d = frame("btn"); // 300 by 400 at 100,50
    d = runCommand(d, "create_element", { id: "bg", type: "rect", parentId: "btn", x: 0, y: 0, width: 120, height: 40, props: { fill: "#7c5cff" } });
    d = runCommand(d, "create_element", { id: "label", type: "text", parentId: "btn", x: 10, y: 10, width: 60, height: 20, props: { text: "Buy", fill: "#ffffff" } });
    return runCommand(d, "create_component", { id: "btn" });
  };
  const withCopy = () => runCommand(withButton(), "create_instance", { componentId: "btn", id: "i1", x: 600, y: 80 });

  it("makes a copy that looks like the component", () => {
    const d = withCopy();
    expect(d.elements.i1.type).toBe("instance");
    expect(d.elements.i1.childIds).toEqual(["i1::bg", "i1::label"]);
    expect(d.elements["i1::label"].text).toBe("Buy");
    expect([d.elements.i1.width, d.elements.i1.height]).toEqual([300, 400]);
    expect(d.elements.i1.name).toBe("Frame 1");
  });

  it("follows the component when it changes", () => {
    let d = withCopy();
    d = runCommand(d, "set_props", { ids: ["bg"], props: { fill: "#ff0000" } });
    d = runCommand(d, "set_props", { ids: ["label"], props: { text: "Add to cart" } });
    expect(d.elements["i1::bg"].fill).toBe("#ff0000");
    expect(d.elements["i1::label"].text).toBe("Add to cart");
  });

  it("keeps a change made on one copy, and still follows the rest", () => {
    let d = withCopy();
    d = runCommand(d, "set_props", { ids: ["i1::label"], props: { text: "Pay now" } });
    expect(d.elements["i1::label"].text).toBe("Pay now");
    expect(d.elements.label.text).toBe("Buy"); // the component is untouched
    d = runCommand(d, "set_props", { ids: ["label"], props: { text: "Add to cart", fill: "#00ff00" } });
    expect(d.elements["i1::label"].text).toBe("Pay now"); // the copy keeps its own words
    expect(d.elements["i1::label"].fill).toBe("#00ff00"); // but follows the new colour
  });

  it("keeps a copy's own size when the component is resized", () => {
    let d = withCopy();
    d = runCommand(d, "resize_element", { id: "i1", x: 600, y: 80, width: 500, height: 200 });
    expect([d.elements.i1.width, d.elements.i1.height]).toEqual([500, 200]);
    d = runCommand(d, "resize_element", { id: "btn", x: 100, y: 50, width: 320, height: 420 });
    expect([d.elements.i1.width, d.elements.i1.height]).toEqual([500, 200]);
  });

  it("saves only the component and the changes, and rebuilds the copy when opened", () => {
    let d = withCopy();
    d = runCommand(d, "set_props", { ids: ["i1::label"], props: { text: "Pay now" } });
    const text = serializeDoc(d);
    expect(text).not.toContain("i1::bg");
    const back = parseDoc(text);
    expect(back.elements["i1::label"].text).toBe("Pay now");
    expect(back.elements["i1::bg"].fill).toBe("#7c5cff");
  });

  it("detaches into a plain frame with its own things", () => {
    let d = withCopy();
    d = runCommand(d, "set_props", { ids: ["i1::label"], props: { text: "Pay now" } });
    d = runCommand(d, "detach_instance", { id: "i1" });
    expect(d.elements.i1.type).toBe("frame");
    expect(d.elements.i1.childIds).toHaveLength(2);
    const label = d.elements[d.elements.i1.childIds[1]];
    expect(label.text).toBe("Pay now");
    expect(label.id.includes("::")).toBe(false);
    d = runCommand(d, "set_props", { ids: ["bg"], props: { fill: "#ff0000" } });
    expect(d.elements[d.elements.i1.childIds[0]].fill).toBe("#7c5cff"); // no longer follows
  });

  it("turns copies into plain frames if the component is deleted", () => {
    let d = withCopy();
    d = runCommand(d, "delete_elements", { ids: ["btn"] });
    expect(d.elements.i1.type).toBe("frame");
    expect(d.elements.i1.childIds).toHaveLength(2);
  });

  it("cannot put new things inside a copy, or delete what is inside one", () => {
    let d = withCopy();
    const blocked = runCommand(d, "create_element", { id: "x", type: "rect", parentId: "i1", x: 0, y: 0, width: 10, height: 10 });
    expect(blocked.elements.x).toBeUndefined();
    d = runCommand(d, "delete_elements", { ids: ["i1::bg"] });
    expect(d.elements["i1::bg"]).toBeDefined();
  });

  it("will not put a component inside itself", () => {
    const d = runCommand(withButton(), "create_instance", { componentId: "btn", id: "loop", x: 0, y: 0, parentId: "btn" });
    expect(d.elements.loop).toBeUndefined();
  });

  it("clears a copy's own changes", () => {
    let d = withCopy();
    d = runCommand(d, "set_props", { ids: ["i1::label"], props: { text: "Pay now" } });
    d = runCommand(d, "reset_overrides", { id: "i1" });
    expect(d.elements["i1::label"].text).toBe("Buy");
  });

  it("makes a copy of a copy by pasting, without dragging its inside along", () => {
    const d = withCopy();
    const payload = { rootIds: ["i1"], origins: { i1: { x: 600, y: 80 } }, elements: Object.fromEntries(Object.entries(d.elements).filter(([id]) => id === "i1" || id.startsWith("i1::"))) };
    const next = runCommand(d, "paste_elements", { payload: payload as never, parentId: null, dx: 20, dy: 20 });
    const copies = Object.values(next.elements).filter((e) => e.type === "instance");
    expect(copies).toHaveLength(2);
    const fresh = copies.find((e) => e.id !== "i1")!;
    expect(fresh.childIds).toHaveLength(2);
    expect(fresh.childIds[0].startsWith(`${fresh.id}::`)).toBe(true);
  });
});

describe("text", () => {
  const withText = (text = "Hello there", extra: Record<string, unknown> = {}) =>
    runCommand(frame("f"), "create_element", { id: "t", type: "text", parentId: "f", x: 10, y: 10, width: 80, height: 21, props: { text, fontSize: 20, ...extra } });

  it("resizes text to fit when its look changes", () => {
    let d = withText();
    const w0 = d.elements.t.width;
    d = runCommand(d, "set_props", { ids: ["t"], props: { fontSize: 40 } });
    expect(d.elements.t.width).toBeGreaterThan(w0 * 1.8);
    expect(d.elements.t.height).toBeGreaterThan(40);
  });

  it("makes lines taller with a bigger line height, and wider with letter spacing", () => {
    let d = withText("one\ntwo");
    const h0 = d.elements.t.height;
    const w0 = d.elements.t.width;
    d = runCommand(d, "set_props", { ids: ["t"], props: { lineHeight: 2 } });
    expect(d.elements.t.height).toBeGreaterThan(h0);
    d = runCommand(d, "set_props", { ids: ["t"], props: { letterSpacing: 4 } });
    expect(d.elements.t.width).toBeGreaterThan(w0);
  });

  it("wraps words once the box is given a width, and grows taller", () => {
    let d = withText("one two three four five six seven eight nine ten");
    const h0 = d.elements.t.height;
    d = runCommand(d, "resize_element", { id: "t", x: 10, y: 10, width: 90, height: h0 });
    expect(d.elements.t.textFixed).toBe(true);
    expect(d.elements.t.width).toBe(90);
    expect(d.elements.t.height).toBeGreaterThan(h0 * 2);
  });

  it("goes back to one line when switched to auto width", () => {
    let d = withText("one two three four five six seven eight nine ten");
    const h0 = d.elements.t.height;
    d = runCommand(d, "resize_element", { id: "t", x: 10, y: 10, width: 90, height: h0 });
    d = runCommand(d, "set_props", { ids: ["t"], props: { textFixed: false } });
    expect(d.elements.t.height).toBe(h0);
  });

  it("breaks text into lines the way the box asks", () => {
    const face = { fontFamily: "", fontWeight: 400, fontSize: 10, lineHeight: 0, letterSpacing: 0 };
    expect(wrapLines("aa bb cc", face, undefined)).toEqual(["aa bb cc"]);
    expect(wrapLines("a\nb", face, 500)).toEqual(["a", "b"]);
    expect(wrapLines("aaaa bbbb cccc dddd", face, 25).length).toBeGreaterThan(1);
  });

  it("keeps the canvas colour in the saved file", () => {
    const d = runCommand(emptyDoc(), "set_background", { color: "#f4f1ea" });
    expect(parseDoc(serializeDoc(d)).background).toBe("#f4f1ea");
    expect(serializeDoc(emptyDoc())).not.toContain("background");
  });

  it("changes the canvas colour, and clearing it goes back to the standard dark", () => {
    let d = runCommand(emptyDoc(), "set_background", { color: "#F4F1EA" });
    expect(d.background).toBe("#f4f1ea");
    expect(emptyDoc().background).toBeUndefined();
    expect(runCommand(d, "set_background", { color: "#f4f1ea" })).toBe(d);
    expect(runCommand(d, "set_background", { color: "not a colour" }).background).toBeUndefined();
    d = runCommand(d, "set_background", { color: null });
    expect(d.background).toBeUndefined();
  });

  it("saves a text style, and every text using it follows when the style changes", () => {
    let d = runCommand(withText("Title", { fontWeight: 700 }), "create_element", { id: "t2", type: "text", parentId: "f", x: 10, y: 60, width: 50, height: 20, props: { text: "Another", fontSize: 12 } });
    d = runCommand(d, "create_text_style", { styleId: "s1", fromId: "t", name: "Heading" });
    expect(d.styles?.s1).toMatchObject({ name: "Heading", fontWeight: 700, fontSize: 20 });
    d = runCommand(d, "apply_text_style", { ids: ["t2"], styleId: "s1" });
    expect(d.elements.t2).toMatchObject({ fontSize: 20, fontWeight: 700, textStyleId: "s1" });
    d = runCommand(d, "update_text_style", { styleId: "s1", props: { fontSize: 32, fontFamily: "Georgia" } });
    expect(d.elements.t.fontSize).toBe(32);
    expect(d.elements.t2.fontFamily).toBe("Georgia");
    expect(d.elements.t2.height).toBeGreaterThan(30);
  });

  it("stops following a style once detached, and clears it when the style is deleted", () => {
    let d = runCommand(withText("Title"), "create_text_style", { styleId: "s1", fromId: "t", name: "Heading" });
    d = runCommand(d, "apply_text_style", { ids: ["t"], styleId: null });
    d = runCommand(d, "update_text_style", { styleId: "s1", props: { fontSize: 50 } });
    expect(d.elements.t.fontSize).toBe(20);
    d = runCommand(d, "apply_text_style", { ids: ["t"], styleId: "s1" });
    d = runCommand(d, "delete_text_style", { styleId: "s1" });
    expect(d.styles?.s1).toBeUndefined();
    expect(d.elements.t.textStyleId).toBe("");
  });

  it("saves the look of text, and styles, and reopens them", () => {
    let d = withText("Title", { fontFamily: "Georgia", fontWeight: 700, textAlign: "center", letterSpacing: 2, lineHeight: 1.5 });
    d = runCommand(d, "create_text_style", { styleId: "s1", fromId: "t", name: "Heading" });
    const back = parseDoc(serializeDoc(d));
    expect(back.elements.t).toMatchObject({ fontFamily: "Georgia", fontWeight: 700, textAlign: "center", letterSpacing: 2, lineHeight: 1.5, textStyleId: "s1" });
    expect(back.styles?.s1.name).toBe("Heading");
  });

  it("does not add text fields to files that do not need them", () => {
    const plain = serializeDoc(withText("Hi"));
    expect(plain).not.toContain("fontFamily");
    expect(plain).not.toContain("textAlign");
    expect(plain).not.toContain('"styles"');
    expect(serializeDoc(frame())).not.toContain("fontWeight");
  });

  it("puts the font and alignment into the SVG export", () => {
    const svg = toSvg(withText("Hi", { fontFamily: "Georgia", fontWeight: 700 }), "f");
    expect(svg).toContain("Georgia");
    expect(svg).toContain('font-weight="700"');
  });
});

describe("the outline the AI reads", () => {
  const scene = () => {
    let d = frame("f");
    d = runCommand(d, "create_element", { id: "t", type: "text", parentId: "f", x: 10, y: 10, width: 80, height: 21, props: { text: "Hello", fontSize: 24, fontWeight: 700, fill: "#222222" } });
    d = runCommand(d, "create_element", { id: "r", type: "rect", parentId: "f", x: 10, y: 50, width: 100, height: 40, props: { fill: "#7c5cff", radius: 8 } });
    return d;
  };

  it("lists each thing with its id, place, size and look, indented by what is inside what", () => {
    const text = outline(scene());
    expect(text).toContain('frame "Frame 1" f');
    expect(text).toContain('  text "Text 1" t · 10,10');
    expect(text).toContain('"Hello"');
    expect(text).toContain("24px w700");
    expect(text).toContain("radius 8");
    expect(text).toContain("fill #7c5cff");
  });

  it("is much shorter than the full data", () => {
    const d = scene();
    expect(outline(d).length).toBeLessThan(JSON.stringify(d.elements).length / 4);
  });

  it("shows copies of a component without listing their inside again", () => {
    let d = runCommand(scene(), "create_component", { id: "f" });
    d = runCommand(d, "create_instance", { componentId: "f", id: "i", x: 500, y: 0 });
    const text = outline(d);
    expect(text).toContain("COMPONENT");
    expect(text).toContain("copy of Frame 1");
    expect(text).not.toContain("i::");
  });

  it("can start from chosen things", () => {
    const text = outline(scene(), ["r"]);
    expect(text).toContain('rect "Rectangle 1" r');
    expect(text).not.toContain("Hello");
  });
});

describe("prototype", () => {
  const screens = () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "home", type: "frame", x: 0, y: 0, width: 300, height: 500 });
    d = runCommand(d, "create_element", { id: "detail", type: "frame", x: 400, y: 0, width: 300, height: 500 });
    d = runCommand(d, "create_element", { id: "menu", type: "frame", x: 800, y: 0, width: 200, height: 300 });
    d = runCommand(d, "create_element", { id: "btn", type: "rect", parentId: "home", x: 20, y: 20, width: 100, height: 40 });
    d = runCommand(d, "create_element", { id: "more", type: "rect", parentId: "home", x: 20, y: 100, width: 100, height: 40 });
    d = runCommand(d, "create_element", { id: "close", type: "rect", parentId: "menu", x: 10, y: 10, width: 40, height: 40 });
    d = runCommand(d, "set_props", { ids: ["btn"], props: { link: "detail", transition: "push-left", transitionMs: 450 } });
    d = runCommand(d, "set_props", { ids: ["more"], props: { link: "menu", linkKind: "overlay", transition: "dissolve" } });
    d = runCommand(d, "set_props", { ids: ["close"], props: { linkKind: "back" } });
    return d;
  };

  it("knows how a click arrives, and for how long", () => {
    const info = linkInfoAt(screens(), "home", 30, 30);
    expect(info).toEqual({ kind: "go", target: "detail", transition: "push-left", ms: 450 });
  });

  it("uses 300 milliseconds when no time is set", () => {
    expect(linkInfoAt(screens(), "home", 30, 110)).toMatchObject({ kind: "overlay", target: "menu", transition: "dissolve", ms: 300 });
  });

  it("treats a back button as going back, with no screen to go to", () => {
    expect(linkInfoAt(screens(), "menu", 820, 20)).toMatchObject({ kind: "back", target: null });
  });

  it("does nothing when a click lands on something with no link", () => {
    expect(linkInfoAt(screens(), "home", 250, 400)).toBeNull();
  });

  it("still tells which screen a click goes to", () => {
    expect(linkAt(screens(), "home", 30, 30)).toBe("detail");
    expect(linkAt(screens(), "menu", 820, 20)).toBeNull();
  });

  it("saves the animation, the action and scrolling, and leaves other files alone", () => {
    let d = screens();
    d = runCommand(d, "set_props", { ids: ["home"], props: { scroll: true } });
    const back = parseDoc(serializeDoc(d));
    expect(back.elements.btn).toMatchObject({ transition: "push-left", transitionMs: 450, linkKind: "" });
    expect(back.elements.more.linkKind).toBe("overlay");
    expect(back.elements.close.linkKind).toBe("back");
    expect(back.elements.home.scroll).toBe(true);
    const plain = serializeDoc(frame());
    for (const k of ["linkKind", "transition", "transitionMs", "scroll"]) expect(plain).not.toContain(`"${k}"`);
  });
});

import { canTurn, keepInPlace, tidyAngle, turnPoint, turnedBox, worldBounds } from "../document/geometry";
import { outlineFromData, parsePathData, toAbs } from "../document/path";
import { handleCursor, resizeTurned } from "../canvas/handles";
import {
  deleteSelectedNodes,
  enterNodeEdit,
  exitNodeEdit,
  nudgeSelectedNodes,
  selectNodes,
  toggleNode,
  withNodes,
  worldNodesOf,
} from "../canvas/nodes";

describe("rotation", () => {
  const bar = (rotation = 0) => runCommand(emptyDoc(), "create_element", { id: "r", type: "rect", x: 100, y: 100, width: 200, height: 20, props: { rotation } });
  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

  it("turns points clockwise and reads angles the way a designer does", () => {
    const p = turnPoint(10, 0, 0, 0, 90);
    near(p.x, 0);
    near(p.y, 10);
    expect(tidyAngle(270)).toBe(-90);
    expect(tidyAngle(360)).toBe(0);
    expect(tidyAngle(-180)).toBe(180);
    expect(tidyAngle(45.126)).toBe(45.13);
  });

  it("knows the upright box around a turned thing", () => {
    const box = turnedBox({ x: 0, y: 0, width: 100, height: 50 }, 90);
    near(box.width, 50);
    near(box.height, 100);
    near(box.x, 25);
    near(box.y, -25);
    const b = worldBounds(bar(90), "r");
    near(b.x, 190);
    near(b.y, 10);
  });

  it("is set like any other property, and frames stay upright", () => {
    let d = runCommand(bar(), "set_props", { ids: ["r"], props: { rotation: 400 } });
    expect(d.elements.r.rotation).toBe(40);
    d = runCommand(frame(), "set_props", { ids: ["f1"], props: { rotation: 30 } });
    expect(d.elements.f1.rotation).toBe(0);
    d = runCommand(emptyDoc(), "create_element", { id: "f", type: "frame", x: 0, y: 0, width: 10, height: 10, props: { rotation: 30 } });
    expect(d.elements.f.rotation).toBe(0);
    expect(canTurn(d, "f")).toBe(false);
  });

  it("keeps whole turns once the rotation changes over time", () => {
    let d = runCommand(bar(), "set_props", { ids: ["r"], props: { rotation: 720 } });
    expect(d.elements.r.rotation).toBe(0);
    d = { ...d, elements: { ...d.elements, r: { ...d.elements.r, keys: { rotation: [{ t: 0, v: 0, ease: "in-out" }] } } } };
    expect(runCommand(d, "set_props", { ids: ["r"], props: { rotation: 720 } }).elements.r.rotation).toBe(720);
    expect(runCommand(d, "set_props", { ids: ["r"], props: { rotation: -400 } }).elements.r.rotation).toBe(-400);
  });

  it("picks a turned thing where it is drawn, not where its box was", () => {
    const d = bar(90); // now a tall bar around x 190 to 210, y 10 to 210
    expect(hitTest(d, 200, 20)).toBe("r");
    expect(hitTest(d, 110, 110)).toBeNull();
    expect(hitTest(bar(), 110, 110)).toBe("r");
  });

  it("turns everything inside a group around its middle, and back again", () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "a", type: "rect", x: 0, y: 0, width: 100, height: 20 });
    d = runCommand(d, "create_element", { id: "b", type: "rect", x: 0, y: 50, width: 100, height: 20 });
    d = runCommand(d, "group_elements", { ids: ["a", "b"], groupId: "g" });
    const turnedDoc = runCommand(d, "set_props", { ids: ["g"], props: { rotation: 90 } });
    expect(turnedDoc.elements.a.rotation).toBe(90);
    expect(turnedDoc.elements.g.rotation).toBe(90);
    // the group's box now holds two tall bars side by side
    near(turnedDoc.elements.g.x, 15);
    near(turnedDoc.elements.g.y, -15);
    near(turnedDoc.elements.g.width, 70);
    near(turnedDoc.elements.g.height, 100);
    const back = runCommand(turnedDoc, "set_props", { ids: ["g"], props: { rotation: 0 } });
    expect(back.elements.a.rotation).toBe(0);
    for (const id of ["a", "b"]) {
      near(worldPos(back, id).x, worldPos(d, id).x);
      near(worldPos(back, id).y, worldPos(d, id).y);
    }
    expect(d.elements.a.rotation).toBe(0); // the old document is untouched
  });

  it("will not turn a group that holds a frame", () => {
    let d = runCommand(frame("f"), "create_element", { id: "a", type: "rect", x: 600, y: 0, width: 50, height: 50 });
    d = runCommand(d, "group_elements", { ids: ["f", "a"], groupId: "g" });
    expect(canTurn(d, "g")).toBe(false);
    d = runCommand(d, "set_props", { ids: ["g"], props: { rotation: 45 } });
    expect(d.elements.g.rotation).toBe(0);
    expect(d.elements.a.rotation).toBe(0);
  });

  it("fits a group around turned things", () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "a", type: "rect", x: 0, y: 0, width: 100, height: 20, props: { rotation: 90 } });
    d = runCommand(d, "create_element", { id: "b", type: "rect", x: 200, y: 0, width: 20, height: 20 });
    d = runCommand(d, "group_elements", { ids: ["a", "b"], groupId: "g" });
    // the turned bar reaches from x 40 to 60 and y -40 to 60
    near(d.elements.g.x, 40);
    near(d.elements.g.y, -40);
    near(d.elements.g.width, 180);
    near(d.elements.g.height, 100);
    expect(hitTest(d, 50, -30)).toBe("g");
  });

  it("resizes a turned thing along its own sides and keeps the far side still", () => {
    const orig = { x: 0, y: 0, width: 100, height: 50 };
    // turned a quarter, the right-hand handle points down the page
    const r = resizeTurned(orig, 90, "e", 0, 20);
    near(r.width, 120);
    near(r.height, 50);
    const farBefore = turnPoint(orig.x, orig.y + 25, 50, 25, 90);
    const farAfter = turnPoint(r.x, r.y + r.height / 2, r.x + r.width / 2, r.y + r.height / 2, 90);
    near(farAfter.x, farBefore.x);
    near(farAfter.y, farBefore.y);
    expect(resizeTurned(orig, 0, "e", 20, 0)).toEqual(resizeRect(orig, "e", 20, 0));
    expect(keepInPlace(orig, { x: 5, y: 5, width: 10, height: 10 }, 0)).toEqual({ x: 5, y: 5, width: 10, height: 10 });
  });

  it("points the resize cursor the way the handle faces", () => {
    expect(handleCursor("n")).toBe("ns-resize");
    expect(handleCursor("n", 90)).toBe("ew-resize");
    expect(handleCursor("nw", 45)).toBe("ns-resize");
    expect(handleCursor("nw", -45)).toBe("ew-resize");
  });

  it("keeps the other points of a turned line still while one is moved", () => {
    const corner = (x: number, y: number) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 });
    const shape = fromAbs([corner(0, 0), corner(100, 0), corner(100, 50)]);
    const d = runCommand(emptyDoc(), "create_element", { id: "p", type: "path", ...shape, props: { nodes: shape.nodes, closed: true, rotation: 90 } });
    const where = (doc: typeof d) => {
      const el = doc.elements.p;
      const n = toAbs(el, el.x, el.y)[0];
      return turnPoint(n.x, n.y, el.x + el.width / 2, el.y + el.height / 2, 90);
    };
    const moved = withNodes(d, "p", [corner(0, 0), corner(100, 0), corner(100, 120)]);
    near(moved.elements.p.height, 120);
    near(where(moved).x, where(d).x);
    near(where(moved).y, where(d).y);
  });

  it("computes world positions of anchor points and moves several points together", () => {
    const corner = (x: number, y: number) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 });
    const shape = fromAbs([corner(0, 0), corner(50, 0), corner(100, 50)]);
    const d = runCommand(emptyDoc(), "create_element", { id: "p", type: "path", x: shape.x, y: shape.y, width: shape.width, height: shape.height, props: { nodes: shape.nodes, closed: false } });
    const pts = worldNodesOf(d, "p");
    expect(pts).toHaveLength(3);
    near(pts[0].x, 0);
    near(pts[0].y, 0);
    near(pts[1].x, 50);
    near(pts[1].y, 0);
    near(pts[2].x, 100);
    near(pts[2].y, 50);

    const moved = withNodes(d, "p", [corner(10, 20), corner(60, 20), corner(100, 50)]);
    const movedPts = toAbs(moved.elements.p, moved.elements.p.x, moved.elements.p.y);
    expect(movedPts[0].x).toBeCloseTo(10, 2);
    expect(movedPts[0].y).toBeCloseTo(20, 2);
    expect(movedPts[1].x).toBeCloseTo(60, 2);
    expect(movedPts[1].y).toBeCloseTo(20, 2);
    expect(movedPts[2].x).toBeCloseTo(100, 2);
    expect(movedPts[2].y).toBeCloseTo(50, 2);
  });

  it("is saved only when something is turned, and older files open upright", () => {
    expect(serializeDoc(bar())).not.toContain("rotation");
    const text = serializeDoc(bar(30));
    expect(text).toContain('"rotation": 30');
    expect(parseDoc(text).elements.r.rotation).toBe(30);
    expect(parseDoc(serializeDoc(bar())).elements.r.rotation).toBe(0);
  });

  it("is exported, with room for the whole turned shape", () => {
    let d = runCommand(frame("f"), "create_element", { id: "r", type: "rect", parentId: "f", x: 10, y: 10, width: 80, height: 30, props: { rotation: 30 } });
    expect(toSvg(d, "f")).toContain('<g transform="rotate(30 50 25)">');
    d = runCommand(emptyDoc(), "create_element", { id: "r", type: "rect", x: 0, y: 0, width: 100, height: 50, props: { rotation: 90 } });
    const svg = toSvg(d, "r");
    expect(svg).toContain('width="50" height="100"');
    expect((svg.match(/<g[ >]/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
  });

  it("is told to the AI in the outline", () => {
    expect(outline(bar(30))).toContain("turned 30°");
    expect(outline(bar())).not.toContain("turned");
  });
});

describe("outlines written as path text", () => {
  const near = (a: number, b: number, by = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(by);

  it("reads straight lines, exact and relative", () => {
    const [tri] = parsePathData("M 0 0 L 100 0 L 50 80 Z");
    expect(tri.closed).toBe(true);
    expect(tri.nodes.map((n) => [n.x, n.y])).toEqual([[0, 0], [100, 0], [50, 80]]);
    const [rel] = parsePathData("m10 10 l 20 0 l 0 20");
    expect(rel.closed).toBe(false);
    expect(rel.nodes.map((n) => [n.x, n.y])).toEqual([[10, 10], [30, 10], [30, 30]]);
    const [hv] = parsePathData("M0,0H10V10 20-5");
    expect(hv.nodes.map((n) => [n.x, n.y])).toEqual([[0, 0], [10, 0], [10, 10], [10, 20], [10, -5]]);
  });

  it("reads curves into handles", () => {
    const [c] = parsePathData("M0 0 C 10 20 30 40 50 0");
    expect(c.nodes[0]).toMatchObject({ ox: 10, oy: 20 });
    expect(c.nodes[1]).toMatchObject({ x: 50, y: 0, ix: -20, iy: 40 });
    const [s] = parsePathData("M0 0 C 0 10 10 20 20 20 S 40 10 40 0");
    expect(s.nodes[1]).toMatchObject({ ox: 10, oy: 0 }); // the smooth curve mirrors the handle before it
    const [q] = parsePathData("M0 0 Q 30 30 60 0");
    near(q.nodes[0].ox, 20);
    near(q.nodes[0].oy, 20);
    near(q.nodes[1].ix, -20);
    near(q.nodes[1].iy, 20);
  });

  it("turns arcs into curves that follow the same round path", () => {
    const [half] = parsePathData("M 0 0 A 50 50 0 0 1 100 0");
    expect(half.nodes.length).toBe(3);
    const line = flatten(half.nodes, false, 40);
    // every spot on it is 50 from the middle, and it goes over the top
    for (const p of line) near(Math.hypot(p.x - 50, p.y), 50, 0.05);
    expect(Math.min(...line.map((p) => p.y))).toBeLessThan(-49.9);
    const [other] = parsePathData("M 0 0 A 50 50 0 0 0 100 0");
    expect(Math.max(...flatten(other.nodes, false, 40).map((p) => p.y))).toBeGreaterThan(49.9);
    const [tight] = parsePathData("M0 0a50 50 0 0150 50");
    expect(tight.nodes[tight.nodes.length - 1]).toMatchObject({ x: 50, y: 50 });
  });

  it("joins the ends of a closed shape, so a leaf made of two curves is one smooth outline", () => {
    const d = "M 0 0 C 30 -40 70 -40 100 0 C 70 40 30 40 0 0 Z";
    const [leaf] = parsePathData(d);
    expect(leaf.closed).toBe(true);
    expect(leaf.nodes.length).toBe(3);
    const line = flatten(leaf.nodes, true, 40);
    expect(Math.min(...line.map((p) => p.y))).toBeCloseTo(-30, 1);
    expect(Math.max(...line.map((p) => p.y))).toBeCloseTo(30, 1);
    expect(Math.max(...line.map((p) => p.x))).toBeCloseTo(100, 5);
    const [drop] = parsePathData("M0 0 C 30 -60 -30 -60 0 0 Z");
    expect(drop.closed).toBe(true);
    expect(drop.nodes.length).toBe(3);
    expect(Math.min(...flatten(drop.nodes, true, 40).map((p) => p.y))).toBeCloseTo(-45, 1);
  });

  it("starts a new piece at every move, and after a close", () => {
    expect(parsePathData("M0 0 L10 0 L10 10 Z M 20 20 L 30 30").length).toBe(2);
    const pieces = parsePathData("M5 5 L10 5 L10 10 Z L 0 0");
    expect(pieces[1].nodes.map((n) => [n.x, n.y])).toEqual([[5, 5], [0, 0]]);
  });

  it("says in plain words what is wrong", () => {
    expect(() => parsePathData("L 10 10")).toThrow(/start with M/);
    expect(() => parsePathData("M 0 0 X 5")).toThrow(/not a path letter/);
    expect(() => parsePathData("M 0 0 L 10")).toThrow(/not a number/);
    expect(() => outlineFromData("")).toThrow(/needs d/);
    expect(() => outlineFromData("M 0 0")).toThrow(/two points/);
    expect(() => outlineFromData("M0 0 L10 0 L10 10 Z M 20 20 L 30 30")).toThrow(/2 separate pieces/);
  });

  it("fits the box to what is drawn, so a shape turns around its own middle", () => {
    const arch = outlineFromData("M 0 0 A 50 50 0 0 1 100 0");
    expect(arch.y).toBeCloseTo(-50, 3);
    expect(arch.height).toBeCloseTo(50, 3);
    const leaf = outlineFromData("M 0 0 C 30 -40 70 -40 100 0 C 70 40 30 40 0 0 Z");
    expect([leaf.x, leaf.y, leaf.width, leaf.height]).toEqual([0, -30, 100, 60]);
  });

  it("gives a box and points ready to be made into a path", () => {
    const shape = outlineFromData("M 20 10 L 120 10 L 70 90 Z");
    expect([shape.x, shape.y, shape.width, shape.height]).toEqual([20, 10, 100, 80]);
    expect(shape.closed).toBe(true);
    const d = runCommand(emptyDoc(), "create_element", { id: "p", type: "path", x: shape.x, y: shape.y, width: shape.width, height: shape.height, props: { nodes: shape.nodes, closed: shape.closed } });
    expect(pathData(toAbs(d.elements.p, d.elements.p.x, d.elements.p.y), true)).toBe("M20 10L120 10L70 90L20 10Z");
  });
});

import { TOOLS, callTool } from "../ai/tools";
import { addPictures, answerApproval, getChat, newConversation, removePicture, sendPictures, setMinimized, setMode } from "../ai/chat";
import { WAYS } from "../ui/ConnectAi";

describe("what the AI can ask for", () => {
  beforeEach(() => {
    resetStore();
    setMode("auto");
  });

  it("gives an AI from outside the working rules and the skills that are turned on", async () => {
    expect(TOOLS.map((t) => t.name)).toContain("get_working_rules");
    const rules = (await callTool("get_working_rules", {})).text;
    expect(rules).toContain("Start with get_context");
    expect(rules).toContain("Respect the permission level");
    expect(rules).toContain("The designer has loaded these skills");
    // an AI from outside keeps its own tools, so it is not told to use no other tool
    expect(rules).not.toContain("Use no other tool");
    expect(WAYS.map((w) => w.text("/Applications/Duet.app/Contents/MacOS/duet-app"))).toEqual([
      'claude mcp add --scope user duet -- "/Applications/Duet.app/Contents/MacOS/duet-app" --mcp-bridge',
      'codex mcp add duet -- "/Applications/Duet.app/Contents/MacOS/duet-app" --mcp-bridge',
      '"duet": {"command":"/Applications/Duet.app/Contents/MacOS/duet-app","args":["--mcp-bridge"]}',
      '"duet": {"command":"/Applications/Duet.app/Contents/MacOS/duet-app","args":["--mcp-bridge"]}',
    ]);
  });

  it("shows the AI a picture the designer attached to a message, without putting it on the canvas", async () => {
    newConversation();
    addPictures([{ name: "feedback.png", data: "QUJD", mime: "image/jpeg", width: 800, height: 600, thumb: "data:image/jpeg;base64,QQ==" }]);
    const waiting = getChat().pictures[0];
    expect(waiting.sent).toBe(false);
    expect(JSON.parse((await callTool("get_context", {})).text).attachedPictures).toEqual([{ number: waiting.n, name: "feedback.png", kind: "picture", waiting: true }]);
    const sent = sendPictures();
    expect(sent.map((p) => p.n)).toEqual([waiting.n]);
    expect(sendPictures()).toEqual([]);
    const seen = await callTool("look_at_attachment", { number: waiting.n });
    expect(seen.image).toEqual({ data: "QUJD", mime: "image/jpeg" });
    expect(seen.text).toContain("not on the canvas");
    expect((await callTool("look_at_attachment", { number: 999 })).isError).toBe(true);
    expect(Object.keys(currentDoc().elements)).toHaveLength(0);
    expect(getState().timeline).toHaveLength(1);
    // a written brief goes the same way, and the AI reads its words
    addPictures([{ name: "brief.md", data: "", mime: "text/plain", width: 0, height: 0, thumb: "", text: "# Launch poster\nWarm colours." }]);
    const brief = getChat().pictures[1];
    expect(JSON.parse((await callTool("get_context", {})).text).attachedPictures[1]).toEqual({ number: brief.n, name: "brief.md", kind: "text", waiting: true });
    const read = await callTool("look_at_attachment", { number: brief.n });
    expect(read.text).toContain("Warm colours.");
    expect(read.image).toBeUndefined();
    removePicture(brief.n);
    // a waiting picture can be taken out, a sent one stays with its message until the conversation is cleared
    addPictures([{ name: "b.png", data: "QQ==", mime: "image/jpeg", width: 1, height: 1, thumb: "" }]);
    removePicture(getChat().pictures[1].n);
    removePicture(waiting.n);
    expect(getChat().pictures.map((p) => p.name)).toEqual(["feedback.png"]);
    newConversation();
    expect(getChat().pictures).toEqual([]);
  });

  it("holds every AI to the designer's setting, and marks what it changes as Duet's step", async () => {
    await callTool("create_element", { type: "rect", x: 0, y: 0, width: 10, height: 10 });
    const a = Object.keys(currentDoc().elements)[0];
    expect(getState().timeline[getState().cursor].actor).toBe("ai");
    setMode("suggest");
    const steps = getState().timeline.length;
    expect((await callTool("move_elements", { ids: [a], dx: 5, dy: 0 })).text).toContain("Nothing has been changed");
    expect(getState().timeline).toHaveLength(steps);
    expect(getChat().messages.slice(-1)[0].proposal?.status).toBe("open");
    setMode("ask");
    setMinimized(true);
    const asked = callTool("delete_elements", { ids: [a] });
    await Promise.resolve();
    // the question is put in front of the designer, even if the chat was folded away
    expect(getChat().minimized).toBe(false);
    const question = getChat().messages.slice(-1)[0];
    expect(question.approval?.status).toBe("waiting");
    answerApproval(question.id, false);
    expect((await asked).isError).toBe(true);
    expect(currentDoc().elements[a]).toBeTruthy();
  });

  it("tells the AI about a layout problem it just caused, and not about one that was already there", async () => {
    await callTool("create_element", { type: "frame", x: 0, y: 0, width: 400, height: 300, props: { fill: "#ffffff" } });
    const fr = currentDoc().rootIds[0];
    const fine = await callTool("create_element", { type: "text", id: "t1", parentId: fr, x: 40, y: 40, width: 200, height: 40, props: { text: "Hello", fontSize: 24, fill: "#111111" } });
    expect(fine.text).not.toContain("Layout check");
    const bad = await callTool("create_element", { type: "text", id: "t2", parentId: fr, x: 350, y: 120, width: 200, height: 40, props: { text: "Sale", fontSize: 24, fill: "#111111" } });
    expect(bad.text).toContain("Layout check, fix these:");
    expect(bad.text).toContain("outside the frame");
    // moving the fine one does not repeat the problem that t2 already had
    const moved = await callTool("move_elements", { ids: ["t1"], dx: 5, dy: 0 });
    expect(moved.text).not.toContain("Layout check");
  });

  it("draws a path from an outline, measured from x and y, and can turn it", async () => {
    const res = await callTool("create_element", { type: "path", x: 100, y: 200, d: "M 0 0 C 30 -40 70 -40 100 0 C 70 40 30 40 0 0 Z", props: { fill: "#2f7d4f", stroke: null, rotation: 30 } });
    expect(res.isError).toBeFalsy();
    const el = Object.values(currentDoc().elements)[0];
    expect(el.type).toBe("path");
    expect(el.closed).toBe(true);
    // the box fits what is drawn (the leaf reaches 30 up and 30 down), not the curve handles
    expect([el.x, el.y, el.width, el.height]).toEqual([100, 170, 100, 60]);
    expect(el.rotation).toBe(30);
    expect(res.text).toContain("Its box sits at 100,170");
  });

  it("gives a filled shape no line around it unless the AI asks for one", async () => {
    await callTool("create_element", { type: "path", x: 0, y: 0, d: "M 0 0 L 10 0 L 10 10 Z", props: { fill: "#2f7d4f" } });
    await callTool("create_element", { type: "path", x: 0, y: 0, d: "M 0 0 L 10 0 L 10 10 Z", props: { stroke: "#112211" } });
    await callTool("create_element", { type: "path", x: 0, y: 0, d: "M 0 0 C 5 -5 10 5 20 0" });
    const [flat, lined, open] = Object.values(currentDoc().elements);
    expect(flat.stroke).toBeNull();
    expect(lined.stroke).toBe("#112211");
    // an open line is only its line, so it keeps one
    expect(open.stroke).toBeTruthy();
  });

  it("redraws a path, and explains an outline it cannot use", async () => {
    await callTool("create_element", { type: "path", x: 0, y: 0, d: "M 0 0 L 10 0 L 10 10 Z" });
    const id = Object.keys(currentDoc().elements)[0];
    const ok = await callTool("set_props", { ids: [id], props: { d: "M 50 50 L 150 50 L 100 120 Z" } });
    expect(ok.isError).toBeFalsy();
    expect(currentDoc().elements[id]).toMatchObject({ x: 50, y: 50, width: 100, height: 70 });
    const bad = await callTool("create_element", { type: "path", x: 0, y: 0, d: "M0 0 L10 0 Z M 5 5 L 9 9" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("separate pieces");
    expect(Object.keys(currentDoc().elements).length).toBe(1);
  });

  it("is told plainly that a frame cannot be turned", async () => {
    dispatch("create_element", { id: "f", type: "frame", x: 0, y: 0, width: 100, height: 100 });
    const res = await callTool("set_props", { ids: ["f"], props: { rotation: 20 } });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("cannot be turned");
    expect(currentDoc().elements.f.rotation).toBe(0);
  });

  it("can ask to bring in a picture, but only a real picture file with a full path", async () => {
    expect(TOOLS.some((t) => t.name === "place_image")).toBe(true);
    expect((await callTool("place_image", { path: "leaf.png", x: 0, y: 0 })).text).toContain("full path");
    expect((await callTool("place_image", { path: "/Users/someone/notes.txt", x: 0, y: 0 })).text).toContain("not a picture");
    expect((await callTool("place_image", { path: "~/Desktop/leaf.png", x: 0, y: 0, parentId: "nope" })).text).toContain("not a frame");
  });

  it("only suggests bringing in a picture when the designer chose Suggest", async () => {
    setMode("suggest");
    const res = await callTool("place_image", { path: "~/Desktop/leaf.png", x: 0, y: 0 });
    expect(res.text).toContain("Suggestion shown");
    const last = getChat().messages[getChat().messages.length - 1];
    expect(last.proposal?.summary).toBe("Bring in the picture at ~/Desktop/leaf.png");
    expect(Object.keys(currentDoc().elements).length).toBe(0);
  });
});

import { canMask, maskOf } from "../document/geometry";
import { docAt, settle } from "../document/time";
import { maskChoice } from "../ui/actions";

describe("masks", () => {
  // a photo-sized box with a circle drawn over part of it, inside a frame at 100,50
  const scene = () => {
    let d = frame("f");
    d = runCommand(d, "create_element", { id: "photo", type: "image", parentId: "f", x: 20, y: 20, width: 200, height: 200 });
    d = runCommand(d, "create_element", { id: "ring", type: "ellipse", parentId: "f", x: 60, y: 60, width: 100, height: 100 });
    return d;
  };
  const masked = () => runCommand(scene(), "make_mask", { maskId: "ring", ids: ["photo"], groupId: "m" });

  it("puts the shape at the bottom of a group that is as big as the shape", () => {
    const d = masked();
    const g = d.elements.m;
    expect(g.mask).toBe(true);
    expect(g.name).toBe("Mask 1");
    expect(g.childIds).toEqual(["ring", "photo"]);
    expect([g.x, g.y, g.width, g.height]).toEqual([60, 60, 100, 100]);
    expect(maskOf(d, g)?.id).toBe("ring");
    // nothing moved on the page
    expect(worldPos(d, "photo")).toEqual({ x: 120, y: 70 });
    expect(worldPos(d, "ring")).toEqual({ x: 160, y: 110 });
    expect(scene().elements.photo.parentId).toBe("f"); // the old document is untouched
  });

  it("is only there where its shape is", () => {
    const d = masked();
    expect(hitTest(d, 210, 160)).toBe("m"); // the middle of the circle
    expect(hitTest(d, 163, 113)).toBe("f"); // a corner of the circle's box, outside the circle
    expect(hitTest(d, 130, 80)).toBe("f"); // on the photo, but outside the shape, so it is not shown
    expect(hitTest(d, 210, 160, new Set(), true)).toBe("photo");
  });

  it("is not shown at a moment when its picture has not come or has gone", () => {
    let d = runCommand(masked(), "set_props", { ids: ["f"], props: { duration: 9 } });
    d = runCommand(d, "set_props", { ids: ["photo"], props: { start: 3, end: 6 } });
    const early = docAt(d, "f", 1);
    expect(early.elements.m.hidden).toBe(true);
    expect(docAt(d, "f", 4).elements.m.hidden).toBeFalsy();
    expect(docAt(d, "f", 7).elements.m.hidden).toBe(true);
  });

  it("keeps its soft edge, invert and grow in the file, and old files open with them off", () => {
    let d = runCommand(masked(), "set_props", { ids: ["m"], props: { maskFeather: 8, maskInvert: true, maskGrow: -4 } });
    const back = parseDoc(serializeDoc(d));
    expect([back.elements.m.maskFeather, back.elements.m.maskInvert, back.elements.m.maskGrow]).toEqual([8, true, -4]);
    expect(d.elements.photo.maskFeather).toBe(0);
    const old = JSON.parse(serializeDoc(masked()));
    for (const id of Object.keys(old.elements)) for (const k of ["maskFeather", "maskInvert", "maskGrow"]) delete old.elements[id][k];
    const opened = parseDoc(JSON.stringify(old));
    expect([opened.elements.m.maskFeather, opened.elements.m.maskInvert, opened.elements.m.maskGrow]).toEqual([0, false, 0]);
    expect(JSON.stringify(old)).not.toContain("maskFeather");
    expect(serializeDoc(masked())).not.toContain("maskFeather");
  });

  it("lives in the timeline as long as the pictures it shows", () => {
    let d = runCommand(scene(), "set_props", { ids: ["f"], props: { duration: 9 } });
    d = runCommand(d, "set_props", { ids: ["photo"], props: { start: 2, end: 5 } });
    d = runCommand(d, "make_mask", { maskId: "ring", ids: ["photo"], groupId: "m" });
    expect([d.elements.m.start, d.elements.m.end]).toEqual([2, 5]);
    const whole = runCommand(runCommand(scene(), "set_props", { ids: ["f"], props: { duration: 9 } }), "make_mask", { maskId: "ring", ids: ["photo"], groupId: "m" });
    expect([whole.elements.m.start, whole.elements.m.end]).toEqual([0, 0]);
  });

  it("needs a plain shape, and something to show through it", () => {
    expect(canMask(scene().elements.photo)).toBe(false);
    expect(runCommand(scene(), "make_mask", { maskId: "photo", ids: ["ring"], groupId: "m" }).elements.m).toBeUndefined();
    expect(runCommand(scene(), "make_mask", { maskId: "ring", ids: [], groupId: "m" }).elements.m).toBeUndefined();
  });

  it("stops being a mask when its shape is taken away", () => {
    const d = runCommand(masked(), "delete_elements", { ids: ["ring"] });
    expect(d.elements.m.mask).toBe(false);
    expect(maskOf(d, d.elements.m)).toBeNull();
    expect([d.elements.m.width, d.elements.m.height]).toEqual([200, 200]);
  });

  it("comes apart with ungroup, and the shape is a shape again", () => {
    const d = runCommand(masked(), "ungroup", { ids: ["m"] });
    expect(d.elements.m).toBeUndefined();
    expect(d.elements.f.childIds).toEqual(["ring", "photo"]);
    expect(worldPos(d, "ring")).toEqual({ x: 160, y: 110 });
  });

  it("picks the shape as the mask wherever it sits, when it is the only shape chosen", () => {
    const d = scene();
    expect(maskChoice(d, [d.elements.photo, d.elements.ring])?.id).toBe("ring");
    expect(maskChoice(d, [d.elements.photo])).toBeNull();
    expect(maskChoice(d, [d.elements.photo, d.elements.f])).toBeNull();
    const two = runCommand(d, "create_element", { id: "box", type: "rect", parentId: "f", x: 0, y: 0, width: 50, height: 50 });
    expect(maskChoice(two, [two.elements.box, two.elements.ring])?.id).toBe("ring"); // the lower of two shapes
  });

  it("is saved, turned with its contents, and exported as a cut-out", () => {
    const d = masked();
    expect(serializeDoc(d)).toContain('"mask": true');
    expect(serializeDoc(scene())).not.toContain('"mask"');
    expect(parseDoc(serializeDoc(d)).elements.m.mask).toBe(true);
    const t = runCommand(d, "set_props", { ids: ["m"], props: { rotation: 45 } });
    expect(t.elements.ring.rotation).toBe(45);
    expect(t.elements.photo.rotation).toBe(45);
    const svg = toSvg(d, "f");
    expect(svg).toContain('<ellipse cx="110" cy="110" rx="50" ry="50"/></clipPath>');
    expect(svg).not.toContain('<ellipse cx="110" cy="110" rx="50" ry="50" fill');
    expect(outline(d)).toContain("mask:");
  });

  it("can be asked for by the AI, which is told when the shape will not do", async () => {
    resetStore();
    setMode("auto");
    dispatch("create_element", { id: "pic", type: "image", x: 0, y: 0, width: 200, height: 200 });
    dispatch("create_element", { id: "leaf", type: "ellipse", x: 50, y: 50, width: 80, height: 120 });
    expect((await callTool("make_mask", { shapeId: "pic", ids: ["leaf"] })).text).toContain("cannot be a mask");
    const res = await callTool("make_mask", { shapeId: "leaf", ids: ["pic"] });
    expect(res.isError).toBeFalsy();
    const g = Object.values(currentDoc().elements).find((e) => e.mask);
    expect(g?.childIds).toEqual(["leaf", "pic"]);
  });
});

import { TraceError, foreground, traceShapes } from "../document/trace";
import { drawnBox } from "../document/path";

describe("tracing a picture into shapes", () => {
  /** A small picture: every pixel painted by a rule. null leaves it see-through. */
  const picture = (w: number, h: number, paint: (x: number, y: number) => [number, number, number] | null) => {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = paint(x, y);
        if (c) rgba.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
      }
    return rgba;
  };
  const green: [number, number, number] = [40, 140, 80];
  const white: [number, number, number] = [255, 255, 255];

  it("follows a square exactly, corner to corner", () => {
    const [shape] = traceShapes(picture(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 5 && y < 25 ? green : null)), 40, 40);
    expect(shape.area).toBe(400);
    expect(shape.color).toBe("#288c50");
    expect(shape.nodes.map((n) => [n.x, n.y])).toEqual([[10, 5], [30, 5], [30, 25], [10, 25]]);
    expect(shape.nodes.every((n) => !n.ix && !n.iy && !n.ox && !n.oy)).toBe(true); // square corners stay sharp
  });

  it("keeps the gentle corners of a straight-sided shape as corners", () => {
    // a box with a shallow point at the bottom, like a shield
    const inside = (x: number, y: number) => x >= 20 && x < 180 && y >= 20 && (y < 100 || y < 130 - (Math.abs(x - 100) * 30) / 80);
    const [shape] = traceShapes(picture(200, 160, (x, y) => (inside(x, y) ? green : white)), 200, 160);
    expect(shape.nodes.length).toBe(5);
    expect(shape.nodes.every((n) => !n.ix && !n.iy && !n.ox && !n.oy)).toBe(true);
  });

  it("turns a round blob into a few smooth points that still fit it", () => {
    const [shape] = traceShapes(picture(120, 120, (x, y) => (Math.hypot(x + 0.5 - 60, y + 0.5 - 60) < 40 ? green : white)), 120, 120);
    expect(shape.nodes.length).toBeLessThan(40);
    expect(shape.nodes.some((n) => n.ox || n.oy)).toBe(true);
    const box = drawnBox(shape.nodes, true);
    for (const v of [box.x, box.y]) expect(Math.abs(v - 20)).toBeLessThan(2);
    for (const v of [box.width, box.height]) expect(Math.abs(v - 80)).toBeLessThan(3);
    // every spot on the traced outline is close to the real circle
    for (const p of flatten(shape.nodes, true, 8)) expect(Math.abs(Math.hypot(p.x - 60, p.y - 60) - 40)).toBeLessThan(2.5);
  });

  it("makes one shape for each separate part, biggest first, and drops specks", () => {
    const shapes = traceShapes(
      picture(100, 60, (x, y) => (x >= 5 && x < 45 && y >= 10 && y < 50 ? green : x >= 60 && x < 80 && y >= 20 && y < 40 ? [200, 60, 60] : x === 95 && y === 5 ? green : white)),
      100,
      60,
    );
    expect(shapes.length).toBe(2);
    expect(shapes[0].area).toBe(1600);
    expect(shapes[1].color).toBe("#c83c3c");
  });

  it("uses see-through parts when the picture has them, and the edge colour when it does not", () => {
    const cut = foreground(picture(20, 20, (x) => (x < 10 ? white : null)), 20, 20);
    expect(cut[0]).toBe(1);
    expect(cut[19]).toBe(0);
    const plain = foreground(picture(20, 20, (x, y) => (x > 5 && x < 15 && y > 5 && y < 15 ? green : white)), 20, 20);
    expect(plain[0]).toBe(0);
    expect(plain[10 * 20 + 10]).toBe(1);
  });

  it("says plainly when a picture is not one it can trace", () => {
    const busy = picture(40, 40, (x, y) => ((x * 7 + y * 13) % 5 < 2 ? [20, 20, 20] : [240, 200, 40]));
    expect(() => traceShapes(busy, 40, 40)).toThrow(TraceError);
    expect(() => traceShapes(busy, 40, 40)).toThrow(/busy background/);
    expect(() => traceShapes(picture(30, 30, () => white), 30, 30)).toThrow(/nothing in this picture/);
  });
});

import { canBeComponent, isLooseCopy } from "../document/components";

describe("a single thing as a component", () => {
  // a picture made into a component, and one copy of it placed beside it
  const scene = () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "pic", type: "image", x: 0, y: 0, width: 300, height: 200, props: { src: "assets/abc.png", name: "Logo", shadow: { x: 0, y: 4, blur: 8, color: "#00000040" } } });
    d = runCommand(d, "create_component", { id: "pic" });
    return runCommand(d, "create_instance", { componentId: "pic", id: "copy", x: 400, y: 0 });
  };

  it("can be made from a picture, a shape or text, but not from a copy", () => {
    const d = scene();
    expect(d.elements.pic.component).toBe(true);
    expect(canBeComponent(d.elements.copy)).toBe(false);
    expect(canBeComponent(d.elements["copy::pic"])).toBe(false);
    const t = runCommand(emptyDoc(), "create_element", { id: "t", type: "text", x: 0, y: 0, width: 10, height: 10 });
    expect(runCommand(t, "create_component", { id: "t" }).elements.t.component).toBe(true);
  });

  it("shows the real thing in every copy, not an empty box", () => {
    const d = scene();
    const copy = d.elements.copy;
    expect(copy.childIds).toEqual(["copy::pic"]);
    const inside = d.elements["copy::pic"];
    expect(inside).toMatchObject({ type: "image", src: "assets/abc.png", x: 0, y: 0, width: 300, height: 200, component: false });
    // the copy itself is a clear box: the look, shadow and all, belongs to the picture inside
    expect(copy).toMatchObject({ fill: "#00000000", stroke: null, shadow: null });
    expect(inside.shadow).toEqual({ x: 0, y: 4, blur: 8, color: "#00000040" });
    expect(isLooseCopy(d, copy)).toBe(true);
    expect(hitTest(d, 500, 100)).toBe("copy");
  });

  it("sizes the thing inside when the copy is sized, and follows the original", () => {
    let d = runCommand(scene(), "resize_element", { id: "copy", x: 400, y: 0, width: 150, height: 100 });
    expect(d.elements["copy::pic"]).toMatchObject({ width: 150, height: 100 });
    d = runCommand(d, "set_props", { ids: ["pic"], props: { src: "assets/new.png", radius: 12 } });
    expect(d.elements["copy::pic"]).toMatchObject({ src: "assets/new.png", radius: 12, width: 150, height: 100 });
  });

  it("keeps a change made on one copy", () => {
    let d = runCommand(scene(), "set_props", { ids: ["copy::pic"], props: { opacity: 0.5 } });
    d = runCommand(d, "set_props", { ids: ["pic"], props: { radius: 8 } });
    expect(d.elements["copy::pic"]).toMatchObject({ opacity: 0.5, radius: 8 });
    expect(d.elements.pic.opacity).toBe(1);
  });

  it("is saved without its inside, and comes back the same", () => {
    const d = scene();
    const text = serializeDoc(d);
    expect(text).not.toContain("copy::pic");
    expect(parseDoc(text).elements["copy::pic"]).toMatchObject({ type: "image", src: "assets/abc.png" });
  });

  it("mends copies that were saved as empty boxes by an older version", () => {
    // how an older Duet wrote a copy of a picture: a grey box with nothing inside
    const old = JSON.parse(serializeDoc(scene()));
    Object.assign(old.elements.copy, { fill: "#d9d9de", shadow: { x: 0, y: 4, blur: 8, color: "#00000040" } });
    const d = parseDoc(JSON.stringify(old));
    expect(d.elements.copy.fill).toBe("#00000000");
    expect(d.elements["copy::pic"].type).toBe("image");
  });

  it("turns back into the thing itself when detached, or when the original is deleted", () => {
    const a = runCommand(scene(), "detach_instance", { id: "copy" });
    expect(a.elements.copy).toMatchObject({ type: "image", src: "assets/abc.png", x: 400, y: 0, component: false, childIds: [] });
    expect(a.elements["copy::pic"]).toBeUndefined();
    const b = runCommand(scene(), "delete_elements", { ids: ["pic"] });
    expect(b.elements.copy).toMatchObject({ type: "image", src: "assets/abc.png", x: 400 });
  });

  it("is exported as the picture, with no box drawn around it", () => {
    const svg = toSvg(runCommand(scene(), "create_element", { id: "f", type: "frame", x: 0, y: 300, width: 10, height: 10 }), "copy");
    expect(svg).not.toContain("<rect x=\"0\" y=\"0\" width=\"300\" height=\"200\" fill");
  });

  it("lets the AI make a component, but only from something that is not a copy", async () => {
    resetStore();
    setMode("auto");
    dispatch("create_element", { id: "pic", type: "image", x: 0, y: 0, width: 300, height: 200, props: { src: "assets/abc.png" } });
    expect((await callTool("set_props", { ids: ["pic"], props: { component: true } })).isError).toBeFalsy();
    const placed = await callTool("create_instance", { componentId: "pic", x: 400, y: 0 });
    expect(placed.isError).toBeFalsy();
    const copy = Object.values(currentDoc().elements).find((e) => e.type === "instance")!;
    expect(currentDoc().elements[`${copy.id}::pic`].type).toBe("image");
    expect((await callTool("set_props", { ids: [copy.id], props: { component: true } })).text).toContain("copy of a component");
    expect((await callTool("set_props", { ids: ["pic"], props: { componentId: "x", overrides: { a: {} } } })).isError).toBeFalsy();
    expect(currentDoc().elements.pic.componentId).toBe("");
  });
});

import { addMsg, askDesigner, forgetSteps, messagesOf, moveConversationTo, setRunning, setSessionId, showConversationFor, tookLine, updateMsg } from "../ai/chat";

describe("a conversation for each project", () => {
  const picture = { name: "ref.png", data: "", mime: "image/png", width: 10, height: 10, thumb: "" };
  const texts = () => getChat().messages.map((m) => m.text);

  it("puts the conversation away and brings it back with its project", () => {
    showConversationFor("/a.duet", true);
    addMsg({ role: "you", text: "make it blue" });
    setSessionId("session-a");

    showConversationFor("/b.duet", true);
    expect(texts()).toEqual([]);
    expect(getChat().sessionId).toBeNull();
    addMsg({ role: "you", text: "add a title" });
    setSessionId("session-b");

    showConversationFor("/a.duet");
    expect(texts()).toEqual(["make it blue"]);
    expect(getChat().sessionId).toBe("session-a");

    showConversationFor("/b.duet");
    expect(texts()).toEqual(["add a title"]);
    expect(getChat().sessionId).toBe("session-b");
  });

  it("opening the same project again changes nothing", () => {
    showConversationFor("/a.duet", true);
    addMsg({ role: "you", text: "hello" });
    showConversationFor("/a.duet");
    expect(texts()).toEqual(["hello"]);
  });

  it("a brand new project starts empty, even over a file used before", () => {
    showConversationFor("/a.duet", true);
    addMsg({ role: "you", text: "old words" });
    showConversationFor("/b.duet", true);
    showConversationFor("/a.duet", true);
    expect(texts()).toEqual([]);
  });

  it("leaves waiting pictures behind and keeps the ones already sent", () => {
    showConversationFor("/a.duet", true);
    addPictures([picture]);
    sendPictures();
    addPictures([picture]);
    showConversationFor("/b.duet", true);
    expect(getChat().pictures).toEqual([]);
    showConversationFor("/a.duet");
    expect(getChat().pictures.map((p) => p.sent)).toEqual([true]);
  });

  it("declines a waiting question and drops the working line, and keeps Undo until the project is closed", async () => {
    showConversationFor("/a.duet", true);
    const answer = askDesigner("Delete the header?");
    addMsg({ role: "note", text: "Moved the logo", undoStep: 4 });
    addMsg({ role: "working", text: "Thinking..." });
    showConversationFor("/b.duet", true);
    expect(await answer).toBe(false);
    showConversationFor("/a.duet");
    expect(getChat().messages.some((m) => m.role === "working")).toBe(false);
    // the project waited in its tab with its history, so Undo still points at the right step
    expect(getChat().messages.find((m) => m.text === "Moved the logo")?.undoStep).toBe(4);
    expect(getChat().running).toBe(false);
    showConversationFor("/b.duet");
    forgetSteps("/a.duet");
    showConversationFor("/a.duet");
    expect(getChat().messages.every((m) => m.undoStep === undefined)).toBe(true);
  });

  it("an AI at work in a project off screen writes to that project's conversation", () => {
    showConversationFor("/a.duet", true);
    setRunning(true);
    const working = addMsg({ role: "working", text: "Thinking..." }, "/a.duet");
    showConversationFor("/b.duet", true);
    expect(getChat().running).toBe(false);
    expect(getChat().busy).toBe("/a.duet");
    addMsg({ role: "duet", text: "Done in a" }, "/a.duet");
    updateMsg(working, { text: "Still thinking" }, "/a.duet");
    expect(texts()).toEqual([]);
    expect(messagesOf("/a.duet").map((m) => m.text)).toEqual(["Still thinking", "Done in a"]);
    showConversationFor("/a.duet");
    expect(getChat().running).toBe(true);
    expect(texts()).toEqual(["Still thinking", "Done in a"]);
    setRunning(false);
    expect(getChat().busy).toBe(null);
  });

  it("Save As takes the conversation to the new file", () => {
    showConversationFor("/a.duet", true);
    addMsg({ role: "you", text: "keep me" });
    moveConversationTo("/copy.duet");
    showConversationFor("/b.duet", true);
    showConversationFor("/copy.duet");
    expect(texts()).toEqual(["keep me"]);
    showConversationFor("/a.duet");
    expect(texts()).toEqual([]);
  });
});

import { brief, carryOn, keepable, packThread, readThread, RESUME_MESSAGES, RESUME_WITHIN, THREAD_LIMIT } from "../memory/thread";
import { dropSession, restoreConversation, sessionUsed } from "../ai/chat";

describe("the thread a project keeps", () => {
  it("keeps what was said and leaves passing things out", () => {
    const kept = keepable(
      [
        { role: "you", text: "make it blue", time: 5, pictures: [2] },
        { role: "working", text: "Thinking..." },
        { role: "note", text: "", approval: { summary: "Delete the header", status: "waiting" } },
        { role: "note", text: "Changed the fill", undone: true },
      ],
      9,
    );
    expect(kept.map((m) => m.role)).toEqual(["you", "note", "note"]);
    expect(kept[0]).toEqual({ role: "you", text: "make it blue", time: 5, pictures: [2] });
    // a question nobody answered counts as a no
    expect(kept[1].approval?.status).toBe("declined");
    expect(kept[1].time).toBe(9);
    expect(kept[2].undone).toBe(true);
  });

  it("survives being written and read back", () => {
    const now = keepable([{ role: "you", text: "hello", time: 1 }, { role: "duet", text: "hi", time: 2 }]);
    const earlier = keepable([{ role: "you", text: "before", time: 0 }, { role: "break", text: "", time: 0 }]);
    expect(readThread(packThread({ now, earlier }))).toEqual({ now, earlier });
  });

  it("keeps who spoke and the names the AIs go by", () => {
    const now = keepable([{ role: "duet", text: "hi", time: 2, by: "Claude Code" }]);
    expect(now[0].by).toBe("Claude Code");
    const names = { "Claude Code": "Juniper" };
    expect(readThread(packThread({ now, earlier: [], names }))).toEqual({ now, earlier: [], names });
  });

  it("treats a missing or damaged file as an empty thread", () => {
    expect(readThread(null)).toEqual({ now: [], earlier: [] });
    expect(readThread("not json")).toEqual({ now: [], earlier: [] });
    expect(readThread(JSON.stringify({ now: [{ role: "you" }, 7, { role: "you", text: "ok" }] })).now.map((m) => m.text)).toEqual(["ok"]);
  });

  it("stays small: old things are let go, earlier conversations first", () => {
    const many = (n: number, text: string) => keepable(Array.from({ length: n }, (_, i) => ({ role: "you", text: `${text} ${i}`, time: i })));
    const back = readThread(packThread({ now: many(THREAD_LIMIT - 10, "now"), earlier: many(50, "old") }));
    expect(back.now).toHaveLength(THREAD_LIMIT - 10);
    expect(back.earlier.map((m) => m.text)).toEqual(Array.from({ length: 10 }, (_, i) => `old ${40 + i}`));
    expect(keepable([{ role: "you", text: "x".repeat(9000) }])[0].text.length).toBe(4000);
  });
});

describe("the note for an AI that starts fresh", () => {
  it("says nothing when nothing was said", () => {
    expect(brief([])).toBe("");
    expect(brief(keepable([{ role: "error", text: "Something went wrong" }]))).toBe("");
  });

  it("tells what was asked, answered and changed, in order", () => {
    const note = brief(
      keepable([
        { role: "you", text: "make the header blue", pictures: [3] },
        { role: "note", text: "Changed the fill of Header" },
        { role: "note", text: "Rounded the corners of Header", undone: true },
        { role: "duet", text: "Done. The header is blue now." },
        { role: "note", text: "", approval: { summary: "Delete the footer", status: "declined" } },
        { role: "duet", text: "", proposal: { tool: "set_props", args: {}, summary: "Make the title bigger", status: "dismissed" } },
      ]),
    );
    const lines = note.split("\n");
    expect(lines[3]).toBe("- The designer said: make the header blue (with picture number 3, which may no longer be kept)");
    expect(lines[4]).toBe("- You changed: Changed the fill of Header; Rounded the corners of Header (the designer took this back)");
    expect(lines[5]).toBe("- You said: Done. The header is blue now.");
    expect(lines[6]).toBe("- You asked to: Delete the footer (the designer said no)");
    expect(lines[7]).toBe("- You suggested: Make the title bigger (the designer dismissed it)");
  });

  it("keeps the latest few of what the AI said and did, and has a ceiling however long the conversation is", () => {
    const long = keepable(Array.from({ length: 300 }, (_, i) => ({ role: i % 2 ? "duet" : "you", text: `${"word ".repeat(200)}${i}` })));
    const note = brief(long);
    expect(note.split("\n").filter((l) => l.startsWith("- You said:"))).toHaveLength(6);
    expect(note.length).toBeLessThan(50000);
    expect(note).toContain("the latest part of the rest:");
  });

  it("keeps what the designer said word for word, from the start, so their rules are not lost", () => {
    const rule = `Never use outlines. ${"Far trees are smaller and darker. ".repeat(40)}Hide every tree bottom.`;
    const said = keepable([
      { role: "you", text: rule },
      ...Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "duet" : "note", text: `step ${i}` })),
      { role: "you", text: "ok" },
    ]);
    const note = brief(said);
    expect(note).toContain(`- The designer said: ${rule}`);
    expect(note).toContain("- The designer said: ok");
    expect(note).not.toContain("You said: step 1\n");
  });

  it("keeps how each AI turn went, and says it in plain words", () => {
    const [kept] = keepable([{ role: "duet", text: "Done", took: { tool: "Antigravity", model: "Gemini 3 Pro (High)", ms: 191000, changes: 12 } }]);
    expect(readThread(packThread({ now: [kept], earlier: [] })).now[0].took).toEqual({ tool: "Antigravity", model: "Gemini 3 Pro (High)", ms: 191000, changes: 12 });
    expect(tookLine(kept.took!)).toBe("Antigravity, Gemini 3 Pro (High), took 3 min, made 12 changes");
    expect(tookLine({ tool: "Claude Code", ms: 9000, changes: 1 })).toBe("Claude Code, took 9 s, made 1 change");
  });

  it("carries the AI tool's own session on only for a short, recent back and forth", () => {
    const t = 1_000_000;
    expect(carryOn({ sessionId: null, used: t, messages: 1 }, t)).toBe(false);
    expect(carryOn({ sessionId: "s", used: t, messages: 1 }, t + 1000)).toBe(true);
    expect(carryOn({ sessionId: "s", used: t, messages: 1 }, t + RESUME_WITHIN)).toBe(false);
    expect(carryOn({ sessionId: "s", used: t, messages: RESUME_MESSAGES }, t + 1000)).toBe(false);
  });
});

describe("a conversation that comes back with its project", () => {
  it("is put back when Duet has nothing of its own, and the AI starts fresh", () => {
    showConversationFor("/saved.duet", true);
    restoreConversation([{ role: "you", text: "from yesterday", time: 1, pictures: [41] }], [{ role: "you", text: "older", time: 0 }]);
    expect(getChat().messages.map((m) => m.text)).toEqual(["from yesterday"]);
    expect(getChat().earlier.map((m) => m.text)).toEqual(["older"]);
    expect(getChat().sessionId).toBeNull();
    // a new picture never takes the number of one that is gone
    addPictures([{ name: "new.png", data: "", mime: "image/png", width: 1, height: 1, thumb: "" }]);
    expect(getChat().pictures[getChat().pictures.length - 1].n).toBeGreaterThan(41);
  });

  it("never replaces a conversation that is already there", () => {
    showConversationFor("/busy.duet", true);
    addMsg({ role: "you", text: "today" });
    restoreConversation([{ role: "you", text: "from the file", time: 1 }], []);
    expect(getChat().messages.map((m) => m.text)).toEqual(["today"]);
  });

  it("a fresh conversation puts the old one away instead of losing it", () => {
    showConversationFor("/fresh.duet", true);
    addMsg({ role: "you", text: "first idea" });
    setSessionId("s1");
    sessionUsed(true);
    newConversation();
    expect(getChat().messages).toEqual([]);
    expect(getChat().earlier.map((m) => m.role)).toEqual(["you", "break"]);
    expect(getChat().sessionId).toBeNull();
    expect(getChat().sessionMessages).toBe(0);
    dropSession();
  });
});

describe("send a copy", () => {
  it("lists the pictures a design uses, each one once, and nothing else", () => {
    let doc = emptyDoc();
    doc = runCommand(doc, "create_element", { id: "a", type: "image", x: 0, y: 0, width: 10, height: 10 });
    doc = runCommand(doc, "set_props", { ids: ["a"], props: { src: "assets/one.png" } });
    doc = runCommand(doc, "create_element", { id: "b", type: "image", x: 0, y: 0, width: 10, height: 10 });
    doc = runCommand(doc, "set_props", { ids: ["b"], props: { src: "assets/one.png" } });
    doc = runCommand(doc, "create_element", { id: "c", type: "image", x: 0, y: 0, width: 10, height: 10 });
    doc = runCommand(doc, "set_props", { ids: ["c"], props: { src: "assets/two.jpg" } });
    doc = runCommand(doc, "create_element", { id: "d", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    expect(picturesIn(doc).sort()).toEqual(["assets/one.png", "assets/two.jpg"]);
    // a picture that was deleted is no longer named, so a copy does not carry it
    expect(picturesIn(runCommand(doc, "delete_elements", { ids: ["c"] }))).toEqual(["assets/one.png"]);
    expect(picturesIn(emptyDoc())).toEqual([]);
  });

  it("names the copy after the project, in the same folder", () => {
    expect(copyNameFor("/Users/me/Documents/Duet/Burger Barn.duet")).toBe("/Users/me/Documents/Duet/Burger Barn copy.duet");
    expect(copyNameFor("C:\\work\\Menu.DUET")).toBe("C:\\work\\Menu copy.duet");
  });

  it("says plainly what the copy leaves out", () => {
    expect(leftOut(false, false)).toBe("This copy leaves out the earlier steps, your versions and your conversation with the AI.");
    expect(leftOut(true, false)).toContain("leaves out your conversation");
    expect(leftOut(false, true)).toContain("leaves out the earlier steps");
    expect(leftOut(true, true)).not.toContain("leaves out");
  });
});

describe("words tied to steps", () => {
  it("gives every new step a name of its own", () => {
    resetStore();
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    dispatch("create_element", { id: "b", type: "rect", x: 0, y: 0, width: 10, height: 10 }, "ai");
    const [, one, two] = getState().timeline;
    expect(one.step).toMatch(/^[0-9a-f]{12}$/);
    expect(two.step).not.toBe(one.step);
    expect(newStepId()).not.toBe(newStepId());
  });

  it("keeps the names with the saved step, the step's own name last", () => {
    expect(stepMessage({ label: "Move logo", actor: "ai" }, false, ["aaaaaa", "bbbbbb"])).toBe("Move logo\n\nActor: ai\nSteps: aaaaaa bbbbbb");
    // a step with no name is saved the way it always was
    expect(stepMessage({ label: "Move logo", actor: "you" }, true)).toBe("Went back to: Move logo\n\nActor: you");
    expect(stepMessage({ label: "Move logo", actor: "you", from: "aaaaaa" }, false, ["bbbbbb"])).toBe("Move logo\n\nActor: you\nSteps: bbbbbb\nFrom: aaaaaa");
    // nothing but a plain name ever gets into the line
    expect(stepsLine(["aaaaaa", "Actor: ai", "bb\nbb", "aaaaaa"])).toBe("Steps: aaaaaa");
  });

  it("saves quick steps together, and only the ones no saved step holds yet", () => {
    const timeline = [{}, { step: "aaaaaa" }, { step: "bbbbbb" }, { step: "cccccc" }];
    expect(stepsToKeep(timeline, 3, new Set(["aaaaaa"]))).toEqual(["bbbbbb", "cccccc"]);
    // gone back one: the step ahead is not part of what is being saved
    expect(stepsToKeep(timeline, 2, new Set())).toEqual(["aaaaaa", "bbbbbb"]);
    expect(stepsToKeep(timeline, 3, new Set(["aaaaaa", "bbbbbb", "cccccc"]))).toEqual([]);
  });

  it("finds a step by its name, or by the saved step that holds it, and nothing otherwise", () => {
    const timeline = [{}, { step: "cccccc", covers: ["aaaaaa", "bbbbbb"] }, { step: "dddddd" }];
    expect(findStep(timeline, "dddddd")).toBe(2);
    expect(findStep(timeline, "aaaaaa")).toBe(1);
    expect(findStep(timeline, "eeeeee")).toBe(-1);
    expect(findStep(timeline, undefined)).toBe(-1);
  });

  it("shows the words behind a step, and stays quiet when there are none", () => {
    const said = [
      { role: "you", text: "make the headline bigger" },
      { role: "duet", text: "On it." },
      { role: "note", text: "Changed the size", step: "aaaaaa" },
      { role: "break", text: "" },
      { role: "note", text: "Moved it", step: "bbbbbb" },
    ];
    expect(wordsBehind(said, { step: "aaaaaa" })).toBe("make the headline bigger");
    expect(wordsBehind(said, { step: "zzzzzz", covers: ["aaaaaa"] })).toBe("make the headline bigger");
    // a step you made yourself, and one whose request is in another conversation
    expect(wordsBehind(said, { step: "cccccc" })).toBeNull();
    expect(wordsBehind(said, { step: "bbbbbb" })).toBeNull();
    expect(wordsBehind(said, {})).toBeNull();
  });

  it("keeps the step with a message when the conversation is saved and read back", () => {
    const kept = keepable([{ role: "note", text: "Changed the size", time: 1, step: "aaaaaa" }]);
    expect(readThread(packThread({ now: kept, earlier: [] })).now[0].step).toBe("aaaaaa");
  });

  it("an AI change remembers its step, and still does after the project is put away and brought back", () => {
    resetStore();
    showConversationFor("/steps.duet", true);
    dispatch("create_element", { id: "a", type: "rect", x: 0, y: 0, width: 10, height: 10 }, "ai");
    const step = getState().timeline[getState().cursor].step;
    addMsg({ role: "note", text: "Made a box", undoStep: getState().cursor, step });
    showConversationFor("/other.duet");
    showConversationFor("/steps.duet");
    const back = getChat().messages[0];
    expect(back.undoStep).toBe(getState().cursor);
    expect(back.step).toBe(step);
    expect(findStep(getState().timeline, back.step)).toBe(1);
  });
});

describe("what the AI writes in the chat", () => {
  it("shows bold and code instead of the marks around them", () => {
    expect(richParts("- **Order:** prices use `set_props` now")).toEqual([
      { kind: "plain", text: "• " },
      { kind: "bold", text: "Order:" },
      { kind: "plain", text: " prices use " },
      { kind: "code", text: "set_props" },
      { kind: "plain", text: " now" },
    ]);
  });

  it("leaves marks alone when nothing closes them, and plain text as it is", () => {
    expect(richParts("2 ** 3 is 8")).toEqual([{ kind: "plain", text: "2 ** 3 is 8" }]);
    expect(richParts("Moved it 12 - 4 px\n- done")).toEqual([{ kind: "plain", text: "Moved it 12 - 4 px\n• done" }]);
    expect(richParts("")).toEqual([]);
  });
});

describe("create_elements", () => {
  it("builds a frame with its children as one command", () => {
    const base = emptyDoc();
    const doc = runCommand(base, "create_elements", {
      items: [
        { id: "f1", type: "frame", x: 0, y: 0, width: 300, height: 400 },
        { id: "r1", type: "rect", x: 10, y: 10, width: 50, height: 50, parentId: "f1" },
        { id: "t1", type: "text", x: 10, y: 80, width: 100, height: 20, parentId: "f1", props: { text: "Hi" } },
      ],
    });
    expect(doc.rootIds).toEqual(["f1"]);
    expect(doc.elements.f1.childIds.sort()).toEqual(["r1", "t1"]);
    expect(doc.elements.t1.text).toBe("Hi");
    expect(base.rootIds).toEqual([]);
  });

  it("is one step in history", () => {
    resetStore();
    const before = getState().timeline.length;
    dispatch("create_elements", {
      items: [
        { id: "f1", type: "frame", x: 0, y: 0, width: 300, height: 400 },
        { id: "r1", type: "rect", x: 0, y: 0, width: 10, height: 10, parentId: "f1" },
      ],
    });
    expect(getState().timeline.length).toBe(before + 1);
  });

  it("keeps the order the AI lists things in, even when they start at the same spot", () => {
    const row = defaultLayout();
    const doc = runCommand(emptyDoc(), "create_elements", {
      items: [
        { id: "row", type: "frame", x: 0, y: 0, width: 400, height: 100, props: { layout: { ...row, dir: "row" } } },
        { id: "first", type: "rect", x: 0, y: 0, width: 80, height: 20, parentId: "row", keepOrder: true },
        { id: "second", type: "rect", x: 0, y: 0, width: 60, height: 20, parentId: "row", keepOrder: true },
      ],
    });
    expect(doc.elements.row.childIds).toEqual(["first", "second"]);
  });

  it("still sorts by where a thing is dropped when it is not told to keep the order", () => {
    const row = defaultLayout();
    const doc = runCommand(emptyDoc(), "create_elements", {
      items: [
        { id: "row", type: "frame", x: 0, y: 0, width: 400, height: 100, props: { layout: { ...row, dir: "row" } } },
        { id: "right", type: "rect", x: 300, y: 0, width: 40, height: 20, parentId: "row" },
        { id: "left", type: "rect", x: 0, y: 0, width: 40, height: 20, parentId: "row" },
      ],
    });
    expect(doc.elements.row.childIds).toEqual(["left", "right"]);
  });

  it("starts clear when a wrapper frame inside an auto layout frame has no fill", () => {
    const doc = runCommand(emptyDoc(), "create_elements", {
      items: [
        { id: "parent", type: "frame", x: 0, y: 0, width: 400, height: 400, props: { layout: defaultLayout() } },
        { id: "child", type: "frame", x: 0, y: 0, width: 100, height: 100, parentId: "parent" },
      ],
    });
    expect(doc.elements.child.fill).toBe("#ffffff00");
  });

  it("keeps explicit fill when a frame inside an auto layout frame has fill", () => {
    const doc = runCommand(emptyDoc(), "create_elements", {
      items: [
        { id: "parent", type: "frame", x: 0, y: 0, width: 400, height: 400, props: { layout: defaultLayout() } },
        { id: "child", type: "frame", x: 0, y: 0, width: 100, height: 100, parentId: "parent", props: { fill: "#112233" } },
      ],
    });
    expect(doc.elements.child.fill).toBe("#112233");
  });

  it("starts white when a top-level frame has no fill", () => {
    const doc = runCommand(emptyDoc(), "create_elements", {
      items: [{ id: "top", type: "frame", x: 0, y: 0, width: 400, height: 400 }],
    });
    expect(doc.elements.top.fill).toBe("#ffffff");
  });

  it("starts white when a frame inside a non-layout frame has no fill", () => {
    const doc = runCommand(emptyDoc(), "create_elements", {
      items: [
        { id: "parent", type: "frame", x: 0, y: 0, width: 400, height: 400 },
        { id: "child", type: "frame", x: 0, y: 0, width: 100, height: 100, parentId: "parent" },
      ],
    });
    expect(doc.elements.child.fill).toBe("#ffffff");
  });

  it("starts clear when created inside an auto layout frame via create_element", () => {
    let doc = runCommand(emptyDoc(), "create_element", { id: "parent", type: "frame", x: 0, y: 0, width: 400, height: 400, props: { layout: defaultLayout() } });
    doc = runCommand(doc, "create_element", { id: "child", type: "frame", x: 0, y: 0, width: 100, height: 100, parentId: "parent" });
    expect(doc.elements.child.fill).toBe("#ffffff00");
  });
});

import { isParked, liveRoom, onParkedChange, parkLive, resetStoreKeepingParked, roomFor, select as selectIds, setProject, unpark } from "../state/store";

describe("projects open in tabs", () => {
  const box = (id: string) => ({ id, type: "rect" as const, x: 0, y: 0, width: 10, height: 10 });

  it("a project put away in its tab comes back with its history, selection and place", () => {
    resetStore();
    setProject({ path: "/w/a", file: "/a.duet", name: "a" });
    dispatch("create_element", box("a1"));
    selectIds(["a1"]);
    expect(parkLive()).toBe(true);
    resetStoreKeepingParked();
    setProject({ path: "/w/b", file: "/b.duet", name: "b" });
    dispatch("create_element", box("b1"));
    expect(unpark("/a.duet")).toBe(true);
    expect(isParked("/a.duet")).toBe(false);
    expect(getState().project.file).toBe("/a.duet");
    expect(currentDoc().elements.a1).toBeTruthy();
    expect(currentDoc().elements.b1).toBeUndefined();
    expect(getState().selection).toEqual(["a1"]);
    undo();
    expect(currentDoc().elements.a1).toBeUndefined();
  });

  it("an AI changes its own project while another is on screen, and only that one", () => {
    resetStore();
    setProject({ path: "/w/a", file: "/a.duet", name: "a" });
    parkLive();
    resetStoreKeepingParked();
    setProject({ path: "/w/b", file: "/b.duet", name: "b" });
    const changed: string[] = [];
    const stop = onParkedChange((f) => changed.push(f));
    const a = roomFor("/a.duet");
    expect(a?.live).toBe(false);
    a?.dispatch("create_element", box("from-ai"), "ai", "Antigravity (outside)");
    stop();
    expect(a?.currentDoc().elements["from-ai"]).toBeTruthy();
    expect(currentDoc().elements["from-ai"]).toBeUndefined();
    expect(getState().timeline).toHaveLength(1);
    expect(changed).toEqual(["/a.duet"]);
    expect(a?.getState().timeline.slice(-1)[0]?.by).toBe("Antigravity (outside)");
    expect(roomFor("/b.duet")).toBe(liveRoom);
    expect(roomFor("/gone.duet")).toBeNull();
  });

  it("unsaved work has no tab to wait in", () => {
    resetStore();
    expect(parkLive()).toBe(false);
  });
});

import { addMsg as addTaskMsg, getChat as chatNow, messagesOf as taskMessages, nameTask, newTask, removeTask, restoreTasks, setTaskRunning, showThread } from "../ai/chat";

describe("tasks: side conversations with one AI", () => {
  it("keep their own messages, apart from the main chat", () => {
    showConversationFor("/tasks.duet", true);
    const key = newTask("claude");
    expect(chatNow().thread).toBe(key);
    addTaskMsg({ role: "you", text: "make three logos" }, key);
    expect(taskMessages(key).map((m) => m.text)).toEqual(["make three logos"]);
    expect(chatNow().messages).toHaveLength(0);
    removeTask(key);
    expect(chatNow().thread).toBe(null);
  });

  it("are named after the first thing said, and the name stays", () => {
    showConversationFor("/tasks.duet", true);
    const key = newTask("agy");
    nameTask(key, "tidy   the spacing on the home page please");
    nameTask(key, "something else");
    expect(chatNow().tasks.find((t) => t.key === key)?.title).toBe("tidy the spacing on the");
    removeTask(key);
  });

  it("are marked done when they finish out of sight, and the mark goes once looked at", () => {
    showConversationFor("/tasks.duet", true);
    const key = newTask("claude");
    setTaskRunning(key, true);
    showThread(null);
    setTaskRunning(key, false);
    expect(chatNow().tasks.find((t) => t.key === key)?.done).toBe(true);
    showThread(key);
    expect(chatNow().tasks.find((t) => t.key === key)?.done).toBe(false);
    removeTask(key);
  });

  it("go away from view when another project opens, and come back with it", () => {
    showConversationFor("/one.duet", true);
    const key = newTask("claude");
    showConversationFor("/two.duet", true);
    expect(chatNow().thread).toBe(null);
    expect(chatNow().tasks.find((t) => t.key === key)?.project).toBe("/one.duet");
    removeTask(key);
  });

  it("come back from the project file, unless Duet already has its own", () => {
    restoreTasks("/saved-tasks.duet", [{ agent: "claude", title: "Logo ideas", messages: [{ role: "you", text: "logos", time: 1 }] }]);
    restoreTasks("/saved-tasks.duet", [{ agent: "agy", title: "Twice", messages: [] }]);
    const mine = chatNow().tasks.filter((t) => t.project === "/saved-tasks.duet");
    expect(mine.map((t) => t.title)).toEqual(["Logo ideas"]);
    for (const t of mine) removeTask(t.key);
  });
});

describe("tasks in the project file", () => {
  it("survive being written and read back, and old files still read", () => {
    const said = keepable([{ role: "you", text: "logos", time: 1 }]);
    const thread = { now: [], earlier: [], tasks: [{ agent: "claude", title: "Logo ideas", said }] };
    expect(readThread(packThread(thread))).toEqual(thread);
    expect(readThread(packThread({ now: [], earlier: [] }))).toEqual({ now: [], earlier: [] });
    expect(readThread(JSON.stringify({ now: [], earlier: [], tasks: [{ title: "no agent" }, 3] }))).toEqual({ now: [], earlier: [] });
  });
});

describe("shape keys: an outline that changes over time", () => {
  const pt = (x: number, y: number) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 });
  const square = (x0: number, y0: number, s: number) => [pt(x0, y0), pt(x0 + s, y0), pt(x0 + s, y0 + s), pt(x0, y0 + s)];
  const shape = () => {
    const box = fromAbs(square(10, 10, 40));
    let d = runCommand(frame("f"), "set_props", { ids: ["f"], props: { duration: 4 } });
    d = runCommand(d, "create_element", { id: "p", type: "path", parentId: "f", x: box.x, y: box.y, width: box.width, height: box.height, props: { nodes: box.nodes, closed: true } });
    return d;
  };
  const keyed = () => {
    let d = runCommand(shape(), "set_shape_key", { id: "p", t: 0 });
    return runCommand(d, "set_shape_key", { id: "p", t: 2, points: square(30, 10, 40), ease: "linear" });
  };

  it("is halfway between two keys at the middle", () => {
    const at = docAt(keyed(), "f", 1).elements.p;
    expect([at.x, at.y, at.width, at.height]).toEqual([20, 10, 40, 40]);
    const start = docAt(keyed(), "f", 0).elements.p;
    expect(start.x).toBe(10);
    expect(docAt(keyed(), "f", 3).elements.p.x).toBe(30);
  });

  it("makes two keys the first time, one for what was and one for now", () => {
    const d = runCommand(shape(), "set_shape_key", { id: "p", t: 2, points: square(30, 10, 40) });
    expect(d.elements.p.shapeKeys.map((k) => k.t)).toEqual([0, 2]);
    expect(shape().elements.p.shapeKeys).toEqual([]);
  });

  it("holds the earlier outline when the point counts differ", () => {
    const d = runCommand(shape(), "set_shape_key", { id: "p", t: 0 });
    const more = runCommand(d, "set_shape_key", { id: "p", t: 2, points: [...square(30, 10, 40), pt(50, 30)] });
    expect(docAt(more, "f", 1).elements.p.nodes).toHaveLength(4);
    expect(docAt(more, "f", 2).elements.p.nodes).toHaveLength(5);
  });

  it("removes a key, and opens from an old file without any", () => {
    const d = runCommand(keyed(), "remove_shape_key", { id: "p", t: 2 });
    expect(d.elements.p.shapeKeys.map((k) => k.t)).toEqual([0]);
    const back = parseDoc(serializeDoc(keyed()));
    expect(back.elements.p.shapeKeys).toHaveLength(2);
    const old = JSON.parse(serializeDoc(shape()));
    expect(old.elements.p.shapeKeys).toBeUndefined();
    expect(parseDoc(JSON.stringify(old)).elements.p.shapeKeys).toEqual([]);
  });

  it("settles an edit made at a moment into a key there, and keeps the resting outline", () => {
    const real = keyed();
    const posed = docAt(real, "f", 1);
    const out = runCommand(posed, "set_shape_key", { id: "p", t: 1, points: square(20, 30, 40) });
    expect(out.elements.p.shapeKeys.map((k) => k.t)).toEqual([0, 1, 2]);
    // settle takes what was changed on the posed picture and writes it back to the real one
    const edited = { ...posed, elements: { ...posed.elements, p: { ...posed.elements.p, ...fromAbs(square(20, 30, 40)) } } };
    const done = settle(real, posed, edited, "f", 1);
    expect(done.elements.p.shapeKeys.map((k) => k.t)).toEqual([0, 1, 2]);
    expect(done.elements.p.x).toBe(real.elements.p.x);
  });
});

describe("roto by hand: editing a mask's points at a moment", () => {
  const pt = (x: number, y: number) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 });
  const scene = () => {
    const box = fromAbs([pt(10, 10), pt(50, 10), pt(50, 50), pt(10, 50)]);
    let d = runCommand(frame("f"), "set_props", { ids: ["f"], props: { duration: 4 } });
    d = runCommand(d, "create_element", { id: "pic", type: "image", parentId: "f", x: 0, y: 0, width: 100, height: 100 });
    d = runCommand(d, "create_element", { id: "p", type: "path", parentId: "f", x: box.x, y: box.y, width: box.width, height: box.height, props: { nodes: box.nodes, closed: true } });
    return runCommand(d, "make_mask", { maskId: "p", ids: ["pic"], groupId: "m" });
  };
  const edit = (real: ReturnType<typeof scene>, t: number, dx: number) => {
    const posed = docAt(real, "f", t);
    const shape = posed.elements.p;
    const moved = fromAbs(toAbs(shape, shape.x, shape.y).map((n) => ({ ...n, x: n.x + dx })));
    const out = { ...posed, elements: { ...posed.elements, p: { ...shape, ...moved } } };
    return settle(real, posed, out, "f", t);
  };

  it("keeps the old shape until the moment, and the new one at it", () => {
    const d = edit(scene(), 2, 20);
    expect(d.elements.p.shapeKeys.map((k) => k.t)).toEqual([0, 2]);
    expect(docAt(d, "f", 0).elements.p.x).toBe(scene().elements.p.x);
    expect(docAt(d, "f", 2).elements.p.x).toBe(scene().elements.p.x + 20);
    expect(docAt(d, "f", 1).elements.p.x).toBe(scene().elements.p.x + 10);
  });

  it("adds another key for a second edit, and an edit at the start only reshapes", () => {
    const d = edit(edit(scene(), 2, 20), 1, 0);
    expect(d.elements.p.shapeKeys.map((k) => k.t)).toEqual([0, 2]);
    const second = edit(edit(scene(), 2, 20), 3, -10);
    expect(second.elements.p.shapeKeys.map((k) => k.t)).toEqual([0, 2, 3]);
    const atStart = edit(scene(), 0, 5);
    expect(atStart.elements.p.shapeKeys).toEqual([]);
  });
});

describe("line up, space evenly, tidy up", () => {
  const three = () => {
    let d = emptyDoc();
    d = runCommand(d, "create_element", { id: "a", type: "rect", x: 0, y: 10, width: 20, height: 20 });
    d = runCommand(d, "create_element", { id: "b", type: "rect", x: 50, y: 40, width: 30, height: 10 });
    d = runCommand(d, "create_element", { id: "c", type: "rect", x: 200, y: 0, width: 20, height: 40 });
    return d;
  };
  const at = (d: ReturnType<typeof three>, id: string) => [d.elements[id].x, d.elements[id].y];

  it("lines several things up with each other", () => {
    const left = runCommand(three(), "align_elements", { ids: ["a", "b", "c"], how: "left" });
    expect(["a", "b", "c"].map((i) => at(left, i)[0])).toEqual([0, 0, 0]);
    const bottom = runCommand(three(), "align_elements", { ids: ["a", "b", "c"], how: "bottom" });
    expect(["a", "b", "c"].map((i) => bottom.elements[i].y + bottom.elements[i].height)).toEqual([50, 50, 50]);
    const centre = runCommand(three(), "align_elements", { ids: ["a", "b", "c"], how: "centre" });
    expect(["a", "b", "c"].map((i) => centre.elements[i].x + centre.elements[i].width / 2)).toEqual([110, 110, 110]);
  });

  it("lines one thing up with the frame that holds it", () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "f", type: "frame", x: 100, y: 100, width: 300, height: 200 });
    d = runCommand(d, "create_element", { id: "r", type: "rect", x: 10, y: 10, width: 50, height: 50, parentId: "f" });
    const out = runCommand(d, "align_elements", { ids: ["r"], how: "centre" });
    expect(out.elements.r.x).toBe(125);
  });

  it("spaces three or more evenly and keeps the outer two where they are", () => {
    const out = runCommand(three(), "align_elements", { ids: ["a", "b", "c"], how: "space-across" });
    expect(at(out, "a")[0]).toBe(0);
    expect(at(out, "c")[0]).toBe(200);
    // 220 wide in all, 70 taken by the things, so 75 between each
    expect(out.elements.b.x).toBe(95);
    // two things have nothing to space
    const two = runCommand(three(), "align_elements", { ids: ["a", "c"], how: "space-across" });
    expect(at(two, "a")[0]).toBe(0);
  });

  it("tidies a scatter into rows with an even gap", () => {
    const out = runCommand(three(), "align_elements", { ids: ["a", "b", "c"], how: "tidy" });
    // a, b and c's middles overlap in height, so they become one row on a shared top, 16 apart or the average gap
    const tops = ["a", "b", "c"].map((i) => out.elements[i].y);
    expect(new Set(tops).size).toBeLessThanOrEqual(2);
    const sorted = ["a", "b", "c"].map((i) => out.elements[i]).sort((p, q) => p.x - q.x);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].y === sorted[i - 1].y) expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].width);
  });

  it("does nothing when everything is already in place", () => {
    const d = three();
    expect(runCommand(d, "align_elements", { ids: ["a"], how: "left" })).toBe(d);
  });
});

describe("ruler guides", () => {
  it("are added, moved, removed, kept sorted and saved with the design", () => {
    let d = runCommand(emptyDoc(), "add_guide", { axis: "x", at: 300 });
    d = runCommand(d, "add_guide", { axis: "x", at: 100 });
    d = runCommand(d, "add_guide", { axis: "y", at: 50 });
    expect(d.guides).toEqual({ x: [100, 300], y: [50] });
    // the same place twice is one guide
    expect(runCommand(d, "add_guide", { axis: "x", at: 100 })).toBe(d);
    d = runCommand(d, "move_guide", { axis: "x", from: 300, at: 20 });
    expect(d.guides?.x).toEqual([20, 100]);
    expect(parseDoc(serializeDoc(d)).guides).toEqual({ x: [20, 100], y: [50] });
    d = runCommand(runCommand(runCommand(d, "remove_guide", { axis: "x", at: 20 }), "remove_guide", { axis: "x", at: 100 }), "remove_guide", { axis: "y", at: 50 });
    expect(d.guides).toBeUndefined();
    expect(serializeDoc(d)).not.toContain("guides");
  });
});

describe("comments on the canvas", () => {
  it("are pinned, resolved, deleted and saved with the design, without changing the old one", () => {
    const start = emptyDoc();
    let d = runCommand(start, "add_comment", { id: "c1", x: 10, y: 20, text: "  Make this bigger ", on: "missing" });
    expect(start.comments).toBeUndefined();
    expect(d.comments).toEqual([{ id: "c1", x: 10, y: 20, text: "Make this bigger", by: "you" }]);
    // an empty one is nothing
    expect(runCommand(d, "add_comment", { x: 0, y: 0, text: "  " })).toBe(d);
    d = runCommand(d, "add_comment", { id: "c2", x: 5, y: 5, text: "A question", by: "ai" });
    const edited = runCommand(d, "edit_comment", { id: "c2", text: " A better question " });
    expect(edited.comments?.[1].text).toBe("A better question");
    expect(d.comments?.[1].text).toBe("A question");
    expect(runCommand(d, "edit_comment", { id: "c2", text: "  " })).toBe(d);
    const resolved = runCommand(d, "resolve_comment", { id: "c1", reply: "Made it 24" });
    expect(d.comments?.[0].resolved).toBeUndefined();
    expect(resolved.comments?.[0]).toMatchObject({ resolved: true, reply: "Made it 24" });
    expect(runCommand(resolved, "resolve_comment", { id: "c1" })).toBe(resolved);
    expect(parseDoc(serializeDoc(resolved)).comments).toEqual(resolved.comments);
    const gone = runCommand(runCommand(resolved, "delete_comment", { id: "c1" }), "delete_comment", { id: "c2" });
    expect(gone.comments).toBeUndefined();
    expect(serializeDoc(gone)).not.toContain("comments");
  });
});

describe("moving a layer's timing at a moment", () => {
  it("adds no keys to the other animated layers", () => {
    let d = runCommand(frame("f"), "set_props", { ids: ["f"], props: { duration: 10 } });
    d = runCommand(d, "create_element", { id: "a", type: "rect", parentId: "f", x: 0, y: 0, width: 10, height: 10 });
    d = runCommand(d, "create_element", { id: "w", type: "rect", parentId: "f", x: 0, y: 0, width: 10, height: 10 });
    d = runCommand(d, "set_timing", { ids: ["w"], start: 6 });
    d = runCommand(d, "set_key", { ids: ["w"], prop: "opacity", t: 6, v: 0 });
    d = runCommand(d, "set_key", { ids: ["w"], prop: "opacity", t: 7, v: 1 });
    const posed = docAt(d, "f", 6.5);
    const out = runCommand(posed, "set_timing", { ids: ["a"], start: 2 });
    const done = settle(d, posed, out, "f", 6.5);
    expect(done.elements.w.keys.opacity!.map((k) => k.t)).toEqual([6, 7]);
    expect(done.elements.a.start).toBe(2);
  });

  it("keeps its own keys where they are when only the start is trimmed", () => {
    let d = runCommand(frame("f"), "set_props", { ids: ["f"], props: { duration: 10 } });
    d = runCommand(d, "create_element", { id: "a", type: "rect", parentId: "f", x: 0, y: 0, width: 10, height: 10 });
    d = runCommand(d, "set_key", { ids: ["a"], prop: "opacity", t: 3, v: 0 });
    d = runCommand(d, "set_key", { ids: ["a"], prop: "opacity", t: 4, v: 1 });
    const trimmed = runCommand(d, "set_timing", { ids: ["a"], start: 2, keepKeys: true });
    expect(trimmed.elements.a.start).toBe(2);
    expect(trimmed.elements.a.keys.opacity!.map((k) => k.t)).toEqual([3, 4]);
    const moved = runCommand(d, "set_timing", { ids: ["a"], start: 2 });
    expect(moved.elements.a.keys.opacity!.map((k) => k.t)).toEqual([5, 6]);
  });
});

describe("blend modes", () => {
  it("sets a blend, saves it, and opens old files as normal", () => {
    let d = runCommand(emptyDoc(), "create_element", { type: "rect", x: 0, y: 0, width: 10, height: 10 });
    const id = Object.keys(d.elements)[0];
    expect(d.elements[id].blend).toBe("normal");
    d = runCommand(d, "set_props", { ids: [id], props: { blend: "screen" } });
    expect(d.elements[id].blend).toBe("screen");
    expect(parseDoc(serializeDoc(d)).elements[id].blend).toBe("screen");
    const plain = runCommand(d, "set_props", { ids: [id], props: { blend: "normal" } });
    expect(serializeDoc(plain)).not.toContain("blend");
    expect(parseDoc(serializeDoc(plain)).elements[id].blend).toBe("normal");
  });
});

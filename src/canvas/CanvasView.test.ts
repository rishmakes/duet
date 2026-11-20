import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { drawnBox, fitView, isMovable, prepareDuplicate } from "./CanvasView";

describe("option drag duplication helpers", () => {
  describe("isMovable", () => {
    it("returns false for null, empty or missing elements", () => {
      const doc = emptyDoc();
      expect(isMovable(doc, null)).toBe(false);
      expect(isMovable(doc, "")).toBe(false);
      expect(isMovable(doc, "missing")).toBe(false);
    });

    it("returns true for unlocked elements on page or inside a frame", () => {
      let doc = emptyDoc();
      doc = runCommand(doc, "create_element", { id: "f1", type: "frame", x: 0, y: 0, width: 200, height: 200 });
      doc = runCommand(doc, "create_element", { id: "r1", type: "rect", parentId: "f1", x: 10, y: 10, width: 50, height: 50 });
      doc = runCommand(doc, "create_element", { id: "r2", type: "rect", x: 300, y: 0, width: 50, height: 50 });

      expect(isMovable(doc, "f1")).toBe(true);
      expect(isMovable(doc, "r1")).toBe(true);
      expect(isMovable(doc, "r2")).toBe(true);
    });

    it("returns false for locked elements", () => {
      let doc = emptyDoc();
      doc = runCommand(doc, "create_element", { id: "r1", type: "rect", x: 0, y: 0, width: 50, height: 50 });
      doc = runCommand(doc, "set_props", { ids: ["r1"], props: { locked: true } });

      expect(isMovable(doc, "r1")).toBe(false);
    });

    it("returns false when an ancestor frame is locked", () => {
      let doc = emptyDoc();
      doc = runCommand(doc, "create_element", { id: "f1", type: "frame", x: 0, y: 0, width: 200, height: 200 });
      doc = runCommand(doc, "create_element", { id: "r1", type: "rect", parentId: "f1", x: 10, y: 10, width: 50, height: 50 });
      doc = runCommand(doc, "set_props", { ids: ["f1"], props: { locked: true } });

      expect(isMovable(doc, "f1")).toBe(false);
      expect(isMovable(doc, "r1")).toBe(false);
    });
  });

  describe("prepareDuplicate", () => {
    it("returns null for empty selection or non-existent elements", () => {
      const doc = emptyDoc();
      expect(prepareDuplicate(doc, [])).toBeNull();
      expect(prepareDuplicate(doc, ["missing"])).toBeNull();
    });

    it("duplicates a shape on the page and leaves the original intact", () => {
      let doc = emptyDoc();
      doc = runCommand(doc, "create_element", { id: "r1", type: "rect", x: 40, y: 50, width: 100, height: 80 });

      const res = prepareDuplicate(doc, ["r1"]);
      expect(res).not.toBeNull();
      const { base, copyIds } = res!;

      expect(copyIds.length).toBe(1);
      const copyId = copyIds[0];
      expect(copyId).not.toBe("r1");

      // Original is untouched
      expect(base.elements.r1).toEqual(doc.elements.r1);

      // Copy has same dimensions, position, parent
      const copy = base.elements[copyId];
      expect(copy).toBeDefined();
      expect(copy.type).toBe("rect");
      expect(copy.x).toBe(40);
      expect(copy.y).toBe(50);
      expect(copy.width).toBe(100);
      expect(copy.height).toBe(80);
      expect(copy.parentId).toBeNull();

      // Both are in rootIds
      expect(base.rootIds).toEqual(["r1", copyId]);
    });

    it("duplicates a shape inside a frame and places the copy in the same frame", () => {
      let doc = emptyDoc();
      doc = runCommand(doc, "create_element", { id: "f1", type: "frame", x: 100, y: 100, width: 300, height: 300 });
      doc = runCommand(doc, "create_element", { id: "r1", type: "rect", parentId: "f1", x: 20, y: 30, width: 40, height: 40 });

      const res = prepareDuplicate(doc, ["r1"]);
      expect(res).not.toBeNull();
      const { base, copyIds } = res!;

      expect(copyIds.length).toBe(1);
      const copyId = copyIds[0];

      // Original is intact
      expect(base.elements.r1).toEqual(doc.elements.r1);

      // Copy is child of the frame
      const copy = base.elements[copyId];
      expect(copy.parentId).toBe("f1");
      expect(copy.x).toBe(20);
      expect(copy.y).toBe(30);
      expect(base.elements.f1.childIds).toEqual(["r1", copyId]);
    });

    it("duplicates multiple selected shapes at once", () => {
      let doc = emptyDoc();
      doc = runCommand(doc, "create_element", { id: "r1", type: "rect", x: 0, y: 0, width: 50, height: 50 });
      doc = runCommand(doc, "create_element", { id: "r2", type: "ellipse", x: 100, y: 0, width: 60, height: 60 });

      const res = prepareDuplicate(doc, ["r1", "r2"]);
      expect(res).not.toBeNull();
      const { base, copyIds } = res!;

      expect(copyIds.length).toBe(2);
      expect(base.elements[copyIds[0]]).toBeDefined();
      expect(base.elements[copyIds[1]]).toBeDefined();

      // Originals unchanged
      expect(base.elements.r1).toEqual(doc.elements.r1);
      expect(base.elements.r2).toEqual(doc.elements.r2);

      expect(base.rootIds).toEqual(["r1", "r2", copyIds[0], copyIds[1]]);
    });

    it("duplicates a frame with its contents", () => {
      let doc = emptyDoc();
      doc = runCommand(doc, "create_element", { id: "f1", type: "frame", x: 0, y: 0, width: 200, height: 200 });
      doc = runCommand(doc, "create_element", { id: "child1", type: "rect", parentId: "f1", x: 10, y: 10, width: 30, height: 30 });

      const res = prepareDuplicate(doc, ["f1"]);
      expect(res).not.toBeNull();
      const { base, copyIds } = res!;

      expect(copyIds.length).toBe(1);
      const frameCopyId = copyIds[0];
      const frameCopy = base.elements[frameCopyId];
      expect(frameCopy).toBeDefined();
      expect(frameCopy.type).toBe("frame");
      expect(frameCopy.childIds.length).toBe(1);

      const childCopyId = frameCopy.childIds[0];
      expect(childCopyId).not.toBe("child1");
      expect(base.elements[childCopyId].parentId).toBe(frameCopyId);

      // Original frame and child unchanged
      expect(base.elements.f1.childIds).toEqual(["child1"]);
      expect(base.elements.child1.parentId).toBe("f1");
    });
  });
});

describe("drawing a new shape", () => {
  const start = { x: 100, y: 100 };
  it("follows the drag as it is", () => {
    expect(drawnBox(start, { x: 160, y: 120 }, false, false)).toEqual({ x: 100, y: 100, width: 60, height: 20 });
  });
  it("Shift keeps it as wide as it is tall, in the direction dragged", () => {
    expect(drawnBox(start, { x: 160, y: 120 }, true, false)).toEqual({ x: 100, y: 100, width: 60, height: 60 });
    expect(drawnBox(start, { x: 80, y: 40 }, true, false)).toEqual({ x: 40, y: 40, width: 60, height: 60 });
  });
  it("Option draws out from where the drag started", () => {
    expect(drawnBox(start, { x: 130, y: 110 }, false, true)).toEqual({ x: 70, y: 90, width: 60, height: 20 });
    expect(drawnBox(start, { x: 130, y: 110 }, true, true)).toEqual({ x: 70, y: 70, width: 60, height: 60 });
  });
});

describe("fitting the view", () => {
  it("waits while the canvas has no size, instead of leaving the design tiny in a corner", () => {
    const video = { x: 0, y: 0, width: 1080, height: 1920 };
    expect(fitView(video, 0, 0, 4)).toBeNull();
    const to = fitView(video, 660, 480, 4)!;
    expect(to.zoom).toBeGreaterThan(0.1);
    expect(to.x + 540 * to.zoom).toBeCloseTo(330);
  });
});

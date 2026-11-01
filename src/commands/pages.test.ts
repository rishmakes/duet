import { describe, expect, it } from "vitest";
import { runCommand } from "./index";
import { emptyDoc } from "../document/types";

describe("page view commands", () => {
  describe("set_pages", () => {
    it("turns on pages in the design", () => {
      const doc = emptyDoc();
      const next = runCommand(doc, "set_pages", { on: true });
      expect(next.pages).toBe(true);
      expect(doc.pages).toBeUndefined(); // no mutation
    });

    it("turns off pages in the design", () => {
      const doc = { ...emptyDoc(), pages: true as const };
      const next = runCommand(doc, "set_pages", { on: false });
      expect(next.pages).toBeUndefined();
      expect(doc.pages).toBe(true); // no mutation
    });

    it("returns unchanged doc if already in requested state", () => {
      const doc = emptyDoc();
      const next = runCommand(doc, "set_pages", { on: false });
      expect(next).toBe(doc);

      const withPages = { ...emptyDoc(), pages: true as const };
      const nextWithPages = runCommand(withPages, "set_pages", { on: true });
      expect(nextWithPages).toBe(withPages);
    });
  });

  describe("add_page", () => {
    it("adds the first page to an empty document", () => {
      const doc = runCommand(emptyDoc(), "set_pages", { on: true });
      const next = runCommand(doc, "add_page", { id: "p1", width: 1080, height: 1080 });
      expect(next.rootIds).toEqual(["p1"]);
      expect(next.elements.p1).toBeDefined();
      expect(next.elements.p1.type).toBe("frame");
      expect(next.elements.p1.width).toBe(1080);
      expect(next.elements.p1.height).toBe(1080);
      expect(next.elements.p1.x).toBe(0);
      expect(next.elements.p1.y).toBe(0);
      expect(doc.rootIds).toHaveLength(0); // immutability check
    });

    it("inherits dimensions and fill from source frame", () => {
      let doc = runCommand(emptyDoc(), "set_pages", { on: true });
      doc = runCommand(doc, "add_page", { id: "p1", width: 800, height: 600 });
      doc = runCommand(doc, "set_props", { ids: ["p1"], props: { fill: "#123456", radius: 12 } });

      const next = runCommand(doc, "add_page", { id: "p2", sourceId: "p1" });
      expect(next.elements.p2.width).toBe(800);
      expect(next.elements.p2.height).toBe(600);
      expect(next.elements.p2.fill).toBe("#123456");
      expect(next.elements.p2.radius).toBe(12);
    });

    it("places pages horizontally to the right with 40px gap without overlapping", () => {
      let doc = runCommand(emptyDoc(), "set_pages", { on: true });
      doc = runCommand(doc, "add_page", { id: "p1", width: 1000, height: 1000 });
      doc = runCommand(doc, "add_page", { id: "p2", width: 1000, height: 1000 });
      doc = runCommand(doc, "add_page", { id: "p3", width: 500, height: 500 });

      expect(doc.elements.p1.x).toBe(0);
      expect(doc.elements.p2.x).toBe(1040); // 0 + 1000 + 40
      expect(doc.elements.p3.x).toBe(2080); // 1040 + 1000 + 40
    });

    it("inserts after afterId when specified", () => {
      let doc = runCommand(emptyDoc(), "set_pages", { on: true });
      doc = runCommand(doc, "add_page", { id: "p1" });
      doc = runCommand(doc, "add_page", { id: "p2" });
      doc = runCommand(doc, "add_page", { id: "p-mid", afterId: "p1" });

      expect(doc.rootIds).toEqual(["p1", "p-mid", "p2"]);
    });

    it("never mutates input document", () => {
      const doc = runCommand(emptyDoc(), "set_pages", { on: true });
      const originalRootIds = [...doc.rootIds];
      const next = runCommand(doc, "add_page", { id: "p1" });

      expect(doc.rootIds).toEqual(originalRootIds);
      expect(doc.elements.p1).toBeUndefined();
      expect(next.elements.p1).toBeDefined();
    });
  });

  describe("reorder_pages", () => {
    it("moves first page to end of rootIds and reflows positions", () => {
      let doc = runCommand(emptyDoc(), "set_pages", { on: true });
      doc = runCommand(doc, "add_page", { id: "p1", width: 100, height: 100 });
      doc = runCommand(doc, "add_page", { id: "p2", width: 200, height: 100 });
      doc = runCommand(doc, "add_page", { id: "p3", width: 300, height: 100 });

      const reordered = runCommand(doc, "reorder_pages", { id: "p1", toIndex: 2 });
      expect(reordered.rootIds).toEqual(["p2", "p3", "p1"]);
      // Reflow: p2 at 0, p3 at 0+200+40=240, p1 at 240+300+40=580
      expect(reordered.elements.p2.x).toBe(0);
      expect(reordered.elements.p3.x).toBe(240);
      expect(reordered.elements.p1.x).toBe(580);
      // original doc untouched
      expect(doc.rootIds).toEqual(["p1", "p2", "p3"]);
      expect(doc.elements.p1.x).toBe(0);
    });

    it("moves last page to beginning of rootIds", () => {
      let doc = runCommand(emptyDoc(), "set_pages", { on: true });
      doc = runCommand(doc, "add_page", { id: "p1", width: 100, height: 100 });
      doc = runCommand(doc, "add_page", { id: "p2", width: 100, height: 100 });
      doc = runCommand(doc, "add_page", { id: "p3", width: 100, height: 100 });

      const reordered = runCommand(doc, "reorder_pages", { id: "p3", toIndex: 0 });
      expect(reordered.rootIds).toEqual(["p3", "p1", "p2"]);
      expect(reordered.elements.p3.x).toBe(0);
      expect(reordered.elements.p1.x).toBe(140);
      expect(reordered.elements.p2.x).toBe(280);
    });

    it("preserves positions when reflow is false", () => {
      let doc = runCommand(emptyDoc(), "set_pages", { on: true });
      doc = runCommand(doc, "add_page", { id: "p1", width: 100, height: 100 });
      doc = runCommand(doc, "add_page", { id: "p2", width: 100, height: 100 });

      const reordered = runCommand(doc, "reorder_pages", { id: "p1", toIndex: 1, reflow: false });
      expect(reordered.rootIds).toEqual(["p2", "p1"]);
      expect(reordered.elements.p1.x).toBe(0);
      expect(reordered.elements.p2.x).toBe(140);
    });

    it("safely ignores invalid ID or out-of-bounds indices", () => {
      let doc = runCommand(emptyDoc(), "set_pages", { on: true });
      doc = runCommand(doc, "add_page", { id: "p1" });
      doc = runCommand(doc, "add_page", { id: "p2" });

      const invalid = runCommand(doc, "reorder_pages", { id: "non-existent", toIndex: 0 });
      expect(invalid).toBe(doc);

      // Clamp high index
      const clampedHigh = runCommand(doc, "reorder_pages", { id: "p1", toIndex: 999 });
      expect(clampedHigh.rootIds).toEqual(["p2", "p1"]);

      // Clamp negative index
      const clampedLow = runCommand(clampedHigh, "reorder_pages", { id: "p1", toIndex: -5 });
      expect(clampedLow.rootIds).toEqual(["p1", "p2"]);
    });
  });
});

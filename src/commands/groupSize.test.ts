import { describe, expect, it } from "vitest";
import { runCommand } from ".";
import { emptyDoc } from "../document/types";

/** A frame with a group of two boxes, side by side: 0-50 and 50-100 wide, 40 high. */
function grouped() {
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 400, height: 400 });
  doc = runCommand(doc, "create_element", { type: "rect", id: "a", parentId: "f", x: 10, y: 10, width: 50, height: 40 });
  doc = runCommand(doc, "create_element", { type: "rect", id: "b", parentId: "f", x: 60, y: 10, width: 50, height: 40 });
  return runCommand(doc, "group_elements", { ids: ["a", "b"], groupId: "g" });
}

describe("a group's size through set_props (#347)", () => {
  it("scales what is inside, as resizing it by hand does", () => {
    const doc = runCommand(grouped(), "set_props", { ids: ["g"], props: { width: 200, height: 80 } });
    expect(doc.elements.g.width).toBe(200);
    expect(doc.elements.g.height).toBe(80);
    expect([doc.elements.a.width, doc.elements.a.height, doc.elements.b.width]).toEqual([100, 80, 100]);
    // the same as resize_element would make it
    const byHand = runCommand(grouped(), "resize_element", { id: "g", x: grouped().elements.g.x, y: grouped().elements.g.y, width: 200, height: 80 });
    expect([doc.elements.a.x, doc.elements.b.x, doc.elements.b.width]).toEqual([byHand.elements.a.x, byHand.elements.b.x, byHand.elements.b.width]);
  });

  it("width alone keeps the height", () => {
    const doc = runCommand(grouped(), "set_props", { ids: ["g"], props: { width: 50 } });
    expect(doc.elements.g.width).toBe(50);
    expect(doc.elements.g.height).toBe(40);
    expect(doc.elements.a.width).toBe(25);
  });
});

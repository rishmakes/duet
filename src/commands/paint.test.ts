import { describe, expect, it } from "vitest";
import { runCommand } from "./index";
import { emptyDoc } from "../document/types";
import { parseDoc, serializeDoc } from "../document/serialize";
import { picturesIn } from "../project/assets";
import type { Doc } from "../document/types";

function baseDoc(): Doc {
  let d = emptyDoc();
  d = runCommand(d, "create_element", { id: "f1", type: "frame", x: 0, y: 0, width: 200, height: 200 });
  d = runCommand(d, "create_element", { id: "p1", type: "image", parentId: "f1", x: 0, y: 0, width: 100, height: 100 });
  d = runCommand(d, "create_element", { id: "r1", type: "rect", parentId: "f1", x: 0, y: 0, width: 100, height: 100 });
  return runCommand(d, "set_props", { ids: ["p1"], props: { src: "assets/photo.png" } });
}

describe("paint_picture", () => {
  it("adds painted patches without changing the old design", () => {
    const d = baseDoc();
    const next = runCommand(d, "paint_picture", { id: "p1", tiles: { "0,0": "assets/a.png", "1,0": "assets/b.png" } });
    expect(next.elements.p1.paint).toEqual({ "0,0": "assets/a.png", "1,0": "assets/b.png" });
    expect(d.elements.p1.paint).toEqual({});
    expect(next.elements.p1.src).toBe("assets/photo.png");
  });

  it("replaces a patch painted again and keeps the others", () => {
    let d = runCommand(baseDoc(), "paint_picture", { id: "p1", tiles: { "0,0": "assets/a.png", "1,0": "assets/b.png" } });
    const before = d;
    d = runCommand(d, "paint_picture", { id: "p1", tiles: { "0,0": "assets/c.png" } });
    expect(d.elements.p1.paint).toEqual({ "0,0": "assets/c.png", "1,0": "assets/b.png" });
    expect(before.elements.p1.paint["0,0"]).toBe("assets/a.png");
  });

  it("ignores shapes, missing things and bad patch names", () => {
    const d = baseDoc();
    expect(runCommand(d, "paint_picture", { id: "r1", tiles: { "0,0": "assets/a.png" } })).toBe(d);
    expect(runCommand(d, "paint_picture", { id: "nope", tiles: { "0,0": "assets/a.png" } })).toBe(d);
    expect(runCommand(d, "paint_picture", { id: "p1", tiles: { "x,1": "assets/a.png", "0,0": "" } })).toBe(d);
  });

  it("saves and opens painted patches, and leaves them out when there are none", () => {
    const d = baseDoc();
    expect(serializeDoc(d)).not.toContain('"paint"');
    const painted = runCommand(d, "paint_picture", { id: "p1", tiles: { "2,3": "assets/a.png" } });
    const back = parseDoc(serializeDoc(painted));
    expect(back.elements.p1.paint).toEqual({ "2,3": "assets/a.png" });
    expect(back.elements.r1.paint).toEqual({});
  });

  it("lists painted patches among the pictures to keep", () => {
    const painted = runCommand(baseDoc(), "paint_picture", { id: "p1", tiles: { "0,0": "assets/a.png" } });
    expect(picturesIn(painted).sort()).toEqual(["assets/a.png", "assets/photo.png"]);
  });
});

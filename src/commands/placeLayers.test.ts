import { describe, expect, it } from "vitest";
import { runCommand } from ".";
import { emptyDoc } from "../document/types";

describe("opening a Photoshop file", () => {
  it("makes one frame with the layers and groups inside, bottom first, without changing the document it was given", () => {
    const before = emptyDoc();
    const layer = (id: string, x: number, more = {}) => ({ id, name: id, x, y: 10, width: 20, height: 20, opacity: 1, blend: "normal" as const, hidden: false, src: `assets/${id}.png`, ...more });
    const doc = runCommand(before, "place_layers", {
      frame: { id: "f", name: "Poster", x: 100, y: 50, width: 300, height: 200 },
      layers: [
        layer("bg", 0),
        { ...layer("g", 0), src: undefined, hidden: true, opacity: 0.5, blend: "multiply" as const, children: [layer("a", 40), layer("b", 80, { blend: "screen" })] },
        { ...layer("empty", 0), src: undefined, children: [] },
        layer("top", 5),
      ],
    });
    expect(before.rootIds).toEqual([]);
    expect(doc.rootIds).toEqual(["f"]);
    expect(doc.elements.f.name).toBe("Poster");
    expect(doc.elements.f.childIds).toEqual(["bg", "g", "top"]);
    const g = doc.elements.g;
    expect([g.type, g.name, g.hidden, g.opacity, g.blend]).toEqual(["group", "g", true, 0.5, "multiply"]);
    expect(g.childIds).toEqual(["a", "b"]);
    // a group keeps where things were in the file
    expect(g.x + doc.elements.b.x).toBe(80);
    expect(doc.elements.b.blend).toBe("screen");
    expect(doc.elements.top.src).toBe("assets/top.png");
  });
});

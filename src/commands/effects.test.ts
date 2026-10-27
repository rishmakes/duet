import { describe, expect, it } from "vitest";
import { runCommand } from "./index";
import { emptyDoc } from "../document/types";
import { parseDoc, serializeDoc } from "../document/serialize";
import type { Doc } from "../document/types";
import { applyEffects, clearEffectsCache } from "../canvas/effects";

function baseDoc(): Doc {
  let d = emptyDoc();
  d = runCommand(d, "create_element", { id: "f1", type: "frame", x: 0, y: 0, width: 200, height: 200 });
  d = runCommand(d, "create_element", { id: "p1", type: "image", parentId: "f1", x: 0, y: 0, width: 100, height: 100 });
  d = runCommand(d, "create_element", { id: "v1", type: "video", parentId: "f1", x: 0, y: 0, width: 100, height: 100 });
  d = runCommand(d, "create_element", { id: "r1", type: "rect", parentId: "f1", x: 0, y: 0, width: 100, height: 100 });
  return d;
}

describe("effects serialization", () => {
  it("does not write out an empty effects list", () => {
    const d = baseDoc();
    const text = serializeDoc(d);
    expect(text).not.toContain('"effects"');
    const back = parseDoc(text);
    expect(back.elements.p1.effects).toEqual([]);
    expect(back.elements.v1.effects).toEqual([]);
  });

  it("loads old files without effects as empty list", () => {
    const raw = JSON.stringify({
      version: 1,
      rootIds: ["f1"],
      elements: {
        f1: { id: "f1", type: "frame", x: 0, y: 0, width: 100, height: 100, childIds: ["p1"] },
        p1: { id: "p1", type: "image", parentId: "f1", x: 0, y: 0, width: 100, height: 100, src: "assets/test.png" },
      },
    });
    const parsed = parseDoc(raw);
    expect(parsed.elements.p1.effects).toEqual([]);
    expect(parsed.elements.f1.effects).toEqual([]);
  });

  it("writes out effects when present and roundtrips correctly", () => {
    let d = baseDoc();
    d = runCommand(d, "add_effect", { ids: ["p1"], effect: "blur" });
    const text = serializeDoc(d);
    expect(text).toContain('"effects"');
    expect(text).toContain('"blur"');
    const back = parseDoc(text);
    expect(back.elements.p1.effects).toHaveLength(1);
    expect(back.elements.p1.effects[0].kind).toBe("blur");
    expect(back.elements.p1.effects[0].on).toBe(true);
    expect(back.elements.p1.effects[0].values.amount).toBe(20);
  });
});

describe("effects commands", () => {
  it("add_effect adds default effect to images and videos, but ignores non-media", () => {
    const before = baseDoc();
    const next = runCommand(before, "add_effect", { ids: ["p1", "v1", "r1"], effect: "sharpen" });

    // never mutates before
    expect(before.elements.p1.effects).toHaveLength(0);

    // image and video got the effect
    expect(next.elements.p1.effects).toHaveLength(1);
    expect(next.elements.p1.effects[0].kind).toBe("sharpen");
    expect(next.elements.p1.effects[0].values).toMatchObject({ amount: 50, radius: 1 });

    expect(next.elements.v1.effects).toHaveLength(1);
    expect(next.elements.v1.effects[0].kind).toBe("sharpen");

    // rect did not get the effect
    expect(next.elements.r1.effects).toHaveLength(0);
  });

  it("add_effect supports custom values and specific index", () => {
    let d = baseDoc();
    d = runCommand(d, "add_effect", { ids: ["p1"], effect: { id: "eff-1", kind: "blur", values: { amount: 80 } } });
    d = runCommand(d, "add_effect", { ids: ["p1"], effect: { id: "eff-2", kind: "pixelate", values: { size: 16 } }, index: 0 });

    expect(d.elements.p1.effects).toHaveLength(2);
    expect(d.elements.p1.effects[0].id).toBe("eff-2");
    expect(d.elements.p1.effects[0].kind).toBe("pixelate");
    expect(d.elements.p1.effects[0].values.size).toBe(16);

    expect(d.elements.p1.effects[1].id).toBe("eff-1");
    expect(d.elements.p1.effects[1].kind).toBe("blur");
    expect(d.elements.p1.effects[1].values.amount).toBe(80);
  });

  it("set_effect toggles on and updates values without mutating", () => {
    let d = baseDoc();
    d = runCommand(d, "add_effect", { ids: ["p1"], effect: { id: "eff-1", kind: "glow" } });
    const before = d;

    // toggle off
    d = runCommand(d, "set_effect", { ids: ["p1"], effectId: "eff-1", on: false });
    expect(before.elements.p1.effects[0].on).toBe(true);
    expect(d.elements.p1.effects[0].on).toBe(false);

    // update values
    d = runCommand(d, "set_effect", { ids: ["p1"], effectId: "eff-1", values: { radius: 120 } });
    expect(d.elements.p1.effects[0].values.radius).toBe(120);
    expect(d.elements.p1.effects[0].values.amount).toBe(50); // preserved default
    expect(d.elements.p1.effects[0].on).toBe(false); // preserved on status
  });

  it("remove_effect removes the effect by id", () => {
    let d = baseDoc();
    d = runCommand(d, "add_effect", { ids: ["p1"], effect: { id: "e1", kind: "blur" } });
    d = runCommand(d, "add_effect", { ids: ["p1"], effect: { id: "e2", kind: "grain" } });
    expect(d.elements.p1.effects).toHaveLength(2);

    const before = d;
    d = runCommand(d, "remove_effect", { ids: ["p1"], effectId: "e1" });
    expect(before.elements.p1.effects).toHaveLength(2);
    expect(d.elements.p1.effects).toHaveLength(1);
    expect(d.elements.p1.effects[0].id).toBe("e2");
  });

  it("move_effect reorders effects up, down, or to a specific index", () => {
    let d = baseDoc();
    d = runCommand(d, "add_effect", { ids: ["p1"], effect: { id: "e1", kind: "blur" } });
    d = runCommand(d, "add_effect", { ids: ["p1"], effect: { id: "e2", kind: "grain" } });
    d = runCommand(d, "add_effect", { ids: ["p1"], effect: { id: "e3", kind: "glow" } });

    // Move e3 up: should become [e1, e3, e2]
    d = runCommand(d, "move_effect", { ids: ["p1"], effectId: "e3", direction: "up" });
    expect(d.elements.p1.effects.map((e) => e.id)).toEqual(["e1", "e3", "e2"]);

    // Move e1 down: should become [e3, e1, e2]
    d = runCommand(d, "move_effect", { ids: ["p1"], effectId: "e1", direction: "down" });
    expect(d.elements.p1.effects.map((e) => e.id)).toEqual(["e3", "e1", "e2"]);

    // Move e2 to index 0: should become [e2, e3, e1]
    d = runCommand(d, "move_effect", { ids: ["p1"], effectId: "e2", toIndex: 0 });
    expect(d.elements.p1.effects.map((e) => e.id)).toEqual(["e2", "e3", "e1"]);
  });
});

describe("canvas effects drawing", () => {
  it("returns original picture when effects list is empty or inactive", () => {
    const d = baseDoc();
    const fakeCanvas = { width: 100, height: 100 } as unknown as HTMLCanvasElement;
    expect(applyEffects(fakeCanvas, [], d.elements.p1, "p1")).toBe(fakeCanvas);
    expect(applyEffects(fakeCanvas, [{ id: "1", kind: "blur", on: false, values: { amount: 20 } }], d.elements.p1, "p1")).toBe(fakeCanvas);
  });

  it("handles fallback gracefully when WebGL2 context is unavailable in testing", () => {
    const d = baseDoc();
    const fakeCanvas = { width: 100, height: 100 } as unknown as HTMLCanvasElement;
    clearEffectsCache();
    const result = applyEffects(fakeCanvas, [{ id: "1", kind: "blur", on: true, values: { amount: 20 } }], d.elements.p1, "p1");
    expect(result).toBeDefined();
  });
});

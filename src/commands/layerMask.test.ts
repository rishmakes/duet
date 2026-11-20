import { describe, expect, it } from "vitest";
import { runCommand } from "./index";
import { emptyDoc } from "../document/types";
import { parseDoc, serializeDoc } from "../document/serialize";
import type { Doc } from "../document/types";

function baseDoc(): Doc {
  let d = emptyDoc();
  d = runCommand(d, "create_element", { id: "f1", type: "frame", x: 0, y: 0, width: 200, height: 200 });
  d = runCommand(d, "create_element", { id: "p1", type: "image", parentId: "f1", x: 0, y: 0, width: 100, height: 100 });
  d = runCommand(d, "create_element", { id: "r1", type: "rect", parentId: "f1", x: 0, y: 0, width: 100, height: 100 });
  d = runCommand(d, "create_element", { id: "t1", type: "text", parentId: "f1", x: 0, y: 0, width: 100, height: 100 });
  return d;
}

describe("layer mask commands", () => {
  it("set_layer_mask applies mask to any element type", () => {
    const before = baseDoc();
    const next = runCommand(before, "set_layer_mask", { ids: ["p1", "r1", "f1", "t1"], src: "assets/mask.png" });

    expect(before.elements.p1.layerMask).toBeNull();
    expect(next.elements.p1.layerMask).toBe("assets/mask.png");
    expect(next.elements.r1.layerMask).toBe("assets/mask.png");
    expect(next.elements.f1.layerMask).toBe("assets/mask.png");
    expect(next.elements.t1.layerMask).toBe("assets/mask.png");
    expect(next.elements.p1.layerMaskInvert).toBe(false);
    expect(next.elements.p1.layerMaskDisabled).toBe(false);
  });

  it("invert_layer_mask toggles invert flag", () => {
    let d = baseDoc();
    d = runCommand(d, "set_layer_mask", { ids: ["r1"], src: "assets/mask.png" });
    expect(d.elements.r1.layerMaskInvert).toBe(false);

    d = runCommand(d, "invert_layer_mask", { ids: ["r1"] });
    expect(d.elements.r1.layerMaskInvert).toBe(true);

    d = runCommand(d, "invert_layer_mask", { ids: ["r1"] });
    expect(d.elements.r1.layerMaskInvert).toBe(false);
  });

  it("toggle_layer_mask toggles disabled state without removing mask", () => {
    let d = baseDoc();
    d = runCommand(d, "set_layer_mask", { ids: ["r1"], src: "assets/mask.png" });
    expect(d.elements.r1.layerMaskDisabled).toBe(false);

    d = runCommand(d, "toggle_layer_mask", { ids: ["r1"] });
    expect(d.elements.r1.layerMaskDisabled).toBe(true);
    expect(d.elements.r1.layerMask).toBe("assets/mask.png");

    d = runCommand(d, "toggle_layer_mask", { ids: ["r1"] });
    expect(d.elements.r1.layerMaskDisabled).toBe(false);
  });

  it("painting the mask again keeps it inverted and off as it was", () => {
    let d = baseDoc();
    d = runCommand(d, "set_layer_mask", { ids: ["r1"], src: "assets/mask.png", invert: true, disabled: true });
    d = runCommand(d, "set_layer_mask", { ids: ["r1"], src: "assets/mask-2.png" });
    expect(d.elements.r1.layerMask).toBe("assets/mask-2.png");
    expect(d.elements.r1.layerMaskInvert).toBe(true);
    expect(d.elements.r1.layerMaskDisabled).toBe(true);
  });

  it("set_layer_mask with no picture removes the mask and resets flags", () => {
    let d = baseDoc();
    d = runCommand(d, "set_layer_mask", { ids: ["r1"], src: "assets/mask.png", invert: true, disabled: true });
    expect(d.elements.r1.layerMask).toBe("assets/mask.png");

    d = runCommand(d, "set_layer_mask", { ids: ["r1"], src: null });
    expect(d.elements.r1.layerMask).toBeNull();
    expect(d.elements.r1.layerMaskInvert).toBe(false);
    expect(d.elements.r1.layerMaskDisabled).toBe(false);
  });
});

describe("layer mask serialization", () => {
  it("does not write out layer mask keys when not set", () => {
    const d = baseDoc();
    const text = serializeDoc(d);
    expect(text).not.toContain('"layerMask"');
    expect(text).not.toContain('"layerMaskInvert"');
    expect(text).not.toContain('"layerMaskDisabled"');
  });

  it("writes out layer mask only when set and roundtrips", () => {
    let d = baseDoc();
    d = runCommand(d, "set_layer_mask", { ids: ["r1"], src: "assets/mask.png", invert: true, disabled: false });
    const text = serializeDoc(d);
    expect(text).toContain('"layerMask": "assets/mask.png"');
    expect(text).toContain('"layerMaskInvert": true');
    expect(text).not.toContain('"layerMaskDisabled"');

    const back = parseDoc(text);
    expect(back.elements.r1.layerMask).toBe("assets/mask.png");
    expect(back.elements.r1.layerMaskInvert).toBe(true);
    expect(back.elements.r1.layerMaskDisabled).toBe(false);
  });

  it("loads legacy files without layer mask as null / false", () => {
    const raw = JSON.stringify({
      version: 1,
      rootIds: ["f1"],
      elements: {
        f1: { id: "f1", type: "frame", x: 0, y: 0, width: 100, height: 100, childIds: [] },
      },
    });
    const parsed = parseDoc(raw);
    expect(parsed.elements.f1.layerMask).toBeNull();
    expect(parsed.elements.f1.layerMaskInvert).toBe(false);
    expect(parsed.elements.f1.layerMaskDisabled).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { FRAME_PRESETS } from "../commands";
import { EDIT_TOOLS, keyPutsDownEditTool, presetFrameBounds, screenCenter } from "./Toolbar";
import { currentDoc, dispatch, getState, resetStore, select } from "../state/store";

describe("Toolbar frame presets helpers", () => {
  it("calculates the middle of screen for default viewport", () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    const fakeCanvas = {
      getBoundingClientRect: () => ({ width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800 }),
    } as unknown as Element;

    const center = screenCenter(vp, fakeCanvas);
    expect(center).toEqual({ x: 500, y: 400 });
  });

  it("calculates the middle of screen when panned and zoomed", () => {
    const vp = { x: 100, y: 50, zoom: 2 };
    const fakeCanvas = {
      getBoundingClientRect: () => ({ width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800 }),
    } as unknown as Element;

    // center in screen = (500, 400)
    // worldX = (500 - 100) / 2 = 200
    // worldY = (400 - 50) / 2 = 175
    const center = screenCenter(vp, fakeCanvas);
    expect(center).toEqual({ x: 200, y: 175 });
  });

  it("calculates preset frame bounds centered around a point", () => {
    const center = { x: 500, y: 400 };

    for (const preset of FRAME_PRESETS) {
      const bounds = presetFrameBounds(preset, center);
      expect(bounds.width).toBe(preset.width);
      expect(bounds.height).toBe(preset.height);
      expect(bounds.x + bounds.width / 2).toBe(center.x);
      expect(bounds.y + bounds.height / 2).toBe(center.y);
    }
  });

  it("centers Phone preset correctly", () => {
    const phone = FRAME_PRESETS.find((p) => p.name === "Phone")!;
    expect(phone).toBeDefined();
    expect(phone.width).toBe(390);
    expect(phone.height).toBe(844);

    const bounds = presetFrameBounds(phone, { x: 600, y: 500 });
    // 600 - 390/2 = 600 - 195 = 405
    // 500 - 844/2 = 500 - 422 = 78
    expect(bounds).toEqual({
      x: 405,
      y: 78,
      width: 390,
      height: 844,
    });
  });

  it("centers Desktop preset correctly", () => {
    const desktop = FRAME_PRESETS.find((p) => p.name === "Desktop")!;
    expect(desktop).toBeDefined();
    expect(desktop.width).toBe(1440);
    expect(desktop.height).toBe(900);

    const bounds = presetFrameBounds(desktop, { x: 1000, y: 800 });
    // 1000 - 1440/2 = 1000 - 720 = 280
    // 800 - 900/2 = 800 - 450 = 350
    expect(bounds).toEqual({
      x: 280,
      y: 350,
      width: 1440,
      height: 900,
    });
  });

  it("dispatches create_preset_frame to store and selects the created frame", () => {
    resetStore();
    const phone = FRAME_PRESETS[0];
    const center = { x: 500, y: 400 };
    const id = "phone-frame-test";

    dispatch("create_preset_frame", { preset: phone, center, id });

    const doc = currentDoc();
    expect(doc.elements[id]).toBeDefined();
    expect(doc.elements[id].name).toBe("Phone");
    expect(doc.elements[id].width).toBe(390);
    expect(doc.elements[id].height).toBe(844);
    expect(doc.elements[id].x).toBe(305);
    expect(doc.elements[id].y).toBe(-22);

    select([id]);
    expect(getState().selection).toEqual([id]);
  });
});

describe("Edit's tools over the canvas", () => {
  it("hold the cutting tools and no drawing tools", () => {
    expect(EDIT_TOOLS.map((t) => t.label)).toEqual(["Select", "Blade", "Stretch", "Hand", "Zoom", "Comment"]);
    expect(EDIT_TOOLS.find((t) => t.label === "Blade")?.time).toBe("blade");
    expect(EDIT_TOOLS.find((t) => t.label === "Stretch")?.time).toBe("stretch");
  });

  it("V, H, Z and C put the blade or the stretch down; X and R do not", () => {
    expect(["v", "V", "h", "z", "c"].every(keyPutsDownEditTool)).toBe(true);
    expect(["x", "r", "s"].some(keyPutsDownEditTool)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  dabAlpha,
  pressureScale,
  smoothPoint,
  dabSpacing,
  stepDabs,
  worldToFile,
  fileToWorld,
  pictureCoverScale,
  parseColor,
  expandBox,
  touchedTiles,
  renderDabCanvas,
} from "./brush";
import {
  getBrushSettings,
  setBrushSettings,
  stepBrushSize,
} from "./brushSettings";
import type { Doc, El } from "../document/types";
import { SHORTCUTS } from "../ui/shortcuts";

describe("brush pure math and engine", () => {
  describe("dabAlpha", () => {
    it("returns 1 at center (r <= 0)", () => {
      expect(dabAlpha(0, 20, 0.5)).toBe(1);
      expect(dabAlpha(-5, 20, 0.5)).toBe(1);
    });

    it("returns 0 outside or at radius (r >= radius)", () => {
      expect(dabAlpha(20, 20, 0.5)).toBe(0);
      expect(dabAlpha(25, 20, 0.5)).toBe(0);
    });

    it("with softness 0 (hard edge), returns 1 everywhere inside radius", () => {
      expect(dabAlpha(5, 20, 0)).toBe(1);
      expect(dabAlpha(19.9, 20, 0)).toBe(1);
      expect(dabAlpha(20, 20, 0)).toBe(0);
    });

    it("with softness 0.5, returns 1 for r <= 10, then smooth cosine falloff to 0 at 20", () => {
      // inner = (1 - 0.5) * 20 = 10
      expect(dabAlpha(5, 20, 0.5)).toBe(1);
      expect(dabAlpha(10, 20, 0.5)).toBe(1);

      // midpoint of falloff: r = 15 => t = (15 - 10) / (20 - 10) = 0.5
      // cosine: 0.5 * (1 + cos(0.5 * PI)) = 0.5 * (1 + 0) = 0.5
      expect(dabAlpha(15, 20, 0.5)).toBeCloseTo(0.5, 5);
      expect(dabAlpha(20, 20, 0.5)).toBe(0);
    });

    it("with softness 1, falls off from center to radius", () => {
      // inner = 0
      expect(dabAlpha(0, 20, 1)).toBe(1);
      // midpoint r = 10 => t = 0.5 => alpha 0.5
      expect(dabAlpha(10, 20, 1)).toBeCloseTo(0.5, 5);
      expect(dabAlpha(20, 20, 1)).toBe(0);
    });
  });

  describe("pressureScale", () => {
    it("always returns 1 for mouse and non-pen inputs", () => {
      expect(pressureScale(0, "mouse")).toBe(1);
      expect(pressureScale(0.5, "mouse")).toBe(1);
      expect(pressureScale(1, "mouse")).toBe(1);
      expect(pressureScale(0, undefined)).toBe(1);
    });

    it("for pen: p=1 scales to 1, p=0 scales down to 0.2, with p^1.35 curve", () => {
      expect(pressureScale(1, "pen")).toBeCloseTo(1.0, 5);
      expect(pressureScale(0, "pen")).toBeCloseTo(0.2, 5);
      // for p = 0.5: 0.2 + 0.8 * (0.5^1.35)
      const expected = 0.2 + 0.8 * Math.pow(0.5, 1.35);
      expect(pressureScale(0.5, "pen")).toBeCloseTo(expected, 5);
    });
  });

  describe("smoothPoint", () => {
    it("applies exponential smoothing factor 0.5", () => {
      const p = smoothPoint({ x: 10, y: 20 }, { x: 30, y: 40 }, 0.5);
      expect(p).toEqual({ x: 20, y: 30 });
    });
  });

  describe("dabSpacing and stepDabs", () => {
    it("dab spacing is 12% of diameter", () => {
      expect(dabSpacing(100)).toBeCloseTo(12, 5);
      expect(dabSpacing(40)).toBeCloseTo(4.8, 5);
    });

    it("steps along segment placing dabs and tracking carry", () => {
      const p0 = { x: 0, y: 0 };
      const p1 = { x: 25, y: 0 };
      const spacing = 10;
      const res = stepDabs(p0, p1, 0, spacing);

      // dabs at 10 and 20
      expect(res.dabs.length).toBe(2);
      expect(res.dabs[0].x).toBeCloseTo(10, 5);
      expect(res.dabs[1].x).toBeCloseTo(20, 5);
      // 5 distance carried over to next segment
      expect(res.carry).toBeCloseTo(5, 5);

      // Next segment of length 7 with carry 5
      const p2 = { x: 32, y: 0 };
      const res2 = stepDabs(p1, p2, res.carry, spacing);
      // dab at distance 5 from p1 (x = 30)
      expect(res2.dabs.length).toBe(1);
      expect(res2.dabs[0].x).toBeCloseTo(30, 5);
      // carry 7 - 5 = 2
      expect(res2.carry).toBeCloseTo(2, 5);
    });
  });

  describe("coordinate conversions", () => {
    const fakeDoc: Doc = {
      version: 1,
      rootIds: ["img1"],
      elements: {
        img1: {
          id: "img1",
          type: "image",
          name: "Photo",
          x: 100,
          y: 50,
          width: 400,
          height: 300,
          rotation: 0,
          src: "assets/photo.png",
          paint: {},
        } as unknown as El,
      },
    };

    it("maps world to file with exact cover fit when dimensions match", () => {
      const el = fakeDoc.elements.img1;
      const picSize: [number, number] = [400, 300];
      const world = { x: 100, y: 50 }; // top-left
      const file = worldToFile(world, el, fakeDoc, picSize);
      expect(file.x).toBeCloseTo(0, 5);
      expect(file.y).toBeCloseTo(0, 5);

      const center = { x: 300, y: 200 }; // center
      const fileCenter = worldToFile(center, el, fakeDoc, picSize);
      expect(fileCenter.x).toBeCloseTo(200, 5);
      expect(fileCenter.y).toBeCloseTo(150, 5);

      expect(fileToWorld(fileCenter, el, fakeDoc, picSize)).toEqual({ x: 300, y: 200 });
    });

    it("maps world to file with rotation around center", () => {
      const el = { ...fakeDoc.elements.img1, rotation: 90 };
      const doc = { ...fakeDoc, elements: { img1: el } };
      const picSize: [number, number] = [400, 400];
      // center of element is at (100 + 200, 50 + 150) = (300, 200)
      const center = { x: 300, y: 200 };
      const fileCenter = worldToFile(center, el, doc, picSize);
      expect(fileCenter.x).toBeCloseTo(200, 5);
      expect(fileCenter.y).toBeCloseTo(200, 5);
    });

    it("calculates cover scale correctly", () => {
      const el = fakeDoc.elements.img1; // 400 x 300
      // picture is 800 x 300 -> scale = max(400/800, 300/300) = max(0.5, 1) = 1
      expect(pictureCoverScale(el, [800, 300])).toBe(1);
    });
  });

  describe("expandBox and touchedTiles", () => {
    it("expands boxes correctly", () => {
      const b1 = { x: 10, y: 10, width: 20, height: 20 };
      const b2 = { x: 5, y: 15, width: 30, height: 30 };
      const exp = expandBox(b1, b2);
      expect(exp).toEqual({ x: 5, y: 10, width: 30, height: 35 });
    });

    it("finds touched tiles clamped to picture file", () => {
      // 600 x 600 picture with PAINT_TILE 256
      // Cols: 0 (0..256), 1 (256..512), 2 (512..600, w=88)
      const box = { x: 200, y: 100, width: 100, height: 50 }; // x: 200..300 (touches cols 0 and 1)
      const tiles = touchedTiles(box, 600, 600, 256);
      expect(tiles.length).toBe(2);
      expect(tiles[0].key).toBe("0,0");
      expect(tiles[0].width).toBe(256);
      expect(tiles[1].key).toBe("1,0");
      expect(tiles[1].width).toBe(256);

      // Touch the edge tile
      const edgeBox = { x: 550, y: 550, width: 10, height: 10 };
      const edgeTiles = touchedTiles(edgeBox, 600, 600, 256);
      expect(edgeTiles.length).toBe(1);
      expect(edgeTiles[0].key).toBe("2,2");
      expect(edgeTiles[0].width).toBe(88); // 600 - 512 = 88
      expect(edgeTiles[0].height).toBe(88);
    });
  });

  describe("parseColor", () => {
    it("parses hex and rgb colors", () => {
      expect(parseColor("#000000")).toEqual([0, 0, 0]);
      expect(parseColor("#ffffff")).toEqual([255, 255, 255]);
      expect(parseColor("#ff0000")).toEqual([255, 0, 0]);
      expect(parseColor("#f00")).toEqual([255, 0, 0]);
      expect(parseColor("rgb(10, 20, 30)")).toEqual([10, 20, 30]);
    });
  });

  describe("brushSettings", () => {
    it("initializes with defaults and allows updates", () => {
      setBrushSettings({ size: 50, softness: 0.8, opacity: 0.9, colour: "#123456" });
      const s = getBrushSettings();
      expect(s.size).toBe(50);
      expect(s.softness).toBe(0.8);
      expect(s.opacity).toBe(0.9);
      expect(s.colour).toBe("#123456");
    });

    it("steps brush size up and down and clamps", () => {
      setBrushSettings({ size: 40 });
      expect(stepBrushSize(1)).toBe(45);
      expect(stepBrushSize(-1)).toBe(40);

      setBrushSettings({ size: 1 });
      expect(stepBrushSize(-1)).toBe(1);

      setBrushSettings({ size: 1000 });
      expect(stepBrushSize(1)).toBe(1000);
    });
  });

  describe("renderDabCanvas", () => {
    it("creates a canvas with the right dimensions", () => {
      const c = renderDabCanvas(20, 0.5, "#ff0000");
      expect(c.width).toBe(20);
      expect(c.height).toBe(20);
    });
  });

  describe("shortcuts", () => {
    it("includes brush and eraser shortcuts under Tools", () => {
      const toolShortcuts = SHORTCUTS.find((s) => s.group === "Tools")?.keys;
      expect(toolShortcuts).toBeDefined();
      expect(toolShortcuts).toContainEqual(["B", "Brush"]);
      expect(toolShortcuts).toContainEqual(["E", "Eraser"]);
      expect(toolShortcuts).toContainEqual(["[ and ]", "Brush smaller or bigger (Photo)"]);
    });
  });
});

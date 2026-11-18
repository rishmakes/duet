import { describe, expect, it } from "vitest";
import { fitMargin } from "./CanvasView";

describe("fitMargin", () => {
  it("keeps a small view's room small, so Fit does not shrink the picture to a speck", () => {
    expect(fitMargin(800, 340)).toBe(17);
  });
  it("never goes under 12 or over 120", () => {
    expect(fitMargin(100, 100)).toBe(12);
    expect(fitMargin(4000, 3000)).toBe(120);
  });
});

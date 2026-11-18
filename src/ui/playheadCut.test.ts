import { describe, expect, it } from "vitest";
import tsx from "./TimeStrip.tsx?raw";
import { HEAD_WINDOW, headX } from "./TimeStrip";

/**
 * The playhead on the timeline lanes must be cut off at the names column by how far the timeline has scrolled,
 * not hidden by whatever is drawn over it: that kept breaking (#327).
 */
describe("the playhead never shows in the names column", () => {
  it("shows only from the right edge of the names, moved by the scroll", () => {
    expect(HEAD_WINDOW).toBe("inset(0 0 0 calc(var(--sl, 0px) + var(--names, 150px)))");
  });

  it("is drawn inside that window, which is told how far the lanes have scrolled", () => {
    expect(tsx).toMatch(/<div className="time-head-clip" style=\{\{ clipPath: HEAD_WINDOW \}\}>\s*<div className="time-head"/);
    expect(tsx).toMatch(/onScroll=\{\(e\) => e\.currentTarget\.style\.setProperty\("--sl"/);
  });

  it("has a head in the ruler and a line below it, both at one whole-pixel position (#389)", () => {
    expect(headX(150, 1.234, 100)).toBe(273);
    expect(tsx).toMatch(/className="time-head-top" style=\{\{ left: headX\(NAMES, clock\.t, pps\) - NAMES \}\}/);
    expect(tsx).toMatch(/className="time-head" style=\{\{ left: headX\(NAMES, clock\.t, pps\) \}\}/);
  });
});

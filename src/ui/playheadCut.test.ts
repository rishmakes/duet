import { describe, expect, it } from "vitest";
import tsx from "./TimeStrip.tsx?raw";
import { HEAD_WINDOW } from "./TimeStrip";

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

  it("is one line, from the handle to the bottom, on a whole pixel (#389)", () => {
    expect(tsx).not.toContain("time-head-top");
    expect(tsx).toMatch(/className="time-head" style=\{\{ left: Math\.round\(/);
  });
});

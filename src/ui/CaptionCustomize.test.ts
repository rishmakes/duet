import { describe, expect, it } from "vitest";
import { slidTo } from "./CaptionCustomize";

describe("letting go of a slider in Customize (#404)", () => {
  it("keeps a drag, even though the value shown is already the preview", () => {
    // dragged from 10 to 40: the captions already show 40 when the slider is let go
    expect(slidTo(10, 40, 40)).toBe(true);
  });

  it("keeps nothing when the slider ends where it started", () => {
    expect(slidTo(10, 10, 10)).toBe(false);
  });

  it("checks a typed value against the value shown, when there was no drag", () => {
    expect(slidTo(null, 52, 60)).toBe(true);
    expect(slidTo(null, 52, 52)).toBe(false);
    expect(slidTo(null, 52, NaN)).toBe(false);
  });
});

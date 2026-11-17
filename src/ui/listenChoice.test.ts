import { describe, expect, it } from "vitest";
import { estimate, recommend, type Speed } from "./Transcribe";

// a slow computer: 10 s to load, 40 s for each 30 s stretch on Balanced
const slow: Speed = { balanced: { load: 10, perStretch: 40 } };
// a quick one: 1 s to load, 3 s a stretch
const quick: Speed = { balanced: { load: 1, perStretch: 3 } };

describe("how to listen (#364)", () => {
  it("knows nothing before this computer is timed", () => {
    expect(estimate("best", 60, {})).toBeNull();
    expect(recommend(60, {}, false)).toBe("balanced");
  });

  it("works out the other choices from the one that was timed", () => {
    expect(estimate("balanced", 60, slow)).toBe(2 + 10 + 2 * 40);
    expect(estimate("fast", 60, slow)!).toBeLessThan(estimate("balanced", 60, slow)!);
    expect(estimate("best", 60, slow)!).toBeGreaterThan(estimate("balanced", 60, slow)!);
  });

  it("uses a choice's own time once it has one", () => {
    expect(estimate("best", 30, { ...slow, best: { load: 5, perStretch: 7 } })).toBe(2 + 5 + 7);
  });

  it("suggests the best that finishes in about the clip's length", () => {
    expect(recommend(60, quick, false)).toBe("best");
    expect(recommend(60, slow, false)).toBe("fast");
    expect(recommend(600, { balanced: { load: 10, perStretch: 25 } }, false)).toBe("balanced");
  });

  it("never suggests Best words for Hinglish or Banglish", () => {
    expect(recommend(60, quick, true)).toBe("balanced");
  });
});

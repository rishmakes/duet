import { describe, expect, it } from "vitest";
import { oncePerFrame, slidTo } from "./CaptionCustomize";

/** A screen whose frames are run by hand. */
function screen() {
  const waiting = new Map<number, () => void>();
  let next = 1;
  return {
    frame: (cb: () => void) => {
      waiting.set(next, cb);
      return next++;
    },
    unframe: (id: number) => void waiting.delete(id),
    draw() {
      const now = [...waiting.values()];
      waiting.clear();
      now.forEach((cb) => cb());
    },
  };
}

describe("a slider in Customize (#404 shadow lag)", () => {
  it("redraws the captions once per frame, with the newest value", () => {
    const s = screen();
    const seen: number[] = [];
    const f = oncePerFrame<number>((n) => seen.push(n), s.frame, s.unframe);
    for (const n of [10, 14, 19, 25]) f.run(n);
    s.draw();
    expect(seen).toEqual([25]);
    f.run(30);
    s.draw();
    expect(seen).toEqual([25, 30]);
  });

  it("drops a waiting change when the slider is let go", () => {
    const s = screen();
    const seen: number[] = [];
    const f = oncePerFrame<number>((n) => seen.push(n), s.frame, s.unframe);
    f.run(40);
    f.cancel();
    s.draw();
    expect(seen).toEqual([]);
  });
});

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

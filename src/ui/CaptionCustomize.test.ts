import { describe, expect, it } from "vitest";
import { oncePerFrame } from "./CaptionCustomize";

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

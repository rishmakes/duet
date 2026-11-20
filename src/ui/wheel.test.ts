import { describe, expect, it } from "vitest";
import { isMouseWheel, wheelZoomFactor } from "./wheel";

const wheel = (deltaY: number, timeStamp: number, deltaX = 0) => ({ deltaMode: 0, deltaX, deltaY, timeStamp }) as unknown as WheelEvent;

describe("isMouseWheel, with numbers taken from a real mouse and trackpad", () => {
  it("takes a mouse notch as a wheel once its fractions arrive", () => {
    expect(isMouseWheel(wheel(4, 1000))).toBe(false);
    expect(isMouseWheel(wheel(39.84, 1016))).toBe(true);
    expect(isMouseWheel(wheel(131.68, 1076))).toBe(true);
  });
  it("takes a big whole step with nothing sideways as a wheel, off a Mac (a Windows notch)", () => {
    expect(isMouseWheel(wheel(-120, 5000), false)).toBe(true);
  });
  it("on a Mac, a fast trackpad flick of big whole steps scrolls and never zooms (#402)", () => {
    for (const [d, t] of [[48, 30000], [77, 30033], [112, 30066], [63, 30100]]) expect(isMouseWheel(wheel(d, t), true)).toBe(false);
  });
  it("takes the trackpad's small whole steps as a slide, sideways or not", () => {
    expect(isMouseWheel(wheel(7, 9000))).toBe(false);
    expect(isMouseWheel(wheel(25, 9033, 5))).toBe(false);
    expect(isMouseWheel(wheel(16, 9066))).toBe(false);
  });
  it("lets go of the wheel a moment after it stops", () => {
    expect(isMouseWheel(wheel(34.5, 20000))).toBe(true);
    expect(isMouseWheel(wheel(7, 20500))).toBe(false);
  });
});

describe("wheelZoomFactor", () => {
  it("zooms in when turned one way and out the other, by the same amount", () => {
    expect(wheelZoomFactor(wheel(-40, 0))).toBeGreaterThan(1);
    expect(wheelZoomFactor(wheel(40, 0)) * wheelZoomFactor(wheel(-40, 0))).toBeCloseTo(1);
  });
});

describe("a whole notch of the creator's mouse", () => {
  it("zooms about one and a half times, not more", () => {
    const steps = [4, 35, 130, 150];
    const total = steps.reduce((z, d) => z * wheelZoomFactor(wheel(-d, 0)), 1);
    expect(total).toBeGreaterThan(1.4);
    expect(total).toBeLessThan(1.9);
  });
});

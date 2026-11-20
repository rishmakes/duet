import { describe, expect, it } from "vitest";
import { alphaToLuminance, convertLuminanceToAlpha, newMaskSize } from "./layerMask";

describe("layer mask pixels", () => {
  it("white shows, black hides, grey is see-through", () => {
    const buf = new Uint8ClampedArray([255, 255, 255, 0, 0, 0, 0, 0, 128, 128, 128, 0]);
    convertLuminanceToAlpha(buf, false);
    expect([buf[3], buf[7], buf[11]]).toEqual([255, 0, 128]);
    convertLuminanceToAlpha(buf, true);
    expect([buf[3], buf[7], buf[11]]).toEqual([0, 255, 127]);
  });

  it("what was painted saves back to the same black and white, inverted or not", () => {
    for (const invert of [false, true]) {
      const grey = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 100, 100, 100, 255]);
      const buf = grey.slice();
      convertLuminanceToAlpha(buf, invert);
      alphaToLuminance(buf, invert);
      expect([...buf]).toEqual([...grey]);
    }
  });

  it("a new mask matches the picture, or is twice the layer, never over 2048", () => {
    expect(newMaskSize({ width: 100, height: 50 }, [800, 400])).toEqual([800, 400]);
    expect(newMaskSize({ width: 300, height: 100 })).toEqual([600, 200]);
    expect(newMaskSize({ width: 100, height: 100 }, [6000, 3000])).toEqual([2048, 1024]);
  });
});

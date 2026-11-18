import { describe, expect, it } from "vitest";
import { EDIT_EDGE, typingBox } from "./handles";

describe("typingBox", () => {
  it("is the words' box pushed out to the middle of the typing box's border, so the handles sit on its outline", () => {
    const b = typingBox({ x: 100, y: 50, width: 200, height: 80 });
    const out = EDIT_EDGE - 0.75;
    expect(b).toEqual({ x: 100 - out, y: 50 - out, width: 200 + out * 2, height: 80 + out * 2 });
  });
});

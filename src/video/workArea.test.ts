import { describe, expect, it } from "vitest";
import { soundsBetween } from "./scene";

describe("export of a work area", () => {
  it("cuts each sound to the part made, timed from its start", () => {
    const list = [
      { path: "/a.mp4", from: 0, at: 0, length: 10, volume: 1, speed: 1 },
      { path: "/b.mp4", from: 5, at: 12, length: 4, volume: 1, speed: 2 },
      { path: "/c.mp3", from: 0, at: 25, length: 3, volume: 1, speed: 1 },
    ];
    expect(soundsBetween(list, 8, 20)).toEqual([
      { path: "/a.mp4", from: 8, at: 0, length: 2, volume: 1, speed: 1 },
      { path: "/b.mp4", from: 5, at: 4, length: 4, volume: 1, speed: 2 },
    ]);
    expect(soundsBetween(list, 13, 14)).toEqual([{ path: "/b.mp4", from: 7, at: 0, length: 1, volume: 1, speed: 2 }]);
  });
});

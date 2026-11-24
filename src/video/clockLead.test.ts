import { describe, expect, it } from "vitest";
import { arrivesBehind, clockLead } from "./clips";

describe("clockLead", () => {
  it("lets a clip on time or ahead set the clock", () => {
    expect(clockLead(52.5, 52.5)).toBe(52.5);
    expect(clockLead(52.8, 52.5)).toBe(52.8);
  });
  it("never lets a clip move the clock back", () => {
    expect(clockLead(52.46, 52.5)).toBe(52.5);
  });
  it("lets a late clip go, so the clock does not wait for it (the 52 s stall in day 041)", () => {
    expect(clockLead(52.2, 52.5)).toBeNull();
  });
  it("lets a clip far ahead go too", () => {
    expect(clockLead(54, 52.5)).toBeNull();
  });
});

describe("arrivesBehind (#424)", () => {
  it("spots a second half that starts before its first sound, so it would repeat the half before it", () => {
    // measured in Duet dev: the player was at 4.801 s of the file when the cut asked for 5.019 s
    expect(arrivesBehind(4.801, 5.0)).toBe(true);
  });
  it("lets a player that is on its place, or ahead of it, play", () => {
    expect(arrivesBehind(5.0, 5.0)).toBe(false);
    expect(arrivesBehind(4.995, 5.0)).toBe(false);
    expect(arrivesBehind(5.2, 5.0)).toBe(false);
  });
});

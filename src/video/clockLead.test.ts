import { describe, expect, it } from "vitest";
import { clockLead } from "./clips";

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

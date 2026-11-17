import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => undefined }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));

import { secondsLeft, shownPercent } from "./Transcribe";

describe("progress while Duet listens (#354)", () => {
  it("shows nothing before listening starts", () => {
    expect(shownPercent({ stage: "model", percent: 0, started: 0 }, 5000)).toBe(0);
    expect(secondsLeft({ stage: "model", percent: 0, started: 0 }, 5000)).toBeNull();
  });

  it("creeps on between the model's reports, but never past the next stretch", () => {
    // 60 s of sound: two stretches; the first took 100 s
    const h = { stage: "hear" as const, percent: 50, seconds: 60, started: 0, hearFrom: 0, lastAt: 100_000 };
    expect(shownPercent(h, 100_000)).toBe(50);
    expect(shownPercent(h, 150_000)).toBe(75);
    expect(shownPercent(h, 900_000)).toBe(95);
    // about as long again for the second half
    expect(Math.round(secondsLeft(h, 100_000)!)).toBe(100);
  });

  it("moves slowly before the first report, so it never looks stuck", () => {
    const h = { stage: "hear" as const, percent: 0, seconds: 40, started: 0, hearFrom: 0 };
    expect(shownPercent(h, 30_000)).toBeGreaterThan(0);
    expect(shownPercent(h, 30_000)).toBeLessThan(50);
  });
});

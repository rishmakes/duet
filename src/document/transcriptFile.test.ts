import { describe, expect, it } from "vitest";
import { srtTime, toSrt, toTxt, transcriptLines } from "./transcriptFile";
import type { EditWord } from "./words";

const w = (word: string, s: number, e: number): EditWord => ({ w: word, s, e, clip: "c", fs: s, fe: e });

describe("transcript files", () => {
  it("writes seconds as an SRT time", () => {
    expect(srtTime(0)).toBe("00:00:00,000");
    expect(srtTime(62.5)).toBe("00:01:02,500");
    expect(srtTime(3661.234)).toBe("01:01:01,234");
    expect(srtTime(-1)).toBe("00:00:00,000");
  });

  it("starts a new line after a long pause or a full stop", () => {
    const words = [w("Hello", 0, 0.4), w("there.", 0.5, 0.9), w("Next", 1, 1.3), w("one", 1.4, 1.7), w("after", 3, 3.4)];
    expect(transcriptLines(words).map((r) => r.map((x) => x.w).join(" "))).toEqual(["Hello there.", "Next one", "after"]);
  });

  it("writes numbered SRT lines with their times", () => {
    const words = [w("Hello", 1, 1.4), w("there.", 1.5, 2), w("Bye", 4, 4.5)];
    expect(toSrt(words)).toBe("1\n00:00:01,000 --> 00:00:02,000\nHello there.\n\n2\n00:00:04,000 --> 00:00:04,500\nBye\n");
  });

  it("keeps a one-word line up long enough to read and never into the next line", () => {
    expect(toSrt([w("Hi", 1, 1.1)])).toContain("00:00:01,000 --> 00:00:01,400");
    const tight = toSrt([w("One.", 0, 0.2), w("Two", 0.25, 0.5)]);
    expect(tight).toContain("00:00:00,000 --> 00:00:00,250");
  });

  it("writes plain text, and nothing when there are no words", () => {
    expect(toTxt([w("Hello", 0, 0.4), w("there.", 0.5, 0.9), w("Bye", 3, 3.4)])).toBe("Hello there.\nBye\n");
    expect(toTxt([])).toBe("");
    expect(toSrt([])).toBe("");
  });
});

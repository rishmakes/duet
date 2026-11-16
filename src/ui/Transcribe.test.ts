import { describe, expect, it } from "vitest";
import { LANGUAGES, plainLetters } from "./Transcribe";

describe("transcribe languages", () => {
  it("Hinglish and Banglish are heard to come out in English letters", () => {
    for (const k of ["hi-en", "bn-en"]) {
      const l = LANGUAGES.find((x) => x.key === k)!;
      expect(l.code).toBe("en");
      expect(l.prompt && /^[\x20-\x7e]+$/.test(l.prompt)).toBe(true);
    }
  });
  it("a word keeps only plain letters", () => {
    expect(plainLetters("ná")).toBe("na");
    expect(plainLetters("bhalo")).toBe("bhalo");
  });
});

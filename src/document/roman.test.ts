import { describe, expect, it } from "vitest";
import { inEnglishLetters } from "./roman";
import { readWords, withWords } from "./words";
import { emptyDoc } from "./types";

describe("words in English letters", () => {
  it("writes Hindi the way people type Hinglish", () => {
    const said = "और गाइस मैं तो बता नहीं भूल गया था यहां करके भी आप कर सकते हो";
    expect(said.split(" ").map(inEnglishLetters)).toEqual(["aur", "gaais", "main", "to", "bata", "nahin", "bhool", "gaya", "tha", "yahan", "karke", "bhi", "aap", "kar", "sakte", "ho"]);
  });

  it("writes Bengali the way people type Banglish", () => {
    expect("আমি ভালো আছি কেমন".split(" ").map(inEnglishLetters)).toEqual(["ami", "bhalo", "achhi", "kemon"]);
  });

  it("leaves English and punctuation as they are", () => {
    expect(inEnglishLetters("color")).toBe("color");
    expect(inEnglishLetters("है?")).toBe("hai?");
    expect(inEnglishLetters("हूँ,")).toBe("hoon,");
  });

  it("keeps every transcript in English letters, set now or read from an older file", () => {
    const doc = withWords(emptyDoc(), "/a.mp4", { language: "hi-en", model: "medium", words: [{ w: "मैं", s: 0, e: 0.3 }] });
    expect(doc.words?.["/a.mp4"].words[0].w).toBe("main");
    const old = readWords({ "/a.mp4": { language: "hi-en", model: "medium", words: [{ w: "ठीक", s: 0, e: 0.3 }] } });
    expect(old?.["/a.mp4"].words[0].w).toBe("theek");
  });
});

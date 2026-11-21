import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { parseDoc, serializeDoc } from "../document/serialize";
import { emptyDoc } from "../document/types";
import { faceFor, isShortWord, lineWidths, wrapLines } from "./text";
import type { TextFace } from "./text";

const face: TextFace = { fontFamily: "Montserrat", fontWeight: 800, fontSize: 60, lineHeight: 1.2, letterSpacing: 0 };

describe("a caption's second font (#404)", () => {
  it("sets only the last word in it", () => {
    const f = { ...face, font2: "Dancing Script", font2Words: "last" as const };
    expect(faceFor("content", 0, 2, f).fontFamily).toBe("Montserrat");
    expect(faceFor("audience", 2, 2, f).fontFamily).toBe("Dancing Script");
  });

  it("sets short words in it: two letters or fewer, not counting marks", () => {
    const f = { ...face, font2: "Dancing Script", font2Words: "short" as const };
    expect(faceFor("to", 1, 5, f).fontFamily).toBe("Dancing Script");
    expect(faceFor("it's", 1, 5, f).fontFamily).toBe("Montserrat");
    expect(isShortWord("A,")).toBe(true);
    expect(isShortWord("you")).toBe(false);
  });

  it("leaves every word in the first font when no second font is set", () => {
    expect(faceFor("to", 0, 0, face)).toBe(face);
    expect(faceFor("to", 0, 0, { ...face, font2Words: "short" }).fontFamily).toBe("Montserrat");
  });

  it("measures and wraps the same as before when there is no second font", () => {
    const lines = wrapLines("content to make your audience", face, 500);
    expect(lines.length).toBeGreaterThan(1);
    expect(lineWidths(lines, face).every((w) => w > 0 && w <= 500)).toBe(true);
  });

  it("keeps the second font in the saved file and refits the caption", () => {
    let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1080, height: 1920 });
    doc = runCommand(doc, "create_element", { type: "text", id: "c", parentId: "f", x: 0, y: 0, width: 400, height: 80 });
    doc = runCommand(doc, "set_props", { ids: ["c"], props: { text: "make your audience" } });
    doc = runCommand(doc, "set_props", { ids: ["c"], props: { font2: "Dancing Script", font2Words: "last" } });
    const back = parseDoc(serializeDoc(doc)).elements.c;
    expect(back.font2).toBe("Dancing Script");
    expect(back.font2Words).toBe("last");
  });
});

describe("capitals with a second font (#404)", () => {
  it("keeps second-font words as said", async () => {
    const { capitals } = await import("./text");
    expect(capitals("make your audience", { ...face, font2: "Dancing Script", font2Words: "last" })).toBe("MAKE YOUR audience");
    expect(capitals("go to it", { ...face, font2: "Dancing Script", font2Words: "short" })).toBe("go to it");
    expect(capitals("make it", face)).toBe("MAKE IT");
  });
});

describe("caption lines (#404)", () => {
  it("puts one word under another, or two even lines", async () => {
    const { breakWords } = await import("./text");
    expect(breakWords("be a doer", face, "stack")).toBe("be\na\ndoer");
    expect(breakWords("one two three four", face, "two")).toBe("one two\nthree four");
    expect(breakWords("alone", face, "two")).toBe("alone");
    expect(breakWords("as it is", face, undefined)).toBe("as it is");
  });
});

import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { parseDoc, serializeDoc } from "./serialize";
import { litAt } from "./time";
import { emptyDoc } from "./types";
import type { El } from "./types";
import { popScale } from "../canvas/render";

function caption(props: Partial<El>): El {
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1080, height: 1920 });
  doc = runCommand(doc, "create_element", { type: "text", id: "c", parentId: "f", x: 0, y: 0, width: 600, height: 80 });
  doc = runCommand(doc, "set_props", { ids: ["c"], props: { text: "one two three" } });
  doc = runCommand(doc, "set_props", { ids: ["c"], props: { spoken: [0, 0.5, 1], ...props } });
  return doc.elements.c;
}

describe("caption words that arrive as they are said (#404)", () => {
  it("marks no word before the first is said, so none shows yet", () => {
    expect(litAt(caption({ arrive: "word" }), 0 - 0.2).lit).toBe(-1);
  });

  it("marks the word being said and how long ago it started", () => {
    const el = litAt(caption({ arrive: "pop" }), 0.6);
    expect(el.lit).toBe(1);
    expect(el.litSince).toBeCloseTo(0.1);
  });

  it("leaves a caption alone that neither lights nor reveals its words", () => {
    const el = caption({});
    expect(litAt(el, 0.6)).toBe(el);
  });

  it("still lights the spoken word in colour without arriving", () => {
    const el = litAt(caption({ spokenFill: "#ffe14d" }), 1.2);
    expect(el.lit).toBe(2);
  });

  it("pops a word from half its size and settles at full size", () => {
    expect(popScale(0)).toBeCloseTo(0.5);
    expect(Math.max(...[0.08, 0.1, 0.12, 0.14].map(popScale))).toBeGreaterThan(1);
    expect(popScale(0.18)).toBe(1);
    expect(popScale(2)).toBe(1);
  });

  it("keeps a bold spoken word and the way words arrive in the saved file", () => {
    let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1080, height: 1920 });
    doc = runCommand(doc, "create_element", { type: "text", id: "c", parentId: "f", x: 0, y: 0, width: 600, height: 80 });
    doc = runCommand(doc, "set_props", { ids: ["c"], props: { text: "one two" } });
    doc = runCommand(doc, "set_props", { ids: ["c"], props: { spoken: [0, 0.5], spokenFill: "#ffffff", spokenBold: true, arrive: "pop" } });
    const back = parseDoc(serializeDoc(doc)).elements.c;
    expect(back.spokenBold).toBe(true);
    expect(back.arrive).toBe("pop");
    expect(back.litSince).toBeUndefined();
  });
});

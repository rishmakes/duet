import { describe, expect, it } from "vitest";
import { runCommand } from "./index";
import { emptyDoc } from "../document/types";
import type { Doc } from "../document/types";
import { captionChunks } from "../document/captions";
import { wordsOfEdit } from "../document/words";

// "so today we um talk about money" with a long pause after "today"
const words = [
  { w: "So", s: 0.2, e: 0.5 },
  { w: "today", s: 0.6, e: 1.0 },
  { w: "we", s: 2.0, e: 2.2 },
  { w: "um,", s: 2.3, e: 2.6 },
  { w: "talk", s: 2.7, e: 3.0 },
  { w: "about", s: 3.1, e: 3.4 },
  { w: "money.", s: 3.5, e: 4.0 },
];

function talk() {
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1080, height: 1920 });
  doc = runCommand(doc, "set_duration", { id: "f", seconds: 6 });
  doc = runCommand(doc, "create_element", { type: "video", id: "v", parentId: "f", x: 0, y: 0, width: 1080, height: 1920, props: { src: "/talk.mp4", start: 0, end: 6 } });
  return runCommand(doc, "set_words", { src: "/talk.mp4", transcript: { language: "en", model: "medium", words } });
}

const captions = (doc: Doc) =>
  doc.elements.f.childIds
    .map((id) => doc.elements[id])
    .filter((el) => el.type === "text")
    .sort((a, b) => a.start - b.start);

describe("captions", () => {
  it("groups words a few at a time, breaking at a pause and keeping no gap between close captions", () => {
    const chunks = captionChunks(wordsOfEdit(talk(), "f"), 3);
    expect(chunks.map((c) => c.text)).toEqual(["So today", "we um, talk", "about money."]);
    // a pause after "today": the first caption lingers a little, then stops
    expect(chunks[0]).toMatchObject({ start: 0.2, end: 1.3 });
    // "talk" runs straight into "about"
    expect(chunks[1]).toMatchObject({ start: 2.0, end: 3.1 });
  });

  it("puts plain texts on a Captions track at the top, each showing while its words are said", () => {
    const doc = runCommand(talk(), "add_captions", { sceneId: "f", look: "bold", per: 3 });
    const list = captions(doc);
    expect(list.map((el) => el.text)).toEqual(["SO TODAY", "WE UM TALK", "ABOUT MONEY"]);
    const track = doc.elements.f.tracks?.[0];
    expect(track?.name).toBe("Captions");
    expect(list.every((el) => el.track === track?.id && el.textAlign === "center" && el.fontWeight === 900)).toBe(true);
    // in front of the video, inside the frame, clear of the bottom
    expect(doc.elements.f.childIds.indexOf(list[0].id)).toBeGreaterThan(doc.elements.f.childIds.indexOf("v"));
    expect(list[0].y + list[0].height).toBeLessThan(1920 * 0.8);
  });

  it("replaces the captions it made before, so another look just swaps them", () => {
    let doc = runCommand(talk(), "add_captions", { sceneId: "f", look: "bold", per: 3 });
    doc = runCommand(doc, "add_captions", { sceneId: "f", look: "one", per: 3 });
    const list = captions(doc);
    expect(list.map((el) => el.text)).toEqual(["SO", "TODAY", "WE", "UM", "TALK", "ABOUT", "MONEY"]);
    expect(doc.elements.f.tracks?.filter((t) => t.name === "Captions")).toHaveLength(1);
  });

  it("keeps quiet captions as they were said, and changes nothing without words", () => {
    const doc = runCommand(talk(), "add_captions", { sceneId: "f", look: "quiet", per: 6 });
    expect(captions(doc).map((el) => el.text)).toEqual(["So today", "we um, talk about money."]);
    const bare = runCommand(talk(), "set_words", { src: "/talk.mp4", transcript: null });
    expect(runCommand(bare, "add_captions", { sceneId: "f", look: "bold", per: 3 })).toBe(bare);
  });
});

describe("the spoken word", () => {
  it("lights up each word of a caption while it is said, and is kept in the file", async () => {
    const { docAt } = await import("../document/time");
    const { parseDoc, serializeDoc } = await import("../document/serialize");
    const doc = runCommand(talk(), "add_captions", { sceneId: "f", look: "bold", per: 3, spokenFill: "#ffe14d" });
    const second = captions(doc)[1];
    expect(second.spoken).toEqual([0, 0.3, 0.7]);
    const at = (t: number) => docAt(doc, "f", t).elements[second.id].lit;
    expect(at(2.1)).toBe(0);
    expect(at(2.4)).toBe(1);
    expect(at(2.95)).toBe(2);
    const back = parseDoc(serializeDoc(doc)).elements[second.id];
    expect(back.spoken).toEqual([0, 0.3, 0.7]);
    expect(back.spokenFill).toBe("#ffe14d");
    expect(serializeDoc(doc)).not.toContain('"lit"');
  });

  it("leaves one word captions and captions with no colour unlit", () => {
    const one = runCommand(talk(), "add_captions", { sceneId: "f", look: "one", per: 3, spokenFill: "#ffe14d" });
    expect(captions(one).every((el) => !el.spoken)).toBe(true);
    const plain = runCommand(talk(), "add_captions", { sceneId: "f", look: "bold", per: 3 });
    expect(captions(plain).every((el) => !el.spoken)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { runCommand } from "./index";
import { emptyDoc } from "../document/types";
import type { Doc } from "../document/types";
import { captionChunks, captionMates, captionWords, captionsIn, lookNow } from "../document/captions";
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
    expect(list.map((el) => el.text)).toEqual(["So today", "we um talk", "about money"]);
    expect(list.every((el) => el.caps)).toBe(true);
    const track = doc.elements.f.tracks?.[0];
    expect(track?.name).toBe("Captions");
    expect(list.every((el) => el.track === track?.id && el.textAlign === "center" && el.fontWeight === 900)).toBe(true);
    // in front of the video, inside the frame, clear of the bottom
    expect(doc.elements.f.childIds.indexOf(list[0].id)).toBeGreaterThan(doc.elements.f.childIds.indexOf("v"));
    expect(list[0].y + list[0].height).toBeLessThan(1920 * 0.8);
    // as wide as its words, centred, never wider than most of the frame
    expect(list[0].width).toBeLessThan(1080 * 0.84);
    expect(Math.abs(list[0].x + list[0].width / 2 - 540)).toBeLessThanOrEqual(1);
  });

  it("replaces the captions it made before, so another look just swaps them", () => {
    let doc = runCommand(talk(), "add_captions", { sceneId: "f", look: "bold", per: 3 });
    doc = runCommand(doc, "add_captions", { sceneId: "f", look: "one", per: 3 });
    const list = captions(doc);
    expect(list.map((el) => el.text)).toEqual(["So", "today", "we", "um", "talk", "about", "money"]);
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

describe("caption looks", () => {
  it("restyles captions fully, keeping their words, their timing and their middle", async () => {
    const { parseDoc, serializeDoc } = await import("../document/serialize");
    let doc = runCommand(talk(), "add_captions", { sceneId: "f", look: "bold", per: 3, spokenFill: "#7cf2c9" });
    const before = captions(doc)[1];
    doc = runCommand(doc, "style_captions", { ids: captions(doc).map((el) => el.id), look: "pill" });
    const pill = doc.elements[before.id];
    expect(pill.text).toBe(before.text);
    expect(pill.spoken).toEqual(before.spoken);
    expect(pill.spokenFill).toBe("#7cf2c9");
    expect(pill.plate?.fill).toBe("#111013");
    expect(pill.caps).toBeUndefined();
    expect(pill.shadow).toBeNull();
    expect(Math.abs(pill.y + pill.height / 2 - (before.y + before.height / 2))).toBeLessThanOrEqual(1);
    // a boxed look lights the word in its own colour, and the box is kept in the file
    doc = runCommand(doc, "style_captions", { ids: [before.id], look: "line" });
    const line = parseDoc(serializeDoc(doc)).elements[before.id];
    expect(line.spokenBox).toBe(true);
    expect(line.spokenFill).toBe("#e5383b");
    expect(line.plate?.each).toBeUndefined();
    // back to a plain look: the box and the box colour go
    doc = runCommand(doc, "style_captions", { ids: [before.id], look: "bold" });
    expect(doc.elements[before.id].plate).toBeUndefined();
    expect(doc.elements[before.id].spokenBox).toBeUndefined();
    expect(doc.elements[before.id].spokenFill).toBe("#ffe14d");
  });

  it("styles text typed by hand too, and ignores anything else", () => {
    let doc = runCommand(talk(), "create_element", { type: "text", id: "t", parentId: "f", x: 100, y: 100, width: 200, height: 40, props: { text: "Hello there" } });
    doc = runCommand(doc, "style_captions", { ids: ["t", "v"], look: "box" });
    expect(doc.elements.t.plate?.each).toBe(true);
    expect(doc.elements.t.text).toBe("Hello there");
    expect(doc.elements.v.plate).toBeUndefined();
  });

  it("gives the loud looks an outline and a font, and takes them away again", async () => {
    const { parseDoc, serializeDoc } = await import("../document/serialize");
    let doc = runCommand(talk(), "add_captions", { sceneId: "f", look: "outline", per: 3, spokenFill: "#7cf2c9" });
    const id = captions(doc)[0].id;
    const saved = parseDoc(serializeDoc(doc)).elements[id];
    expect(saved.stroke).toBe("#000000");
    expect(saved.strokeWidth).toBeGreaterThan(1);
    expect(saved.fontFamily).toBe("Montserrat");
    expect(saved.spokenFill).toBe("#7cf2c9");
    doc = runCommand(doc, "style_captions", { ids: [id], look: "quiet" });
    expect(doc.elements[id].stroke).toBeNull();
    expect(doc.elements[id].fontFamily).toBe("Inter");
  });

  it("Dim lights the spoken word white, and keeps text with no spoken words bright", () => {
    let doc = runCommand(talk(), "add_captions", { sceneId: "f", look: "dim", per: 3, spokenFill: "#7cf2c9" });
    expect(captions(doc)[0].spokenFill).toBe("#ffffff");
    doc = runCommand(doc, "create_element", { type: "text", id: "t", parentId: "f", x: 100, y: 100, width: 200, height: 40, props: { text: "Hello" } });
    doc = runCommand(doc, "style_captions", { ids: ["t"], look: "dim" });
    expect(doc.elements.t.fill).toBe("#ffffff");
  });
  it("keeps a caption centred when its words are edited", () => {
    const doc = runCommand(talk(), "add_captions", { sceneId: "f", look: "bold", per: 3 });
    const c = captions(doc)[0];
    const middle = c.x + c.width / 2;
    const edited = runCommand(doc, "set_props", { ids: [c.id], props: { text: "So today we talk money" } }).elements[c.id];
    expect(edited.width).not.toBe(c.width);
    expect(Math.abs(edited.x + edited.width / 2 - middle)).toBeLessThanOrEqual(1);
  });
  it("a change to one caption's look reaches every caption, its words stay its own", () => {
    const doc = runCommand(talk(), "add_captions", { sceneId: "f", look: "bold", per: 3 });
    const [a, b] = captions(doc);
    expect(captionMates(doc, [a.id], { fill: "#ff0000" })).toEqual(expect.arrayContaining(captions(doc).map((c) => c.id)));
    expect(captionMates(doc, [a.id], { text: "Hello" })).toEqual([a.id]);
    expect(captionMates(doc, [a.id], { fill: "#ff0000", x: 4 })).toEqual([a.id]);
    expect(b.id).not.toBe(a.id);
  });

  it("finds a video's captions and the look they have, until the designer makes it their own", () => {
    let doc = runCommand(talk(), "add_captions", { sceneId: "f", look: "outline", per: 3 });
    const ids = captionsIn(doc, "f");
    expect(ids).toEqual(captions(doc).map((el) => el.id));
    expect(captionsIn(doc, null)).toEqual([]);
    expect(lookNow(doc.elements[ids[0]], doc.elements.f)).toBe("outline");
    doc = runCommand(doc, "style_captions", { ids, look: "box" });
    expect(lookNow(doc.elements[ids[0]], doc.elements.f)).toBe("box");
    doc = runCommand(doc, "set_props", { ids, props: { fontSize: 99 } });
    expect(lookNow(doc.elements[ids[0]], doc.elements.f)).toBeNull();
  });
  it("leaves out sound tags and a word said twice in a row", () => {
    const heard = ["[music]", "go", "there", "There,", "*pew*", "(laughs)", "now", "♪"].map((w, i) => ({ w, s: i, e: i + 0.5, clip: "v", src: "/a.mp4" }));
    expect(captionWords(heard as never).map((w) => w.w)).toEqual(["go", "there", "now"]);
  });
});

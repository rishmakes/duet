import { describe, expect, it } from "vitest";
import { runCommand } from "../commands/index";
import { parseDoc, serializeDoc } from "./serialize";
import { emptyDoc } from "./types";
import type { Doc, El, Transcript } from "./types";
import { cutOutOfEdit, wordsOfEdit } from "./words";

const talk: Transcript = {
  language: "hi",
  model: "medium",
  words: [
    { w: "Toh", s: 0.1, e: 0.4 },
    { w: "toh", s: 0.5, e: 0.8 },
    { w: "aaj", s: 1.0, e: 1.3 },
    { w: "hum", s: 1.4, e: 1.7 },
    { w: "baat", s: 3.0, e: 3.4 },
    { w: "karenge", s: 3.5, e: 4.0 },
  ],
};

/** A 10 s scene with one clip of /talk.mp4 showing its whole file, with words. */
function scene(): { doc: Doc; sceneId: string; clipId: string } {
  const sceneId = "scene";
  const clipId = "clip";
  const doc = emptyDoc();
  const base = Object.values(runCommand(emptyDoc(), "create_element", { id: "x", type: "rect", x: 0, y: 0, width: 1, height: 1 }).elements)[0];
  const frame: El = { ...base, id: sceneId, type: "frame", name: "Talk", width: 1920, height: 1080, duration: 10, childIds: [clipId], parentId: null };
  const clip: El = { ...base, id: clipId, type: "video", name: "talk", src: "/talk.mp4", parentId: sceneId, start: 0, end: 10, clipFrom: 0, speed: 1, volume: 1, childIds: [] };
  const d: Doc = { ...doc, rootIds: [sceneId], elements: { [sceneId]: frame, [clipId]: clip } };
  return { doc: runCommand(d, "set_words", { src: "/talk.mp4", transcript: talk }), sceneId, clipId };
}

describe("words of an edit", () => {
  it("are kept with the recording and never mutate the design", () => {
    const { doc } = scene();
    expect(doc.words?.["/talk.mp4"].words).toHaveLength(6);
    const without = runCommand(doc, "set_words", { src: "/talk.mp4", transcript: null });
    expect(without.words).toBeUndefined();
    expect(doc.words?.["/talk.mp4"]).toBeDefined();
  });

  it("follow a trim: the words of the part a clip shows, at the moment they are heard", () => {
    const { doc, sceneId, clipId } = scene();
    // the clip starts 0.9 s into its file and sits 2 s into the scene
    const trimmed: Doc = { ...doc, elements: { ...doc.elements, [clipId]: { ...doc.elements[clipId], clipFrom: 0.9, start: 2, end: 4 } } };
    const words = wordsOfEdit(trimmed, sceneId);
    expect(words.map((w) => w.w)).toEqual(["aaj", "hum"]);
    expect(words[0].s).toBeCloseTo(2.1);
    expect(words[0].fs).toBeCloseTo(1.0);
    const cut = cutOutOfEdit(trimmed, sceneId);
    expect(cut.map((c) => c.words)).toEqual([["Toh", "toh"], ["baat", "karenge"]]);
  });

  it("follow speed: twice as fast, words come twice as soon", () => {
    const { doc, sceneId, clipId } = scene();
    const fast: Doc = { ...doc, elements: { ...doc.elements, [clipId]: { ...doc.elements[clipId], speed: 2, end: 5 } } };
    const words = wordsOfEdit(fast, sceneId);
    expect(words).toHaveLength(6);
    expect(words[4].s).toBeCloseTo(1.5);
  });

  it("follow a split into two clips of the same file, with nothing heard twice", () => {
    const { doc, sceneId, clipId } = scene();
    const a = { ...doc.elements[clipId], end: 2 };
    const b = { ...doc.elements[clipId], id: "clip2", start: 2, end: 6, clipFrom: 2.9 };
    const split: Doc = { ...doc, elements: { ...doc.elements, [clipId]: a, clip2: b, [sceneId]: { ...doc.elements[sceneId], childIds: [clipId, "clip2"] } } };
    expect(wordsOfEdit(split, sceneId).map((w) => w.w)).toEqual(["Toh", "toh", "aaj", "hum", "baat", "karenge"]);
    expect(wordsOfEdit(split, sceneId).map((w) => w.clip)).toEqual(["clip", "clip", "clip", "clip", "clip2", "clip2"]);
    expect(cutOutOfEdit(split, sceneId)).toEqual([]);
  });

  it("are saved in the file and read back", () => {
    const { doc } = scene();
    const back = parseDoc(serializeDoc(doc));
    expect(back.words).toEqual(doc.words);
  });
});

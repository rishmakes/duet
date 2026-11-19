import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => undefined }));

import { callTool } from "./tools";
import { setMode } from "./chat";
import { JOIN_FADE, runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { cutsForWords, trimPoints, wordsOfEdit } from "../document/words";
import { currentDoc, loadDoc, resetStore } from "../state/store";

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
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
  doc = runCommand(doc, "set_duration", { id: "f", seconds: 6 });
  doc = runCommand(doc, "create_element", { type: "video", id: "v", parentId: "f", x: 0, y: 0, width: 1920, height: 1080, props: { src: "/talk.mp4", start: 0, end: 6 } });
  return runCommand(doc, "set_words", { src: "/talk.mp4", transcript: { language: "en", model: "medium", words } });
}

describe("cutting by words", () => {
  it("never starts or ends a cut on a word, and keeps a breath on each side", () => {
    const edit = wordsOfEdit(talk(), "f");
    // "um," alone: gaps of 0.1 s each side, so the cut goes halfway into each
    expect(cutsForWords(edit, [{ from: 3, to: 3 }])).toEqual([{ start: 2.25, end: 2.65 }]);
    // "we um," after the long pause: the pause goes too, a breath stays after "today"
    expect(cutsForWords(edit, [{ from: 2, to: 3 }])).toEqual([{ start: 1.15, end: 2.65 }]);
    // the last word: a breath after it, never past the end
    expect(cutsForWords(edit, [{ from: 6, to: 6 }], 0.15, 4.1)).toEqual([{ start: 3.45, end: 4.1 }]);
    // cuts that touch become one
    expect(cutsForWords(edit, [{ from: 4, to: 4 }, { from: 3, to: 3 }])).toEqual([{ start: 2.25, end: 3.05 }]);
  });

  it("in fast speech, cuts at the quietest moment between two words, never inside the next one", () => {
    const edit = wordsOfEdit(talk(), "f");
    // "talk" really ends at 3.08 and "about" starts at 3.12: the sound is quiet only from 3.08 to 3.12
    const loud = (t: number) => (t >= 3.08 && t < 3.12 ? 5 : t >= 2.7 && t < 3.5 ? 200 : 5);
    const [r] = cutsForWords(edit, [{ from: 3, to: 4 }], 0.15, Infinity, loud);
    expect(r.end).toBeGreaterThanOrEqual(3.08);
    expect(r.end).toBeLessThan(3.12);
  });

  it("still cuts a word the speech model gave no length", () => {
    const edit = [
      { w: "a", s: 1, e: 1.2, clip: "v", fs: 1, fe: 1.2 },
      { w: "uh", s: 1.2, e: 1.2, clip: "v", fs: 1.2, fe: 1.2 },
      { w: "b", s: 1.2, e: 1.5, clip: "v", fs: 1.2, fe: 1.5 },
    ];
    const [r] = cutsForWords(edit, [{ from: 1, to: 1 }]);
    expect(r.end - r.start).toBeGreaterThan(0.01);
  });

  it("gives trims a breath before each word for a start and after each word for an end", () => {
    expect(trimPoints(words, "start").slice(0, 3)).toEqual([0.05, 0.55, 1.85]);
    expect(trimPoints(words, "end").slice(0, 2)).toEqual([0.55, 1.15]);
  });

  it("fades the sound a little on each side of every join", () => {
    const doc = runCommand(talk(), "cut_ranges", { sceneId: "f", ranges: [{ start: 2.25, end: 2.65 }] });
    const clips = doc.elements.f.childIds.map((id) => doc.elements[id]);
    expect(clips).toHaveLength(2);
    expect(clips.find((c) => c.start === 0)?.fadeOut).toBe(JOIN_FADE);
    expect(clips.find((c) => c.start !== 0)?.fadeIn).toBe(JOIN_FADE);
  });
});

describe("the AI's words tools", () => {
  beforeEach(() => {
    resetStore();
    setMode("auto");
    loadDoc(talk());
  });

  it("reads the words in phrases, numbered, split at a pause", async () => {
    const r = await callTool("get_transcript", { id: "f" });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain("0.20-1.00  0:So 1:today");
    expect(r.text).toContain("2.00-4.00  2:we 3:um, 4:talk 5:about 6:money.");
  });

  it("cuts words with the same command as Cut silences, and then lists them as cut out", async () => {
    const r = await callTool("cut_words", { id: "f", cuts: [{ from: 3, to: 3, says: "um" }] });
    expect(r.isError).toBeFalsy();
    expect(currentDoc().elements.f.duration).toBe(5.6);
    expect(wordsOfEdit(currentDoc(), "f").map((w) => w.w)).toEqual(["So", "today", "we", "talk", "about", "money."]);
    const after = await callTool("get_transcript", { id: "f" });
    expect(after.text).toContain("Cut out of the edit");
    expect(after.text).toContain("um,");
  });

  it("fixes and takes out words in the transcript only, never cutting the video (#397)", async () => {
    const r = await callTool("fix_words", { id: "f", fixes: [{ from: 4, to: 4, says: "talk", text: "talk" }, { from: 3, to: 3, says: "um,", text: "" }, { from: 0, to: 1, says: "So today", text: "Today" }] });
    expect(r.isError).toBeFalsy();
    expect(wordsOfEdit(currentDoc(), "f").map((w) => w.w)).toEqual(["Today", "we", "talk", "about", "money."]);
    expect(currentDoc().elements.f.duration).toBe(6);
    expect((await callTool("fix_words", { id: "f", fixes: [{ from: 1, to: 1, says: "money", text: "x" }] })).isError).toBe(true);
  });

  it("refuses words that are not the ones it read, and cuts nothing", async () => {
    const r = await callTool("cut_words", { id: "f", cuts: [{ from: 3, to: 3, says: "talk" }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("read get_transcript again");
    expect((await callTool("cut_words", { id: "f", cuts: [{ from: 5, to: 9, says: "about" }] })).isError).toBe(true);
    expect(currentDoc().elements.f.duration).toBe(6);
  });

  it("says to transcribe first when no clip has words", async () => {
    loadDoc(runCommand(talk(), "set_words", { src: "/talk.mp4", transcript: null }));
    const r = await callTool("get_transcript", { id: "f" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("transcribe");
  });
});

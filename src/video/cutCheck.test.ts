import { describe, expect, it } from "vitest";
import { runCommand } from "../commands/index";
import { emptyDoc } from "../document/types";
import type { Doc, El, Word } from "../document/types";
import { badCutLine, checkCuts, type Heard } from "./cutCheck";
import { PEAK_SLICE } from "./faces";

/** A recording of 10 s: speech 1.0-3.0 and 4.0-6.0, quiet between. */
const speech: [number, number][] = [
  [1.0, 3.0],
  [4.0, 6.0],
];
const words: Word[] = [
  { w: "toh", s: 1.0, e: 1.9 },
  { w: "aaj", s: 2.0, e: 3.0 },
  { w: "hum", s: 4.0, e: 5.0 },
  { w: "baat", s: 5.1, e: 6.0 },
];
function peaks(): Uint8Array {
  const p = new Uint8Array(Math.round(10 / PEAK_SLICE));
  for (const [a, b] of speech) for (let i = Math.round(a / PEAK_SLICE); i < Math.round(b / PEAK_SLICE); i++) p[i] = 200;
  return p;
}

/** A frame with clips of /talk.mp4, each [frame start, frame end, file from]. */
function frame(parts: [number, number, number][]): { doc: Doc; ids: string[] } {
  const base = Object.values(runCommand(emptyDoc(), "create_element", { id: "x", type: "rect", x: 0, y: 0, width: 1, height: 1 }).elements)[0];
  const ids = parts.map((_, i) => `c${i}`);
  const scene: El = { ...base, id: "f", type: "frame", name: "Talk", width: 1920, height: 1080, duration: 20, childIds: ids, parentId: null };
  const els: Record<string, El> = { f: scene };
  parts.forEach(([start, end, clipFrom], i) => {
    els[ids[i]] = { ...base, id: ids[i], type: "video", name: `clip ${i}`, src: "/talk.mp4", parentId: "f", start, end, clipFrom, speed: 1, volume: 1, childIds: [] };
  });
  return { doc: { ...emptyDoc(), rootIds: ["f"], elements: els }, ids };
}

const all = (): Map<string, Heard> => new Map([["/talk.mp4", { speech, words, peaks: peaks() }]]);

describe("checking cuts (#148)", () => {
  it("finds nothing wrong with cuts in the quiet", () => {
    // file 0.5-3.5, then file 3.6-6.5
    const { doc } = frame([
      [0, 3, 0.5],
      [3, 5.9, 3.6],
    ]);
    expect(checkCuts(doc, "f", all())).toEqual([]);
  });

  it("finds an end that chops a word and a start that clips one, with clean places near", () => {
    // ends at file 2.5, inside "aaj"; next starts at file 4.3, inside "hum"
    const { doc, ids } = frame([
      [0, 2.5, 0],
      [2.5, 4.6, 4.3],
    ]);
    const bad = checkCuts(doc, "f", all());
    expect(bad.map((c) => [c.clip, c.edge, c.file])).toEqual([
      [ids[0], "end", 2.5],
      [ids[1], "start", 4.3],
    ]);
    expect(bad[0].word?.w).toBe("aaj");
    expect(bad[0].speech).toEqual([1.0, 3.0]);
    // clean after the speech ends with room, or before it starts
    expect(bad[0].later).toBeCloseTo(3.01, 2);
    expect(bad[0].earlier).toBeUndefined(); // the speech began more than 1.5 s before
    expect(bad[1].earlier).toBeCloseTo(3.99, 2);
    expect(badCutLine(bad[0], "clip 0")).toContain("chopped");
  });

  it("a split clip that plays on is not a cut", () => {
    const { doc } = frame([
      [0, 2.5, 0],
      [2.5, 5, 2.5],
    ]);
    expect(checkCuts(doc, "f", all()).map((c) => c.edge)).toEqual(["end"]);
  });

  it("without the voice finder, a cut is bad only where a word is and it is loud", () => {
    const { doc } = frame([[0, 2.5, 0]]);
    expect(checkCuts(doc, "f", new Map([["/talk.mp4", { words, peaks: peaks() }]]))).toHaveLength(1);
    // a word under the cut, but quiet there: the word's time was a guess
    expect(checkCuts(doc, "f", new Map([["/talk.mp4", { words, peaks: new Uint8Array(200) }]]))).toHaveLength(0);
  });

  it("speech may come close on the side kept, never on the side cut away", () => {
    // an end 10 ms after speech ends keeps the whole word: clean
    expect(checkCuts(frame([[0, 3.01, 0]]).doc, "f", all())).toEqual([]);
    // a start 10 ms after speech ends lets the tail of that word in: clipped
    expect(checkCuts(frame([[0, 0.9, 3.01]]).doc, "f", all()).map((c) => c.edge)).toEqual(["start"]);
    // a start just before speech begins is clean
    expect(checkCuts(frame([[0, 2.2, 3.99]]).doc, "f", all())).toEqual([]);
  });

  it("a cut a hair before speech ends still chops it", () => {
    const { doc } = frame([[0, 2.98, 0]]);
    expect(checkCuts(doc, "f", all())).toHaveLength(1);
  });
});

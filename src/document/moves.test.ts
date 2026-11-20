import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { clipBefore, cutLookAt, cutsIn, holdsStill, shownSpanOf } from "./moves";
import { parseDoc, serializeDoc } from "./serialize";
import { docAt } from "./time";
import { emptyDoc } from "./types";
import type { Doc } from "./types";

/** A 10 s scene with two clips end to end at 4 s on one track, and a third on another track. */
function scene(): Doc {
  let d = emptyDoc();
  d = runCommand(d, "create_element", { id: "s", type: "frame", x: 0, y: 0, width: 100, height: 100 });
  d = runCommand(d, "create_element", { id: "a", type: "video", parentId: "s", x: 0, y: 0, width: 100, height: 100 });
  d = runCommand(d, "create_element", { id: "b", type: "video", parentId: "s", x: 0, y: 0, width: 100, height: 100 });
  d = runCommand(d, "create_element", { id: "c", type: "video", parentId: "s", x: 0, y: 0, width: 100, height: 100 });
  const el = structuredClone(d.elements);
  el.s.duration = 10;
  Object.assign(el.a, { start: 0, end: 4, clipFrom: 1, src: "a.mp4" });
  Object.assign(el.b, { start: 4, end: 10, clipFrom: 2, src: "b.mp4" });
  Object.assign(el.c, { start: 4, end: 10, src: "c.mp4", track: "other" });
  return { ...d, elements: el };
}

const at = (d: Doc, t: number) => docAt(d, "s", t);

describe("transitions at a cut", () => {
  it("finds the clip on the other side of a cut, only on the same track", () => {
    const d = scene();
    expect(clipBefore(d, d.elements.b, d.elements.s)?.id).toBe("a");
    expect(clipBefore(d, d.elements.c, d.elements.s)).toBeNull();
    expect(clipBefore(d, d.elements.a, d.elements.s)).toBeNull();
    expect(cutsIn(d, d.elements.s)).toEqual(["b"]);
  });

  it("sets and takes away a transition, and only where there is a cut", () => {
    let d = scene();
    d = runCommand(d, "set_transition", { ids: ["b", "c"], kind: "dissolve" });
    expect(d.elements.b.cutIn).toEqual({ kind: "dissolve", seconds: 0.5 });
    expect(d.elements.c.cutIn).toBeUndefined();
    d = runCommand(d, "set_transition", { ids: ["b"], kind: "dip-black" });
    expect(d.elements.b.cutIn).toEqual({ kind: "dip-black", seconds: 0.5 });
    d = runCommand(d, "set_transition", { ids: ["b"], kind: "dip-black", seconds: 9 });
    expect(d.elements.b.cutIn?.seconds).toBe(2);
    const before = d;
    d = runCommand(d, "set_transition", { ids: ["b"], kind: "cut" });
    expect(d.elements.b.cutIn).toBeUndefined();
    expect(before.elements.b.cutIn).toBeDefined();
  });

  it("a dissolve shows both clips around the cut, the front one fading, and keeps the clips in place", () => {
    const d = runCommand(scene(), "set_transition", { ids: ["b"], kind: "dissolve", seconds: 1 });
    expect(shownSpanOf(d, d.elements.a, d.elements.s)).toEqual({ start: 0, end: 4.5 });
    expect(shownSpanOf(d, d.elements.b, d.elements.s)).toEqual({ start: 3.5, end: 10 });
    expect(d.elements.a.end).toBe(4);
    expect(at(d, 3.4).elements.s.childIds).toEqual(["a"]);
    const mid = at(d, 4);
    expect(mid.elements.s.childIds).toEqual(["a", "b", "c"]);
    expect(mid.elements.a.opacity).toBe(1);
    expect(mid.elements.b.opacity).toBeCloseTo(0.5);
    expect(at(d, 3.75).elements.b.opacity).toBeLessThan(0.5);
    expect(at(d, 4.5).elements.s.childIds).toEqual(["b", "c"]);
    expect(at(d, 5).elements.b.opacity).toBe(1);
  });

  it("a dissolve is never longer than the shorter clip", () => {
    let d = scene();
    d = { ...d, elements: { ...d.elements, b: { ...d.elements.b, end: 4.6 } } };
    d = runCommand(d, "set_transition", { ids: ["b"], kind: "dissolve", seconds: 2 });
    expect(shownSpanOf(d, d.elements.b, d.elements.s)).toEqual({ start: 3.7, end: 4.6 });
  });

  it("a dip covers the clip going out with colour up to the cut, then uncovers the one coming in", () => {
    const d = runCommand(scene(), "set_transition", { ids: ["b"], kind: "dip-white", seconds: 1 });
    expect(shownSpanOf(d, d.elements.a, d.elements.s)).toEqual({ start: 0, end: 4 });
    expect(at(d, 3).elements.a.wash).toBeUndefined();
    expect(at(d, 3.75).elements.a.wash?.amount).toBeCloseTo(0.5);
    expect(at(d, 3.75).elements.a.wash?.color).toBe("#ffffff");
    expect(at(d, 4).elements.b.wash?.amount).toBeCloseTo(1);
    expect(at(d, 4.25).elements.b.wash?.amount).toBeCloseTo(0.5);
    expect(at(d, 4.6).elements.b.wash).toBeUndefined();
    expect(cutLookAt(d, d.elements.c, d.elements.s, 4)).toBeNull();
  });

  it("a transition whose clips no longer touch does nothing", () => {
    let d = runCommand(scene(), "set_transition", { ids: ["b"], kind: "dissolve" });
    d = { ...d, elements: { ...d.elements, b: { ...d.elements.b, start: 5 } } };
    expect(shownSpanOf(d, d.elements.a, d.elements.s)).toEqual({ start: 0, end: 4 });
    expect(at(d, 4.2).elements.s.childIds).toEqual(["c"]);
  });

  it("says when a dissolve holds a still picture because a file has no footage past the cut", () => {
    const d = runCommand(scene(), "set_transition", { ids: ["b"], kind: "dissolve", seconds: 1 });
    // a.mp4 is used from 1 s to 5 s; b.mp4 starts at 2 s, so there is room before it
    expect(holdsStill(d, d.elements.b, d.elements.s, () => 20)).toBe(false);
    expect(holdsStill(d, d.elements.b, d.elements.s, (src) => (src === "a.mp4" ? 5.2 : 20))).toBe(true);
  });

  it("saves the transition, and old files and unknown ones open as plain cuts", () => {
    const d = runCommand(scene(), "set_transition", { ids: ["b"], kind: "dip-black", seconds: 0.8 });
    const back = parseDoc(serializeDoc(d));
    expect(back.elements.b.cutIn).toEqual({ kind: "dip-black", seconds: 0.8 });
    expect(serializeDoc(scene())).not.toContain("cutIn");
    const raw = JSON.parse(serializeDoc(d));
    raw.elements.b.cutIn = { kind: "spin", seconds: 1 };
    expect(parseDoc(JSON.stringify(raw)).elements.b.cutIn).toBeUndefined();
  });
});

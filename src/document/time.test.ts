import { describe, expect, it } from "vitest";
import { commandLabel, runCommand } from "../commands";
import { parseDoc, serializeDoc } from "./serialize";
import { CURVES, curveAt, docAt, elAt, entranceOf, fileTimeAt, frameTimeAt, valueAt } from "./time";
import { emptyDoc } from "./types";
import type { El } from "./types";
import { exportSize, soundsOf } from "../video/scene";
import { currentDoc, dispatch, loadDoc, resetStore, seenDoc, setClock, workDoc } from "../state/store";

function scene() {
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
  doc = runCommand(doc, "create_element", { type: "rect", id: "r", parentId: "f", x: 100, y: 100, width: 200, height: 100 });
  doc = runCommand(doc, "create_element", { type: "text", id: "t", parentId: "f", x: 100, y: 400, width: 200, height: 40 });
  return runCommand(doc, "set_duration", { id: "f", seconds: 10 });
}

describe("time", () => {
  it("holds the ends and eases in between", () => {
    const keys = [
      { t: 1, v: 0, ease: "linear" as const },
      { t: 3, v: 100, ease: "linear" as const },
    ];
    expect(valueAt(keys, 0)).toBe(0);
    expect(valueAt(keys, 2)).toBe(50);
    expect(valueAt(keys, 9)).toBe(100);
  });

  it("only a frame on the page can play", () => {
    const doc = scene();
    expect(doc.elements.f.duration).toBe(10);
    expect(runCommand(doc, "set_duration", { id: "r", seconds: 5 })).toBe(doc);
  });

  it("shows a thing only between the second it appears and the second it leaves", () => {
    const doc = runCommand(scene(), "set_timing", { ids: ["t"], start: 2, end: 5 });
    expect(docAt(doc, "f", 1).elements.f.childIds).toEqual(["r"]);
    expect(docAt(doc, "f", 2).elements.f.childIds).toEqual(["r", "t"]);
    expect(docAt(doc, "f", 5).elements.f.childIds).toEqual(["r"]);
    // the design itself is untouched
    expect(doc.elements.f.childIds).toEqual(["r", "t"]);
  });

  it("changes a value over time, and leaves the design as it was", () => {
    let doc = runCommand(scene(), "set_key", { ids: ["r"], prop: "x", t: 0, v: 100, ease: "linear" });
    doc = runCommand(doc, "set_key", { ids: ["r"], prop: "x", t: 4, v: 500, ease: "linear" });
    expect(docAt(doc, "f", 2).elements.r.x).toBe(300);
    expect(doc.elements.r.x).toBe(100);
    doc = runCommand(doc, "remove_key", { ids: ["r"], prop: "x" });
    expect(doc.elements.r.keys).toEqual({});
  });

  it("moves a moment along the timeline, clamped to the scene and replacing any key there", () => {
    let doc = runCommand(scene(), "set_key", { ids: ["r"], prop: "x", t: 1, v: 100 });
    doc = runCommand(doc, "set_key", { ids: ["r"], prop: "y", t: 1, v: 200 });
    doc = runCommand(doc, "set_key", { ids: ["r"], prop: "x", t: 4, v: 500 });
    expect(commandLabel("move_key", { id: "r", from: 1, to: 2.5 })).toBe("Move a moment");

    // moves every key within 0.004 of 'from' on that element (both x and y)
    doc = runCommand(doc, "move_key", { id: "r", from: 1.002, to: 2.5 });
    expect(doc.elements.r.keys.x?.map((k) => [k.t, k.v])).toEqual([[2.5, 100], [4, 500]]);
    expect(doc.elements.r.keys.y?.map((k) => [k.t, k.v])).toEqual([[2.5, 200]]);

    // replaces an existing key of the same property at 'to'
    doc = runCommand(doc, "move_key", { id: "r", from: 2.5, to: 4 });
    expect(doc.elements.r.keys.x?.map((k) => [k.t, k.v])).toEqual([[4, 100]]);
    expect(doc.elements.r.keys.y?.map((k) => [k.t, k.v])).toEqual([[4, 200]]);

    // clamps to the frame duration (10s) and rounds to 3 decimals
    doc = runCommand(doc, "move_key", { id: "r", from: 4, to: 12.3456 });
    expect(doc.elements.r.keys.x?.map((k) => [k.t, k.v])).toEqual([[10, 100]]);

    // clamps to 0 when negative
    doc = runCommand(doc, "move_key", { id: "r", from: 10, to: -3 });
    expect(doc.elements.r.keys.x?.map((k) => [k.t, k.v])).toEqual([[0, 100]]);

    // rounds to 3 decimals when within bounds
    doc = runCommand(doc, "move_key", { id: "r", from: 0, to: 3.4567 });
    expect(doc.elements.r.keys.x?.map((k) => [k.t, k.v])).toEqual([[3.457, 100]]);

    // returns the same doc when nothing matched
    expect(runCommand(doc, "move_key", { id: "r", from: 5, to: 6 })).toBe(doc);
    expect(runCommand(doc, "move_key", { id: "nonexistent", from: 3.457, to: 5 })).toBe(doc);
  });

  it("moves what a thing does along with it when its start moves", () => {
    let doc = runCommand(scene(), "set_entrance", { ids: ["t"], when: "in", kind: "fade", seconds: 1 });
    expect(doc.elements.t.keys.opacity?.map((k) => k.t)).toEqual([0, 1]);
    expect(docAt(doc, "f", 0).elements.t.opacity).toBe(0);
    doc = runCommand(doc, "set_timing", { ids: ["t"], start: 3 });
    expect(doc.elements.t.keys.opacity?.map((k) => k.t)).toEqual([3, 4]);
  });

  it("keeps a still design's file as it was, and brings time back from a saved one", () => {
    const still = runCommand(emptyDoc(), "create_element", { type: "rect", id: "a", x: 0, y: 0, width: 10, height: 10 });
    const text = serializeDoc(still);
    for (const word of ["duration", "start", "end", "keys", "clipFrom", "volume"]) expect(text).not.toContain(`"${word}"`);
    const doc = runCommand(runCommand(scene(), "set_timing", { ids: ["t"], start: 2, end: 5 }), "set_entrance", { ids: ["t"], when: "in", kind: "slide-up" });
    const back = parseDoc(serializeDoc(doc));
    expect(back.elements.f.duration).toBe(10);
    expect(back.elements.t.start).toBe(2);
    expect(back.elements.t.keys).toEqual(doc.elements.t.keys);
  });

  it("says which ready-made arrival a thing has", () => {
    let doc = runCommand(scene(), "set_timing", { ids: ["t"], start: 2, end: 6 });
    expect(entranceOf(doc.elements.t, doc.elements.f, "in")).toBe("none");
    doc = runCommand(doc, "set_entrance", { ids: ["t"], when: "in", kind: "slide-up" });
    doc = runCommand(doc, "set_entrance", { ids: ["t"], when: "out", kind: "fade" });
    expect(entranceOf(doc.elements.t, doc.elements.f, "in")).toBe("slide-up");
    expect(entranceOf(doc.elements.t, doc.elements.f, "out")).toBe("fade");
  });

  it("cuts a clip in two at one second, and the second half carries on from where the first stopped", () => {
    let doc = runCommand(scene(), "create_element", { type: "video", id: "v", parentId: "f", x: 0, y: 0, width: 100, height: 100, props: { src: "/a.mp4", start: 1, end: 9, clipFrom: 2 } });
    doc = runCommand(doc, "split_at", { sceneId: "f", t: 4, ids: ["v"], newIds: { v: "v2" } });
    expect([doc.elements.v.start, doc.elements.v.end, doc.elements.v.clipFrom]).toEqual([1, 4, 2]);
    expect([doc.elements.v2.start, doc.elements.v2.end, doc.elements.v2.clipFrom]).toEqual([4, 9, 5]);
    expect(doc.elements.f.childIds).toEqual(["r", "t", "v", "v2"]);
    // nothing to cut where nothing shows
    expect(runCommand(doc, "split_at", { sceneId: "f", t: 0.5, ids: ["v"] })).toBe(doc);
  });

  it("deletes a part and closes the gap it leaves", () => {
    let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 100, height: 100 });
    doc = runCommand(doc, "set_duration", { id: "f", seconds: 9 });
    for (const [id, start, end] of [["a", 0, 3], ["b", 3, 5], ["c", 5, 9]] as const) doc = runCommand(doc, "create_element", { type: "video", id, parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { src: "/a.mp4", start, end } });
    doc = runCommand(doc, "ripple_delete", { ids: ["b"] });
    expect(doc.elements.b).toBeUndefined();
    expect([doc.elements.a.start, doc.elements.a.end]).toEqual([0, 3]);
    expect([doc.elements.c.start, doc.elements.c.end]).toEqual([3, 7]);
    expect(doc.elements.f.duration).toBe(7);
  });

  it("closing a gap also moves a shape's points in time, so its outline changes at the same moments", () => {
    let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 100, height: 100 });
    doc = runCommand(doc, "set_duration", { id: "f", seconds: 9 });
    for (const [id, start, end] of [["a", 0, 3], ["b", 3, 5]] as const) doc = runCommand(doc, "create_element", { type: "video", id, parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { src: "/a.mp4", start, end } });
    doc = runCommand(doc, "create_element", { type: "path", id: "p", parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { start: 5, end: 9 } });
    const shapeKeys = [{ t: 5.5, points: [], ease: "in-out" as const }, { t: 7, points: [], ease: "in-out" as const }];
    doc = { ...doc, elements: { ...doc.elements, p: { ...doc.elements.p, shapeKeys } } };
    doc = runCommand(doc, "ripple_delete", { ids: ["b"] });
    expect(doc.elements.p.start).toBe(3);
    expect(doc.elements.p.shapeKeys.map((k) => k.t)).toEqual([3.5, 5]);
  });

  it("a change by hand at another moment becomes a mark there, once a thing has been marked", () => {
    resetStore();
    loadDoc(scene());
    setClock({ scene: "f", t: 1 });
    // not marked yet: a move is a plain move
    dispatch("move_elements", { ids: ["r"], dx: 10, dy: 0 });
    expect(currentDoc().elements.r.x).toBe(110);
    expect(currentDoc().elements.r.keys).toEqual({});
    dispatch("key_now", { ids: ["r"], props: ["x", "y"], t: 1 });
    setClock({ t: 3 });
    dispatch("move_elements", { ids: ["r"], dx: 200, dy: 0 });
    const r = currentDoc().elements.r;
    expect(r.x).toBe(110);
    expect(r.keys.x?.map((k) => [k.t, k.v])).toEqual([[1, 110], [3, 310]]);
    // y did not change, so it has no new mark
    expect(r.keys.y?.length).toBe(1);
    expect(seenDoc().elements.r.x).toBe(310);
    expect(workDoc().elements.r.x).toBe(310);
    setClock({ t: 2 });
    expect(seenDoc().elements.r.x).toBe(210);
    // with the clock closed, the design is itself again
    setClock({ scene: null });
    expect(workDoc()).toBe(currentDoc());
    resetStore();
  });

  it("a sound is saved, cut like a clip, and heard at its moment in the finished video", () => {
    let doc = runCommand(scene(), "create_element", { type: "sound", id: "m", parentId: "f", x: 0, y: 0, width: 1, height: 1, props: { src: "/music.mp3", start: 2, end: 8, volume: 0.3 } });
    const back = parseDoc(serializeDoc(doc));
    expect([back.elements.m.src, back.elements.m.volume, back.elements.m.start]).toEqual(["/music.mp3", 0.3, 2]);
    expect(soundsOf(doc, "f")).toEqual([{ path: "/music.mp3", from: 0, at: 2, length: 6, volume: 0.3, speed: 1 }]);
    doc = runCommand(doc, "split_at", { sceneId: "f", t: 5, ids: ["m"], newIds: { m: "m2" } });
    expect(soundsOf(doc, "f")[1]).toEqual({ path: "/music.mp3", from: 3, at: 5, length: 3, volume: 0.3, speed: 1 });
  });

  it("a faster clip is shorter on the timeline, keeps the same part of its file, and is saved", () => {
    let doc = runCommand(scene(), "create_element", { type: "sound", id: "m", parentId: "f", x: 0, y: 0, width: 1, height: 1, props: { src: "/a.mp3", start: 2, end: 6, clipFrom: 1 } });
    doc = runCommand(doc, "set_speed", { ids: ["m"], speed: 2 });
    expect([doc.elements.m.speed, doc.elements.m.start, doc.elements.m.end]).toEqual([2, 2, 4]);
    // 2 seconds of the frame now play 4 seconds of the file, from the same place
    expect(soundsOf(doc, "f")).toEqual([{ path: "/a.mp3", from: 1, at: 2, length: 2, volume: 1, speed: 2 }]);
    expect(fileTimeAt(doc.elements.m, 2, 3)).toBe(3);
    expect(frameTimeAt(doc.elements.m, 2, 3)).toBe(3);
    // splitting a fast clip splits its file at the right second
    const cut = runCommand(doc, "split_at", { sceneId: "f", t: 3, ids: ["m"], newIds: { m: "m2" } });
    expect([cut.elements.m2.clipFrom, cut.elements.m2.speed]).toEqual([3, 2]);
    expect(parseDoc(serializeDoc(doc)).elements.m.speed).toBe(2);
    // slowing it back down gives the length back, and a normal speed is not written to the file
    const back = runCommand(doc, "set_speed", { ids: ["m"], speed: 1 });
    expect(back.elements.m.end).toBe(6);
    expect(serializeDoc(back)).not.toContain('"speed"');
    // too fast or too slow is held to what works
    expect(runCommand(doc, "set_speed", { ids: ["m"], speed: 500 }).elements.m.speed).toBe(16);
    expect(runCommand(doc, "set_speed", { ids: ["m"], speed: 0.001 }).elements.m.speed).toBe(0.1);
  });

  it("pulling the end of a clip stretches it: the same part of the file plays slower or faster", () => {
    let doc = runCommand(scene(), "create_element", { type: "sound", id: "m", parentId: "f", x: 0, y: 0, width: 1, height: 1, props: { src: "/a.mp3", start: 2, end: 6, clipFrom: 1 } });
    // twice as long on the timeline: half speed, same file part, same start
    const slow = runCommand(doc, "stretch_clip", { id: "m", edge: "end", to: 10 });
    expect([slow.elements.m.speed, slow.elements.m.start, slow.elements.m.end, slow.elements.m.clipFrom]).toEqual([0.5, 2, 10, 1]);
    // half as long: twice the speed
    const fast = runCommand(doc, "stretch_clip", { id: "m", edge: "end", to: 4 });
    expect([fast.elements.m.speed, fast.elements.m.end]).toEqual([2, 4]);
    // the start pulled: the end stays, the file still begins where it did
    const early = runCommand(doc, "stretch_clip", { id: "m", edge: "start", to: 0 });
    expect([early.elements.m.start, early.elements.m.end, early.elements.m.clipFrom]).toEqual([0, 6, 1]);
    expect(early.elements.m.speed).toBeCloseTo(4 / 6, 2);
    // squeezed too far is held to the fastest speed, and the end stops where that puts it
    const squeezed = runCommand(doc, "stretch_clip", { id: "m", edge: "end", to: 2.1 });
    expect([squeezed.elements.m.speed, squeezed.elements.m.end]).toEqual([16, 2.25]);
    // the frame is as long as it is: it cannot be stretched past its end
    expect(runCommand(doc, "stretch_clip", { id: "m", edge: "end", to: 9999 }).elements.m.end).toBe(10);
    // an undo-able change, and pulling to where it already is changes nothing
    expect(runCommand(doc, "stretch_clip", { id: "m", edge: "end", to: 6 })).toBe(doc);
  });

  it("a video comes out at the size that was chosen, in even numbers", () => {
    expect(exportSize({ width: 1920, height: 1080 }, 0)).toEqual([1920, 1080]);
    expect(exportSize({ width: 1920, height: 1080 }, 1280)).toEqual([1280, 720]);
    expect(exportSize({ width: 1080, height: 1920 }, 1280)).toEqual([720, 1280]);
    expect(exportSize({ width: 339.98, height: 179.46 }, 0)).toEqual([340, 178]);
  });

  it("a speed curve starts at 0, ends at 1 and follows its handles", () => {
    expect(curveAt(CURVES.steady, 0.3)).toBeCloseTo(0.3, 3);
    expect(curveAt(CURVES.gentle, 0)).toBe(0);
    expect(curveAt(CURVES.gentle, 1)).toBe(1);
    expect(curveAt(CURVES.gentle, 0.5)).toBeCloseTo(0.5, 2);
    // slow at the start, quick in the middle
    expect(curveAt(CURVES.gentle, 0.2)).toBeLessThan(0.2);
    // fast at the start
    expect(curveAt(CURVES.snappy, 0.2)).toBeGreaterThan(0.5);
    // bouncy goes past the end before it settles
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8, 0.9].map((p) => curveAt(CURVES.bouncy, p)))).toBeGreaterThan(1);
  });

  it("set_curve shapes the move that arrives at a moment, and a hand change keeps the shape", () => {
    let doc = runCommand(scene(), "set_key", { ids: ["r"], prop: "x", t: 0, v: 0 });
    doc = runCommand(doc, "set_key", { ids: ["r"], prop: "x", t: 2, v: 100 });
    doc = runCommand(doc, "set_curve", { ids: ["r"], props: ["x"], t: 2, shape: "snappy" });
    expect(doc.elements.r.keys.x![1].curve).toEqual([0.16, 1, 0.3, 1]);
    expect(doc.elements.r.keys.x![0].curve).toBeUndefined();
    // the speed shows in the value halfway through the time
    expect(elAt(doc.elements.r, 1).x).toBeGreaterThan(50);
    // marking the same moment again keeps the shape
    doc = runCommand(doc, "key_now", { ids: ["r"], props: ["x"], t: 2 });
    expect(doc.elements.r.keys.x![1].curve).toEqual([0.16, 1, 0.3, 1]);
    // the first moment has no move arriving at it
    expect(runCommand(doc, "set_curve", { ids: ["r"], props: ["x"], t: 0, shape: "gentle" })).toBe(doc);
  });

  it("a bouncy move never makes opacity leave 0 to 1", () => {
    let doc = runCommand(scene(), "set_key", { ids: ["r"], prop: "opacity", t: 0, v: 0 });
    doc = runCommand(doc, "set_key", { ids: ["r"], prop: "opacity", t: 2, v: 1 });
    doc = runCommand(doc, "set_curve", { ids: ["r"], props: ["opacity"], t: 2, shape: "bouncy" });
    for (let t = 0; t <= 2; t += 0.1) expect(elAt(doc.elements.r, t).opacity).toBeLessThanOrEqual(1);
  });

  it("move_key can move only one kind of change at a moment", () => {
    let doc = runCommand(scene(), "set_key", { ids: ["r"], prop: "x", t: 1, v: 10 });
    doc = runCommand(doc, "set_key", { ids: ["r"], prop: "width", t: 1, v: 50 });
    doc = runCommand(doc, "move_key", { id: "r", from: 1, to: 2, props: ["x"] });
    expect(doc.elements.r.keys.x![0].t).toBe(2);
    expect(doc.elements.r.keys.width![0].t).toBe(1);
    // without props, everything at that moment moves
    doc = runCommand(doc, "move_key", { id: "r", from: 1, to: 3 });
    expect(doc.elements.r.keys.width![0].t).toBe(3);
  });
});

describe("the clip time rule", () => {
  const clip = { clipFrom: 4 } as El;
  it("maps a moment of the frame to a second of the file and back", () => {
    expect(fileTimeAt(clip, 2, 5)).toBe(7);
    expect(frameTimeAt(clip, 2, 7)).toBe(5);
    expect(frameTimeAt(clip, 2, 0)).toBe(-2);
  });
  it("is a clean round trip", () => {
    for (const t of [2, 3.25, 9]) expect(frameTimeAt(clip, 2, fileTimeAt(clip, 2, t))).toBeCloseTo(t, 9);
  });
});

describe("markers", () => {
  it("are added in order of time, moved, renamed, removed and saved", () => {
    let doc = scene();
    doc = runCommand(doc, "add_marker", { id: "f", t: 4, name: "Cut here", markerId: "m2" });
    doc = runCommand(doc, "add_marker", { id: "f", t: 1.5, markerId: "m1" });
    expect(doc.elements.f.markers.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(doc.elements.f.markers[0].color).not.toBe(doc.elements.f.markers[1].color);
    doc = runCommand(doc, "update_marker", { id: "f", markerId: "m1", t: 6, name: "Logo" });
    expect(doc.elements.f.markers.map((m) => [m.id, m.t, m.name])).toEqual([["m2", 4, "Cut here"], ["m1", 6, "Logo"]]);
    expect(parseDoc(serializeDoc(doc)).elements.f.markers.map((m) => m.name)).toEqual(["Cut here", "Logo"]);
    // past the end is held at the end, and a frame with no markers writes none
    expect(runCommand(doc, "update_marker", { id: "f", markerId: "m1", t: 999 }).elements.f.markers[1].t).toBe(doc.elements.f.duration);
    doc = runCommand(runCommand(doc, "remove_marker", { id: "f", markerId: "m1" }), "remove_marker", { id: "f", markerId: "m2" });
    expect(serializeDoc(doc)).not.toContain('"markers"');
  });
  it("go only on a frame that plays", () => {
    const still = runCommand(emptyDoc(), "create_element", { id: "s", type: "frame", x: 0, y: 0, width: 100, height: 100 });
    expect(runCommand(still, "add_marker", { id: "s", t: 1 })).toBe(still);
  });
});

describe("the work area", () => {
  it("is begun and ended at the playhead, kept inside the scene, and saved", () => {
    let doc = runCommand(scene(), "set_work_area", { id: "f", start: 2 });
    expect(doc.elements.f.workArea).toEqual({ start: 2, end: doc.elements.f.duration });
    doc = runCommand(doc, "set_work_area", { id: "f", end: 6 });
    expect(doc.elements.f.workArea).toEqual({ start: 2, end: 6 });
    expect(parseDoc(serializeDoc(doc)).elements.f.workArea).toEqual({ start: 2, end: 6 });
    // a new beginning past the end takes the rest of the scene; an end before the beginning starts it from the top
    expect(runCommand(doc, "set_work_area", { id: "f", start: 7 }).elements.f.workArea).toEqual({ start: 7, end: doc.elements.f.duration });
    expect(runCommand(doc, "set_work_area", { id: "f", end: 1 }).elements.f.workArea).toEqual({ start: 0, end: 1 });
    // the whole scene is no work area at all
    const whole = runCommand(doc, "set_work_area", { id: "f", start: 0, end: doc.elements.f.duration });
    expect(whole.elements.f.workArea).toBeUndefined();
    expect(serializeDoc(whole)).not.toContain("workArea");
    expect(runCommand(doc, "set_work_area", { id: "f", clear: true }).elements.f.workArea).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { extractPayload } from "./clipboard";
import { runCommand } from "../commands";
import { parseDoc, serializeDoc } from "./serialize";
import { hiddenHere, loudness, trackRows } from "./tracks";
import { emptyDoc } from "./types";
import type { Doc } from "./types";

/** A scene of 20 seconds with clips a (0 to 4), b (2 to 6) over it, and c (8 to 10), plus a sound. */
function scene() {
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
  doc = runCommand(doc, "set_duration", { id: "f", seconds: 20 });
  for (const [id, start, end] of [["a", 0, 4], ["b", 2, 6], ["c", 8, 10]] as const) doc = runCommand(doc, "create_element", { type: "video", id, parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { src: "/a.mp4", start, end } });
  return runCommand(doc, "create_element", { type: "sound", id: "s", parentId: "f", x: 0, y: 0, width: 1, height: 1, props: { src: "/v.mp3", start: 0, end: 5 } });
}

const names = (doc: Doc) => trackRows(doc, doc.elements.f).map((r) => `${r.name}: ${r.items.map((el) => el.id).join(" ")}`);

describe("tracks", () => {
  it("sorts things into title, clip and sound rows by itself until a track is touched", () => {
    const doc = scene();
    expect(doc.elements.f.tracks).toBeUndefined();
    // b is in front of a, so it is on top; c fits beside it
    expect(names(doc)).toEqual(["Clips 1: c b", "Clips 2: a", "Sound 1: s"]);
  });

  it("keeps the rows as they look when the first track is made, with the new one on top", () => {
    const doc = runCommand(scene(), "add_track", { id: "f", trackId: "t-new" });
    expect(names(doc)).toEqual(["Track 4: ", "Clips 1: c b", "Clips 2: a", "Sound 1: s"]);
    expect(doc.elements.f.tracks![0].id).toBe("t-new");
    expect(doc.elements.a.track).toBe(doc.elements.f.tracks![2].id);
  });

  it("a clip stays on its track when it no longer covers another", () => {
    let doc = runCommand(scene(), "add_track", { id: "f" });
    doc = runCommand(doc, "set_timing", { ids: ["a"], start: 12, end: 16 });
    expect(names(doc)).toEqual(["Track 4: ", "Clips 1: c b", "Clips 2: a", "Sound 1: s"]);
  });

  it("any track holds clips and sounds alike, and a higher track is in front", () => {
    let doc = runCommand(scene(), "add_track", { id: "f" });
    doc = runCommand(doc, "set_track", { ids: ["a", "s"], track: { index: 0 } });
    expect(names(doc)).toEqual(["Track 4: s a", "Clips 1: c b", "Clips 2: ", "Sound 1: "]);
    // a is now in front of b and c, which stay as they were
    const order = doc.elements.f.childIds;
    expect(order.indexOf("a")).toBeGreaterThan(order.indexOf("b"));
    expect(order.indexOf("a")).toBeGreaterThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    expect(runCommand(doc, "set_track", { ids: ["a"], track: { index: 0 } })).toBe(doc);
  });

  it("moving a thing down a track puts it behind what is above, and nothing else moves", () => {
    let doc = scene();
    doc = runCommand(doc, "create_element", { type: "text", id: "t", parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { start: 0, end: 3 } });
    doc = runCommand(doc, "add_track", { id: "f", index: 4 });
    expect(names(doc)).toEqual(["Titles 1: t", "Clips 1: c b", "Clips 2: a", "Sound 1: s", "Track 5: "]);
    const before = doc.elements.f.childIds.filter((id) => id !== "t");
    doc = runCommand(doc, "set_track", { ids: ["t"], track: { index: 4 } });
    expect(doc.elements.f.childIds).toEqual(["t", ...before]);
  });

  it("a new thing goes on the highest track it fits on, or a new track on top", () => {
    let doc = runCommand(scene(), "add_track", { id: "f" });
    doc = runCommand(doc, "create_element", { type: "text", id: "t", parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { start: 0, end: 3 } });
    expect(names(doc)[0]).toBe("Track 4: t");
    doc = runCommand(doc, "create_element", { type: "video", id: "v", parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { src: "/a.mp4", start: 1, end: 9 } });
    expect(names(doc).slice(0, 2)).toEqual(["Track 5: v", "Track 4: t"]);
    // opening it again keeps them there
    expect(names(parseDoc(serializeDoc(doc)))).toEqual(names(doc));
  });

  it("renames a track, and a track with no clips can be taken away", () => {
    let doc = runCommand(scene(), "add_track", { id: "f" });
    doc = runCommand(doc, "rename_track", { id: "f", track: { index: 0 }, name: "60s idea" });
    expect(names(doc)[0]).toBe("60s idea: ");
    doc = runCommand(doc, "delete_track", { id: "f", track: { index: 0 } });
    expect(names(doc)).toEqual(["Clips 1: c b", "Clips 2: a", "Sound 1: s"]);
  });

  it("deleting a track takes everything on it with it", () => {
    let doc = runCommand(scene(), "delete_track", { id: "f", track: { index: 0 } });
    expect(doc.elements.b).toBeUndefined();
    expect(doc.elements.c).toBeUndefined();
    expect(doc.elements.f.childIds).toEqual(["a", "s"]);
    expect(names(doc)).toEqual(["Clips 2: a", "Sound 1: s"]);
  });

  it("pastes clips onto a picked track, the first one starting at the playhead", () => {
    let doc = runCommand(scene(), "add_track", { id: "f", name: "60s idea" });
    const payload = extractPayload(doc, ["b", "c"])!;
    doc = runCommand(doc, "paste_elements", { payload, parentId: "f", idMap: { b: "b2", c: "c2" }, track: { index: 0 }, at: 15 });
    expect([doc.elements.b2.start, doc.elements.b2.end, doc.elements.c2.start, doc.elements.c2.end]).toEqual([15, 19, 21, 23]);
    expect(doc.elements.f.duration).toBe(23);
    expect(names(doc)[0]).toBe("60s idea: c2 b2");
    // pasting again over the same time makes no other track
    doc = runCommand(doc, "paste_elements", { payload, parentId: "f", track: { index: 0 }, at: 15 });
    expect(doc.elements.f.tracks!.length).toBe(4);
    // the same place in the picture as the clips they came from
    expect([doc.elements.b2.x, doc.elements.b2.y]).toEqual([doc.elements.b.x, doc.elements.b.y]);
  });

  it("saves tracks with the design and opens them again", () => {
    const doc = runCommand(scene(), "add_track", { id: "f", name: "60s idea" });
    const back = parseDoc(serializeDoc(doc));
    expect(back.elements.f.tracks).toEqual(doc.elements.f.tracks);
    expect(names(back)).toEqual(names(doc));
    // a design without tracks writes nothing new
    expect(serializeDoc(scene())).not.toContain("track");
  });

  it("a file saved when each track held one kind of thing opens with the same rows, as plain tracks", () => {
    let doc = scene();
    for (const [id, start, end] of [["w1", 0, 1], ["w3", 0.5, 1.5]] as const) doc = runCommand(doc, "create_element", { type: "text", id, parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { start, end } });
    // as 0.14 saved it: sound first in the list, a clip and a word on no track yet
    const old = structuredClone(doc);
    const f = old.elements.f as unknown as { tracks: unknown[] };
    f.tracks = [
      { id: "s1", name: "Sound 1", kind: "sound", silent: true },
      { id: "c1", name: "Clips 1", kind: "clips" },
      { id: "c2", name: "My clips", kind: "clips" },
      { id: "t1", name: "Titles 1", kind: "titles" },
    ];
    Object.assign(old.elements.s, { track: "s1" });
    Object.assign(old.elements.b, { track: "c1" });
    Object.assign(old.elements.c, { track: "c1" });
    Object.assign(old.elements.w1, { track: "t1" });
    const opened = parseDoc(serializeDoc(old));
    expect(names(opened)).toEqual(["Titles 1: w1", "Titles 2: w3", "Clips 1: c b", "My clips: a", "Sound 1: s"]);
    expect(opened.elements.f.tracks!.some((t) => "kind" in t)).toBe(false);
    expect(loudness(opened, opened.elements.s)).toBe(0);
    expect(opened.elements.f.childIds).toEqual(old.elements.f.childIds);
  });

  it("a silent or hidden track holds for everything on it, now and later", () => {
    let doc = runCommand(scene(), "set_track_switch", { id: "f", track: { index: 1 }, silent: true });
    expect(loudness(doc, doc.elements.a)).toBe(0);
    expect(loudness(doc, doc.elements.c)).toBe(1);
    // the clip's own sound setting is left as it was
    expect(doc.elements.a.volume).toBe(1);
    doc = runCommand(doc, "set_track", { ids: ["c"], track: { index: 1 } });
    expect(loudness(doc, doc.elements.c)).toBe(0);
    doc = runCommand(doc, "set_track_switch", { id: "f", track: { index: 0 }, hidden: true });
    expect(hiddenHere(doc, doc.elements.b)).toBe(true);
    expect(hiddenHere(doc, doc.elements.a)).toBe(false);
    doc = runCommand(doc, "set_track_switch", { id: "f", track: { index: 1 }, silent: false });
    expect(loudness(doc, doc.elements.a)).toBe(1);
    const again = parseDoc(serializeDoc(doc));
    expect(hiddenHere(again, again.elements.b)).toBe(true);
  });

  it("text and shapes keep their rows once saved", () => {
    let doc = scene();
    for (const [id, start, end] of [["w1", 0, 1], ["w2", 1, 2], ["w3", 0.5, 1.5]] as const) doc = runCommand(doc, "create_element", { type: "text", id, parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { start, end } });
    const opened = parseDoc(serializeDoc(doc));
    expect(names(opened).slice(0, 2)).toEqual(["Titles 1: w3", "Titles 2: w2 w1"]);
    expect(opened.elements.w1.track).toBeTruthy();
    // w1 moved out from under w3 stays on its row
    const moved = runCommand(opened, "set_timing", { ids: ["w1"], start: 5, end: 6 });
    expect(names(moved).slice(0, 2)).toEqual(["Titles 1: w3", "Titles 2: w2 w1"]);
    expect(parseDoc(serializeDoc(moved)).elements.w1.track).toBe(opened.elements.w1.track);
  });
});

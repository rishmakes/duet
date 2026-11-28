import { describe, expect, it } from "vitest";
import { runCommand } from ".";
import type { PlaceItem } from ".";
import { trackRows } from "../document/tracks";
import { emptyDoc } from "../document/types";
import type { Doc } from "../document/types";

const clip = (id: string, seconds: number, type: PlaceItem["type"] = "video"): PlaceItem => ({ id, type, src: `/m/${id}.mp4`, name: `${id}.mp4`, seconds, width: 1920, height: 1080 });

/** Clips a 0-4, b 4-7, c 7-9 on one track, and music under them on its own track. */
function edit() {
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
  doc = runCommand(runCommand(doc, "set_duration", { id: "f", seconds: 10 }), "follow_footage", { id: "f", on: true });
  return runCommand(doc, "place_media", { id: "f", items: [clip("a", 4), clip("b", 3), clip("c", 2), clip("m", 60, "sound")], at: 0 });
}

const rows = (doc: Doc) => trackRows(doc, doc.elements.f).map((r) => r.items.map((el) => `${el.id} ${el.start}-${el.end}`).join(", "));

describe("make_room (#399)", () => {
  it("a clip dragged over another covers it: the one under gets shorter and nothing jumps to another track", () => {
    let doc = runCommand(edit(), "set_timing", { ids: ["c"], start: 3, end: 5 });
    doc = runCommand(doc, "make_room", { ids: ["c"] });
    expect(rows(doc)).toEqual(["a 0-3, b 5-7, c 3-5", "m 0-60"]);
    expect(doc.elements.b.clipFrom).toBe(1);
  });

  it("with push, what starts later on the track moves along and the clip landed inside is cut", () => {
    let doc = runCommand(edit(), "set_timing", { ids: ["c"], start: 2, end: 4 });
    doc = runCommand(doc, "make_room", { ids: ["c"], push: true });
    const rest = doc.elements.f.childIds.find((id) => !["a", "b", "c", "m"].includes(id))!;
    expect(doc.elements.a.end).toBe(2);
    expect([doc.elements[rest].start, doc.elements[rest].end]).toEqual([4, 6]);
    expect([doc.elements.b.start, doc.elements.b.end]).toEqual([6, 9]);
    expect(rows(doc)).toHaveLength(2);
  });

  it("with push, a clip moved a little pushes what is after it only that little, with no gap (#452)", () => {
    // b 4-7 moved 0.2 s later: c pushed from 7 to 7.2, not by b's whole length
    let doc = runCommand(edit(), "set_timing", { ids: ["b"], start: 4.2, end: 7.2 });
    doc = runCommand(doc, "make_room", { ids: ["b"], push: true });
    expect(rows(doc)[0]).toBe("a 0-4, b 4.2-7.2, c 7.2-9.2");
    // moved into a gap it fits in: nothing else moves
    doc = runCommand(runCommand(doc, "set_timing", { ids: ["c"], start: 12, end: 14 }), "set_timing", { ids: ["b"], start: 8, end: 11 });
    expect(runCommand(doc, "make_room", { ids: ["b"], push: true }).elements.c.start).toBe(12);
  });

  it("leaves sound under clips alone, and is no step at all when nothing is covered", () => {
    const doc = edit();
    expect(runCommand(doc, "make_room", { ids: ["a"] })).toBe(doc);
    const moved = runCommand(runCommand(doc, "set_timing", { ids: ["c"], start: 1, end: 3 }), "make_room", { ids: ["c"] });
    expect(moved.elements.m.end).toBe(doc.elements.m.end);
  });
});

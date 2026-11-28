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

describe("ripple_trim (#236)", () => {
  it("the end edge pulled in moves the rest of the track left with it, so no gap opens", () => {
    const doc = runCommand(edit(), "ripple_trim", { id: "a", edge: "end", by: -1 });
    expect(rows(doc)).toEqual(["a 0-3, b 3-6, c 6-8", "m 0-60"]);
  });

  it("the end edge pulled out pushes the rest of the track right, and other tracks stay", () => {
    // a's file is 4 s, so trim it first to have room to pull it out again
    const doc = runCommand(runCommand(edit(), "ripple_trim", { id: "b", edge: "end", by: -1 }), "ripple_trim", { id: "b", edge: "end", by: 0.5 });
    expect(rows(doc)).toEqual(["a 0-4, b 4-6.5, c 6.5-8.5", "m 0-60"]);
  });

  it("the start edge trims the start of the file, the clip stays where it starts, and the rest moves left", () => {
    const doc = runCommand(edit(), "ripple_trim", { id: "b", edge: "start", by: 1 });
    expect(rows(doc)[0]).toBe("a 0-4, b 4-6, c 6-8");
    expect(doc.elements.b.clipFrom).toBe(1);
    // pulled back out, it shows the start again, never before the file begins
    const back = runCommand(doc, "ripple_trim", { id: "b", edge: "start", by: -5 });
    expect(rows(back)[0]).toBe("a 0-4, b 4-7, c 7-9");
    expect(back.elements.b.clipFrom).toBe(0);
  });

  it("close_gap closes an empty gap on one track: what is after it meets what is before it, other tracks stay", () => {
    // b deleted the plain way leaves a gap 4-7 between a and c
    const doc = runCommand(edit(), "delete_elements", { ids: ["b"] });
    const track = doc.elements.a.track!;
    const closed = runCommand(doc, "close_gap", { sceneId: "f", track, at: 5 });
    expect(rows(closed)).toEqual(["a 0-4, c 4-6", "m 0-60"]);
    // inside a clip there is no gap, so nothing happens
    expect(runCommand(doc, "close_gap", { sceneId: "f", track, at: 1 })).toBe(doc);
    // a gap at the very start closes to the start
    const late = runCommand(edit(), "delete_elements", { ids: ["a"] });
    expect(rows(runCommand(late, "close_gap", { sceneId: "f", track: late.elements.b.track!, at: 2 }))[0]).toBe("b 0-3, c 3-5");
  });

  it("ripple_delete with ownTrack closes the gap on that track only, so the music stays", () => {
    const doc = runCommand(runCommand(edit(), "set_timing", { ids: ["m"], start: 5, end: 9 }), "ripple_delete", { ids: ["a"], ownTrack: true });
    expect(rows(doc)).toEqual(["b 0-3, c 3-5", "m 5-9"]);
    // left out, everything after moves back, as before
    const all = runCommand(runCommand(edit(), "set_timing", { ids: ["m"], start: 5, end: 9 }), "ripple_delete", { ids: ["a"] });
    expect(rows(all)).toEqual(["b 0-3, c 3-5", "m 1-5"]);
  });

  it("keeps a clip a tenth of a second at least, and is no step when nothing changes", () => {
    const doc = edit();
    expect(rows(runCommand(doc, "ripple_trim", { id: "c", edge: "end", by: -9 }))[0]).toBe("a 0-4, b 4-7, c 7-7.1");
    expect(runCommand(doc, "ripple_trim", { id: "a", edge: "end", by: 0 })).toBe(doc);
  });
});

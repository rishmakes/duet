import { describe, expect, it } from "vitest";
import { runCommand } from ".";
import type { PlaceItem } from ".";
import { trackRows } from "../document/tracks";
import { emptyDoc } from "../document/types";
import type { Doc } from "../document/types";

const clip = (id: string, seconds: number, type: PlaceItem["type"] = "video"): PlaceItem => ({ id, type, src: `/m/${id}.mp4`, name: `${id}.mp4`, seconds, width: 1920, height: 1080 });

/** A video scene, 10 seconds long, as Home makes it. */
function blank() {
  const doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
  return runCommand(doc, "set_duration", { id: "f", seconds: 10 });
}

const rows = (doc: Doc) => trackRows(doc, doc.elements.f).map((r) => r.items.map((el) => `${el.id} ${el.start}-${el.end}`).join(", "));
const time = (doc: Doc, id: string) => [doc.elements[id].start, doc.elements[id].end];

describe("place_media", () => {
  it("an empty video takes the length of the clips, one after another on one track", () => {
    const doc = runCommand(blank(), "place_media", { id: "f", items: [clip("a", 4), clip("b", 3)], at: 0 });
    expect(doc.elements.f.duration).toBe(7);
    expect(rows(doc)).toEqual(["b 4-7, a 0-4"]);
  });

  it("a drop inside a clip goes to its nearer edge and pushes what is later on that track", () => {
    let doc = runCommand(blank(), "place_media", { id: "f", items: [clip("a", 4), clip("b", 3)], at: 0 });
    doc = runCommand(doc, "place_media", { id: "f", items: [clip("c", 2)], at: 3, track: { index: 0 } });
    expect(time(doc, "a")).toEqual([0, 4]);
    expect(time(doc, "c")).toEqual([4, 6]);
    expect(time(doc, "b")).toEqual([6, 9]);
    expect(doc.elements.f.duration).toBe(9);
    expect(trackRows(doc, doc.elements.f)).toHaveLength(1);
  });

  it("with Cmd it goes on a new track above and nothing moves", () => {
    let doc = runCommand(blank(), "place_media", { id: "f", items: [clip("a", 4)], at: 0 });
    doc = runCommand(doc, "place_media", { id: "f", items: [clip("c", 2)], at: 1, track: { index: 0 }, aside: true });
    expect(time(doc, "a")).toEqual([0, 4]);
    expect(rows(doc)).toEqual(["c 1-3", "a 0-4"]);
    // the new track is in front
    expect(doc.elements.f.childIds.indexOf("c")).toBeGreaterThan(doc.elements.f.childIds.indexOf("a"));
  });

  it("dropped on empty space it makes a new track on top", () => {
    let doc = runCommand(blank(), "place_media", { id: "f", items: [clip("a", 4)], at: 0 });
    doc = runCommand(doc, "place_media", { id: "f", items: [clip("c", 2)], at: 0 });
    expect(rows(doc)).toEqual(["c 0-2", "a 0-4"]);
  });

  it("sound goes on a sound track and stops where the video stops", () => {
    let doc = runCommand(blank(), "place_media", { id: "f", items: [clip("a", 4)], at: 0 });
    doc = runCommand(doc, "place_media", { id: "f", items: [clip("m", 60, "sound"), clip("b", 2)], at: 0, track: { index: 0 } });
    expect(time(doc, "b")).toEqual([0, 2]);
    expect(time(doc, "a")).toEqual([2, 6]);
    expect(time(doc, "m")).toEqual([0, 6]);
    expect(rows(doc)).toEqual(["b 0-2, a 2-6", "m 0-6"]);
  });

  it("in Motion the new layers go just above the picked one and keep the times", () => {
    let doc = runCommand(blank(), "place_media", { id: "f", items: [clip("a", 4), clip("b", 4)], at: 0 });
    doc = runCommand(doc, "place_media", { id: "f", items: [clip("c", 2), clip("d", 2)], at: 1, above: "a" });
    expect(doc.elements.f.childIds).toEqual(["a", "c", "d", "b"]);
    expect(time(doc, "c")).toEqual([1, 3]);
    expect(time(doc, "d")).toEqual([3, 5]);
    expect(time(doc, "b")).toEqual([4, 8]);
    // Edit still shows every one of them
    expect(trackRows(doc, doc.elements.f).flatMap((r) => r.items.map((el) => el.id)).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("is one step, and does nothing with nothing to place", () => {
    const doc = blank();
    expect(runCommand(doc, "place_media", { id: "f", items: [], at: 0 })).toBe(doc);
    expect(runCommand(doc, "place_media", { id: "nope", items: [clip("a", 2)], at: 0 })).toBe(doc);
  });
});

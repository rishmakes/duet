import { describe, expect, it } from "vitest";
import { runCommand } from ".";
import type { PlaceItem } from ".";
import { trackRows } from "../document/tracks";
import { emptyDoc } from "../document/types";
import type { Doc } from "../document/types";

const clip = (id: string, seconds: number, type: PlaceItem["type"] = "video"): PlaceItem => ({ id, type, src: `/m/${id}.mp4`, name: `${id}.mp4`, seconds, width: 1920, height: 1080 });

/** A video scene, 10 seconds long, as Home makes it, worked on in Edit. */
function blank() {
  const doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
  return runCommand(runCommand(doc, "set_duration", { id: "f", seconds: 10 }), "follow_footage", { id: "f", on: true });
}

const rows = (doc: Doc) => trackRows(doc, doc.elements.f).map((r) => r.items.map((el) => `${el.id} ${el.start}-${el.end}`).join(", "));
const time = (doc: Doc, id: string) => [doc.elements[id].start, doc.elements[id].end];

describe("place_media", () => {
  it("an empty video takes the length of the clips, one after another on one track", () => {
    const doc = runCommand(blank(), "place_media", { id: "f", items: [clip("a", 4), clip("b", 3)], at: 0 });
    expect(doc.elements.f.duration).toBe(7);
    expect(rows(doc)).toEqual(["b 4-7, a 0-4"]);
  });

  it("with push (Cmd), a drop in the middle of a clip cuts it there and pushes what is later on that track", () => {
    let doc = runCommand(blank(), "place_media", { id: "f", items: [clip("a", 4), clip("b", 3)], at: 0 });
    doc = runCommand(doc, "place_media", { id: "f", items: [clip("c", 2)], at: 3, track: { index: 0 }, push: true });
    expect(time(doc, "a")).toEqual([0, 3]);
    expect(time(doc, "c")).toEqual([3, 5]);
    const rest = doc.elements.f.childIds.find((id) => !["a", "b", "c"].includes(id))!;
    expect(time(doc, rest)).toEqual([5, 6]);
    expect(doc.elements[rest].clipFrom).toBe(3);
    expect(time(doc, "b")).toEqual([6, 9]);
    expect(doc.elements.f.duration).toBe(9);
    expect(trackRows(doc, doc.elements.f)).toHaveLength(1);
  });

  it("by default a drop covers what is under it and nothing later moves (#399)", () => {
    let doc = runCommand(blank(), "place_media", { id: "f", items: [clip("a", 4), clip("b", 3)], at: 0 });
    doc = runCommand(doc, "place_media", { id: "f", items: [clip("c", 2)], at: 1, track: { index: 0 } });
    // a is cut around c: its start before, its end after, and b stays where it was
    expect(time(doc, "a")).toEqual([0, 1]);
    expect(time(doc, "c")).toEqual([1, 3]);
    const rest = doc.elements.f.childIds.find((id) => !["a", "b", "c"].includes(id))!;
    expect(time(doc, rest)).toEqual([3, 4]);
    expect(doc.elements[rest].clipFrom).toBe(3);
    expect(time(doc, "b")).toEqual([4, 7]);
    expect(doc.elements.f.duration).toBe(7);
    expect(trackRows(doc, doc.elements.f)).toHaveLength(1);
  });

  it("a drop that covers a whole clip takes it away and trims the next one, all on one track", () => {
    let doc = runCommand(blank(), "place_media", { id: "f", items: [clip("a", 2), clip("b", 3)], at: 0 });
    doc = runCommand(doc, "place_media", { id: "f", items: [clip("c", 3)], at: 0, track: { index: 0 } });
    expect(doc.elements.a).toBeUndefined();
    expect(time(doc, "c")).toEqual([0, 3]);
    expect(time(doc, "b")).toEqual([3, 5]);
    expect(doc.elements.b.clipFrom).toBe(1);
    expect(rows(doc)).toEqual(["c 0-3, b 3-5"]);
  });

  it("aside, it goes on a new track above and nothing moves", () => {
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
    // the clip covers the start of the one under it, which keeps its place
    expect(time(doc, "b")).toEqual([0, 2]);
    expect(time(doc, "a")).toEqual([2, 4]);
    expect(doc.elements.a.clipFrom).toBe(2);
    expect(time(doc, "m")).toEqual([0, 4]);
    expect(rows(doc)).toEqual(["b 0-2, a 2-4", "m 0-4"]);
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

  it("with push, a drop in a title that runs to the end cuts it; its second part keeps its length, and nothing is drawn over", () => {
    let doc = runCommand(blank(), "follow_footage", { id: "f", on: false });
    doc = runCommand(runCommand(doc, "set_duration", { id: "f", seconds: 13 }), "follow_footage", { id: "f", on: true });
    doc = runCommand(doc, "create_element", { type: "text", id: "sun", parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { start: 0, end: 0 } });
    doc = runCommand(doc, "add_track", { id: "f", index: 1 });
    const pic = { ...clip("p", 3), type: "image" as const };
    doc = runCommand(doc, "place_media", { id: "f", items: [pic, clip("s", 6)], at: 4.7, track: { index: 0 }, push: true });
    expect(time(doc, "sun")).toEqual([0, 4.7]);
    expect(time(doc, "p")).toEqual([4.7, 7.7]);
    expect(time(doc, "s")).toEqual([7.7, 13.7]);
    const rest = doc.elements.f.childIds.find((id) => !["sun", "p", "s"].includes(id))!;
    expect(time(doc, rest)).toEqual([13.7, 22]);
    expect(doc.elements.f.duration).toBe(22);
    for (const row of trackRows(doc, doc.elements.f)) {
      const spans = row.items.map((el) => [el.start, el.end > el.start ? el.end : doc.elements.f.duration]);
      for (const [i, a] of spans.entries()) for (const b of spans.slice(i + 1)) expect(a[0] < b[1] && b[0] < a[1]).toBe(false);
    }
  });

  it("is one step, and does nothing with nothing to place", () => {
    const doc = blank();
    expect(runCommand(doc, "place_media", { id: "f", items: [], at: 0 })).toBe(doc);
    expect(runCommand(doc, "place_media", { id: "nope", items: [clip("a", 2)], at: 0 })).toBe(doc);
  });
});

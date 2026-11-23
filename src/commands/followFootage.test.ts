import { describe, expect, it } from "vitest";
import { runCommand } from ".";
import { parseDoc, serializeDoc } from "../document/serialize";
import { emptyDoc } from "../document/types";

/** A frame that plays for 5 seconds, worked on in Edit (follows its footage) or in Motion. */
function scene(edit: boolean) {
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
  doc = runCommand(doc, "set_duration", { id: "f", seconds: 5 });
  return edit ? runCommand(doc, "follow_footage", { id: "f", on: true }) : doc;
}

const clip = (id: string, start: number, end: number) => ({ type: "video" as const, id, parentId: "f", x: 0, y: 0, width: 1920, height: 1080, props: { src: `/m/${id}.mp4`, name: id, start, end } });

describe("follow_footage (#343)", () => {
  it("Edit: the scene grows with a clip and shrinks when it is trimmed, both ways", () => {
    let doc = runCommand(scene(true), "create_element", clip("a", 0, 10));
    expect(doc.elements.f.duration).toBe(10);
    doc = runCommand(doc, "set_timing", { ids: ["a"], start: 0, end: 3 });
    expect(doc.elements.f.duration).toBe(3);
    // pulling the end out past the scene's end is not cut short: the scene grows again
    doc = runCommand(doc, "set_timing", { ids: ["a"], end: 8 });
    expect(doc.elements.a.end).toBe(8);
    expect(doc.elements.f.duration).toBe(8);
    doc = runCommand(doc, "delete_elements", { ids: ["a"] });
    // with nothing on it, the scene keeps the length it had
    expect(doc.elements.f.duration).toBe(8);
  });

  it("Motion: adding or trimming never changes the length", () => {
    let doc = runCommand(scene(false), "create_element", clip("a", 0, 10));
    expect(doc.elements.f.duration).toBe(5);
    doc = runCommand(doc, "place_media", { id: "f", items: [{ id: "b", type: "video", src: "/m/b.mp4", name: "b.mp4", seconds: 10, width: 1920, height: 1080 }], at: 0, layers: true });
    expect(doc.elements.f.duration).toBe(5);
    doc = runCommand(doc, "set_timing", { ids: ["a"], end: 2 });
    expect(doc.elements.f.duration).toBe(5);
  });

  it("switching to Edit snaps to the end of the last thing; back to Motion keeps it", () => {
    let doc = runCommand(scene(false), "create_element", clip("a", 0, 3));
    doc = runCommand(doc, "create_element", { type: "text", id: "t", parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { start: 1, end: 4 } });
    doc = runCommand(doc, "follow_footage", { id: "f", on: true });
    // a title that runs past the clip counts
    expect(doc.elements.f.duration).toBe(4);
    doc = runCommand(doc, "follow_footage", { id: "f", on: false });
    expect(doc.elements.f.duration).toBe(4);
    expect(doc.elements.f.followsFootage).toBeUndefined();
  });

  it("a length typed by hand is refused in Edit; making it still again goes through", () => {
    const doc = runCommand(scene(true), "create_element", clip("a", 0, 4));
    expect(runCommand(doc, "set_duration", { id: "f", seconds: 9 })).toBe(doc);
    expect(runCommand(doc, "set_duration", { id: "f", seconds: 0 }).elements.f.duration).toBe(0);
  });

  it("the work area stays inside the scene when it shrinks", () => {
    let doc = runCommand(scene(true), "create_element", clip("a", 0, 10));
    doc = runCommand(doc, "set_work_area", { id: "f", start: 2, end: 9 });
    doc = runCommand(doc, "set_timing", { ids: ["a"], end: 6 });
    expect(doc.elements.f.workArea).toEqual({ start: 2, end: 6 });
    doc = runCommand(doc, "set_timing", { ids: ["a"], end: 1.5 });
    expect(doc.elements.f.workArea).toBeUndefined();
  });

  it("is saved with the design, and a scene that does not follow writes nothing new", () => {
    const doc = runCommand(scene(true), "create_element", clip("a", 0, 4));
    expect(parseDoc(serializeDoc(doc)).elements.f.followsFootage).toBe(true);
    expect(serializeDoc(scene(false))).not.toContain("followsFootage");
  });

  it("does nothing on a still design or when it is already so", () => {
    const still = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 10, height: 10 });
    expect(runCommand(still, "follow_footage", { id: "f", on: true })).toBe(still);
    const edit = scene(true);
    expect(runCommand(edit, "follow_footage", { id: "f", on: true })).toBe(edit);
  });
});

describe("Media keeps all the footage (#378)", () => {
  it("a clip placed on the timeline lands in Media, and stays there when taken off", () => {
    let doc = runCommand(scene(true), "create_element", clip("a", 0, 4));
    expect((doc.media ?? []).map((m) => m.src)).toEqual(["/m/a.mp4"]);
    doc = runCommand(doc, "delete_elements", { ids: ["a"] });
    expect(doc.elements.a).toBeUndefined();
    expect((doc.media ?? []).map((m) => m.src)).toEqual(["/m/a.mp4"]);
  });

  it("a file already in Media is not added twice, and never mutates", () => {
    let doc = runCommand(scene(true), "add_media", { items: [{ id: "k", name: "a.mp4", kind: "video", src: "/m/a.mp4" }] });
    doc = runCommand(doc, "create_element", clip("a", 0, 4));
    const before = JSON.stringify(doc);
    const after = runCommand(doc, "delete_elements", { ids: ["a"] });
    expect(after.media?.map((m) => m.id)).toEqual(["k"]);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("footage the video plays stays in Media unless it goes from the video too", () => {
    let doc = runCommand(scene(true), "create_element", clip("a", 0, 4));
    const id = doc.media![0].id;
    expect(runCommand(doc, "remove_media", { ids: [id] }).media).toHaveLength(1);
    doc = runCommand(doc, "remove_media", { ids: [id], fromVideo: true });
    expect(doc.elements.a).toBeUndefined();
    expect(doc.media ?? []).toHaveLength(0);
  });

  it("a removed folder lets go of what the video plays, which moves to the top", () => {
    let doc = runCommand(scene(true), "new_folder", { id: "f", name: "Takes" });
    doc = runCommand(doc, "add_media", { items: [{ id: "k", name: "a.mp4", kind: "video", src: "/m/a.mp4", folderId: "f" }, { id: "u", name: "b.mp4", kind: "video", src: "/m/b.mp4", folderId: "f" }] });
    doc = runCommand(doc, "create_element", clip("a", 0, 4));
    doc = runCommand(doc, "remove_media", { ids: ["f"] });
    expect(doc.media).toEqual([{ id: "k", name: "a.mp4", kind: "video", src: "/m/a.mp4" }]);
  });

  it("an old file lists the footage its timeline plays in Media when it opens", () => {
    const old = runCommand(scene(true), "create_element", clip("a", 0, 4));
    const { media: _m, ...bare } = old;
    const opened = parseDoc(serializeDoc(bare as typeof old));
    expect((opened.media ?? []).map((m) => m.src)).toEqual(["/m/a.mp4"]);
  });
});

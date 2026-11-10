import { describe, expect, it } from "vitest";
import { runCommand } from "./index";
import { parseDoc, serializeDoc } from "../document/serialize";
import { emptyDoc } from "../document/types";
import type { Doc } from "../document/types";

function withClips(): Doc {
  return runCommand(emptyDoc(), "add_media", {
    items: [
      { id: "f1", name: "Shoot", kind: "folder" },
      { id: "f2", name: "CamA", kind: "folder", folderId: "f1" },
      { id: "c1", name: "a.mp4", kind: "video", src: "/x/Shoot/CamA/a.mp4", length: 4, folderId: "f2" },
      { id: "s1", name: "song.mp3", kind: "sound", src: "/x/song.mp3", length: 90 },
      { id: "p1", name: "logo.png", kind: "image", src: "/x/logo.png" },
    ],
  });
}

describe("Clips", () => {
  it("adds clips and folders in order, keeping the nesting, and never mutates", () => {
    const before = emptyDoc();
    const d = runCommand(before, "add_media", { items: [{ id: "c", name: "a.mp4", kind: "video", src: "/a.mp4" }] });
    expect(before.media).toBeUndefined();
    expect(d.media).toEqual([{ id: "c", name: "a.mp4", kind: "video", src: "/a.mp4" }]);
    const n = withClips();
    expect(n.media!.map((m) => [m.id, m.folderId ?? null])).toEqual([
      ["f1", null],
      ["f2", "f1"],
      ["c1", "f2"],
      ["s1", null],
      ["p1", null],
    ]);
  });

  it("does not add the same file twice in one folder, nor a clip with no file", () => {
    const d = runCommand(withClips(), "add_media", {
      items: [
        { id: "s2", name: "song.mp3", kind: "sound", src: "/x/song.mp3" },
        { id: "v", name: "nothing", kind: "video" },
      ],
    });
    expect(d.media!.length).toBe(5);
  });

  it("removing a folder removes what is inside it", () => {
    const d = runCommand(withClips(), "remove_media", { ids: ["f1"] });
    expect(d.media!.map((m) => m.id)).toEqual(["s1", "p1"]);
    expect(runCommand(d, "remove_media", { ids: ["s1", "p1"] }).media).toBeUndefined();
  });

  it("new folders get their own names", () => {
    let d = runCommand(emptyDoc(), "new_folder", { id: "a" });
    d = runCommand(d, "new_folder", { id: "b" });
    expect(d.media!.map((m) => m.name)).toEqual(["Folder 1", "Folder 2"]);
  });

  it("renames, and an empty name changes nothing", () => {
    const d = runCommand(withClips(), "rename_media", { id: "c1", name: "Opening shot" });
    expect(d.media!.find((m) => m.id === "c1")!.name).toBe("Opening shot");
    const same = withClips();
    expect(runCommand(same, "rename_media", { id: "c1", name: "  " })).toBe(same);
  });

  it("moves into folders and back to the top, and a folder never goes inside itself", () => {
    let d = runCommand(withClips(), "move_media", { ids: ["s1"], folderId: "f2" });
    expect(d.media!.find((m) => m.id === "s1")!.folderId).toBe("f2");
    d = runCommand(d, "move_media", { ids: ["s1"], folderId: null });
    expect(d.media!.find((m) => m.id === "s1")!.folderId).toBeUndefined();
    const before = withClips();
    expect(runCommand(before, "move_media", { ids: ["f1"], folderId: "f2" })).toBe(before);
    expect(runCommand(before, "move_media", { ids: ["f1"], folderId: "f1" })).toBe(before);
  });

  it("survives saving and opening, and old files open with no Clips", () => {
    const d = withClips();
    expect(parseDoc(serializeDoc(d)).media).toEqual(d.media);
    expect(parseDoc(serializeDoc(emptyDoc())).media).toBeUndefined();
    expect(serializeDoc(emptyDoc())).not.toContain("media");
  });

  it("a saved folder that loops or is missing puts its things at the top", () => {
    const text = JSON.stringify({
      version: 1,
      rootIds: [],
      elements: {},
      media: [
        { id: "a", name: "A", kind: "folder", folderId: "b" },
        { id: "b", name: "B", kind: "folder", folderId: "a" },
        { id: "c", name: "c.mp4", kind: "video", src: "/c.mp4", folderId: "gone" },
        { id: "d", name: "bad", kind: "video" },
      ],
    });
    expect(parseDoc(text).media).toEqual([
      { id: "a", name: "A", kind: "folder" },
      { id: "b", name: "B", kind: "folder" },
      { id: "c", name: "c.mp4", kind: "video", src: "/c.mp4" },
    ]);
  });
});

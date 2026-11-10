import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { entriesOf, shown, usedIn } from "./ClipsPanel";

describe("Clips list", () => {
  it("shows the clips and sounds a video already plays, once per file, unless Clips has them", () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "f", type: "frame", x: 0, y: 0, width: 100, height: 100 });
    d = runCommand(d, "create_element", { id: "v1", type: "video", parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { src: "/a.mp4", name: "Swirl clip" } });
    d = runCommand(d, "create_element", { id: "v2", type: "video", parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { src: "/a.mp4", name: "Swirl again" } });
    d = runCommand(d, "create_element", { id: "s1", type: "sound", parentId: "f", x: 0, y: 0, width: 1, height: 1, props: { src: "/m.mp3", name: "Music" } });
    expect(usedIn(d, []).map((m) => [m.name, m.kind])).toEqual([
      ["Swirl clip", "video"],
      ["Music", "sound"],
    ]);
    expect(usedIn(d, [{ id: "k", name: "a", kind: "video", src: "/a.mp4" }]).map((m) => m.name)).toEqual(["Music"]);
  });

  it("filters keep the folders on the way to what matches", () => {
    const media = [
      { id: "f", name: "Shoot", kind: "folder" as const },
      { id: "a", name: "wide.mp4", kind: "video" as const, src: "/w.mp4", folderId: "f" },
      { id: "b", name: "song.mp3", kind: "sound" as const, src: "/s.mp3" },
    ];
    expect([...shown(media, "sound", "")]).toEqual(["b"]);
    expect([...shown(media, "all", "wide")].sort()).toEqual(["a", "f"]);
    expect(shown(media, "all", "").size).toBe(3);
  });
});

describe("Media", () => {
  it("lists the scenes first, then what is kept, then what the video plays", () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "f", type: "frame", x: 0, y: 0, width: 100, height: 100 });
    d = runCommand(d, "set_duration", { id: "f", seconds: 8 });
    d = runCommand(d, "create_element", { id: "v", type: "video", parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { src: "/a.mp4", name: "Swirl" } });
    d = runCommand(d, "add_media", { items: [{ id: "k", name: "logo.png", kind: "image", src: "/l.png" }] });
    expect(entriesOf(d).map((m) => [m.name, m.kind])).toEqual([
      ["Frame 1", "scene"],
      ["logo.png", "image"],
      ["Swirl", "video"],
    ]);
    expect([...shown(entriesOf(d), "scene", "")]).toEqual(["scene:f"]);
  });
});

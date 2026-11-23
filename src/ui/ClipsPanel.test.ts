import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { entriesOf, isRenameKey, shown } from "./ClipsPanel";

describe("Media", () => {
  it("lists the scenes first, then the footage, with what the video plays kept in Media (#378)", () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "f", type: "frame", x: 0, y: 0, width: 100, height: 100 });
    d = runCommand(d, "set_duration", { id: "f", seconds: 8 });
    d = runCommand(d, "create_element", { id: "v", type: "video", parentId: "f", x: 0, y: 0, width: 10, height: 10, props: { src: "/a.mp4", name: "Swirl" } });
    d = runCommand(d, "add_media", { items: [{ id: "k", name: "logo.png", kind: "image", src: "/l.png" }] });
    expect(entriesOf(d).map((m) => [m.name, m.kind])).toEqual([
      ["Frame 1", "scene"],
      ["Swirl", "video"],
      ["logo.png", "image"],
    ]);
    expect([...shown(entriesOf(d), "scene", "")]).toEqual(["scene:f"]);
  });
});

describe("Rename key in Media", () => {
  it("is Enter on a Mac and F2 on Windows, as each system's file browser", () => {
    expect(isRenameKey("Enter", true)).toBe(true);
    expect(isRenameKey("F2", true)).toBe(false);
    expect(isRenameKey("F2", false)).toBe(true);
    expect(isRenameKey("Enter", false)).toBe(false);
  });
});

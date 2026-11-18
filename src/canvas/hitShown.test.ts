import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { setSceneOnly } from "./render";
import { hitTest } from "./CanvasView";

describe("picking while a video is looked at alone", () => {
  afterEach(() => setSceneOnly(null));

  it("is not blocked by a picture left beside the video, which covers the same spot but is not on show (day 041: captions could not be edited)", () => {
    let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1080, height: 1920 });
    doc = runCommand(doc, "create_element", { type: "text", id: "caption", parentId: "f", x: 300, y: 737, width: 400, height: 78 });
    doc = runCommand(doc, "create_element", { type: "image", id: "loose", x: 45, y: 460, width: 640, height: 411 });
    expect(hitTest(doc, 500, 770)).toBe("loose");
    setSceneOnly("f");
    expect(hitTest(doc, 500, 770)).toBe("caption");
  });
});

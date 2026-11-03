import { describe, expect, it } from "vitest";
import { runCommand } from "./index";
import { parseDoc, serializeDoc } from "../document/serialize";
import { emptyDoc } from "../document/types";

function film() {
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
  doc = runCommand(doc, "create_element", { type: "frame", id: "still", x: 2000, y: 0, width: 400, height: 300 });
  return runCommand(doc, "set_duration", { id: "f", seconds: 8 });
}

describe("comments on a moment", () => {
  it("keep the scene and the second, held inside the scene's length", () => {
    const before = film();
    const doc = runCommand(before, "add_comment", { x: 10, y: 10, text: "Too big here", scene: "f", t: 3.456 });
    expect(doc.comments![0]).toMatchObject({ scene: "f", t: 3.46 });
    expect(before.comments).toBeUndefined();
    const late = runCommand(before, "add_comment", { x: 10, y: 10, text: "End", scene: "f", t: 20 });
    expect(late.comments![0].t).toBe(8);
  });

  it("leave out the time on a frame that does not play", () => {
    const doc = runCommand(film(), "add_comment", { x: 10, y: 10, text: "Still", scene: "still", t: 2 });
    expect(doc.comments![0].scene).toBeUndefined();
    expect(doc.comments![0].t).toBeUndefined();
  });

  it("survive saving and opening", () => {
    const doc = runCommand(film(), "add_comment", { x: 10, y: 10, text: "Here", scene: "f", t: 1.5 });
    expect(parseDoc(serializeDoc(doc)).comments![0]).toMatchObject({ scene: "f", t: 1.5 });
  });
});

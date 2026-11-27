import { beforeEach, describe, expect, it } from "vitest";
import { emptyDoc } from "../document/types";
import { currentDoc, dispatch, loadDoc, resetStore, setClock, undo } from "./store";
import { runCommand } from "../commands";

describe("Reset sound while a scene is open", () => {
  beforeEach(resetStore);

  it("one press puts back volume, fades and volume points, wherever the playhead is", () => {
    let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
    doc = runCommand(doc, "set_duration", { id: "f", seconds: 10 });
    doc = runCommand(doc, "create_element", { type: "sound", id: "m", parentId: "f", x: 0, y: 0, width: 1, height: 1, props: { src: "/music.mp3", start: 0, end: 8 } });
    doc = runCommand(doc, "set_props", { ids: ["m"], props: { volume: 0.2, fadeIn: 1 } });
    doc = runCommand(doc, "set_keys", { id: "m", prop: "volume", keys: [{ t: 1, v: 0.4 }, { t: 2, v: 0.6 }] });
    loadDoc(doc);
    setClock({ scene: "f", t: 1.5 });

    dispatch("reset_sound", { ids: ["m"] });
    const m = currentDoc().elements.m;
    expect([m.volume, m.fadeIn, m.fadeOut, m.keys.volume]).toEqual([1, 0, 0, undefined]);

    undo();
    expect(currentDoc().elements.m).toEqual(doc.elements.m);
  });
});

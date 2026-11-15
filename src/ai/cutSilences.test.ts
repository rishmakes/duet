import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => undefined }));

// a 10 second voice, loud all through except a pause from 3 to 5 seconds (one reading every 0.05 s)
const voice = new Uint8Array(200).map((_, i) => (i >= 60 && i < 100 ? 5 : 200));
vi.mock("../video/faces", async (original) => ({ ...(await original<typeof import("../video/faces")>()), peaksOf: async () => voice }));

import { callTool } from "./tools";
import { setMode } from "./chat";
import { runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { currentDoc, loadDoc, resetStore } from "../state/store";

function talk() {
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
  doc = runCommand(doc, "set_duration", { id: "f", seconds: 10 });
  doc = runCommand(doc, "create_element", { type: "video", id: "v", parentId: "f", x: 0, y: 0, width: 1920, height: 1080, props: { src: "/talk.mp4", start: 0, end: 10 } });
  return doc;
}

describe("the AI's Cut silences tool", () => {
  beforeEach(() => {
    resetStore();
    setMode("auto");
    loadDoc(talk());
  });

  it("lists the pauses first without cutting anything", async () => {
    const r = await callTool("cut_silences", { id: "f", find: true });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.text)).toEqual({ pauses: [{ start: 3.1, end: 4.9 }], seconds: 1.8 });
    expect(currentDoc().elements.f.duration).toBe(10);
  });

  it("cuts them with the same command as the button, so the video gets shorter", async () => {
    const r = await callTool("cut_silences", { id: "f" });
    expect(r.isError).toBeFalsy();
    expect(currentDoc().elements.f.duration).toBe(8.2);
  });

  it("says why when there is nothing to cut or the settings are wrong", async () => {
    expect((await callTool("cut_silences", { id: "f", quiet: 1 })).isError).toBe(true);
    expect((await callTool("cut_silences", { id: "v" })).isError).toBe(true);
    const none = await callTool("cut_silences", { id: "f", shortest: 5 });
    expect(none.isError).toBe(true);
    expect(currentDoc().elements.f.duration).toBe(10);
  });
});

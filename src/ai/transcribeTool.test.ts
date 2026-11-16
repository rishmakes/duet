import { beforeEach, describe, expect, it, vi } from "vitest";

const heard: { path: string; language: string; prompt: string | null }[] = [];
let installed: string | null = "medium";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { path: string; language: string; prompt: string | null }) => {
    if (cmd === "voice_status") return { installed };
    if (cmd === "voice_transcribe") {
      heard.push(args);
      return { language: args.language, model: "medium", words: [{ w: "Namaste", s: 0.2, e: 0.6 }, { w: "dosto", s: 0.7, e: 1.1 }] };
    }
    return undefined;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));

import { callTool } from "./tools";
import { setMode } from "./chat";
import { runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { currentDoc, loadDoc, resetStore } from "../state/store";

function talk() {
  let doc = runCommand(emptyDoc(), "create_element", { type: "frame", id: "f", x: 0, y: 0, width: 1920, height: 1080 });
  doc = runCommand(doc, "set_duration", { id: "f", seconds: 6 });
  doc = runCommand(doc, "create_element", { type: "video", id: "a", parentId: "f", x: 0, y: 0, width: 1920, height: 1080, props: { src: "/talk.mp4", start: 0, end: 3 } });
  doc = runCommand(doc, "create_element", { type: "video", id: "b", parentId: "f", x: 0, y: 0, width: 1920, height: 1080, props: { src: "/talk.mp4", start: 3, end: 6, clipFrom: 3 } });
  return doc;
}

describe("the AI's transcribe tool", () => {
  beforeEach(() => {
    resetStore();
    setMode("suggest");
    loadDoc(talk());
    heard.length = 0;
    installed = "medium";
  });

  it("hears each recording once, keeps its words, and needs no yes since it changes nothing seen", async () => {
    const r = await callTool("transcribe", { ids: ["a", "b"], language: "Hinglish" });
    expect(r.isError).toBeFalsy();
    expect(heard).toHaveLength(1);
    expect(heard[0].language).toBe("en");
    expect(heard[0].prompt).toBeTruthy();
    expect(currentDoc().words?.["/talk.mp4"].language).toBe("hi-en");
    expect(r.text).toContain("talk.mp4: 2 words");
  });

  it("skips a recording that already has words unless asked again", async () => {
    await callTool("transcribe", { ids: ["a"], language: "en" });
    const r = await callTool("transcribe", { ids: ["b"], language: "en" });
    expect(heard).toHaveLength(1);
    expect(r.text).toContain("already heard before");
    await callTool("transcribe", { ids: ["b"], language: "en", again: true });
    expect(heard).toHaveLength(2);
  });

  it("says what is wrong: not downloaded, a wrong language, not a clip", async () => {
    expect((await callTool("transcribe", { ids: ["a"], language: "Klingon" })).isError).toBe(true);
    expect((await callTool("transcribe", { ids: ["f"], language: "en" })).isError).toBe(true);
    installed = null;
    const r = await callTool("transcribe", { ids: ["a"], language: "en" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Store");
    expect(heard).toHaveLength(0);
  });
});

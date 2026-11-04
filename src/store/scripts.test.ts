import { describe, expect, it } from "vitest";
// @ts-ignore node's own types are not part of this project; the tests run in node
import vm from "node:vm";
import { emptyDoc } from "../document/types";
import { ScriptRun, itemsFor, readMeta, workerSource } from "./scripts";
import { scriptStep } from "../ai/tools";

describe("a script's steps", () => {
  it("changes a copy of the design through the same tools as the AI, counting each change", () => {
    const start = emptyDoc();
    const run = new ScriptRun(start);
    const made = run.handle({ type: "call", id: 1, tool: "create_element", args: { type: "rect", x: 0, y: 0, width: 40, height: 40 } });
    expect(made?.error).toBeUndefined();
    const id = made?.value as string;
    expect(run.doc.elements[id]?.type).toBe("rect");
    run.handle({ type: "call", id: 2, tool: "set_props", args: { ids: [id], props: { opacity: 0.5 } } });
    expect(run.doc.elements[id]?.opacity).toBe(0.5);
    expect(run.steps).toBe(2);
    // the design on screen is untouched until the run ends
    expect(start.rootIds).toEqual([]);
  });

  it("reads the design without counting a change", () => {
    const run = new ScriptRun(emptyDoc());
    const r = run.handle({ type: "call", id: 1, tool: "get_document" });
    expect(r?.value).toEqual({ rootIds: [], elements: {} });
    expect(run.steps).toBe(0);
  });

  it("has no door to files, exports or the internet", () => {
    for (const tool of ["export_frame", "place_image", "load_look", "save_skill", "save_version", "picture_of_duet"]) {
      const r = scriptStep(emptyDoc(), tool, {});
      expect("error" in r && r.error).toMatch(/cannot use/);
    }
  });

  it("answers a wrong call with the reason, and keeps going", () => {
    const run = new ScriptRun(emptyDoc());
    const r = run.handle({ type: "call", id: 1, tool: "set_props", args: { ids: ["nope"], props: {} } });
    expect(r?.error).toBeTruthy();
    expect(run.steps).toBe(0);
  });

  it("keeps what the script says", () => {
    const run = new ScriptRun(emptyDoc());
    expect(run.handle({ type: "log", text: "hello" })).toBeNull();
    expect(run.logs).toEqual(["hello"]);
  });
});

describe("what a script runs on", () => {
  let doc = emptyDoc();
  const frame = scriptStep(doc, "create_element", { type: "frame", x: 0, y: 0, width: 100, height: 100 });
  if ("doc" in frame) doc = frame.doc;
  const rect = scriptStep(doc, "create_element", { type: "rect", x: 200, y: 0 });
  if ("doc" in rect) doc = rect.doc;

  it("gives the picked things, each frame, nothing for the whole file, or the lines of a list", () => {
    expect(itemsFor("selection", doc, ["a", "b"])).toEqual(["a", "b"]);
    expect(itemsFor("each-frame", doc, [])).toEqual(doc.rootIds.filter((id) => doc.elements[id].type === "frame"));
    expect(itemsFor("each-frame", doc, [])).toHaveLength(1);
    expect(itemsFor("file", doc, ["a"])).toEqual([]);
    expect(itemsFor("list", doc, [], [" one ", "", "two"])).toEqual(["one", "two"]);
  });

  it("reads script.json, and still shows a broken one by its folder name", () => {
    expect(readMeta('{"name":"Tidy names","line":"Names layers","runsOn":"each-frame"}', "x")).toEqual({ name: "Tidy names", line: "Names layers", runsOn: "each-frame" });
    expect(readMeta("not json", "tidy")).toEqual({ name: "tidy", line: "", runsOn: "selection" });
  });
});

describe("the script's own room", () => {
  /** Run the worker's source in a bare room that looks like a worker, with the internet in it. */
  function room(code: string) {
    const sent: { type: string; [k: string]: unknown }[] = [];
    class Scope {
      fetch() {
        return "reached the internet";
      }
    }
    // like a worker, the room itself is "self", so a bare fetch is looked up on it
    const self = new Scope() as Scope & Record<string, unknown>;
    self.self = self;
    self.postMessage = (m: { type: string }) => sent.push(m);
    self.XMLHttpRequest = function () {};
    const ctx = vm.createContext(self);
    vm.runInContext(workerSource(code), ctx);
    const start = () => (self.onmessage as (e: { data: unknown }) => Promise<void>)({ data: { type: "start", items: ["a"] } });
    return { self, sent, start };
  }

  it("shuts the internet before the script runs", async () => {
    const r = room("duet.log(typeof fetch, typeof self.fetch, typeof XMLHttpRequest);");
    await r.start();
    expect(r.sent[0]).toEqual({ type: "log", text: "undefined undefined undefined" });
    expect(r.sent[1]).toEqual({ type: "done" });
  });

  it("hands the script its items and sends its calls out", async () => {
    const r = room("duet.log(duet.items.join(',')); duet.call('get_document', { a: 1 });");
    await r.start();
    expect(r.sent).toContainEqual({ type: "log", text: "a" });
    expect(r.sent).toContainEqual({ type: "call", id: 1, tool: "get_document", args: { a: 1 } });
  });

  it("reports a script that throws", async () => {
    const r = room("throw new Error('oops');");
    await r.start();
    expect(r.sent).toContainEqual({ type: "error", text: "oops" });
  });
});

import { scriptAsk } from "./scripts";
describe("asking the AI to write a script", () => {
  it("says what it runs on, carries the code so far, and asks for save_script", () => {
    const t = scriptAsk("round every corner", "each-frame", "Round", "duet.log(1);");
    expect(t).toContain('called "Round"');
    expect(t).toContain('runsOn "each-frame"');
    expect(t).toContain("duet.log(1);");
    expect(t).toContain("save_script");
  });
});

import { DUET_SCRIPTS } from "./scripts";
describe("the scripts that come with Duet", () => {
  /** Run a script for real, in a bare room, with its calls answered by a ScriptRun. */
  async function runFor(code: string, start: ReturnType<typeof emptyDoc>, items: string[]) {
    const run = new ScriptRun(start);
    const self = {} as Record<string, unknown>;
    self.self = self;
    let finished: (v: string) => void = () => {};
    const end = new Promise<string>((r) => (finished = r));
    self.postMessage = (m: { type: string; text?: string }) => {
      if (m.type === "done" || m.type === "error") return finished(m.type === "error" ? String(m.text) : "done");
      const reply = run.handle(m);
      if (reply) void Promise.resolve().then(() => (self.onmessage as (e: { data: unknown }) => void)({ data: reply }));
    };
    vm.runInContext(workerSource(code), vm.createContext(self));
    void (self.onmessage as (e: { data: unknown }) => void)({ data: { type: "start", items } });
    return { result: await end, run };
  }

  it("Space evenly in a row puts the same gap between picked things", async () => {
    let doc = emptyDoc();
    const ids: string[] = [];
    for (const [x, width] of [[0, 20], [30, 20], [150, 40], [200, 20]]) {
      const r = scriptStep(doc, "create_element", { type: "rect", x, y: 0, width, height: 20 });
      if (!("doc" in r)) throw new Error(r.error);
      doc = r.doc;
      ids.push(r.value as string);
    }
    const space = DUET_SCRIPTS.find((s) => s.id === "script-duet-space-evenly")!;
    const { result, run } = await runFor(space.code, doc, ids);
    expect(result).toBe("done");
    const xs = ids.map((id) => run.doc.elements[id].x);
    // 220 wide, 100 of things, so three gaps of 40
    expect(xs).toEqual([0, 60, 120, 200]);
  });
});

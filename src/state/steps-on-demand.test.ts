import { describe, expect, it } from "vitest";
import { NOT_LOADED, getState, goTo, liveRoom, loadTimeline, setProject, setStepLoader, undo } from "./store";
import type { HistoryEntry } from "./store";
import { emptyDoc } from "../document/types";

const docNamed = (name: string) => ({ ...emptyDoc(), rootIds: [name] });
const step = (n: number, loaded: boolean): HistoryEntry => ({
  doc: loaded ? docNamed(`d${n}`) : NOT_LOADED,
  hash: `h${n}`,
  label: `step ${n}`,
  actor: "you",
  time: n,
});
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("a long history opened with only its newest designs", () => {
  it("fetches an older step's design before going back to it, and keeps it", async () => {
    const asked: string[] = [];
    setStepLoader(async (_path, hash) => {
      asked.push(hash);
      return docNamed(`d${hash.slice(1)}`);
    });
    setProject({ path: "/work/p" });
    loadTimeline([step(0, false), step(1, false), step(2, true)]);

    goTo(0);
    // nothing changes until the design is in
    expect(getState().cursor).toBe(2);
    await settle();
    expect(getState().cursor).toBe(0);
    expect(getState().timeline[0].doc.rootIds).toEqual(["d0"]);
    expect(asked).toEqual(["h0"]);

    goTo(2);
    goTo(0);
    expect(getState().cursor).toBe(0);
    expect(asked).toEqual(["h0"]);
  });

  it("undo walks back into steps that were not loaded", async () => {
    setStepLoader(async (_path, hash) => docNamed(`d${hash.slice(1)}`));
    setProject({ path: "/work/p" });
    loadTimeline([step(0, false), step(1, true)]);
    undo();
    await settle();
    expect(getState().cursor).toBe(0);
    expect(getState().timeline[0].doc.rootIds).toEqual(["d0"]);
  });

  it("a version is fetched before it is brought back", async () => {
    setStepLoader(async () => docNamed("old"));
    setProject({ path: "/work/p" });
    loadTimeline([{ ...step(0, false), version: "Client round 1" }, step(1, true)]);
    const doc = await liveRoom.stepDoc(getState().timeline[0]);
    expect(doc?.rootIds).toEqual(["old"]);
  });
});

import { describe, expect, it } from "vitest";
import { noPicks, pick, type PickAct, type Picks } from "./mediaPick";

const order = ["scene", "a", "b", "c", "d"];
const run = (acts: PickAct[], from: Picks = noPicks, o = order) => acts.reduce((s, a) => pick(s, a, o), from);
const ids = (acts: PickAct[], from?: Picks, o?: string[]) => run(acts, from, o).ids;

describe("Picking in Media", () => {
  it("a press picks one thing, and another press picks another instead", () => {
    expect(ids([{ type: "press", id: "a" }, { type: "click", id: "a" }])).toEqual(["a"]);
    expect(ids([{ type: "press", id: "a" }, { type: "click", id: "a" }, { type: "press", id: "scene" }, { type: "click", id: "scene" }])).toEqual(["scene"]);
    expect(ids([{ type: "press", id: "scene" }, { type: "press", id: "b" }])).toEqual(["b"]);
  });

  it("Cmd adds or takes away, and Shift picks a run from the last one", () => {
    expect(ids([{ type: "press", id: "a" }, { type: "press", id: "c", toggle: true }])).toEqual(["a", "c"]);
    expect(ids([{ type: "press", id: "a" }, { type: "press", id: "c", toggle: true }, { type: "press", id: "a", toggle: true }])).toEqual(["c"]);
    expect(ids([{ type: "press", id: "b" }, { type: "press", id: "d", shift: true }])).toEqual(["b", "c", "d"]);
    expect(ids([{ type: "press", id: "b" }, { type: "press", id: "d", shift: true }, { type: "press", id: "a", shift: true }])).toEqual(["a", "b"]);
  });

  it("the box ticks and unticks without Cmd, and keeps the order Media shows", () => {
    expect(ids([{ type: "tick", id: "c" }, { type: "tick", id: "a" }])).toEqual(["a", "c"]);
    expect(ids([{ type: "tick", id: "c" }, { type: "tick", id: "a" }, { type: "tick", id: "c" }])).toEqual(["a"]);
  });

  it("pressing one of several keeps them all for a drag; the click narrows to it", () => {
    const two = run([{ type: "tick", id: "a" }, { type: "tick", id: "b" }]);
    expect(ids([{ type: "press", id: "a" }], two)).toEqual(["a", "b"]);
    expect(ids([{ type: "press", id: "a" }, { type: "dragEnd" }], two)).toEqual(["a", "b"]);
    expect(ids([{ type: "press", id: "a" }, { type: "click", id: "a" }], two)).toEqual(["a"]);
    // a drag that ended forgets the narrow, so a later stray click does not narrow
    expect(ids([{ type: "press", id: "a" }, { type: "dragEnd" }, { type: "click", id: "a" }], two)).toEqual(["a", "b"]);
  });

  it("grabbing a thing that is not picked picks just it, even if the press never reached it", () => {
    const one = run([{ type: "press", id: "b" }]);
    expect(ids([{ type: "drag", id: "c" }], one)).toEqual(["c"]);
    const two = run([{ type: "tick", id: "a" }, { type: "tick", id: "b" }]);
    expect(ids([{ type: "drag", id: "b" }], two)).toEqual(["a", "b"]);
  });

  it("letting go always lets go, and picking works again right after", () => {
    const s = run([{ type: "all" }, { type: "none" }]);
    expect(s).toEqual(noPicks);
    expect(ids([{ type: "press", id: "b" }], s)).toEqual(["b"]);
  });

  it("what is no longer shown is no longer picked, so a switch of view or filter leaves nothing hidden", () => {
    const s = run([{ type: "tick", id: "scene" }, { type: "tick", id: "a" }]);
    const grid = ["b", "c"];
    const after = pick(s, { type: "shown" }, grid);
    expect(after).toEqual(noPicks);
    expect(pick(after, { type: "press", id: "c" }, grid).ids).toEqual(["c"]);
  });

  it("a right-click on one of the picked keeps them; on another, picks just that", () => {
    const two = run([{ type: "tick", id: "a" }, { type: "tick", id: "b" }]);
    expect(ids([{ type: "menu", id: "b" }], two)).toEqual(["a", "b"]);
    expect(ids([{ type: "menu", id: "d" }], two)).toEqual(["d"]);
  });

  it("Cmd-A picks everything shown", () => {
    expect(ids([{ type: "all" }])).toEqual(order);
  });
});

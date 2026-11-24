import { describe, expect, it } from "vitest";
import { planSounds } from "./audioClock";
import type { Doc, El } from "../document/types";

const el = (o: Partial<El>) => ({ type: "sound", src: "a.mp3", clipFrom: 0, speed: 1, volume: 1, keys: {}, fadeIn: 0, fadeOut: 0, start: 0, end: 0, ...o }) as unknown as El;
const scene = el({ id: "s", type: "frame", duration: 10 });
const doc = (...els: El[]) => ({ elements: Object.fromEntries([scene, ...els].map((e) => [e.id, e])) }) as unknown as Doc;
const ready = () => true;
const len = () => 30;

describe("planSounds", () => {
  it("a cut clip's two halves meet exactly: the second begins at the file moment the first ends", () => {
    const d = doc(el({ id: "a", start: 0, end: 4 }), el({ id: "b", start: 4, end: 10, clipFrom: 4 }));
    const [a, b] = planSounds(d, scene, 0, ["a", "b"], ready, len);
    expect(a.after).toBe(0);
    expect(b.after).toBe(4);
    expect(a.offset + a.length).toBe(b.offset);
  });
  it("playing from the middle of a clip starts it at its place in the file", () => {
    const d = doc(el({ id: "a", start: 2, end: 8, clipFrom: 5 }));
    const [a] = planSounds(d, scene, 3, ["a"], ready, len);
    expect(a.after).toBe(0);
    expect(a.offset).toBe(6);
    expect(a.length).toBe(5);
  });
  it("leaves out what is already over, and stops at the end of the file", () => {
    const d = doc(el({ id: "a", start: 0, end: 2 }), el({ id: "b", start: 0, end: 10, clipFrom: 25 }));
    const plan = planSounds(d, scene, 3, ["a", "b"], ready, len);
    expect(plan.map((p) => p.id)).toEqual(["b"]);
    expect(plan[0].length).toBe(2);
  });
});

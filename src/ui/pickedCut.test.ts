import { describe, expect, it } from "vitest";
import { TRANSITION_DRAG, cutKeyAction, draggedKind } from "./pickedCut";

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});
const on = { picked: true, hasMove: true, copied: true, typing: false };

describe("keys on a picked cut", () => {
  it("Cmd+C copies and Cmd+V pastes a picked transition, on the key itself", () => {
    expect(cutKeyAction(key("c", { metaKey: true }), on)).toBe("copy");
    expect(cutKeyAction(key("v", { metaKey: true }), on)).toBe("paste");
    expect(cutKeyAction(key("C", { ctrlKey: true }), on)).toBe("copy");
  });

  it("Cmd+V pastes onto a plain cut picked by its +", () => {
    expect(cutKeyAction(key("v", { metaKey: true }), { ...on, hasMove: false })).toBe("paste");
  });

  it("leaves Cmd+C and Cmd+V to clips and things when no cut is picked", () => {
    const none = { ...on, picked: false };
    expect(cutKeyAction(key("c", { metaKey: true }), none)).toBeNull();
    expect(cutKeyAction(key("v", { metaKey: true }), none)).toBeNull();
  });

  it("leaves the keys alone while typing, and when there is nothing to copy or paste", () => {
    expect(cutKeyAction(key("c", { metaKey: true }), { ...on, typing: true })).toBeNull();
    expect(cutKeyAction(key("c", { metaKey: true }), { ...on, hasMove: false })).toBeNull();
    expect(cutKeyAction(key("v", { metaKey: true }), { ...on, copied: false })).toBeNull();
    expect(cutKeyAction(key("c"), on)).toBeNull();
    expect(cutKeyAction(key("v", { metaKey: true, shiftKey: true }), on)).toBeNull();
  });

  it("Delete takes away a transition and Escape lets the cut go", () => {
    expect(cutKeyAction(key("Backspace"), on)).toBe("remove");
    expect(cutKeyAction(key("Delete"), { ...on, hasMove: false })).toBeNull();
    expect(cutKeyAction(key("Escape"), on)).toBe("let-go");
  });
});

describe("a transition tile dropped on a cut", () => {
  const drag = (data: Record<string, string>) => [Object.keys(data), (t: string) => data[t] ?? ""] as const;

  it("carries the transition it was dragged from", () => {
    expect(draggedKind(...drag({ [TRANSITION_DRAG]: "dip-black" }))).toBe("dip-black");
  });

  it("ignores footage, layers and anything else dropped on a cut", () => {
    expect(draggedKind(...drag({ Files: "" }))).toBeNull();
    expect(draggedKind(...drag({ "text/plain": "dissolve" }))).toBeNull();
  });

  it("ignores a kind Duet does not have", () => {
    expect(draggedKind(...drag({ [TRANSITION_DRAG]: "explode" }))).toBeNull();
  });
});

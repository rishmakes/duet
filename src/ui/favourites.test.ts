import { describe, expect, it } from "vitest";

const store = new Map<string, string>();
// @ts-expect-error mock storage for node test environment
globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };

const { faveOf, toggleFavourite, toggleIn } = await import("./favourites");

describe("favourites (#338)", () => {
  it("a star goes on first, and comes off again", () => {
    const a = toggleIn([], faveOf.transition("dissolve"));
    const b = toggleIn(a, faveOf.style("x"));
    expect(b).toEqual(["style:x", "transition:dissolve"]);
    expect(toggleIn(b, "transition:dissolve")).toEqual(["style:x"]);
  });

  it("stays on this computer", () => {
    toggleFavourite("transition:dip-black");
    expect(JSON.parse(store.get("duet.assets.favourites")!)).toEqual(["transition:dip-black"]);
  });
});

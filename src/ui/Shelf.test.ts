import { describe, expect, it } from "vitest";

const store = new Map<string, string>();
// @ts-expect-error mock storage for node test environment
globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };

const { getLayout, parseLayout } = await import("./layout");
const { toggleShelf } = await import("./Shelf");

describe("shelves fold shut and stay shut (#338)", () => {
  it("starts with every shelf open", () => {
    expect(parseLayout({}).shelvesShut).toEqual([]);
  });

  it("shuts a shelf, keeps it shut on this computer, and opens it again", () => {
    toggleShelf("captions-ready");
    expect(getLayout().shelvesShut).toEqual(["captions-ready"]);
    expect(parseLayout(JSON.parse(store.get("duet:layout")!)).shelvesShut).toEqual(["captions-ready"]);
    toggleShelf("captions-ready");
    expect(getLayout().shelvesShut).toEqual([]);
  });

  it("drops anything that is not a shelf name", () => {
    expect(parseLayout({ shelvesShut: ["assets-fonts", 3, null] }).shelvesShut).toEqual(["assets-fonts"]);
    expect(parseLayout({ shelvesShut: "nope" }).shelvesShut).toEqual([]);
  });
});

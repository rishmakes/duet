import { describe, expect, it } from "vitest";
import type { Doc } from "../document/types";
import { isUntitledName, nameFromWork } from "./naming";

const doc = (els: { id: string; type: string; name: string }[]): Doc =>
  ({ version: 1, rootIds: els.map((e) => e.id), elements: Object.fromEntries(els.map((e) => [e.id, e])) }) as unknown as Doc;

describe("naming Untitled work", () => {
  it("knows the names Duet gave on its own", () => {
    expect(isUntitledName("Untitled")).toBe(true);
    expect(isUntitledName("Untitled 45")).toBe(true);
    expect(isUntitledName("Untitled poster")).toBe(false);
  });

  it("takes a named frame first", () => {
    const d = doc([
      { id: "a", type: "rect", name: "Background" },
      { id: "b", type: "frame", name: "Mercury Diagnostics – Letterhead A4" },
    ]);
    expect(nameFromWork(d, "make a letterhead")).toBe("Mercury Diagnostics – Letterhead A4");
  });

  it("skips names nobody chose, and falls back to the request", () => {
    const d = doc([{ id: "a", type: "frame", name: "Frame 1" }]);
    expect(nameFromWork(d, "@Juniper make a poster for a jazz night, please!")).toBe("Make a poster for a jazz");
  });

  it("clears letters a file name cannot hold", () => {
    expect(nameFromWork(doc([{ id: "a", type: "frame", name: "Menu: lunch/dinner" }]))).toBe("Menu lunch dinner");
  });

  it("gives nothing when nothing says", () => {
    expect(nameFromWork(doc([]))).toBeNull();
  });
});

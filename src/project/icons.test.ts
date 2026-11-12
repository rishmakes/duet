import { describe, expect, it } from "vitest";
import { readSvg, countLayers } from "../document/svgImport";
import { parseIcon } from "./icons";

describe("icons", () => {
  it("only accepts names from the offered sets", () => {
    expect(parseIcon("lucide:house")).toEqual({ prefix: "lucide", name: "house" });
    expect(parseIcon("fa6-solid:house")).toBeNull();
    expect(parseIcon("ps:cart")).toBeNull();
    expect(parseIcon("house")).toBeNull();
  });

  it("an icon at a pixel size comes in at that size as layers", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10l9-8 9 8v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></g></svg>`;
    const plan = readSvg(svg, "house");
    expect(plan.width).toBe(24);
    expect(plan.height).toBe(24);
    expect(countLayers(plan.items)).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { finds, shelfOn } from "./assetsFind";

describe("finding in Assets (#338)", () => {
  it("an empty search finds everything", () => {
    expect(finds("", "Dissolve")).toBe(true);
    expect(finds("   ")).toBe(true);
  });

  it("finds a name holding the words, in any case", () => {
    expect(finds("dip", "Dissolve", "Dip to black")).toBe(true);
    expect(finds(" BLACK ", "Dip to black")).toBe(true);
    expect(finds("glow", "Dissolve", "Dip to black")).toBe(false);
  });

  it("a chip shows its own shelf; design system and components show only under All", () => {
    expect(shelfOn("transitions", "transitions")).toBe(true);
    expect(shelfOn("yours", "transitions")).toBe(false);
    expect(shelfOn("system", "brand")).toBe(false);
    expect(shelfOn("components", "all")).toBe(true);
    expect(shelfOn("effects", "effects")).toBe(true);
  });
});

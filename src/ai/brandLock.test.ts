import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { brandRules, offBrand } from "./brandLock";

function kit(locked: boolean) {
  let d = runCommand(emptyDoc(), "add_brand_colour", { id: "c1", name: "Navy", hex: "#0b1f3a" });
  return runCommand(d, "set_brand", { fonts: ["Inter"], voice: "Plain.", locked });
}

describe("brand lock", () => {
  it("lets anything through while unlocked", () => {
    expect(offBrand(kit(false), { props: { fill: "#ff0000", fontFamily: "Comic Sans" } })).toBeNull();
  });

  it("refuses colours and fonts outside a locked kit, deep inside the arguments", () => {
    const msg = offBrand(kit(true), { elements: [{ type: "rect", fill: "#FF0000" }, { type: "text", fontFamily: "Arial" }] });
    expect(msg).toContain("#FF0000");
    expect(msg).toContain("Arial");
  });

  it("lets kit colours, white, black and kit fonts through", () => {
    expect(offBrand(kit(true), { props: { fill: "#0B1F3A", stroke: "#fff", shadow: { color: "#000000" }, fontFamily: "inter" } })).toBeNull();
  });

  it("tells the AI the kit as rules", () => {
    const text = brandRules(kit(true));
    expect(text).toContain("Navy #0b1f3a");
    expect(text).toContain("Inter");
    expect(text).toContain("locked");
    expect(brandRules(emptyDoc())).toBe("");
  });
});

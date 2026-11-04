import { describe, expect, it } from "vitest";
import { runCommand } from "./index";
import { parseDoc, serializeDoc } from "../document/serialize";
import { emptyDoc } from "../document/types";
import type { Doc } from "../document/types";

/** A frame with a navy rectangle and a text in two fonts' worth of styles. */
function design(): Doc {
  let d = runCommand(emptyDoc(), "create_element", { id: "f", type: "frame", x: 0, y: 0, width: 400, height: 300 });
  d = runCommand(d, "create_element", { id: "r", type: "rect", x: 10, y: 10, width: 50, height: 50, parentId: "f" });
  d = runCommand(d, "set_props", { ids: ["r"], props: { fill: "#0B1F3A", stroke: "#ff6600" } });
  d = runCommand(d, "create_element", { id: "t", type: "text", x: 10, y: 80, width: 100, height: 20, parentId: "f" });
  return runCommand(d, "set_props", { ids: ["t"], props: { fill: "#0b1f3a", fontFamily: "Inter" } });
}

describe("brand kit", () => {
  it("is made from the colours and fonts the design uses, most used first", () => {
    const d = runCommand(design(), "make_brand_kit", {});
    expect(d.brand?.colours[0].hex).toBe("#0b1f3a");
    expect(d.brand?.colours.map((c) => c.hex)).toContain("#ff6600");
    expect(d.brand?.fonts).toEqual(["Inter"]);
  });

  it("keeps the few colours that are the brand, not every grey and white on the page", () => {
    let d = design();
    d = runCommand(d, "create_element", { id: "g", type: "rect", x: 0, y: 0, width: 5, height: 5, parentId: "f" });
    d = runCommand(d, "set_props", { ids: ["g"], props: { fill: "#d9d9de", stroke: "#ffffff" } });
    const kit = runCommand(d, "make_brand_kit", {});
    expect(kit.brand?.colours.map((c) => c.hex).sort()).toEqual(["#0b1f3a", "#ff6600"]);
    let many = design();
    for (let i = 0; i < 8; i++) {
      many = runCommand(many, "create_element", { id: `m${i}`, type: "rect", x: 0, y: 0, width: 5, height: 5, parentId: "f" });
      many = runCommand(many, "set_props", { ids: [`m${i}`], props: { fill: `#${(i * 30 + 20).toString(16).padStart(2, "0")}3a${(i * 20 + 40).toString(16).padStart(2, "0")}` } });
    }
    expect(runCommand(many, "make_brand_kit", {}).brand?.colours.length).toBe(5);
  });

  it("a design with only greys still gets a kit", () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "f", type: "frame", x: 0, y: 0, width: 100, height: 100 });
    d = runCommand(d, "set_props", { ids: ["f"], props: { fill: "#ffffff" } });
    expect(runCommand(d, "make_brand_kit", {}).brand?.colours.map((c) => c.hex)).toEqual(["#ffffff"]);
  });

  it("making it again adds only new colours", () => {
    const once = runCommand(design(), "make_brand_kit", {});
    const twice = runCommand(once, "make_brand_kit", {});
    expect(twice.brand?.colours.length).toBe(once.brand?.colours.length);
  });

  it("changing a kit colour changes the design that uses it, and nothing else", () => {
    const d = runCommand(design(), "make_brand_kit", {});
    const navy = d.brand!.colours.find((c) => c.hex === "#0b1f3a")!;
    const next = runCommand(d, "change_brand_colour", { id: navy.id, hex: "#112244" });
    expect(next.elements.r.fill).toBe("#112244");
    expect(next.elements.t.fill).toBe("#112244");
    expect(next.elements.r.stroke).toBe("#ff6600");
    expect(next.elements.f.fill).toBe(d.elements.f.fill);
    expect(d.elements.r.fill).toBe("#0B1F3A");
  });

  it("keeps logo, voice and lock, and comes back from the file", () => {
    let d = runCommand(design(), "add_brand_colour", { id: "c1", name: "Navy", hex: "#0b1f3a" });
    d = runCommand(d, "set_brand", { logoId: "r", voice: "Warm and plain.", locked: true, fonts: ["Inter"] });
    const back = parseDoc(serializeDoc(d));
    expect(back.brand).toEqual({ colours: [{ id: "c1", name: "Navy", hex: "#0b1f3a" }], fonts: ["Inter"], logoId: "r", voice: "Warm and plain.", locked: true });
    const open = runCommand(back, "set_brand", { locked: false });
    expect(open.brand?.locked).toBeUndefined();
  });

  it("a colour can be removed and a bad colour is not added", () => {
    let d = runCommand(design(), "add_brand_colour", { id: "c1", name: "Navy", hex: "#0b1f3a" });
    expect(runCommand(d, "add_brand_colour", { name: "Bad", hex: "blue" })).toBe(d);
    d = runCommand(d, "remove_brand_colour", { id: "c1" });
    expect(d.brand?.colours).toEqual([]);
  });
});

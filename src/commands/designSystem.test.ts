import { describe, expect, it } from "vitest";
import { runCommand } from "./index";
import { parseDoc, serializeDoc } from "../document/serialize";
import { emptyDoc } from "../document/types";
import type { Doc } from "../document/types";
import { brandRules } from "../ai/brandLock";
import { kitFromDoc, readKit } from "./designSystem";

/** A card frame laid out with gaps of 16 and padding of 24, a rounded button inside, and three kinds of text. */
function design(): Doc {
  let d = runCommand(emptyDoc(), "create_element", { id: "f", type: "frame", x: 0, y: 0, width: 400, height: 300 });
  d = runCommand(d, "set_props", { ids: ["f"], props: { layout: { dir: "column", gap: 16, padX: 24, padY: 24, align: "start", justify: "start", hug: false }, radius: 12 } });
  d = runCommand(d, "create_element", { id: "b", type: "rect", x: 0, y: 0, width: 120, height: 40, parentId: "f" });
  d = runCommand(d, "set_props", { ids: ["b"], props: { fill: "#ff6600", radius: 8 } });
  const text = (id: string, size: number, weight: number) => {
    d = runCommand(d, "create_element", { id, type: "text", x: 0, y: 0, width: 100, height: 20, parentId: "f" });
    d = runCommand(d, "set_props", { ids: [id], props: { fontFamily: "Inter", fontSize: size, fontWeight: weight, text: "Hello" } });
  };
  text("h", 32, 700);
  text("p1", 16, 400);
  text("p2", 16, 400);
  text("s", 12, 400);
  return runCommand(d, "create_component", { id: "b" });
}

describe("design system", () => {
  it("is read from the design: spacing, corners, pieces and text styles", () => {
    const d = runCommand(design(), "make_design_system", {});
    expect(d.brand?.spacing).toEqual([16, 24]);
    expect(d.brand?.corners).toEqual([8, 12]);
    expect(d.brand?.pieces).toEqual(["b"]);
    const styles = Object.values(d.styles ?? {});
    expect(styles.map((s) => [s.name, s.fontSize])).toEqual([
      ["Heading", 32],
      ["Body", 16],
      ["Small", 12],
    ]);
    expect(d.brand?.colours.map((c) => c.hex)).toContain("#ff6600");
  });

  it("making it does not change the design itself", () => {
    const before = design();
    const d = runCommand(before, "make_design_system", {});
    expect(d.elements).toEqual(before.elements);
  });

  it("a design with no auto layout gets standard spacing steps", () => {
    let d = runCommand(emptyDoc(), "create_element", { id: "r", type: "rect", x: 0, y: 0, width: 10, height: 10 });
    d = runCommand(d, "make_design_system", {});
    expect(d.brand?.spacing).toEqual([4, 8, 16, 24, 32, 48]);
  });

  it("changing a text style by name changes every text that uses it", () => {
    let d = runCommand(design(), "make_design_system", {});
    const body = Object.keys(d.styles!).find((k) => d.styles![k].name === "Body")!;
    d = runCommand(d, "apply_text_style", { ids: ["p1", "p2"], styleId: body });
    const next = runCommand(d, "set_design_system", { textStyles: [{ name: "body", fontSize: 18 }] });
    expect(next.elements.p1.fontSize).toBe(18);
    expect(next.elements.p2.fontSize).toBe(18);
    expect(next.elements.s.fontSize).toBe(12);
    expect(next.styles![body].fontWeight).toBe(400);
    expect(d.elements.p1.fontSize).toBe(16);
  });

  it("a new text style name is added, and a removed one lets its text keep its look", () => {
    let d = runCommand(design(), "set_design_system", { textStyles: [{ name: "Label", fontSize: 11, fontWeight: 600 }] });
    const label = Object.keys(d.styles!).find((k) => d.styles![k].name === "Label")!;
    d = runCommand(d, "apply_text_style", { ids: ["s"], styleId: label });
    expect(d.elements.s.fontSize).toBe(11);
    d = runCommand(d, "set_design_system", { removeTextStyles: ["Label"] });
    expect(d.styles?.[label]).toBeUndefined();
    expect(d.elements.s.textStyleId).toBe("");
    expect(d.elements.s.fontSize).toBe(11);
  });

  it("colours by name: a known name changes and the design follows, a new name is added", () => {
    let d = runCommand(design(), "set_design_system", { colours: [{ name: "Orange", hex: "#ff6600" }] });
    d = runCommand(d, "set_design_system", { colours: [{ name: "orange", hex: "#ee5500" }, { name: "Ink", hex: "#111111" }] });
    expect(d.brand?.colours.map((c) => [c.name, c.hex])).toEqual([
      ["Orange", "#ee5500"],
      ["Ink", "#111111"],
    ]);
    expect(d.elements.b.fill).toBe("#ee5500");
    d = runCommand(d, "set_design_system", { removeColours: ["Ink"] });
    expect(d.brand?.colours.length).toBe(1);
  });

  it("spacing and corners are tidied; pieces become components", () => {
    let d = runCommand(design(), "create_element", { id: "card", type: "frame", x: 500, y: 0, width: 200, height: 100 });
    d = runCommand(d, "set_design_system", { spacing: [8, 4, 8, -2, 16.4], corners: [0, 6], pieces: ["b", "card", "nope"] });
    expect(d.brand?.spacing).toEqual([4, 8, 16]);
    expect(d.brand?.corners).toEqual([6]);
    expect(d.brand?.pieces).toEqual(["b", "card"]);
    expect(d.elements.card.component).toBe(true);
  });

  it("the AI reads it as rules, without pieces that were deleted", () => {
    let d = runCommand(design(), "make_design_system", {});
    let rules = brandRules(d);
    expect(rules).toContain("Spacing steps: 16, 24 px");
    expect(rules).toContain("Corner sizes: 8, 12 px");
    expect(rules).toContain("Heading");
    expect(rules).toContain('b "');
    d = runCommand(d, "delete_elements", { ids: ["b"] });
    rules = brandRules(d);
    expect(rules).not.toContain("Pieces:");
  });

  it("is kept in the file", () => {
    const d = runCommand(design(), "make_design_system", {});
    const back = parseDoc(serializeDoc(d));
    expect(back.brand?.spacing).toEqual(d.brand?.spacing);
    expect(back.brand?.corners).toEqual(d.brand?.corners);
    expect(back.brand?.pieces).toEqual(d.brand?.pieces);
  });

  it("is saved as a kit with its pieces, and the components the pieces are built from", () => {
    let d = runCommand(design(), "create_element", { id: "card", type: "frame", x: 500, y: 0, width: 200, height: 100 });
    d = runCommand(d, "create_instance", { componentId: "b", id: "cb", x: 10, y: 10, parentId: "card" });
    d = runCommand(d, "make_design_system", {});
    d = runCommand(d, "set_design_system", { pieces: ["card"] });
    const kit = readKit(JSON.stringify(kitFromDoc(d, "Clay")))!;
    expect(kit.name).toBe("Clay");
    expect(kit.pieces).toEqual(["card"]);
    expect(Object.keys(kit.elements).sort()).toEqual(["b", "card", "cb"]);
    expect(kit.elements.b.parentId).toBeNull();
    expect(kit.textStyles.length).toBe(3);
    expect(kit.spacing).toEqual([16, 24]);
  });

  it("a kit used in another project brings its system and places its pieces beside the design", () => {
    let src = runCommand(design(), "make_design_system", {});
    src = runCommand(src, "set_design_system", { colours: [{ name: "Orange", hex: "#ff6600" }] });
    const kit = kitFromDoc(src, "Clay");
    let d = runCommand(emptyDoc(), "create_element", { id: "home", type: "frame", x: 0, y: 0, width: 300, height: 600 });
    d = runCommand(d, "use_kit", { kit });
    expect(d.brand?.pieces).toEqual(["b"]);
    expect(d.elements.b.component).toBe(true);
    expect(d.elements.b.x).toBe(420);
    expect(d.rootIds).toEqual(["home", "b"]);
    expect(d.brand?.spacing).toEqual([16, 24]);
    expect(Object.values(d.styles ?? {}).map((s) => s.name)).toEqual(["Heading", "Body", "Small"]);
    expect(d.brand?.colours.find((c) => c.name === "Orange")?.hex).toBe("#ff6600");
    // using it again does not place the pieces twice
    const again = runCommand(d, "use_kit", { kit });
    expect(again.rootIds).toEqual(["home", "b"]);
    expect(Object.keys(again.styles ?? {}).length).toBe(3);
  });

  it("a file that is not a kit is not read as one", () => {
    expect(readKit("{}")).toBeNull();
    expect(readKit("not json")).toBeNull();
  });
});

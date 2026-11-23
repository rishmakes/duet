import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { countFiles, designFileName, plannedFiles, standardEnding } from "./designExport";

function screens() {
  let d = runCommand(emptyDoc(), "create_element", { id: "a", type: "frame", x: 0, y: 0, width: 100, height: 100 });
  d = runCommand(d, "create_element", { id: "b", type: "frame", x: 200, y: 0, width: 100, height: 100 });
  d = runCommand(d, "create_element", { id: "r", type: "rect", x: 400, y: 0, width: 50, height: 50 });
  const named = (id: string, name: string) => ({ ...d.elements[id], name });
  return { ...d, elements: { ...d.elements, a: named("a", "Home"), b: named("b", "Home"), r: named("r", "Logo") } };
}

describe("design export files", () => {
  it("makes one file per screen, with the ending after the name and no two names alike", () => {
    const files = plannedFiles(screens(), ["a", "b"], { kind: "png", scale: 2, ending: "@2x" }, "/out", "Site");
    expect(files.map((f) => f.path)).toEqual(["/out/Home@2x.png", "/out/Home 2@2x.png"]);
  });

  it("keeps every screen in one PDF, named after the project", () => {
    const files = plannedFiles(screens(), ["a", "b"], { kind: "pdf", scale: 1, ending: "" }, "/out", "Site");
    expect(files).toEqual([{ ids: ["a", "b"], path: "/out/Site.pdf" }]);
  });

  it("makes a Photoshop file only from a frame", () => {
    const doc = screens();
    expect(plannedFiles(doc, ["a", "r"], { kind: "psd", scale: 1, ending: "" }, "/out", "Site").map((f) => f.path)).toEqual(["/out/Home.psd"]);
    expect(countFiles(doc, ["r"], [{ kind: "psd", scale: 1, ending: "" }])).toBe(0);
  });

  it("counts files across kinds", () => {
    expect(countFiles(screens(), ["a", "b", "r"], [{ kind: "png", scale: 1, ending: "" }, { kind: "pdf", scale: 1, ending: "" }])).toBe(4);
  });

  it("never lets an ending reach into another folder", () => {
    expect(plannedFiles(screens(), ["a"], { kind: "svg", scale: 1, ending: "/../x" }, "/out", "Site")[0].path).toBe("/out/Home-..-x.svg");
  });

  it("names sizes only for pictures made of pixels", () => {
    expect(standardEnding({ kind: "jpg", scale: 3 })).toBe("@3x");
    expect(standardEnding({ kind: "svg", scale: 3 })).toBe("");
    expect(designFileName({ kind: "png", scale: 2 })).toBe("PNG 2x");
    expect(designFileName({ kind: "psd", scale: 2 })).toBe("Photoshop");
  });
});

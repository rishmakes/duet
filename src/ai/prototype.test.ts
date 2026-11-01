import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { prototypeMap } from "./prototype";

function app() {
  let d = runCommand(emptyDoc(), "create_element", { id: "home", type: "frame", x: 0, y: 0, width: 390, height: 844, props: { name: "Home" } });
  d = runCommand(d, "create_element", { id: "tests", type: "frame", x: 500, y: 0, width: 390, height: 844, props: { name: "Tests" } });
  d = runCommand(d, "create_element", { id: "menu", type: "frame", x: 1000, y: 0, width: 300, height: 400, props: { name: "Menu" } });
  d = runCommand(d, "create_element", { id: "lost", type: "frame", x: 1400, y: 0, width: 390, height: 844, props: { name: "Lost" } });
  d = runCommand(d, "create_element", { id: "btn", type: "rect", x: 20, y: 700, width: 350, height: 56, parentId: "home", props: { name: "Button", link: "tests", transition: "push-left" } });
  d = runCommand(d, "create_element", { id: "label", type: "text", x: 10, y: 10, width: 100, height: 20, parentId: "home", props: { text: "Book a test" } });
  d = runCommand(d, "reparent_elements", { ids: ["label"], parentId: "home" });
  d = runCommand(d, "create_element", { id: "icon", type: "rect", x: 10, y: 10, width: 24, height: 24, parentId: "home", props: { name: "Menu icon", link: "menu", linkKind: "overlay", trigger: "hover" } });
  return runCommand(d, "create_element", { id: "back", type: "text", x: 10, y: 10, width: 60, height: 20, parentId: "tests", props: { text: "Back", linkKind: "back" } });
}

describe("prototype map", () => {
  it("lists screens and what leads where, with when and how", () => {
    const m = prototypeMap(app());
    expect(m.start).toBe("home");
    expect(m.screens.map((s) => s.name)).toEqual(["Home", "Tests", "Menu", "Lost"]);
    expect(m.connections).toEqual([
      { from: "btn", name: "Button", on: "home", when: "click", does: "go", to: "tests", toName: "Tests", moves: "push-left", ms: 300 },
      { from: "icon", name: "Menu icon", on: "home", when: "hover", does: "open on top", to: "menu", toName: "Menu" },
      { from: "back", name: "Text 2", text: "Back", on: "tests", when: "click", does: "back" },
    ]);
    expect(m.notReached).toEqual(["Lost"]);
    expect(m.deadEnds).toEqual(["Menu", "Lost"]);
  });

  it("an empty board has no screens", () => {
    expect(prototypeMap(emptyDoc())).toEqual({ start: null, screens: [], connections: [], notReached: [], deadEnds: [] });
  });
});

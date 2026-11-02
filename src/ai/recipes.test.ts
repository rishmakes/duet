import { describe, expect, it } from "vitest";
import { addStep, changeStep, LANDING_PAGE, moveStep, readRecipe, removeStep, stepPrompt } from "./recipes";

describe("recipes", () => {
  const r = LANDING_PAGE;

  it("adds a step after the one picked, and at the end", () => {
    const { recipe, id } = addStep(r, "wireframe");
    expect(recipe.steps.findIndex((s) => s.id === id)).toBe(r.steps.findIndex((s) => s.id === "wireframe") + 1);
    expect(r.steps.length).toBe(LANDING_PAGE.steps.length);
    const end = addStep(r, r.steps[r.steps.length - 1].id);
    expect(end.recipe.steps[end.recipe.steps.length - 1].id).toBe(end.id);
  });

  it("changes, moves and removes steps without touching the one it was given", () => {
    const changed = changeStep(r, "brief", { title: "What it is for" });
    expect(changed.steps[0].title).toBe("What it is for");
    expect(r.steps[0].title).toBe("Brief");
    const moved = moveStep(r, "questions", -1);
    expect(moved.steps[0].id).toBe("questions");
    expect(moveStep(r, "brief", -1)).toBe(r);
    expect(removeStep(r, "icons").steps.some((s) => s.id === "icons")).toBe(false);
  });

  it("tells the AI only its step, with what the designer said", () => {
    const at = r.steps.findIndex((s) => s.id === "wireframe");
    const text = stepPrompt(r, at, [{ step: "brief", text: "A page for a bakery" }]);
    expect(text).toContain("Wireframe");
    expect(text).toContain("A page for a bakery");
    expect(text).not.toContain("Polish");
    expect(text).not.toContain("get_context");
  });

  it("after a comment step, the AI reads the comments", () => {
    const at = r.steps.findIndex((s) => s.id === "design");
    expect(stepPrompt(r, at, [])).toContain("get_context");
  });

  it("reads a shared recipe file, and refuses anything else", () => {
    const back = readRecipe(JSON.stringify(r));
    expect(back?.steps.map((s) => s.id)).toEqual(r.steps.map((s) => s.id));
    expect(readRecipe("not a recipe")).toBeNull();
    expect(readRecipe(JSON.stringify({ name: "x" }))).toBeNull();
  });
});

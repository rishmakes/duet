import { describe, expect, it } from "vitest";
import { link } from "../ui/Kitchen";
import {
  addStep,
  carryOn,
  changeStep,
  COOK_DESIGN_CHANGED_ERROR,
  COOK_NO_DESIGN_ERROR,
  cookToSave,
  getCooking,
  LANDING_PAGE,
  SCREEN,
  BUILT_IN,
  moveStep,
  moveStepTo,
  readCook,
  readRecipe,
  stepSkillIds,
  removeStep,
  sameDesign,
  startCooking,
  stopCooking,
  stepPrompt,
} from "./recipes";

describe("recipes", () => {
  const r = LANDING_PAGE;

  it("adds a step after the one picked, and at the end", () => {
    const { recipe, id } = addStep(r, "wireframe");
    expect(recipe.steps.findIndex((s) => s.id === id)).toBe(r.steps.findIndex((s) => s.id === "wireframe") + 1);
    expect(r.steps.length).toBe(LANDING_PAGE.steps.length);
    const end = addStep(r, r.steps[r.steps.length - 1].id);
    expect(end.recipe.steps[end.recipe.steps.length - 1].id).toBe(end.id);
  });

  it("adds a blank step between steps and preserves sequence", () => {
    const { recipe, id } = addStep(r, "questions");
    const idx = recipe.steps.findIndex((s) => s.id === id);
    expect(idx).toBe(r.steps.findIndex((s) => s.id === "questions") + 1);
    expect(recipe.steps[idx].does).toBe("");
    expect(recipe.steps.length).toBe(r.steps.length + 1);
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

  it("moves a dragged step to where it was let go", () => {
    const last = r.steps.length - 1;
    const down = moveStepTo(r, "brief", 2);
    expect(down.steps[2].id).toBe("brief");
    expect(down.steps.length).toBe(r.steps.length);
    expect(moveStepTo(r, "brief", 99).steps[last].id).toBe("brief");
    expect(moveStepTo(r, r.steps[last].id, 0).steps[0].id).toBe(r.steps[last].id);
    expect(moveStepTo(r, "brief", 0)).toBe(r);
    expect(r.steps[0].id).toBe("brief");
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

  it("keeps what a step uses when the recipe is read back, and drops what it cannot read", () => {
    const uses = [{ kind: "skill", id: "spacing" }, { kind: "rocket", id: "x" }, "junk"];
    const withUses = { ...r, steps: r.steps.map((s, i) => (i === 0 ? { ...s, uses } : s)) };
    const back = readRecipe(JSON.stringify(withUses));
    expect(back?.steps[0].uses).toEqual([{ kind: "skill", id: "spacing" }]);
    expect(stepSkillIds(back!.steps[0])).toEqual(["spacing"]);
    expect(stepSkillIds(back!.steps[1])).toEqual([]);
  });

  describe("a cook stays on its design", () => {
    it("stays the same design when it gets its first file", () => {
      expect(sameDesign({ opening: 1, key: null }, { opening: 1, key: "/a.duet" })).toBe(true);
    });
    it("is the same design when that file or tab is opened again", () => {
      expect(sameDesign({ opening: 1, key: "/a.duet" }, { opening: 5, key: "/a.duet" })).toBe(true);
    });
    it("is another design when another one opens, even with no file on either", () => {
      expect(sameDesign({ opening: 1, key: "/a.duet" }, { opening: 2, key: "/b.duet" })).toBe(false);
      expect(sameDesign({ opening: 1, key: null }, { opening: 2, key: null })).toBe(false);
    });
  });

  describe("a cook keeps its place", () => {
    const cook = {
      recipe: LANDING_PAGE,
      at: 2,
      status: "working" as const,
      said: [{ step: "brief", text: "A page for a bakery" }],
      replies: { questions: "What style do you want?" },
      done: ["brief", "questions"],
      project: { opening: 3, key: "/projects/bakery.duet" },
    };

    it("saves recipe copy, step, answers, replies, done steps and design key", () => {
      const saved = cookToSave(cook);
      expect(saved.recipe.id).toBe(LANDING_PAGE.id);
      expect(saved.recipe.name).toBe(LANDING_PAGE.name);
      expect(saved.step).toBe(2);
      expect(saved.answers).toEqual([{ step: "brief", text: "A page for a bakery" }]);
      expect(saved.replies).toEqual({ questions: "What style do you want?" });
      expect(saved.done).toEqual(["brief", "questions"]);
      expect(saved.key).toBe("/projects/bakery.duet");
      expect(saved.working).toBe(true);
    });

    it("reads a good saved cooking file as paused and waiting", () => {
      const saved = cookToSave(cook);
      const restored = readCook(JSON.stringify(saved));
      expect(restored).not.toBeNull();
      expect(restored?.recipe.id).toBe(LANDING_PAGE.id);
      expect(restored?.at).toBe(2);
      expect(restored?.status).toBe("waiting");
      expect(restored?.paused).toBe(true);
      expect(restored?.working).toBe(true);
      expect(restored?.said).toEqual([{ step: "brief", text: "A page for a bakery" }]);
      expect(restored?.replies).toEqual({ questions: "What style do you want?" });
      expect(restored?.done).toEqual(["brief", "questions"]);
      expect(restored?.project.key).toBe("/projects/bakery.duet");
      expect(restored?.project.opening).toBe(-1);
    });

    it("reading an empty file gives null", () => {
      expect(readCook("")).toBeNull();
      expect(readCook("   ")).toBeNull();
    });

    it("reading a broken file does not crash and gives null", () => {
      expect(readCook("not json")).toBeNull();
      expect(readCook("{ broken")).toBeNull();
      expect(readCook("123")).toBeNull();
      expect(readCook("null")).toBeNull();
      expect(readCook("{}")).toBeNull();
      expect(readCook(JSON.stringify({ step: 1 }))).toBeNull();
      expect(readCook(JSON.stringify({ recipe: { name: "x" } }))).toBeNull();
      expect(readCook(JSON.stringify({ recipe: LANDING_PAGE, step: 999 }))).toBeNull();
    });

    it("refuses carry on when the cook has no file or tab key", () => {
      const cookNoKey = {
        recipe: LANDING_PAGE,
        at: 1,
        status: "waiting" as const,
        said: [],
        replies: {},
        done: ["brief"],
        project: { opening: -1, key: null },
      };
      const restored = readCook(JSON.stringify(cookToSave(cookNoKey)));
      expect(restored).not.toBeNull();
      expect(restored?.project.key).toBeNull();

      startCooking(LANDING_PAGE);
      const c = getCooking()!;
      Object.assign(c, { ...restored, project: { opening: -1, key: null } });
      carryOn();
      expect(getCooking()?.error).toBe(COOK_NO_DESIGN_ERROR);
      stopCooking();
    });

    it("refuses carry on when the design is not open", () => {
      const cookWithKey = {
        recipe: LANDING_PAGE,
        at: 1,
        status: "waiting" as const,
        said: [],
        replies: {},
        done: ["brief"],
        project: { opening: -1, key: "/unopened/path.duet" },
      };
      const restored = readCook(JSON.stringify(cookToSave(cookWithKey)));
      startCooking(LANDING_PAGE);
      const c = getCooking()!;
      Object.assign(c, restored);
      carryOn();
      expect(getCooking()?.error).toBe(COOK_DESIGN_CHANGED_ERROR);
      stopCooking();
    });
  });

  describe("link draws clean lines between steps", () => {
    it("connects left-to-right along a row without looping", () => {
      const path = link({ x: 60, y: 80 }, { x: 320, y: 80 });
      // a right edge (60 + 224 = 284) to b left edge (320), y = 80 + 40 = 120
      expect(path).toMatch(/^M284,120 C(\d+),120 (\d+),120 320,120$/);
      const match = /^M284,120 C(\d+),120 (\d+),120 320,120$/.exec(path);
      expect(match).not.toBeNull();
      const cp1X = Number(match![1]);
      const cp2X = Number(match![2]);
      // control points stay between x1 and x2 in forward order
      expect(cp1X).toBeGreaterThanOrEqual(284);
      expect(cp2X).toBeGreaterThanOrEqual(cp1X);
      expect(cp2X).toBeLessThanOrEqual(320);
    });

    it("connects right-to-left along a snaking row without looping backwards", () => {
      const path = link({ x: 580, y: 230 }, { x: 320, y: 230 });
      // a left edge (580) to b right edge (320 + 224 = 544), y = 230 + 40 = 270
      const match = /^M580,270 C(\d+),270 (\d+),270 544,270$/.exec(path);
      expect(match).not.toBeNull();
      const cp1X = Number(match![1]);
      const cp2X = Number(match![2]);
      // x values decrease monotonically: 580 >= cp1X >= cp2X >= 544 (never loops back)
      expect(cp1X).toBeLessThanOrEqual(580);
      expect(cp2X).toBeLessThanOrEqual(cp1X);
      expect(cp2X).toBeGreaterThanOrEqual(544);
    });

    it("exits bottom and enters top when connecting to a step on a lower row", () => {
      const vertical = link({ x: 580, y: 80 }, { x: 580, y: 230 });
      // exits bottom center of a (692, 160), enters top center of b (692, 230)
      expect(vertical).toContain("M692,160");
      expect(vertical).toContain("692,230");

      const snakeRow = link({ x: 580, y: 80 }, { x: 60, y: 230 });
      // when snaking to a new row to the left, exits bottom of a (692, 160) and enters top of b (172, 230)
      expect(snakeRow).toContain("M692,160");
      expect(snakeRow).toContain("172,230");
    });
  });
});

describe("the built-in recipes", () => {
  it("has a short screen recipe whose steps are all in order and none are empty", () => {
    expect(BUILT_IN.map((r) => r.id)).toEqual(["landing-page", "screen-from-a-brief"]);
    expect(SCREEN.steps.map((x) => x.kind)).toEqual(["ask", "ai", "ai", "review", "ai"]);
    expect(SCREEN.steps.every((x) => x.does.length > 20)).toBe(true);
    expect(new Set(SCREEN.steps.map((x) => x.id)).size).toBe(SCREEN.steps.length);
  });
});

describe("a recipe an AI writes (save_recipe)", () => {
  it("keeps the steps in order with their kinds, and lays them out", async () => {
    const { recipeFrom } = await import("./recipes");
    const r = recipeFrom(" Carousel ", "Five slides", [
      { title: "Brief", kind: "ask", does: "What is it selling?" },
      { kind: "ai", does: "Make five slides." },
      { title: "Look", kind: "review", does: "Check the slides." },
    ]);
    if ("error" in r) throw new Error(r.error);
    expect(r.name).toBe("Carousel");
    expect(r.steps.map((s) => s.kind)).toEqual(["ask", "ai", "review"]);
    expect(r.steps[1].title).toBe("Step 2");
    expect(new Set(r.steps.map((s) => `${s.x},${s.y}`)).size).toBe(3);
  });
  it("keeps the id it is given, so saving again updates the same recipe", async () => {
    const { recipeFrom } = await import("./recipes");
    const r = recipeFrom("A", "", [{ kind: "ai", does: "x" }], "keep-me");
    expect("error" in r ? null : r.id).toBe("keep-me");
  });
  it("refuses a recipe with no name or no real steps", async () => {
    const { recipeFrom } = await import("./recipes");
    expect("error" in recipeFrom(" ", "", [{ kind: "ai", does: "x" }])).toBe(true);
    expect("error" in recipeFrom("A", "", [{ kind: "ai", does: "  " }])).toBe(true);
  });
});

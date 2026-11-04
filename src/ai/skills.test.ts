import { beforeEach, describe, expect, it, vi } from "vitest";

// the skills folder on the computer, kept in memory for the test
const files = new Map<string, string>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { id?: string; body?: string } = {}) => {
    if (cmd === "write_user_skill") files.set(args.id!, args.body!);
    else if (cmd === "list_user_skills") return [...files].map(([id, body]) => ({ id, body }));
    else throw new Error(`${cmd} is not there in a test`);
  },
}));

import { answerApproval, getChat } from "./chat";
import { getSkills, loadSkills } from "./skills";
import { callTool } from "./tools";
import { skillsText, useStepSkills } from "./rules";

const waiting = async () => {
  await Promise.resolve();
  return getChat().messages.slice(-1)[0];
};

describe("the AI saving what the designer taught it as a skill", () => {
  beforeEach(async () => {
    files.clear();
    await loadSkills();
  });

  it("asks the designer first, then saves it switched on, so later conversations follow it", async () => {
    const saving = callTool("save_skill", { name: "Flat botanical silhouettes", summary: "Jungle scenes in flat colour.", rules: "- No outlines.\n- Far trees are smaller and darker." });
    const question = await waiting();
    expect(question.approval).toMatchObject({ summary: 'Save the skill "Flat botanical silhouettes"', status: "waiting" });
    answerApproval(question.id, true);
    const res = await saving;
    expect(res.isError).toBeFalsy();
    expect(files.get("flat-botanical-silhouettes")).toBe("# Flat botanical silhouettes\nJungle scenes in flat colour.\n\n- No outlines.\n- Far trees are smaller and darker.\n");
    const skill = getSkills().find((s) => s.id === "mine-flat-botanical-silhouettes");
    expect(skill?.enabled).toBe(true);
    expect(skillsText()).toContain("Far trees are smaller and darker.");
  });

  it("brings a skill of the designer's up to date under the same name", async () => {
    files.set("flat-botanical-silhouettes", "# Flat botanical silhouettes\n- No outlines.\n");
    await loadSkills();
    const saving = callTool("save_skill", { name: "Flat botanical silhouettes", rules: "- No outlines.\n- Hide every tree bottom." });
    const question = await waiting();
    expect(question.approval?.summary).toBe('Update the skill "Flat botanical silhouettes"');
    answerApproval(question.id, true);
    expect((await saving).text).toContain("Updated");
    expect(files.get("flat-botanical-silhouettes")).toContain("Hide every tree bottom.");
  });

  it("saves nothing when the designer says not now", async () => {
    const saving = callTool("save_skill", { name: "Loud", rules: "- Everything red." });
    answerApproval((await waiting()).id, false);
    expect((await saving).isError).toBe(true);
    expect(files.size).toBe(0);
  });
});

describe("a recipe step that picks its own skills", () => {
  beforeEach(async () => {
    files.clear();
    files.set("calm", "# Calm\n- Soft colours only.\n");
    files.set("loud", "# Loud\n- Everything red.\n");
    await loadSkills();
  });

  it("sends only the skills the step picked, and all the turned-on ones again after", () => {
    useStepSkills(["mine-calm"]);
    expect(skillsText()).toContain("Soft colours only.");
    expect(skillsText()).not.toContain("Everything red.");
    useStepSkills(null);
    expect(skillsText()).toContain("Everything red.");
  });

  it("sends no skills for a step that picked none", () => {
    useStepSkills([]);
    expect(skillsText()).toContain("(no skills loaded)");
    useStepSkills(null);
  });
});

describe("making and changing a skill of your own in the Store", () => {
  beforeEach(async () => {
    files.clear();
    await loadSkills();
  });

  it("saves the name, what it does and the rules, and takes them apart again", async () => {
    const { createSkill, skillParts } = await import("./skills");
    expect(await createSkill("My brand", "- Pill buttons.", "Keeps my brand look.")).toBeNull();
    const body = files.get("my-brand")!;
    expect(body).toBe("# My brand\nKeeps my brand look.\n\n- Pill buttons.\n");
    expect(skillParts(body)).toEqual({ name: "My brand", line: "Keeps my brand look.", rules: "- Pill buttons." });
    expect(getSkills().find((s) => s.id === "mine-my-brand")?.summary).toBe("Keeps my brand look.");
    // a skill written without a line keeps its first rule as a rule
    expect(skillParts("# Old\n- One rule\n- Two")).toEqual({ name: "Old", line: "", rules: "- One rule\n- Two" });
  });

  it("refuses a name Duet already ships", async () => {
    const { createSkill } = await import("./skills");
    expect(await createSkill("Spacing", "- x")).toMatch(/Duet already has/);
  });

  it("changes a skill in place, keeping its id when renamed", async () => {
    const { createSkill, updateSkill } = await import("./skills");
    await createSkill("My brand", "- Pill buttons.");
    expect(await updateSkill("mine-my-brand", "Brand two", "Newer look.", "- Square buttons.")).toBeNull();
    expect(files.get("my-brand")).toBe("# Brand two\nNewer look.\n\n- Square buttons.\n");
    expect(getSkills().find((s) => s.id === "mine-my-brand")?.name).toBe("Brand two");
    expect(await updateSkill("spacing", "Spacing", "", "- x")).toMatch(/Only your own/);
    expect(await updateSkill("mine-my-brand", "Spacing", "", "- x")).toMatch(/already a skill/);
  });
});

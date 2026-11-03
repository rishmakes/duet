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

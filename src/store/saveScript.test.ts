import { beforeEach, describe, expect, it, vi } from "vitest";

// the scripts folder on the computer, kept in memory for the test
const folders = new Map<string, { meta: string; code: string }>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { id?: string; meta?: string; code?: string } = {}) => {
    if (cmd === "write_user_script") folders.set(args.id!, { meta: args.meta!, code: args.code! });
    else if (cmd === "list_user_scripts") return [...folders].map(([id, f]) => ({ id, ...f }));
    else if (cmd === "bring_back") return;
    else throw new Error(`${cmd} is not there in a test`);
  },
}));

import { answerApproval, getChat } from "../ai/chat";
import { callTool } from "../ai/tools";
import { getScripts, loadScripts } from "./scripts";

/** The designer's question, once the tool has asked it. */
const question = async () => {
  for (let i = 0; i < 50; i++) {
    const m = getChat().messages.slice(-1)[0];
    if (m?.approval?.status === "waiting") return m;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("nobody was asked");
};

const code = 'for (const id of duet.items) await duet.call("set_props", { ids: [id], props: { radius: 12 } });';

describe("the AI saving a script for the designer", () => {
  beforeEach(async () => {
    folders.clear();
    await loadScripts();
  });

  it("asks first, then keeps it in the Store under the designer's things", async () => {
    const saving = callTool("save_script", { name: "Round every corner", line: "Rounds what you picked.", runsOn: "selection", code });
    const q = await question();
    expect(q.approval?.summary).toBe('Save the script "Round every corner"');
    answerApproval(q.id, true);
    const res = await saving;
    expect(res.isError).toBeFalsy();
    expect(folders.get("round-every-corner")?.code).toBe(code);
    expect(getScripts()[0]).toMatchObject({ id: "script-round-every-corner", name: "Round every corner", runsOn: "selection" });
  });

  it("brings a script of the same name up to date, in the same folder", async () => {
    folders.set("round-every-corner", { meta: JSON.stringify({ name: "Round every corner", line: "", runsOn: "selection" }), code: "duet.log(1);" });
    await loadScripts();
    const saving = callTool("save_script", { name: "round every corner", runsOn: "each-frame", code });
    const q = await question();
    expect(q.approval?.summary).toBe('Update the script "round every corner"');
    answerApproval(q.id, true);
    expect((await saving).text).toContain("Updated");
    expect(folders.size).toBe(1);
    expect(folders.get("round-every-corner")?.code).toBe(code);
  });

  it("saves nothing when the designer says not now", async () => {
    const saving = callTool("save_script", { name: "Loud", runsOn: "file", code });
    answerApproval((await question()).id, false);
    expect((await saving).isError).toBe(true);
    expect(folders.size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { NAMES, giveNames, nameOf, nextName, readGiven } from "./names";

describe("AI names", () => {
  it("has fifteen names", () => {
    expect(NAMES).toHaveLength(15);
    expect(new Set(NAMES).size).toBe(15);
  });

  it("gives each tool the next free name, once", () => {
    const a = giveNames(["Claude Code", "Antigravity"], {});
    expect(a).toEqual({ "Claude Code": "Juniper", Antigravity: "Moss" });
    expect(giveNames(["Claude Code"], a)).toBe(a);
  });

  it("gives the same tool working from its own window a name of its own", () => {
    const a = giveNames(["Claude Code", "Claude Code (outside)"], {});
    expect(nameOf("Claude Code", a)).toBe("Juniper");
    expect(nameOf("Claude Code (outside)", a)).toBe("Moss");
  });

  it("shows the tool's own name for one from its own window that has none yet", () => {
    expect(nameOf("Cursor (outside)", {})).toBe("Cursor");
  });

  it("skips a name the designer gave by hand", () => {
    expect(nextName({ "Claude Code": "juniper" })).toBe("Moss");
  });

  it("starts the list again with a number after fifteen", () => {
    const all = Object.fromEntries(NAMES.map((n, i) => [`Tool ${i}`, n]));
    expect(nextName(all)).toBe("Juniper 2");
  });

  it("shows the tool's own name when it has none", () => {
    expect(nameOf("Codex", {})).toBe("Codex");
  });

  it("keeps only plain names from a file", () => {
    expect(readGiven({ "Claude Code": " Juniper ", x: 3, y: "" })).toEqual({ "Claude Code": "Juniper" });
    expect(readGiven(null)).toEqual({});
  });
});

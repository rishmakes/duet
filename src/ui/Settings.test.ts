import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "./shortcuts";
import { matchGeneralRow, matchShortcuts } from "./Settings";

describe("Settings search", () => {
  it("returns all shortcuts when search query is empty", () => {
    expect(matchShortcuts(SHORTCUTS, "", true)).toEqual(SHORTCUTS);
    expect(matchShortcuts(SHORTCUTS, "   ", true)).toEqual(SHORTCUTS);
  });

  it("filters shortcuts by what they do, case-insensitive", () => {
    const hits = matchShortcuts(SHORTCUTS, "undo", true);
    expect(hits).toHaveLength(1);
    expect(hits[0].group).toBe("Change things");
    expect(hits[0].keys).toEqual([["Cmd Z", "Undo"]]);
  });

  it("filters shortcuts by keys across platforms", () => {
    const macHits = matchShortcuts(SHORTCUTS, "cmd z", true);
    expect(macHits.some((g) => g.group === "Change things")).toBe(true);

    const winHits = matchShortcuts(SHORTCUTS, "ctrl z", false);
    expect(winHits.some((g) => g.group === "Change things")).toBe(true);
  });

  it("hides groups with no matching shortcuts", () => {
    const hits = matchShortcuts(SHORTCUTS, "cut-no-match-xyz", true);
    expect(hits).toHaveLength(0);
  });

  it("matches multiple groups when query matches across them", () => {
    const hits = matchShortcuts(SHORTCUTS, "zoom", true);
    const groups = hits.map((g) => g.group);
    expect(groups).toContain("Tools");
    expect(groups).toContain("See");
    expect(groups).toContain("Video");
    expect(groups).not.toContain("Change things");
  });

  it("matches General rows by tool name or version or update", () => {
    const meta = { agentName: "Claude", version: "0.11.0" };

    expect(matchGeneralRow("ai", "claude", meta)).toBe(true);
    expect(matchGeneralRow("ai", "ai", meta)).toBe(true);
    expect(matchGeneralRow("version", "claude", meta)).toBe(false);

    expect(matchGeneralRow("version", "0.11", meta)).toBe(true);
    expect(matchGeneralRow("version", "update", meta)).toBe(true);
    expect(matchGeneralRow("ai", "update", meta)).toBe(false);
  });

  it("matches both General rows when searching general", () => {
    const meta = { agentName: "Claude", version: "0.11.0" };
    expect(matchGeneralRow("ai", "general", meta)).toBe(true);
    expect(matchGeneralRow("version", "general", meta)).toBe(true);
  });
});

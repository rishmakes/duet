import { describe, expect, it } from "vitest";
import type { Skill } from "../ai/skills";
import { buildThings, countByKind, findThings } from "./things";

const skill = (id: string, name: string, source: "shipped" | "mine", enabled = true): Skill => ({
  id,
  name,
  summary: `${name} rules`,
  body: `# ${name}`,
  source,
  enabled,
});

const list = buildThings([skill("spacing", "Spacing", "shipped"), skill("mine-brand", "My brand", "mine", false)]);

describe("the Store's list", () => {
  it("turns skills into things and adds the ChatGPT connection as a plugin", () => {
    expect(list.map((t) => t.id)).toEqual(["spacing", "mine-brand", "plugin-connect"]);
    const mine = list[1];
    expect(mine).toMatchObject({ kind: "skill", by: "You", on: false, removable: true, editable: true });
    expect(list[0]).toMatchObject({ by: "Duet", removable: false, editable: false });
    expect(list[2].touches.length).toBeGreaterThan(0);
  });

  it("finds by words, kind and installed", () => {
    expect(findThings(list, { query: "brand" }).map((t) => t.id)).toEqual(["mine-brand"]);
    expect(findThings(list, { query: "chatgpt" }).map((t) => t.id)).toEqual(["plugin-connect"]);
    expect(findThings(list, { kind: "skill" })).toHaveLength(2);
    expect(findThings(list, { kind: "script" })).toHaveLength(0);
    expect(findThings(list, { kind: "all", installedOnly: true })).toHaveLength(3);
    expect(findThings(list, { query: "  " })).toHaveLength(3);
  });

  it("counts each kind", () => {
    expect(countByKind(list)).toEqual({ skill: 2, script: 0, plugin: 1 });
  });
});

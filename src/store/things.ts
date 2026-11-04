import { useMemo } from "react";
import { useSkills, type Skill } from "../ai/skills";

/**
 * The Store's one list. Skills, scripts and plugins are all "things": the Store page,
 * a recipe step's "uses" field and the AI read this same list.
 */
export type ThingKind = "skill" | "script" | "plugin";

export interface Thing {
  kind: ThingKind;
  /** Unique across kinds. A skill keeps its skill id, so recipe steps that saved it still find it. */
  id: string;
  name: string;
  /** One line on what it does. */
  line: string;
  /** Who made it: "Duet", "You", or a person's name. */
  by: string;
  /** What it can touch, in plain words, shown before it is turned on or installed. */
  touches: string[];
  installed: boolean;
  /** Turned on. A plugin that switches itself (like the ChatGPT connection) reports false here and shows its own switch. */
  on: boolean;
  /** Can the designer delete it? Things Duet ships cannot be deleted, only turned off. */
  removable: boolean;
  /** Can the designer change its text? */
  editable: boolean;
}

export const KIND_WORDS: Record<ThingKind, { one: string; many: string }> = {
  skill: { one: "Skill", many: "Skills" },
  script: { one: "Script", many: "Scripts" },
  plugin: { one: "Plugin", many: "Plugins" },
};

const SKILL_TOUCHES = ["What the AI is told while it designs"];

export function skillThing(s: Skill): Thing {
  return {
    kind: "skill",
    id: s.id,
    name: s.name,
    line: s.summary,
    by: s.source === "shipped" ? "Duet" : "You",
    touches: SKILL_TOUCHES,
    installed: true,
    on: s.enabled,
    removable: s.source === "mine",
    editable: s.source === "mine",
  };
}

/** The ChatGPT and Claude connection, the first plugin. It lives in the app; its switch is its own. */
export const CONNECT_PLUGIN: Thing = {
  kind: "plugin",
  id: "plugin-connect",
  name: "Connect to ChatGPT and Claude",
  line: "Talk to ChatGPT or Claude on the web, and watch them design here.",
  by: "Duet",
  touches: ["Your open design, while it is on", "A private link on the internet, while it is on"],
  installed: true,
  on: false,
  removable: false,
  editable: false,
};

export function buildThings(skills: Skill[]): Thing[] {
  return [...skills.map(skillThing), CONNECT_PLUGIN];
}

export interface Finding {
  query?: string;
  kind?: ThingKind | "all";
  installedOnly?: boolean;
}

/** Search by name, line or maker; filter by kind and installed. Order stays as given. */
export function findThings(list: Thing[], f: Finding): Thing[] {
  const q = (f.query ?? "").trim().toLowerCase();
  return list.filter(
    (t) =>
      (!f.kind || f.kind === "all" || t.kind === f.kind) &&
      (!f.installedOnly || t.installed) &&
      (!q || `${t.name} ${t.line} ${t.by}`.toLowerCase().includes(q)),
  );
}

export function countByKind(list: Thing[]): Record<ThingKind, number> {
  const n: Record<ThingKind, number> = { skill: 0, script: 0, plugin: 0 };
  for (const t of list) n[t.kind]++;
  return n;
}

/** Every thing, kept up to date as skills change. */
export function useThings(): Thing[] {
  const skills = useSkills();
  return useMemo(() => buildThings(skills), [skills]);
}

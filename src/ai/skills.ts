import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import contrast from "./skills/contrast.md?raw";
import mobile from "./skills/mobile-screens.md?raw";
import spacing from "./skills/spacing.md?raw";
import typeScale from "./skills/type-scale.md?raw";
import plainWords from "./skills/plain-words.md?raw";
import boldBlocks from "./skills/bold-blocks.md?raw";
import bento from "./skills/bento.md?raw";
import autoLayout from "./skills/auto-layout.md?raw";
import calmAndTrusted from "./skills/calm-and-trusted.md?raw";
import friendlyAndModern from "./skills/friendly-and-modern.md?raw";
import prototypes from "./skills/prototypes.md?raw";

export interface Skill {
  id: string;
  name: string;
  summary: string;
  body: string;
  source: "shipped" | "mine";
  enabled: boolean;
}

const SHIPPED: Record<string, string> = {
  "auto-layout": autoLayout,
  "mobile-screens": mobile,
  spacing,
  "type-scale": typeScale,
  contrast,
  "plain-words": plainWords,
  "bold-blocks": boldBlocks,
  bento,
  "calm-and-trusted": calmAndTrusted,
  "friendly-and-modern": friendlyAndModern,
  prototypes,
};

/** Skills that change the whole look of a design. They ship switched off, and a designer turns one on when they want it. */
const OFF_AT_FIRST = ["bold-blocks", "bento", "calm-and-trusted", "friendly-and-modern"];
const SEEDED = "duet:skills-seeded-2";

const KEY = "duet:skills-off";

/** Split off a "---" front matter block, as used by skill files elsewhere. */
export function splitFrontMatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body: m[2] };
}

/** Turn any skill file into Duet's shape: a heading, a one-line summary, then the rules. */
export function toDuetSkill(text: string, fallbackName: string): { name: string; body: string } {
  const { meta, body } = splitFrontMatter(text.replace(/\r\n/g, "\n"));
  const named = describeSkill(body, fallbackName);
  const name = (meta.name || named.name || fallbackName).trim();
  const summary = (meta.description || named.summary).split(/(?<=[.!?])\s/)[0].trim();
  const rest = /^\s*# /.test(body) ? body.replace(/^\s*# .*\n?/, "") : body;
  return { name, body: `# ${name}\n${summary}\n\n${rest.trim()}\n` };
}

/** First heading is the name, the first line after it is the summary. */
export function describeSkill(body: string, fallback: string): { name: string; summary: string } {
  const lines = body.split("\n").map((l) => l.trim());
  const h = lines.findIndex((l) => l.startsWith("# "));
  const name = h >= 0 ? lines[h].slice(2).trim() : fallback;
  const summary = lines.slice(h + 1).find((l) => l && !l.startsWith("#") && !l.startsWith("-")) ?? "";
  return { name: name || fallback, summary };
}

/**
 * Which skills are off, as kept in `store.json` in Duet's folder beside the skills, so the choice is
 * never lost with the app's own storage. Null until that file has been read.
 */
let fileOff: Set<string> | null = null;
/** Anything else kept in store.json, written back untouched. */
let storeRest: Record<string, unknown> = {};

async function readStoreState(): Promise<Set<string> | null> {
  try {
    const text = await invoke<string | null>("read_store_state");
    if (!text) return null;
    const { skillsOff, ...rest } = JSON.parse(text) as { skillsOff?: unknown };
    storeRest = rest;
    return Array.isArray(skillsOff) ? new Set(skillsOff.map(String)) : null;
  } catch {
    return null;
  }
}

function writeStoreState(off: Set<string>) {
  void invoke("write_store_state", { body: JSON.stringify({ ...storeRest, skillsOff: [...off].sort() }, null, 2) }).catch(() => undefined);
}

function offSet(): Set<string> {
  if (fileOff) return new Set(fileOff);
  try {
    const raw = localStorage.getItem(KEY);
    const off = new Set(JSON.parse(raw ?? "[]") as string[]);
    if (!localStorage.getItem(SEEDED)) {
      if (raw !== null || localStorage.getItem("duet:skills-seeded-1")) {
        off.add("calm-and-trusted");
        off.add("friendly-and-modern");
      } else {
        for (const id of OFF_AT_FIRST) off.add(id);
      }
      localStorage.setItem(SEEDED, "1");
      localStorage.setItem(KEY, JSON.stringify([...off]));
    }
    return off;
  } catch {
    return new Set();
  }
}

function saveOff(set: Set<string>) {
  fileOff = new Set(set);
  writeStoreState(set);
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

let skills: Skill[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function build(mine: { id: string; body: string }[]): Skill[] {
  const off = offSet();
  const shipped = Object.entries(SHIPPED).map(([id, body]) => ({
    id,
    body,
    ...describeSkill(body, id),
    source: "shipped" as const,
    enabled: !off.has(id),
  }));
  const own = mine.map(({ id, body }) => ({
    id: `mine-${id}`,
    body,
    ...describeSkill(body, id),
    source: "mine" as const,
    enabled: !off.has(`mine-${id}`),
  }));
  return [...shipped, ...own];
}

skills = build([]);

export async function loadSkills() {
  if (!fileOff) {
    const kept = await readStoreState();
    // the first time, what this computer remembered moves into the file
    if (kept) fileOff = kept;
    else saveOff(offSet());
  }
  let mine: { id: string; body: string }[] = [];
  try {
    mine = await invoke<{ id: string; body: string }[]>("list_user_skills");
  } catch {
    /* outside the desktop app there are no saved skills */
  }
  skills = build(mine);
  emit();
}

export const getSkills = () => skills;
export function useSkills(): Skill[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => skills,
  );
}

export function toggleSkill(id: string) {
  const off = offSet();
  if (off.has(id)) off.delete(id);
  else off.add(id);
  saveOff(off);
  skills = skills.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
  emit();
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

/** The id a skill of your own gets from its name. */
export const mySkillId = (name: string) => `mine-${slug(name)}`;

/** A skill file in Duet's shape: the name, one line on what it does, then the rules. */
export function skillBody(name: string, line: string, rules: string): string {
  const first = line.trim().split("\n")[0].trim();
  return `# ${name.trim()}\n${first ? `${first}\n\n` : ""}${rules.trim()}\n`;
}

/** Take a skill file apart again for editing: its name, what it does, and its rules. */
export function skillParts(body: string, fallback = ""): { name: string; line: string; rules: string } {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const h = lines.findIndex((l) => l.trim().startsWith("# "));
  const name = h >= 0 ? lines[h].trim().slice(2).trim() : fallback;
  let rest = h >= 0 ? lines.slice(h + 1) : lines;
  while (rest.length && !rest[0].trim()) rest = rest.slice(1);
  // the line right under the name says what it does, unless it is already a rule or a heading
  const top = rest[0]?.trim() ?? "";
  const hasLine = !!top && !top.startsWith("-") && !top.startsWith("#") && !top.startsWith("*") && !/^\d+\./.test(top);
  const line = hasLine ? top : "";
  const rules = (hasLine ? rest.slice(1) : rest).join("\n").trim();
  return { name: name || fallback, line, rules };
}

/** Save a skill of your own. Returns a message if it could not be saved. */
export async function createSkill(name: string, rules: string, line = ""): Promise<string | null> {
  const id = slug(name);
  if (!id) return "Give the skill a name.";
  if (!rules.trim()) return "Write at least one rule.";
  if (skills.some((s) => s.id === `mine-${id}`)) return "You already have a skill with that name.";
  if (skills.some((s) => s.source === "shipped" && slug(s.name) === id)) return `Duet already has a skill called "${name.trim()}". Choose another name.`;
  const body = skillBody(name, line, rules);
  try {
    await invoke("write_user_skill", { id, body });
  } catch (e) {
    return String(e);
  }
  await loadSkills();
  return null;
}

/**
 * Save the rules a designer taught the AI as a skill of their own, or bring one up to date.
 * Returns what happened, or a message if it could not be saved.
 */
export async function keepTaughtSkill(name: string, summary: string, rules: string): Promise<{ updated: boolean } | { error: string }> {
  const id = slug(name);
  if (!id) return { error: "Give the skill a name." };
  if (!rules.trim()) return { error: "Write at least one rule." };
  if (skills.some((s) => s.source === "shipped" && slug(s.name) === id)) return { error: `Duet already has a skill called "${name.trim()}". Choose another name.` };
  const updated = skills.some((s) => s.id === `mine-${id}`);
  const first = summary.trim().split("\n")[0];
  const body = `# ${name.trim()}\n${first ? `${first}\n\n` : ""}${rules.trim()}\n`;
  try {
    await invoke("write_user_skill", { id, body });
  } catch (e) {
    return { error: String(e) };
  }
  await loadSkills();
  return { updated };
}

/** Save a skill that was written elsewhere. Returns a message if it could not be saved. */
export async function importSkillText(text: string, fallbackName: string): Promise<string | null> {
  const { name, body } = toDuetSkill(text, fallbackName);
  const id = slug(name);
  if (!id) return "That skill has no usable name.";
  if (skills.some((s) => s.id === `mine-${id}`)) return `You already have a skill called "${name}".`;
  try {
    await invoke("write_user_skill", { id, body });
  } catch (e) {
    return String(e);
  }
  await loadSkills();
  return null;
}

const MAX_SKILL_CHARS = 30000;

/** Import a skill from a file, or from a folder that holds a SKILL.md and optional reference notes. */
export async function importSkillPath(path: string): Promise<string | null> {
  const base = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "skill";
  const stem = base.replace(/\.(md|markdown|txt)$/i, "");
  try {
    if (/\.(md|markdown|txt)$/i.test(base)) {
      return importSkillText(await invoke<string>("read_text_file", { path }), stem);
    }
    const entries = await invoke<{ name: string; is_dir: boolean }[]>("list_dir", { path });
    const main = entries.find((e) => !e.is_dir && e.name.toLowerCase() === "skill.md") ?? entries.find((e) => !e.is_dir && /\.md$/i.test(e.name));
    if (!main) return "I could not find a SKILL.md or any .md file in that folder.";
    let text = await invoke<string>("read_text_file", { path: `${path}/${main.name}` });
    // reference notes beside the main file give the skill its detail
    const refs = entries.find((e) => e.is_dir && e.name.toLowerCase() === "references");
    if (refs) {
      const notes = await invoke<{ name: string; is_dir: boolean }[]>("list_dir", { path: `${path}/${refs.name}` });
      for (const n of notes.filter((n) => !n.is_dir && /\.md$/i.test(n.name))) {
        if (text.length > MAX_SKILL_CHARS) break;
        const t = await invoke<string>("read_text_file", { path: `${path}/${refs.name}/${n.name}` });
        text += `\n\n## Reference: ${n.name.replace(/\.md$/i, "")}\n${t.trim()}\n`;
      }
    }
    return importSkillText(text.slice(0, MAX_SKILL_CHARS), stem);
  } catch (e) {
    return String(e);
  }
}

/**
 * Change a skill of your own. It keeps its id even when renamed, so recipe steps that use it still find it.
 * Returns a message if it could not be saved.
 */
export async function updateSkill(skillId: string, name: string, line: string, rules: string): Promise<string | null> {
  if (!skillId.startsWith("mine-") || !skills.some((s) => s.id === skillId)) return "Only your own skills can be changed.";
  if (!name.trim()) return "Give the skill a name.";
  if (!rules.trim()) return "Write at least one rule.";
  const clash = skills.find((s) => s.id !== skillId && s.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (clash) return `There is already a skill called "${clash.name}".`;
  try {
    await invoke("write_user_skill", { id: skillId.slice(5), body: skillBody(name, line, rules) });
  } catch (e) {
    return String(e);
  }
  await loadSkills();
  return null;
}

export async function deleteSkill(skillId: string) {
  if (!skillId.startsWith("mine-")) return;
  try {
    await invoke("delete_user_skill", { id: skillId.slice(5) });
  } catch {
    /* ignore */
  }
  await loadSkills();
}

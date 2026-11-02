import { plainName } from "./who";

/**
 * The names AIs go by in a project. Each AI tool gets the next free one the first time it is met
 * there, and keeps it: every conversation with it in that project, the main chat or a task, shows
 * the same name. The same tool working from its own window is another AI, so it gets a name of its
 * own. The designer can rename one.
 */
export const NAMES = ["Juniper", "Moss", "Pepper", "Olive", "Hazel", "Basil", "Sage", "Clover", "Maple", "Fern", "Willow", "Rowan", "Indigo", "Saffron", "Cedar"];

/** Names given in one project, by the tool's own name ("Claude Code" to "Juniper", "Claude Code (outside)" to "Moss"). */
export type Given = Record<string, string>;

/** The next name nobody in the project has. Past the fifteenth, the list starts again with a number: "Juniper 2". */
export function nextName(given: Given): string {
  const used = new Set(Object.values(given).map((n) => n.toLowerCase()));
  for (let round = 1; ; round++) {
    for (const n of NAMES) {
      const name = round === 1 ? n : `${n} ${round}`;
      if (!used.has(name.toLowerCase())) return name;
    }
  }
}

/** Give names to tools that have none yet, in the order they come. The same object back when nothing changed. */
export function giveNames(tools: string[], given: Given): Given {
  let out = given;
  for (const t of tools) {
    const tool = t.trim();
    if (!plainName(tool) || out[tool]) continue;
    out = { ...out, [tool]: nextName(out) };
  }
  return out;
}

/** The name an AI tool goes by, or the tool's own name when it has none yet. */
export const nameOf = (tool: string | undefined, given: Given): string => (tool ? (given[tool] ?? plainName(tool)) : "");

/** A name the designer typed, tidied. Empty when it is no name at all. */
export const tidyName = (typed: string) => typed.replace(/\s+/g, " ").trim().slice(0, 24);

/** Only names that are plain words are kept from a file. */
export function readGiven(value: unknown): Given {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Given = {};
  for (const [tool, name] of Object.entries(value as Record<string, unknown>)) if (typeof name === "string" && tidyName(name)) out[tool] = tidyName(name);
  return out;
}

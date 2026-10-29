import { typeName } from "../commands";
import type { Doc } from "../document/types";

/** A name Duet gave on its own: "Untitled", "Untitled 12". */
export const isUntitledName = (name: string) => /^Untitled( \d+)?$/.test(name.trim());

/** Letters a file name cannot hold, and a length that still fits the list of projects. */
const tidy = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48)
    .trim();

/** "Frame 3", "Rectangle 12": the name an element gets before anyone names it. */
const isDefault = (name: string) => Object.values(typeName).some((t) => new RegExp(`^${t} \\d+$`).test(name.trim()));

/** The first few words of what the designer asked, as a name. */
function fromAsk(ask: string): string {
  const words = ask
    .replace(/@\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s&'-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  const s = tidy(words.join(" "));
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

/**
 * A name for work that is still Untitled, from what is in it: the first named frame on the canvas,
 * then any named element, then the first words of what the designer asked. Null when nothing says.
 */
export function nameFromWork(doc: Doc, firstAsk?: string): string | null {
  const roots = doc.rootIds.map((id) => doc.elements[id]).filter(Boolean);
  const named = roots.filter((e) => e.name && !isDefault(e.name) && !isUntitledName(e.name));
  const pick = named.find((e) => e.type === "frame") ?? named[0];
  const name = pick ? tidy(pick.name) : fromAsk(firstAsk ?? "");
  return name && !isUntitledName(name) ? name : null;
}

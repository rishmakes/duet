import { sameHex } from "../commands/brand";
import type { Doc } from "../document/types";

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const COLOUR_KEYS = new Set(["fill", "stroke", "color", "from", "to"]);

/** The brand kit as rules for the AI, or an empty string when there is none. */
export function brandRules(doc: Doc): string {
  const b = doc.brand;
  if (!b || (!b.colours.length && !b.fonts.length && !b.voice && !b.logoId)) return "";
  const lines = ["Brand kit for this project. Keep to it."];
  if (b.colours.length) lines.push(`Colours: ${b.colours.map((c) => `${c.name} ${c.hex}`).join(", ")}.`);
  if (b.fonts.length) lines.push(`Fonts: ${b.fonts.join(", ")}.`);
  if (b.logoId && doc.elements[b.logoId]) lines.push(`The logo is ${b.logoId} ("${doc.elements[b.logoId].name}"). Copy it with duplicate_elements; never redraw it.`);
  if (b.voice) lines.push(`Voice: ${b.voice}`);
  if (b.locked) lines.push("The kit is locked: Duet refuses any other colour or font. White, black and see-through are always allowed.");
  return lines.join("\n");
}

/** When the kit is locked, what in these tool arguments is off brand, or null when all is in the kit. */
export function offBrand(doc: Doc, args: unknown): string | null {
  const b = doc.brand;
  if (!b?.locked) return null;
  const colours = new Set([...b.colours.map((c) => c.hex), "#ffffff", "#000000"]);
  const fonts = new Set(b.fonts.map((f) => f.toLowerCase()));
  const badColours = new Set<string>();
  const badFonts = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (COLOUR_KEYS.has(k) && typeof x === "string" && HEX.test(x) && b.colours.length && !colours.has(sameHex(x))) badColours.add(x);
      else if (k === "fontFamily" && typeof x === "string" && x && fonts.size && !fonts.has(x.toLowerCase())) badFonts.add(x);
      else walk(x);
    }
  };
  walk(args);
  if (!badColours.size && !badFonts.size) return null;
  const parts = [];
  if (badColours.size) parts.push(`colours ${[...badColours].join(", ")} are not in the brand kit (use ${b.colours.map((c) => c.hex).join(", ")})`);
  if (badFonts.size) parts.push(`fonts ${[...badFonts].join(", ")} are not in the brand kit (use ${b.fonts.join(", ")})`);
  return `The brand kit is locked, so nothing was changed: ${parts.join("; ")}. Only the designer can unlock it.`;
}

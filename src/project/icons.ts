/**
 * Free icons from Iconify (api.iconify.design). Only sets whose licence lets a designer use
 * them in paid work with no credit are offered. An icon comes back as plain SVG text, which
 * goes in through the SVG import, so it lands as real, editable layers.
 * Searching sends the typed word (and the computer's address) to Iconify.
 */

const API = "https://api.iconify.design";

/** The sets offered. Licence words are what a designer reads next to a result. */
export const ICON_SETS: Record<string, { name: string; licence: string }> = {
  lucide: { name: "Lucide", licence: "ISC, free for any use" },
  tabler: { name: "Tabler", licence: "MIT, free for any use" },
  ph: { name: "Phosphor", licence: "MIT, free for any use" },
  heroicons: { name: "Heroicons", licence: "MIT, free for any use" },
  bi: { name: "Bootstrap Icons", licence: "MIT, free for any use" },
  "material-symbols": { name: "Material Symbols", licence: "Apache 2.0, free for any use" },
  mdi: { name: "Material Design Icons", licence: "Apache 2.0, free for any use" },
  ri: { name: "Remix Icon", licence: "Apache 2.0, free for any use" },
  "simple-icons": { name: "Simple Icons (brand logos)", licence: "Public domain; the brands still own their logos" },
};

export interface IconHit {
  /** "lucide:house", the way Iconify names it. */
  icon: string;
  set: string;
  licence: string;
}

/** Split "lucide:house" into its set and name, or null when it is not an offered icon. */
export function parseIcon(icon: string): { prefix: string; name: string } | null {
  const m = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(icon.trim());
  return m && ICON_SETS[m[1]] ? { prefix: m[1], name: m[2] } : null;
}

/** Icons matching a word, from the offered sets only. Throws when the computer is offline. */
export async function searchIcons(query: string, limit = 24): Promise<IconHit[]> {
  const url = `${API}/search?query=${encodeURIComponent(query.trim())}&limit=${Math.min(Math.max(limit, 32), 96)}&prefixes=${Object.keys(ICON_SETS).join(",")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Iconify answered ${res.status}`);
  const data = (await res.json()) as { icons?: string[] };
  return (data.icons ?? [])
    .filter((i) => parseIcon(i))
    .slice(0, limit)
    .map((icon) => {
      const set = ICON_SETS[icon.split(":")[0]];
      return { icon, set: set.name, licence: set.licence };
    });
}

const svgs = new Map<string, string>();

/** One icon as SVG text at a pixel size. `color` (#rrggbb) replaces the icon's own colour. */
export async function iconSvg(icon: string, size = 24, color?: string): Promise<string> {
  const p = parseIcon(icon);
  if (!p) throw new Error(`${icon} is not an icon Duet offers. Use find_icons to see which are.`);
  const px = Math.min(Math.max(Math.round(size), 8), 1024);
  const hex = color && /^#[0-9a-f]{6}$/i.test(color) ? `&color=${encodeURIComponent(color)}` : "";
  const url = `${API}/${p.prefix}/${p.name}.svg?height=${px}${hex}`;
  const kept = svgs.get(url);
  if (kept) return kept;
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status === 404 ? `There is no icon named ${icon}.` : `Iconify answered ${res.status}`);
  const text = await res.text();
  if (!text.includes("<svg")) throw new Error(`There is no icon named ${icon}.`);
  svgs.set(url, text);
  return text;
}

import type { Brand, DesignSystem, Doc, El, TextStyle } from "../document/types";
import { canBeComponent, isDerived, syncInstances } from "../document/components";
import { addBrandColour, changeBrandColour, makeBrandKit, removeBrandColour, setBrand } from "./brand";
import { newId, restyle } from "./index";

/**
 * Two things a project keeps to.
 * The brand kit is who you are, in everything you make: colours, fonts, logo, voice, and brand
 * assets such as lower thirds, a logo intro or a post frame.
 * The design system is how a UI is built, on top of the brand kit: text styles, spacing steps,
 * corner sizes and UI components such as buttons and cards. Its colours and fonts are the brand kit's.
 * Assets and components are ordinary components; the lists say which is which.
 */

export interface ChangeBrandKitArgs {
  /** Colours by name: a name the kit has takes the new colour (and the design follows); a new name is added. */
  colours?: { name: string; hex: string }[];
  /** Names of colours to take out of the kit. */
  removeColours?: string[];
  fonts?: string[];
  voice?: string;
  /** The logo on the canvas, or an empty string for none. */
  logoId?: string;
  /** Ids of the brand assets. Each becomes a component if it is not one. Replaces the list. */
  assets?: string[];
}

export interface TextStyleIn {
  name: string;
  fontFamily?: string;
  fontSize: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
}

export interface SetDesignSystemArgs {
  /** Spacing steps in pixels. Replaces the list. */
  spacing?: number[];
  /** Corner sizes in pixels. Replaces the list. */
  corners?: number[];
  /** Ids of the UI components. Each becomes a component if it is not one. Replaces the list. */
  components?: string[];
  /** Text styles by name: a name the file has is changed (and the text using it follows); a new name is added. */
  textStyles?: TextStyleIn[];
  /** Names of text styles to take out. Text that used one keeps its look. */
  removeTextStyles?: string[];
}

export interface MakeDesignSystemArgs {
  /** When there is no brand kit yet and one is made too: the most colours to keep, most used first. */
  most?: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const emptyBrand = (): Brand => ({ colours: [], fonts: [] });
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Pixel steps written one way: whole, above zero, no repeats, smallest first. */
export function steps(list: unknown[], most = 8): number[] {
  const n = list.map(Number).filter((v) => Number.isFinite(v) && v > 0 && v <= 2000).map((v) => Math.round(v));
  return [...new Set(n)].sort((a, b) => a - b).slice(0, most);
}

/** The values used most often, as steps. */
function mostUsed(values: number[], most: number): number[] {
  const count = new Map<number, number>();
  for (const v of values) {
    const r = Math.round(v);
    if (r > 0) count.set(r, (count.get(r) ?? 0) + 1);
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, most).map(([v]) => v);
  return steps(top, most);
}

const live = (doc: Doc, ids: string[] | undefined) => (ids ?? []).filter((id) => doc.elements[id]?.component);
/** The brand assets that still exist as components. */
export const liveAssets = (doc: Doc) => live(doc, doc.brand?.assets);
/** The UI components of the design system that still exist. */
export const liveComponents = (doc: Doc) => live(doc, doc.system?.components);

/** Ids made into a list of components: only things that are or can be one, and those that are not yet become one. */
function asComponents(doc: Doc, list: string[]): { ids: string[]; elements: Doc["elements"] } {
  const ids = [...new Set(list.map(String))].filter((id) => doc.elements[id] && (doc.elements[id].component || canBeComponent(doc.elements[id])));
  let elements = doc.elements;
  const make = ids.filter((id) => !doc.elements[id].component);
  if (make.length) {
    elements = { ...elements };
    for (const id of make) elements[id] = { ...elements[id], component: true };
  }
  return { ids, elements };
}

/** Names for text styles, biggest first, by how many kinds of text a design has. */
const STYLE_NAMES = [[], ["Body"], ["Heading", "Body"], ["Heading", "Body", "Small"], ["Title", "Heading", "Body", "Small"], ["Title", "Heading", "Subheading", "Body", "Small"], ["Display", "Title", "Heading", "Subheading", "Body", "Small"]];

// ---- the brand kit ----

export function changeBrandKit(doc: Doc, a: ChangeBrandKitArgs): Doc {
  let d = doc;
  for (const c of a.colours ?? []) {
    if (!c || typeof c.name !== "string" || typeof c.hex !== "string" || !HEX.test(c.hex)) continue;
    const had = d.brand?.colours.find((k) => same(k.name, c.name));
    d = had ? changeBrandColour(d, { id: had.id, hex: c.hex }) : addBrandColour(d, { name: c.name, hex: c.hex });
  }
  for (const name of a.removeColours ?? []) {
    const had = d.brand?.colours.find((k) => same(k.name, String(name)));
    if (had) d = removeBrandColour(d, { id: had.id });
  }
  if (a.fonts || a.voice !== undefined || a.logoId !== undefined) d = setBrand(d, { fonts: a.fonts, voice: a.voice, logoId: a.logoId });
  if (a.assets) {
    const { ids, elements } = asComponents(d, a.assets);
    d = { ...d, elements, brand: { ...(d.brand ?? emptyBrand()), assets: ids } };
  }
  return d;
}

// ---- the design system ----

export function setDesignSystem(doc: Doc, a: SetDesignSystemArgs): Doc {
  let d = doc;
  const s: DesignSystem = { ...(d.system ?? {}) };
  if (a.spacing) s.spacing = steps(a.spacing);
  if (a.corners) s.corners = steps(a.corners);
  if (a.components) {
    const { ids, elements } = asComponents(d, a.components);
    s.components = ids;
    d = { ...d, elements };
  }
  if (a.spacing || a.corners || a.components) d = { ...d, system: s };

  // text styles, by name
  if (a.textStyles?.length || a.removeTextStyles?.length) {
    const styles: Record<string, TextStyle> = { ...(d.styles ?? {}) };
    const touched: string[] = [];
    for (const t of a.textStyles ?? []) {
      if (!t || typeof t.name !== "string" || !t.name.trim() || !(Number(t.fontSize) > 0)) continue;
      const id = Object.keys(styles).find((k) => same(styles[k].name, t.name)) ?? newId("style");
      const was = styles[id];
      styles[id] = {
        name: t.name.trim(),
        fontFamily: typeof t.fontFamily === "string" ? t.fontFamily : (was?.fontFamily ?? d.brand?.fonts[0] ?? ""),
        fontSize: Number(t.fontSize),
        fontWeight: Number(t.fontWeight) > 0 ? Number(t.fontWeight) : (was?.fontWeight ?? 400),
        lineHeight: Number(t.lineHeight) > 0 ? Number(t.lineHeight) : (was?.lineHeight ?? 1.3),
        letterSpacing: t.letterSpacing !== undefined && Number.isFinite(Number(t.letterSpacing)) ? Number(t.letterSpacing) : (was?.letterSpacing ?? 0),
      };
      if (was) touched.push(id);
    }
    const gone = new Set(Object.keys(styles).filter((k) => (a.removeTextStyles ?? []).some((n) => same(styles[k].name, String(n)))));
    for (const k of gone) delete styles[k];
    const next: Doc = { ...d, styles, elements: { ...d.elements } };
    for (const [id, el] of Object.entries(next.elements)) {
      if (el.type !== "text") continue;
      if (gone.has(el.textStyleId)) next.elements[id] = { ...el, textStyleId: "" };
      else if (touched.includes(el.textStyleId)) next.elements[id] = { ...el };
    }
    for (const id of touched) restyle(next, id);
    d = next;
  }
  return d;
}

/**
 * A design system read from what the design already uses: the gaps and padding of its auto layouts
 * as spacing steps, its corner sizes, its components (all but the brand assets), and, when the file
 * has no text styles yet, its most used kinds of text as styles. What it has already stays.
 * With no brand kit yet, one is made too, since the design system takes its colours and fonts from it.
 */
export function makeDesignSystem(doc: Doc, a: MakeDesignSystemArgs): Doc {
  let d = doc.brand ? doc : makeBrandKit(doc, { most: a.most });
  const els = Object.values(d.elements).filter((el) => !isDerived(el.id));
  const s: DesignSystem = { ...(d.system ?? {}) };

  if (!s.spacing?.length) {
    const gaps: number[] = [];
    for (const el of els) if (el.type === "frame" && el.layout) gaps.push(el.layout.gap, el.layout.padX, el.layout.padY);
    const found = mostUsed(gaps, 6);
    s.spacing = found.length >= 2 ? found : [4, 8, 16, 24, 32, 48];
  }
  if (!s.corners?.length) s.corners = mostUsed(els.map((el) => el.radius ?? 0), 4);
  const assets = new Set(liveAssets(d));
  s.components = [...new Set([...liveComponents(d), ...els.filter((el) => el.component && !assets.has(el.id)).map((el) => el.id)])];
  d = { ...d, system: s };

  if (!Object.keys(d.styles ?? {}).length) {
    const kinds = new Map<string, { el: El; n: number }>();
    for (const el of els) {
      if (el.type !== "text" || !el.fontSize) continue;
      const key = `${el.fontFamily}|${Math.round(el.fontSize)}|${el.fontWeight}`;
      const k = kinds.get(key);
      if (k) k.n++;
      else kinds.set(key, { el, n: 1 });
    }
    const top = [...kinds.values()].sort((x, y) => y.n - x.n).slice(0, 6).sort((x, y) => y.el.fontSize - x.el.fontSize || y.el.fontWeight - x.el.fontWeight);
    const names = STYLE_NAMES[top.length];
    const styles: Record<string, TextStyle> = {};
    top.forEach(({ el }, i) => {
      styles[newId("style")] = { name: names[i], fontFamily: el.fontFamily, fontSize: Math.round(el.fontSize), fontWeight: el.fontWeight, lineHeight: el.lineHeight, letterSpacing: el.letterSpacing };
    });
    if (top.length) d = { ...d, styles };
  }
  return d;
}

/** True when the project has a design system: steps, corners, components or text styles. */
export const hasDesignSystem = (doc: Doc) => !!(doc.system?.spacing?.length || doc.system?.corners?.length || liveComponents(doc).length || Object.keys(doc.styles ?? {}).length);

/** The brand assets, as a line for the AI, or nothing. */
export function assetLines(doc: Doc): string[] {
  const assets = liveAssets(doc);
  return assets.length ? [`Brand assets: ${assets.map((id) => `${id} "${doc.elements[id].name}"`).join(", ")}. Use these in posts, videos and pages: place them with create_instance and change the copy's text with set_props. Never redraw one.`] : [];
}

/** The design system in a few lines, for the AI. Empty when there is none. */
export function designSystemLines(doc: Doc): string[] {
  if (!hasDesignSystem(doc)) return [];
  const s = doc.system;
  const lines = ["Design system for UI in this project, on top of the brand kit. Keep to it."];
  const styles = Object.entries(doc.styles ?? {});
  if (styles.length) lines.push(`Text styles (give text one with apply_text_style): ${styles.map(([id, t]) => `${t.name} ${id} (${t.fontFamily || "system font"} ${t.fontSize}px, weight ${t.fontWeight}, line ${t.lineHeight})`).join("; ")}.`);
  if (s?.spacing?.length) lines.push(`Spacing steps: ${s.spacing.join(", ")} px. Use only these for gaps, padding and the space between things.`);
  if (s?.corners?.length) lines.push(`Corner sizes: ${s.corners.join(", ")} px. Use only these for radius.`);
  const comps = liveComponents(doc);
  if (comps.length) lines.push(`UI components: ${comps.map((id) => `${id} "${doc.elements[id].name}"`).join(", ")}. Build screens with these: place them with create_instance and change the copy's text with set_props. Never redraw one.`);
  return lines;
}

// ---- kits: a brand kit, or a design system with its brand kit, as one file used in any project ----

export interface Kit {
  kind: "duet-kit";
  version: 1;
  name: string;
  brand: { colours: { name: string; hex: string }[]; fonts: string[]; voice?: string; assets: string[] };
  /** Left out for a brand kit on its own. */
  system?: { spacing?: number[]; corners?: number[]; textStyles: TextStyle[]; components: string[] };
  /** The assets and components and the components inside them, with everything in them, as in a design file. */
  elements: Record<string, El>;
}

/** A thing and everything inside it, leaving out the insides of copies, which are rebuilt from their main. */
function subtree(doc: Doc, id: string, out: Record<string, El>) {
  const el = doc.elements[id];
  if (!el || out[id] || isDerived(id)) return;
  out[id] = el.type === "instance" ? { ...el, childIds: [] } : el;
  if (el.type === "instance") subtree(doc, el.componentId, out);
  else for (const c of el.childIds) subtree(doc, c, out);
}

/** The project's brand kit as a kit file, and its design system with it when `withSystem`. */
export function kitFromDoc(doc: Doc, name: string, withSystem: boolean): Kit {
  const b = doc.brand ?? emptyBrand();
  const assets = liveAssets(doc);
  const components = withSystem ? liveComponents(doc) : [];
  const elements: Record<string, El> = {};
  for (const id of [...assets, ...components]) subtree(doc, id, elements);
  // a component one is built from sits at the top of the kit, never inside a frame it does not come with
  for (const el of Object.values(elements)) if (el.parentId && !elements[el.parentId]) elements[el.id] = { ...el, parentId: null };
  return {
    kind: "duet-kit",
    version: 1,
    name: name.trim() || (withSystem ? "Design system" : "Brand kit"),
    brand: { colours: b.colours.map(({ name: n, hex }) => ({ name: n, hex })), fonts: [...b.fonts], ...(b.voice ? { voice: b.voice } : {}), assets },
    ...(withSystem
      ? { system: { ...(doc.system?.spacing?.length ? { spacing: [...doc.system.spacing] } : {}), ...(doc.system?.corners?.length ? { corners: [...doc.system.corners] } : {}), textStyles: Object.values(doc.styles ?? {}), components } }
      : {}),
    elements: structuredClone(elements),
  };
}

/** A kit read from a file, or null when it is not one. */
export function readKit(text: string): Kit | null {
  let k: Partial<Kit>;
  try {
    k = JSON.parse(text) as Partial<Kit>;
  } catch {
    return null;
  }
  if (!k || k.kind !== "duet-kit" || typeof k.name !== "string" || !k.brand || typeof k.brand !== "object") return null;
  const elements = k.elements && typeof k.elements === "object" ? k.elements : {};
  const ids = (l: unknown) => (Array.isArray(l) ? l.filter((id): id is string => typeof id === "string" && !!elements[id]) : []);
  const b = k.brand;
  const s = k.system;
  return {
    kind: "duet-kit",
    version: 1,
    name: k.name,
    brand: {
      colours: Array.isArray(b.colours) ? b.colours.filter((c) => c && typeof c.name === "string" && HEX.test(String(c.hex))) : [],
      fonts: Array.isArray(b.fonts) ? b.fonts.filter((f) => typeof f === "string") : [],
      ...(typeof b.voice === "string" ? { voice: b.voice } : {}),
      assets: ids(b.assets),
    },
    ...(s && typeof s === "object"
      ? {
          system: {
            ...(Array.isArray(s.spacing) ? { spacing: steps(s.spacing) } : {}),
            ...(Array.isArray(s.corners) ? { corners: steps(s.corners) } : {}),
            textStyles: Array.isArray(s.textStyles) ? s.textStyles.filter((t) => t && typeof t.name === "string" && Number(t.fontSize) > 0) : [],
            components: ids(s.components),
          },
        }
      : {}),
    elements,
  };
}

export interface UseKitArgs {
  kit: Kit;
}

/**
 * Bring a kit into the design. Its brand kit joins the project's (a colour name the project has takes
 * the kit's colour), and its design system too when it has one. Its assets and components are placed
 * in a row to the right of the design, ready to be used. Nothing is placed twice.
 */
export function useKit(doc: Doc, a: UseKitArgs): Doc {
  const k = a.kit;
  if (!k || k.kind !== "duet-kit" || !k.brand) return doc;
  let d = changeBrandKit(doc, {
    colours: k.brand.colours,
    fonts: [...new Set([...(doc.brand?.fonts ?? []), ...k.brand.fonts])],
    ...(k.brand.voice && !doc.brand?.voice ? { voice: k.brand.voice } : {}),
  });
  if (k.system) d = setDesignSystem(d, { ...(k.system.spacing?.length ? { spacing: k.system.spacing } : {}), ...(k.system.corners?.length ? { corners: k.system.corners } : {}), textStyles: k.system.textStyles });

  // what comes in: every top thing in the kit whose id the design does not have yet, with what is inside it
  const tops = Object.values(k.elements).filter((el) => !el.parentId && !d.elements[el.id]);
  if (tops.length) {
    const elements = { ...d.elements };
    const add = (id: string) => {
      const el = k.elements[id];
      if (!el || elements[id]) return;
      elements[id] = structuredClone(el);
      if (el.type !== "instance") el.childIds.forEach(add);
    };
    // placed in a row to the right of everything on the open board, tops lined up
    const roots = d.rootIds.map((id) => d.elements[id]).filter(Boolean);
    let x = roots.length ? Math.max(...roots.map((r) => r.x + r.width)) + 120 : 0;
    const y = roots.length ? Math.min(...roots.map((r) => r.y)) : 0;
    for (const t of tops) {
      add(t.id);
      elements[t.id] = { ...elements[t.id], x, y };
      x += t.width + 40;
    }
    d = { ...d, elements, rootIds: [...d.rootIds, ...tops.map((t) => t.id)] };
  }
  const assets = k.brand.assets.filter((id) => d.elements[id]?.component);
  if (assets.length) d = { ...d, brand: { ...(d.brand ?? emptyBrand()), assets: [...new Set([...liveAssets(d), ...assets])] } };
  const comps = (k.system?.components ?? []).filter((id) => d.elements[id]?.component);
  if (comps.length) d = { ...d, system: { ...(d.system ?? {}), components: [...new Set([...liveComponents(d), ...comps])] } };
  return syncInstances(d);
}

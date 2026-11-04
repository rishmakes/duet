import type { Brand, Doc, El, TextStyle } from "../document/types";
import { canBeComponent, isDerived, syncInstances } from "../document/components";
import { addBrandColour, changeBrandColour, makeBrandKit, removeBrandColour, setBrand } from "./brand";
import { newId, restyle } from "./index";

/**
 * The design system: the brand kit grown up. Colours, fonts and voice as before, plus the text
 * styles, the spacing steps, the corner sizes and the pieces (components such as buttons and cards)
 * a design is built from. The AI reads it as rules and builds with the pieces.
 */

export interface TextStyleIn {
  name: string;
  fontFamily?: string;
  fontSize: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
}

export interface SetDesignSystemArgs {
  /** Colours by name: a name the kit has takes the new colour (and the design follows); a new name is added. */
  colours?: { name: string; hex: string }[];
  /** Names of colours to take out of the kit. */
  removeColours?: string[];
  fonts?: string[];
  voice?: string;
  /** Spacing steps in pixels. Replaces the list. */
  spacing?: number[];
  /** Corner sizes in pixels. Replaces the list. */
  corners?: number[];
  /** Ids of the things that are the pieces. Each becomes a component if it is not one. Replaces the list. */
  pieces?: string[];
  /** Text styles by name: a name the file has is changed (and the text using it follows); a new name is added. */
  textStyles?: TextStyleIn[];
  /** Names of text styles to take out. Text that used one keeps its look. */
  removeTextStyles?: string[];
}

export interface MakeDesignSystemArgs {
  /** The most colours to keep, most used first. */
  most?: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const empty = (): Brand => ({ colours: [], fonts: [] });
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

/** The pieces that still exist as components. */
export function livePieces(doc: Doc): string[] {
  return (doc.brand?.pieces ?? []).filter((id) => doc.elements[id]?.component);
}

/** Names for text styles, biggest first, by how many kinds of text a design has. */
const STYLE_NAMES = [[], ["Body"], ["Heading", "Body"], ["Heading", "Body", "Small"], ["Title", "Heading", "Body", "Small"], ["Title", "Heading", "Subheading", "Body", "Small"], ["Display", "Title", "Heading", "Subheading", "Body", "Small"]];

export function setDesignSystem(doc: Doc, a: SetDesignSystemArgs): Doc {
  let d = doc;
  // colours, by name
  for (const c of a.colours ?? []) {
    if (!c || typeof c.name !== "string" || typeof c.hex !== "string" || !HEX.test(c.hex)) continue;
    const had = d.brand?.colours.find((k) => same(k.name, c.name));
    d = had ? changeBrandColour(d, { id: had.id, hex: c.hex }) : addBrandColour(d, { name: c.name, hex: c.hex });
  }
  for (const name of a.removeColours ?? []) {
    const had = d.brand?.colours.find((k) => same(k.name, String(name)));
    if (had) d = removeBrandColour(d, { id: had.id });
  }
  if (a.fonts || a.voice !== undefined) d = setBrand(d, { fonts: a.fonts, voice: a.voice });

  const b: Brand = { ...(d.brand ?? empty()) };
  if (a.spacing) b.spacing = steps(a.spacing);
  if (a.corners) b.corners = steps(a.corners);
  let elements = d.elements;
  if (a.pieces) {
    const ids = [...new Set(a.pieces.map(String))].filter((id) => d.elements[id] && (d.elements[id].component || canBeComponent(d.elements[id])));
    const make = ids.filter((id) => !d.elements[id].component);
    if (make.length) {
      elements = { ...elements };
      for (const id of make) elements[id] = { ...elements[id], component: true };
    }
    b.pieces = ids;
  }
  d = { ...d, elements, brand: b };

  // text styles, by name
  if (a.textStyles?.length || a.removeTextStyles?.length) {
    const styles: Record<string, TextStyle> = { ...(d.styles ?? {}) };
    const touched: string[] = [];
    for (const s of a.textStyles ?? []) {
      if (!s || typeof s.name !== "string" || !s.name.trim() || !(Number(s.fontSize) > 0)) continue;
      const id = Object.keys(styles).find((k) => same(styles[k].name, s.name)) ?? newId("style");
      const was = styles[id];
      styles[id] = {
        name: s.name.trim(),
        fontFamily: typeof s.fontFamily === "string" ? s.fontFamily : (was?.fontFamily ?? d.brand?.fonts[0] ?? ""),
        fontSize: Number(s.fontSize),
        fontWeight: Number(s.fontWeight) > 0 ? Number(s.fontWeight) : (was?.fontWeight ?? 400),
        lineHeight: Number(s.lineHeight) > 0 ? Number(s.lineHeight) : (was?.lineHeight ?? 1.3),
        letterSpacing: Number.isFinite(Number(s.letterSpacing)) && s.letterSpacing !== undefined ? Number(s.letterSpacing) : (was?.letterSpacing ?? 0),
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
 * A design system read from what the design already uses: its colours and fonts (as the brand kit),
 * the gaps and padding of its auto layouts, its corner sizes, its components as pieces, and, when the
 * file has no text styles yet, its most used kinds of text as styles. What the kit has already stays.
 */
export function makeDesignSystem(doc: Doc, a: MakeDesignSystemArgs): Doc {
  let d = makeBrandKit(doc, { most: a.most });
  const els = Object.values(d.elements).filter((el) => !isDerived(el.id));
  const b: Brand = { ...(d.brand ?? empty()) };

  if (!b.spacing?.length) {
    const gaps: number[] = [];
    for (const el of els) if (el.type === "frame" && el.layout) gaps.push(el.layout.gap, el.layout.padX, el.layout.padY);
    const found = mostUsed(gaps, 6);
    b.spacing = found.length >= 2 ? found : [4, 8, 16, 24, 32, 48];
  }
  if (!b.corners?.length) b.corners = mostUsed(els.map((el) => el.radius ?? 0), 4);
  b.pieces = [...new Set([...livePieces(d), ...els.filter((el) => el.component).map((el) => el.id)])];
  d = { ...d, brand: b };

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

/** The design system in a few lines, for the AI. Empty when there is nothing in it. */
export function designSystemLines(doc: Doc): string[] {
  const b = doc.brand;
  const lines: string[] = [];
  const styles = Object.entries(doc.styles ?? {});
  if (styles.length) lines.push(`Text styles (use them with apply_text_style): ${styles.map(([id, s]) => `${s.name} ${id} (${s.fontFamily || "system font"} ${s.fontSize}px, weight ${s.fontWeight}, line ${s.lineHeight})`).join("; ")}.`);
  if (b?.spacing?.length) lines.push(`Spacing steps: ${b.spacing.join(", ")} px. Use only these for gaps, padding and the space between things.`);
  if (b?.corners?.length) lines.push(`Corner sizes: ${b.corners.join(", ")} px. Use only these for radius.`);
  const pieces = livePieces(doc);
  if (pieces.length) lines.push(`Pieces: ${pieces.map((id) => `${id} "${doc.elements[id].name}"`).join(", ")}. Build with these: place them with create_instance and change the copy's text with set_props. Never redraw a piece.`);
  return lines;
}


// ---- kits: a design system made once and used in any project ----

/** A design system as a file of its own. Its pieces travel with it, with the components they are built from. */
export interface Kit {
  kind: "duet-kit";
  version: 1;
  name: string;
  colours: { name: string; hex: string }[];
  fonts: string[];
  voice?: string;
  spacing?: number[];
  corners?: number[];
  textStyles: TextStyle[];
  /** Ids of the pieces, in order. */
  pieces: string[];
  /** The pieces and the components inside them, with everything in them, as in a design file. */
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

/** The project's design system as a kit, named. */
export function kitFromDoc(doc: Doc, name: string): Kit {
  const b = doc.brand ?? empty();
  const pieces = livePieces(doc);
  const elements: Record<string, El> = {};
  for (const id of pieces) subtree(doc, id, elements);
  // a component a piece is built from sits at the top of the kit, never inside a frame it does not come with
  for (const el of Object.values(elements)) if (el.parentId && !elements[el.parentId]) elements[el.id] = { ...el, parentId: null };
  return {
    kind: "duet-kit",
    version: 1,
    name: name.trim() || "Design system",
    colours: b.colours.map(({ name: n, hex }) => ({ name: n, hex })),
    fonts: [...b.fonts],
    ...(b.voice ? { voice: b.voice } : {}),
    ...(b.spacing?.length ? { spacing: [...b.spacing] } : {}),
    ...(b.corners?.length ? { corners: [...b.corners] } : {}),
    textStyles: Object.values(doc.styles ?? {}),
    pieces,
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
  if (!k || k.kind !== "duet-kit" || typeof k.name !== "string") return null;
  const elements = k.elements && typeof k.elements === "object" ? k.elements : {};
  return {
    kind: "duet-kit",
    version: 1,
    name: k.name,
    colours: Array.isArray(k.colours) ? k.colours.filter((c) => c && typeof c.name === "string" && HEX.test(String(c.hex))) : [],
    fonts: Array.isArray(k.fonts) ? k.fonts.filter((f) => typeof f === "string") : [],
    ...(typeof k.voice === "string" ? { voice: k.voice } : {}),
    ...(Array.isArray(k.spacing) ? { spacing: steps(k.spacing) } : {}),
    ...(Array.isArray(k.corners) ? { corners: steps(k.corners) } : {}),
    textStyles: Array.isArray(k.textStyles) ? k.textStyles.filter((s) => s && typeof s.name === "string" && Number(s.fontSize) > 0) : [],
    pieces: Array.isArray(k.pieces) ? k.pieces.filter((id) => typeof id === "string" && !!elements[id]) : [],
    elements,
  };
}

export interface UseKitArgs {
  kit: Kit;
}

/**
 * Bring a kit into the design: its colours, fonts, text styles, spacing and corners join the design
 * system (a name the project has takes the kit's value), and its pieces are placed in a row to the
 * right of the design, ready to be used. A piece the design already has is not placed twice.
 */
export function useKit(doc: Doc, a: UseKitArgs): Doc {
  const k = a.kit;
  if (!k || k.kind !== "duet-kit") return doc;
  let d = setDesignSystem(doc, {
    colours: k.colours,
    fonts: [...new Set([...(doc.brand?.fonts ?? []), ...k.fonts])],
    ...(k.voice && !doc.brand?.voice ? { voice: k.voice } : {}),
    ...(k.spacing?.length ? { spacing: k.spacing } : {}),
    ...(k.corners?.length ? { corners: k.corners } : {}),
    textStyles: k.textStyles,
  });

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
  const pieces = k.pieces.filter((id) => d.elements[id]?.component);
  d = { ...d, brand: { ...(d.brand ?? empty()), pieces: [...new Set([...livePieces(d), ...pieces])] } };
  return syncInstances(d);
}

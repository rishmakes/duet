import type { Brand, BrandColour, Doc, El } from "../document/types";
import { newId } from "./index";

export interface SetBrandArgs {
  fonts?: string[];
  /** The logo on the canvas, or an empty string for none. */
  logoId?: string;
  voice?: string;
  locked?: boolean;
}

export interface AddBrandColourArgs {
  id?: string;
  name: string;
  hex: string;
}

export interface ChangeBrandColourArgs {
  id: string;
  name?: string;
  /** A new colour. Every place in the design that used the old one follows. */
  hex?: string;
}

export interface RemoveBrandColourArgs {
  id: string;
}

export interface MakeBrandKitArgs {
  /** The most colours to keep, most used first. 5 if left out: a brand is a few colours, not every colour on the page. */
  most?: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A colour written one way, so #FFF and #ffffff are the same. */
export function sameHex(h: string): string {
  const s = h.trim().toLowerCase();
  return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
}

const empty = (): Brand => ({ colours: [], fonts: [] });

function withBrand(doc: Doc, brand: Brand): Doc {
  return { ...doc, brand };
}

/** Every colour a thing is painted with: fill, outline, shadow and gradient. */
export function coloursOf(el: El): string[] {
  const out: string[] = [];
  if (el.fill && HEX.test(el.fill)) out.push(el.fill);
  if (el.stroke && HEX.test(el.stroke)) out.push(el.stroke);
  if (el.shadow?.color && HEX.test(el.shadow.color)) out.push(el.shadow.color);
  if (el.gradient) for (const c of [el.gradient.from, el.gradient.to]) if (HEX.test(c)) out.push(c);
  return out.map(sameHex);
}

export function setBrand(doc: Doc, a: SetBrandArgs): Doc {
  const b: Brand = { ...(doc.brand ?? empty()) };
  if (a.fonts) b.fonts = [...new Set(a.fonts.map((f) => f.trim()).filter(Boolean))];
  if (a.logoId !== undefined) {
    if (a.logoId && doc.elements[a.logoId]) b.logoId = a.logoId;
    else delete b.logoId;
  }
  if (a.voice !== undefined) {
    if (a.voice.trim()) b.voice = a.voice.trim();
    else delete b.voice;
  }
  if (a.locked !== undefined) {
    if (a.locked) b.locked = true;
    else delete b.locked;
  }
  return withBrand(doc, b);
}

export function addBrandColour(doc: Doc, a: AddBrandColourArgs): Doc {
  if (!HEX.test(a.hex)) return doc;
  const b = doc.brand ?? empty();
  const colour: BrandColour = { id: a.id ?? newId("colour"), name: a.name.trim() || "Colour", hex: sameHex(a.hex) };
  return withBrand(doc, { ...b, colours: [...b.colours, colour] });
}

export function changeBrandColour(doc: Doc, a: ChangeBrandColourArgs): Doc {
  const b = doc.brand;
  const was = b?.colours.find((c) => c.id === a.id);
  if (!b || !was) return doc;
  const hex = a.hex && HEX.test(a.hex) ? sameHex(a.hex) : was.hex;
  const colours = b.colours.map((c) => (c.id === a.id ? { ...c, name: a.name?.trim() || c.name, hex } : c));
  let elements = doc.elements;
  if (hex !== was.hex) {
    // the design follows the kit: every place painted with the old colour takes the new one
    const swap = (c: string) => (HEX.test(c) && sameHex(c) === was.hex ? hex : c);
    elements = {};
    for (const [id, el] of Object.entries(doc.elements)) {
      if (!coloursOf(el).includes(was.hex)) {
        elements[id] = el;
        continue;
      }
      elements[id] = {
        ...el,
        fill: swap(el.fill),
        stroke: el.stroke ? swap(el.stroke) : el.stroke,
        shadow: el.shadow ? { ...el.shadow, color: swap(el.shadow.color) } : el.shadow,
        gradient: el.gradient ? { ...el.gradient, from: swap(el.gradient.from), to: swap(el.gradient.to) } : el.gradient,
      };
    }
  }
  return { ...doc, elements, brand: { ...b, colours } };
}

export function removeBrandColour(doc: Doc, a: RemoveBrandColourArgs): Doc {
  const b = doc.brand;
  if (!b?.colours.some((c) => c.id === a.id)) return doc;
  return withBrand(doc, { ...b, colours: b.colours.filter((c) => c.id !== a.id) });
}

/** A kit made from what the design already uses: its colours, most used first, and its fonts. Logo and voice stay. */
/** Greys, white and black say nothing about a brand: they have no hue to speak of. */
function isNeutral(hex: string): boolean {
  const h = sameHex(hex).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) < 14;
}

export function makeBrandKit(doc: Doc, a: MakeBrandKitArgs): Doc {
  const count = new Map<string, number>();
  const fonts = new Set<string>();
  for (const el of Object.values(doc.elements)) {
    for (const c of coloursOf(el)) count.set(c, (count.get(c) ?? 0) + 1);
    if (el.type === "text" && el.fontFamily) fonts.add(el.fontFamily);
  }
  for (const s of Object.values(doc.styles ?? {})) if (s.fontFamily) fonts.add(s.fontFamily);
  const b = doc.brand ?? empty();
  const known = new Set(b.colours.map((c) => c.hex));
  const wanted = [...count.entries()].filter(([hex]) => !known.has(hex)).sort((x, y) => y[1] - x[1]);
  // The brand's own colours first; greys, white and black only if the design has nothing else.
  const coloured = wanted.filter(([hex]) => !isNeutral(hex));
  const fresh = (coloured.length || b.colours.length ? coloured : wanted)
    .slice(0, Math.max(0, (a.most ?? 5) - b.colours.length))
    .map(([hex], i) => ({ id: newId("colour"), name: `Colour ${b.colours.length + i + 1}`, hex }));
  return withBrand(doc, { ...b, colours: [...b.colours, ...fresh], fonts: [...new Set([...b.fonts, ...fonts])] });
}

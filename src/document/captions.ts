import type { Doc, El, Shadow } from "./types";
import type { EditWord } from "./words";

/**
 * Captions (#71): the words heard in an edit, shown on the video a few at a time. Each caption is plain
 * text on a Captions track, so it can be moved, restyled or deleted like any other text.
 */

export type CaptionLook = "bold" | "quiet" | "pill" | "one" | "box" | "line" | "outline" | "glow" | "dim" | "there" | "highlight" | "plates" | "cursive" | "pen" | "sticker" | "stack" | "rainbow";

/**
 * The looks. `lit` is the colour a look lights the spoken word in when it has its own; `unlit` looks
 * light no word. `styled` looks are the ready styles: fonts, colours and how the words arrive all set,
 * their tile drawn from their own settings.
 */
export const CAPTION_LOOKS: { key: CaptionLook; name: string; lit?: string; unlit?: true; styled?: true }[] = [
  { key: "there", name: "Right and there", styled: true },
  { key: "highlight", name: "Highlight", lit: "#3d7bff", styled: true },
  { key: "plates", name: "Plates", unlit: true, styled: true },
  { key: "cursive", name: "Cursive", unlit: true, styled: true },
  { key: "pen", name: "Pen box", unlit: true, styled: true },
  { key: "sticker", name: "Sticker", lit: "#ff5fd2", styled: true },
  { key: "stack", name: "Stack", unlit: true, styled: true },
  { key: "rainbow", name: "Rainbow", unlit: true, styled: true },
  { key: "bold", name: "Bold pop" },
  { key: "quiet", name: "Quiet" },
  { key: "pill", name: "Pill" },
  { key: "one", name: "One word", unlit: true },
  { key: "box", name: "Box", lit: "#7c5cff" },
  { key: "line", name: "Box, one line", lit: "#e5383b" },
  { key: "outline", name: "Outline" },
  { key: "glow", name: "Glow" },
  { key: "dim", name: "Dim", lit: "#ffffff" },
];

/**
 * The free font each look is written in, fetched the first time it is used. Until it is here, or with no
 * internet, the words show in the computer's own font, so a caption is never missing.
 */
export const CAPTION_FONTS: Record<CaptionLook, string> = {
  bold: "Montserrat",
  quiet: "Inter",
  pill: "Poppins",
  one: "Anton",
  box: "Poppins",
  line: "Poppins",
  outline: "Montserrat",
  glow: "Poppins",
  dim: "Montserrat",
  there: "Montserrat",
  highlight: "Poppins",
  plates: "Anton",
  cursive: "Montserrat",
  pen: "Caveat",
  sticker: "Luckiest Guy",
  stack: "Anton",
  rainbow: "Fredoka",
};

/** The second fonts the ready styles use for some of their words. */
export const CAPTION_FONTS_2 = ["Dancing Script", "Great Vibes"];

/** A look with a box behind the spoken word, whose colour is the look's own. */
export const boxedLook = (look: CaptionLook) => look === "box" || look === "line";

export const CAPTIONS_TRACK = "Captions";

/** One caption: its words and the seconds of the frame it shows. */
export interface CaptionChunk {
  text: string;
  start: number;
  end: number;
  /** The second each word starts being said, counted from the caption's start. */
  spoken: number[];
}

/** Colours the spoken word can be lit in, the first one by default. */
export const SPOKEN_COLOURS = ["#ffe14d", "#7cf2c9", "#ff5fd2", "#a68bff", "#ff5a5a"];

/** A pause this long between two words starts a new caption, so a caption never hangs over silence. */
const PAUSE = 0.7;
/** A caption stays this long after its last word when nothing comes straight after. */
const LINGER = 0.3;

const round = (n: number) => Math.round(n * 1000) / 1000;

/** A sound the voice model wrote down instead of a word, like [music], (laughs), *pew* or ♪. */
const SOUND_TAG = /^([[(*].*[\])*]|.*♪.*)[.,!?]*$/;
const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** The words worth a caption: no sound tags, and a word said twice in a row shows once. */
export function captionWords(words: EditWord[]): EditWord[] {
  const out: EditWord[] = [];
  for (const w of words) {
    if (SOUND_TAG.test(w.w.trim())) continue;
    const last = out[out.length - 1];
    if (last && bare(w.w) && bare(w.w) === bare(last.w)) continue;
    out.push(w);
  }
  return out;
}

/** Words grouped into captions of at most `per` words, broken at pauses and at the end of a sentence. */
export function captionChunks(words: EditWord[], per: number): CaptionChunk[] {
  const n = Math.max(1, Math.min(6, Math.round(per) || 1));
  const groups: EditWord[][] = [];
  let run: EditWord[] = [];
  for (const w of captionWords(words)) {
    const last = run[run.length - 1];
    if (run.length && (run.length >= n || w.s - last.e > PAUSE || /[.?!]$/.test(last.w))) {
      groups.push(run);
      run = [];
    }
    run.push(w);
  }
  if (run.length) groups.push(run);
  return groups.map((g, i) => {
    const next = groups[i + 1]?.[0];
    const lastEnd = g[g.length - 1].e;
    // straight into the next caption when it follows closely, so the text never blinks off between them
    const end = next && next.s - lastEnd <= PAUSE ? next.s : lastEnd + LINGER;
    const start = round(g[0].s);
    return { text: g.map((w) => w.w).join(" "), start, end: round(Math.max(end, g[0].s + 0.1)), spoken: g.map((w) => round(w.s - start)) };
  });
}

/** How a caption's words are written in a look: no full stops or commas for the loud ones. */
export function captionText(text: string, look: CaptionLook): string {
  if (look === "quiet" || look === "pill") return text;
  return text.replace(/[.,;:]+(?=\s|$)/g, "");
}

/** The text properties of a look, sized for a frame. Sizes are set for 1080 pixels on the short side. Every look sets the same properties, so one look replaces another fully. */
export function captionProps(look: CaptionLook, frame: { width: number; height: number }): Partial<El> {
  const k = Math.min(frame.width, frame.height) / 1080;
  const px = (n: number) => Math.max(1, Math.round(n * k));
  const shadow = (y: number, blur: number): Shadow => ({ x: 0, y: px(y), blur: px(blur), color: "#000000" });
  const base: Partial<El> = { fill: "#ffffff", textAlign: "center", textFixed: false, fontFamily: CAPTION_FONTS[look], lineHeight: 1.15, letterSpacing: 0, caps: true, plate: undefined, spokenBox: undefined, spokenBold: undefined, arrive: undefined, font2: undefined, font2Words: undefined, breaks: undefined, sticker: undefined, drawnBox: undefined, copies: undefined, rainbow: undefined, shadow: null, stroke: null, strokeWidth: 1 };
  const edge = (n: number): Partial<El> => ({ stroke: "#000000", strokeWidth: px(n) });
  switch (look) {
    case "outline":
      return { ...base, fontSize: px(64), fontWeight: 900, ...edge(7), shadow: shadow(4, 10) };
    case "glow":
      return { ...base, fontSize: px(60), fontWeight: 800, caps: undefined, shadow: { x: 0, y: 0, blur: px(28), color: "#b49cff" } };
    case "dim":
      return { ...base, fill: "#ffffff73", fontSize: px(60), fontWeight: 900, shadow: shadow(3, 14) };
    case "quiet":
      return { ...base, fontSize: px(44), fontWeight: 500, caps: undefined, shadow: shadow(2, 12) };
    case "pill":
      return { ...base, fontSize: px(46), fontWeight: 700, caps: undefined, lineHeight: 1.5, plate: { fill: "#111013", radius: px(40), padX: px(26), padY: px(10) } };
    case "one":
      return { ...base, fontSize: px(120), fontWeight: 400, letterSpacing: px(2), ...edge(4), shadow: shadow(6, 16) };
    case "box":
      return { ...base, fontSize: px(52), fontWeight: 800, lineHeight: 1.5, spokenBox: true, plate: { fill: "#000000", radius: px(10), padX: px(12), padY: px(6), each: true } };
    case "line":
      return { ...base, fontSize: px(52), fontWeight: 800, lineHeight: 1.5, spokenBox: true, plate: { fill: "#000000", radius: px(12), padX: px(16), padY: px(8) } };
    case "there":
      return { ...base, fontSize: px(68), fontWeight: 900, ...edge(3), shadow: shadow(6, 0), font2: "Dancing Script", font2Words: "last" };
    case "highlight":
      return { ...base, fontSize: px(54), fontWeight: 600, caps: undefined, lineHeight: 1.4, spokenBox: true, spokenBold: true, shadow: shadow(2, 12) };
    case "plates":
      return { ...base, fill: "#111013", fontSize: px(64), fontWeight: 400, lineHeight: 1.45, arrive: "pop", plate: { fill: "#ffe14d", radius: px(6), padX: px(14), padY: px(4), each: true } };
    case "cursive":
      return { ...base, fontSize: px(60), fontWeight: 800, arrive: "word", font2: "Great Vibes", font2Words: "short", shadow: shadow(3, 14) };
    case "pen":
      return { ...base, fontSize: px(70), fontWeight: 700, caps: undefined, arrive: "word", drawnBox: "#ffffff", shadow: shadow(2, 10) };
    case "sticker":
      return { ...base, fill: "#ffe14d", fontSize: px(66), fontWeight: 400, arrive: "pop", sticker: "#ffffff", shadow: shadow(5, 12) };
    case "stack":
      return { ...base, fill: "#e5383b", fontSize: px(96), fontWeight: 400, lineHeight: 1, arrive: "word", breaks: "stack", shadow: shadow(4, 14) };
    case "rainbow":
      return { ...base, fontSize: px(68), fontWeight: 700, arrive: "pop", rainbow: true, copies: { n: 2, color: "#111013" } };
    default:
      return { ...base, fontSize: px(68), fontWeight: 900, ...edge(3), shadow: shadow(6, 0) };
  }
}

/** Where captions sit: low on a wide video, a little higher on a tall one, clear of the phone's buttons. */
export const captionMiddle = (frame: { width: number; height: number }) => Math.round(frame.height * (frame.height > frame.width ? 0.68 : 0.82));

/** The widest a caption gets before its words wrap: most of the frame, clear of the sides. */
export const captionRoom = (frame: { width: number }) => Math.round(frame.width * 0.84);

/** What makes a caption's look: changing one of these on a caption changes every caption in its video, so a video has one caption style. */
export const CAPTION_STYLE = ["fill", "gradient", "stroke", "strokeWidth", "opacity", "blend", "effects", "fontSize", "fontFamily", "fontWeight", "lineHeight", "letterSpacing", "caps", "shadow", "plate", "spokenFill", "spokenBox", "spokenBold", "arrive", "font2", "font2Words", "breaks", "sticker", "drawnBox", "copies", "rainbow"] as const;

/** Whether a text sits on its video's Captions track. */
export function isCaption(doc: Doc, id: string): boolean {
  const el = doc.elements[id];
  const parent = el?.parentId ? doc.elements[el.parentId] : null;
  return el?.type === "text" && !!el.track && !!parent?.tracks?.some((t) => t.id === el.track && t.name === CAPTIONS_TRACK);
}

/**
 * The texts a change reaches. A change to the look of a caption reaches every caption in its video;
 * anything else (its words, where it sits, when it shows) stays with the picked ones.
 */
export function captionMates(doc: Doc, ids: string[], props: object): string[] {
  const keys = Object.keys(props);
  if (!keys.length || !keys.every((k) => (CAPTION_STYLE as readonly string[]).includes(k))) return ids;
  const out = new Set(ids);
  for (const id of ids) {
    if (!isCaption(doc, id)) continue;
    const el = doc.elements[id];
    for (const c of doc.elements[el.parentId!].childIds) if (doc.elements[c]?.track === el.track && doc.elements[c].type === "text") out.add(c);
  }
  return [...out];
}

/** Every caption in a video, in the order they play. */
export function captionsIn(doc: Doc, sceneId: string | null | undefined): string[] {
  const scene = sceneId ? doc.elements[sceneId] : null;
  const track = scene?.tracks?.find((t) => t.name === CAPTIONS_TRACK);
  if (!scene || !track) return [];
  return scene.childIds.filter((id) => doc.elements[id]?.type === "text" && doc.elements[id].track === track.id);
}

/** The look a caption has, while it still is one: once its font, size, weight, outline or box changes, it is the designer's own. */
export function lookNow(el: El, frame: { width: number; height: number }): CaptionLook | null {
  const extras = ["font2", "font2Words", "breaks", "sticker", "drawnBox", "copies", "rainbow", "arrive", "spokenBox", "spokenBold"] as const;
  const same = (p: Partial<El>) =>
    p.fontFamily === el.fontFamily && p.fontSize === el.fontSize && p.fontWeight === el.fontWeight && (p.stroke ?? null) === (el.stroke ?? null) && !p.plate === !el.plate && !!p.plate?.each === !!el.plate?.each && (p.fill ?? "#ffffff") === el.fill && extras.every((k) => sameLook(p[k] || null, el[k] || null));
  return CAPTION_LOOKS.find((l) => same(captionProps(l.key, frame)))?.key ?? null;
}

/** A caption style the designer made, kept on this computer: its name (none yet shows as "Custom") and its style at 1080. */
export interface CustomLook {
  id: string;
  name: string | null;
  props: Partial<El>;
}

/** A caption style sized by k: a custom look is kept at 1080 and grows or shrinks to the video it is used on. */
export function sizeLook(props: Partial<El>, k: number): Partial<El> {
  const px = (n: number | undefined) => (n === undefined ? undefined : Math.max(0, Math.round(n * k * 100) / 100));
  const out: Partial<El> = { ...props };
  if (props.fontSize !== undefined) out.fontSize = Math.max(1, px(props.fontSize)!);
  if (props.letterSpacing !== undefined) out.letterSpacing = px(props.letterSpacing);
  if (props.strokeWidth !== undefined) out.strokeWidth = px(props.strokeWidth);
  if (props.shadow) out.shadow = { ...props.shadow, x: px(props.shadow.x)!, y: px(props.shadow.y)!, blur: px(props.shadow.blur)! };
  if (props.plate) out.plate = { ...props.plate, radius: px(props.plate.radius)!, padX: px(props.plate.padX)!, padY: px(props.plate.padY)! };
  return out;
}

/** A caption's style, only what makes its look, sized for 1080. */
export function lookOf(el: El, frame: { width: number; height: number }): Partial<El> {
  const style: Record<string, unknown> = {};
  for (const k of CAPTION_STYLE) if ((el as unknown as Record<string, unknown>)[k] !== undefined) style[k] = structuredClone((el as unknown as Record<string, unknown>)[k]);
  return sizeLook(style as Partial<El>, 1080 / Math.min(frame.width, frame.height));
}

/** Whether two styles are the same look; sizes may differ by rounding after a trip through a video of another size. */
export function sameLook(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.6;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return (a ?? null) === (b ?? null);
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) if (!sameLook(ra[k], rb[k])) return false;
  return true;
}

/**
 * The custom looks after the captions took a style. A style that is already a look changes nothing;
 * otherwise it goes into the one unnamed Custom look, made first if there is none.
 */
export function keepCustom(looks: CustomLook[], props: Partial<El>, id: () => string): CustomLook[] {
  if (looks.some((l) => sameLook(l.props, props))) return looks;
  const open = looks.find((l) => l.name === null);
  if (open) return looks.map((l) => (l === open ? { ...l, props } : l));
  return [{ id: id(), name: null, props }, ...looks];
}

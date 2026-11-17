import type { El, Shadow } from "./types";
import type { EditWord } from "./words";

/**
 * Captions (#71): the words heard in an edit, shown on the video a few at a time. Each caption is plain
 * text on a Captions track, so it can be moved, restyled or deleted like any other text.
 */

export type CaptionLook = "bold" | "quiet" | "pill" | "one" | "box" | "line" | "outline" | "glow" | "dim";

/** The looks, and the colour each one lights the spoken word in when it has its own. */
export const CAPTION_LOOKS: { key: CaptionLook; name: string; lit?: string }[] = [
  { key: "bold", name: "Bold pop" },
  { key: "quiet", name: "Quiet" },
  { key: "pill", name: "Pill" },
  { key: "one", name: "One word" },
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
};

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

/** Words grouped into captions of at most `per` words, broken at pauses and at the end of a sentence. */
export function captionChunks(words: EditWord[], per: number): CaptionChunk[] {
  const n = Math.max(1, Math.min(6, Math.round(per) || 1));
  const groups: EditWord[][] = [];
  let run: EditWord[] = [];
  for (const w of words) {
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
  const base: Partial<El> = { fill: "#ffffff", textAlign: "center", textFixed: false, fontFamily: CAPTION_FONTS[look], lineHeight: 1.15, letterSpacing: 0, caps: true, plate: undefined, spokenBox: undefined, shadow: null, stroke: null, strokeWidth: 1 };
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
      return { ...base, fontSize: px(120), fontWeight: 400, letterSpacing: px(2), ...edge(6), shadow: shadow(6, 16) };
    case "box":
      return { ...base, fontSize: px(52), fontWeight: 800, lineHeight: 1.5, spokenBox: true, plate: { fill: "#000000", radius: px(10), padX: px(12), padY: px(6), each: true } };
    case "line":
      return { ...base, fontSize: px(52), fontWeight: 800, lineHeight: 1.5, spokenBox: true, plate: { fill: "#000000", radius: px(12), padX: px(16), padY: px(8) } };
    default:
      return { ...base, fontSize: px(68), fontWeight: 900, ...edge(4), shadow: shadow(6, 0) };
  }
}

/** Where captions sit: low on a wide video, a little higher on a tall one, clear of the phone's buttons. */
export const captionMiddle = (frame: { width: number; height: number }) => Math.round(frame.height * (frame.height > frame.width ? 0.68 : 0.82));

/** The widest a caption gets before its words wrap: most of the frame, clear of the sides. */
export const captionRoom = (frame: { width: number }) => Math.round(frame.width * 0.84);

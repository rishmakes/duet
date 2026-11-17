import type { El } from "../document/types";

/** The face used when none is chosen: the system's own. */
export const FONT_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif`;
export const LINE_HEIGHT = 1.3;

let scratch: CanvasRenderingContext2D | null | undefined;
function ctx2d(): CanvasRenderingContext2D | null {
  if (scratch === undefined) scratch = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  return scratch;
}

/** Everything that decides how letters look and space out. */
export interface TextFace {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  /** A multiple of the font size. 0 means the default. */
  lineHeight: number;
  letterSpacing: number;
}

export const faceOf = (el: TextFace): TextFace => ({
  fontFamily: el.fontFamily,
  fontWeight: el.fontWeight,
  fontSize: el.fontSize,
  lineHeight: el.lineHeight,
  letterSpacing: el.letterSpacing,
});

/** The font as a canvas or CSS string. A chosen family comes first, then the system fonts. */
export function fontCss(f: Pick<TextFace, "fontFamily" | "fontWeight" | "fontSize">, size = f.fontSize): string {
  const family = f.fontFamily.trim() ? `"${f.fontFamily.replace(/"/g, "")}", ` : "";
  return `${f.fontWeight || 400} ${size}px ${family}${FONT_STACK}`;
}

export const lineStep = (f: Pick<TextFace, "fontSize" | "lineHeight">) => f.fontSize * (f.lineHeight || LINE_HEIGHT);

/**
 * The canvas hangs words from the top of their line. A typing box centres them in the line instead.
 * This is how far down (or, when negative, up) a typing box must move so its words sit where the
 * canvas draws them. In design pixels.
 */
export function textLift(f: TextFace): number {
  const c = ctx2d();
  if (!c) return 0;
  c.font = fontCss(f);
  c.textBaseline = "alphabetic";
  const m = c.measureText("Hg");
  c.textBaseline = "top";
  const fromTop = c.measureText("Hg").fontBoundingBoxAscent;
  c.textBaseline = "alphabetic";
  const rise = m.fontBoundingBoxAscent;
  const fall = m.fontBoundingBoxDescent;
  if (![rise, fall, fromTop].every(Number.isFinite)) return 0;
  // on the canvas the baseline sits (rise - fromTop) below the top; in a typing box it sits half the spare line space plus the rise below it
  return -fromTop - (lineStep(f) - rise - fall) / 2;
}

/** How far the baseline of a line sits below the top of that line on the canvas, in design pixels. */
export function baselineDrop(f: TextFace): number {
  const c = ctx2d();
  if (!c) return f.fontSize * 0.8;
  c.font = fontCss(f);
  c.textBaseline = "alphabetic";
  const rise = c.measureText("Hg").fontBoundingBoxAscent;
  c.textBaseline = "top";
  const fromTop = c.measureText("Hg").fontBoundingBoxAscent;
  c.textBaseline = "alphabetic";
  if (![rise, fromTop].every(Number.isFinite)) return f.fontSize * 0.8;
  return rise - fromTop;
}

/** How wide one line is, with the letter spacing added. */
export function lineWidth(text: string, f: TextFace): number {
  const c = ctx2d();
  let w: number;
  if (c) {
    c.font = fontCss(f);
    w = c.measureText(text).width;
  } else {
    w = text.length * f.fontSize * 0.55;
  }
  return w + Math.max(0, text.length - 1) * (f.letterSpacing || 0);
}

/** Break text into lines. Words wrap when a width is given. */
export function wrapLines(text: string, f: TextFace, maxWidth?: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (!maxWidth || maxWidth <= 0) {
      out.push(raw);
      continue;
    }
    let line = "";
    for (const word of raw.split(/(\s+)/)) {
      const tryLine = line + word;
      if (line && lineWidth(tryLine.trimEnd(), f) > maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = tryLine;
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** The lines of a piece of text and the box that holds them. */
export function layoutText(el: Pick<El, "text" | "width" | "textFixed"> & { caps?: boolean } & TextFace): { lines: string[]; width: number; height: number } {
  const lines = wrapLines(el.caps ? el.text.toUpperCase() : el.text, el, el.textFixed ? el.width : undefined);
  const widest = Math.max(0, ...lines.map((l) => lineWidth(l, el)));
  return {
    lines,
    width: el.textFixed ? el.width : Math.max(8, Math.ceil(widest) + 2),
    height: Math.max(1, Math.ceil(lines.length * lineStep(el))),
  };
}

/** The size a text element should have, given what it says and how it looks. */
export function fitText(el: El): { width: number; height: number } {
  const m = layoutText(el);
  return { width: m.width, height: m.height };
}

/** Plain measuring of a short label. Used for names on the canvas. */
export function measureText(text: string, fontSize: number, weight = 400): { width: number; height: number } {
  const lines = text.split("\n");
  const face = { fontFamily: "", fontWeight: weight, fontSize, lineHeight: 0, letterSpacing: 0 };
  const width = Math.max(...lines.map((l) => lineWidth(l, face)));
  return { width: Math.ceil(width), height: Math.ceil(lines.length * fontSize * LINE_HEIGHT) };
}

/** Fonts that most Macs and Windows computers already have. Any installed font name also works. */
export const COMMON_FONTS = [
  "Helvetica Neue",
  "Arial",
  "Avenir Next",
  "Futura",
  "Gill Sans",
  "Optima",
  "Verdana",
  "Trebuchet MS",
  "Tahoma",
  "Georgia",
  "Palatino",
  "Baskerville",
  "Didot",
  "Times New Roman",
  "American Typewriter",
  "Courier New",
  "Menlo",
  "Impact",
  "Inter",
  "Roboto",
];

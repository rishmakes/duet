import { ancestors, maskOf, turnOf, turnPoint, turnVector, worldBounds, worldRect } from "../document/geometry";
import { toAbs, trace } from "../document/path";
import type { Blend, Doc, El, Rect } from "../document/types";
import { seenDoc } from "../state/store";
import type { State } from "../state/store";
import { logError } from "../errorLog";
import { isLooseCopy } from "../document/components";
import { getPicture } from "../project/assets";
import { clipPicture, drawingVideoNow, madePicture } from "../video/clips";
import { graded } from "./grade";
import { applyEffects } from "./effects";
import { getChat } from "../ai/chat";
import { nameOf } from "../ai/names";
import { HANDLES } from "./handles";
import { agentColour } from "../ai/colours";
import { plainName } from "../ai/who";
import { RULER, rulerTicks } from "./guides";
import { getLayout } from "../ui/layout";
import { FONT_STACK, fontCss, layoutText, lineStep, lineWidth, measureText } from "./text";

/** How far each scrolling screen is scrolled while presenting. Empty in the editor. */
export const presentScroll: Record<string, number> = {};

export const COLORS = {
  bg: "#141417",
  dot: "#2a2a31",
  accent: "#7c5cff",
  guide: "#22d3ee",
  gap: "#ff4d8d",
  ruler: "#1c1c21",
  muted: "#8d8d98",
  white: "#ffffff",
};

const toScreen = (s: State, wx: number, wy: number) => ({
  x: wx * s.viewport.zoom + s.viewport.x,
  y: wy * s.viewport.zoom + s.viewport.y,
});

export function screenRect(s: State, r: Rect): Rect {
  const p = toScreen(s, r.x, r.y);
  return { x: p.x, y: p.y, width: r.width * s.viewport.zoom, height: r.height * s.viewport.zoom };
}

/** What is written above a screen on the canvas. A diamond marks components and their copies. */
export const labelText = (el: El) =>
  el.component ? `◆ ${el.name}` : el.type === "instance" ? `◇ ${el.name}` : el.duration > 0 ? `▶ ${el.name}  ${lengthText(el.duration)}` : el.name;

/** How long a scene plays, as minutes and seconds. */
export const lengthText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function labelRect(s: State, doc: Doc, id: string): Rect {
  const el = doc.elements[id];
  const sr = screenRect(s, worldRect(doc, id));
  const w = measureText(labelText(el), 12).width + 6;
  return { x: sr.x, y: sr.y - 20, width: w, height: 18 };
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rr > 0) ctx.roundRect(x, y, w, h, rr);
  else ctx.rect(x, y, w, h);
}

/** Gradient between two colours across a box, at an angle in degrees. */
export function makeGradient(ctx: CanvasRenderingContext2D, g: NonNullable<El["gradient"]>, x: number, y: number, w: number, h: number) {
  const a = (g.angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const grad = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  grad.addColorStop(0, g.from);
  grad.addColorStop(1, g.to);
  return grad;
}

/** Shadow sizes are in screen pixels, so they follow the zoom, and the direction follows the turn of the shape. */
function castShadow(ctx: CanvasRenderingContext2D, shadow: NonNullable<El["shadow"]>) {
  const m = ctx.getTransform();
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur * Math.hypot(m.a, m.b);
  ctx.shadowOffsetX = shadow.x * m.a + shadow.y * m.c;
  ctx.shadowOffsetY = shadow.x * m.b + shadow.y * m.d;
}

/** Draw on the screen as if a box were upright, while it is really turned around its middle. */
function turned(ctx: CanvasRenderingContext2D, r: Rect, deg: number, paint: () => void) {
  if (!deg) return paint();
  ctx.save();
  ctx.translate(r.x + r.width / 2, r.y + r.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.translate(-(r.x + r.width / 2), -(r.y + r.height / 2));
  paint();
  ctx.restore();
}

/** A drawn line: filled if it is closed, stroked, with an optional shadow. */
function drawLine(ctx: CanvasRenderingContext2D, el: El, x: number, y: number) {
  const nodes = toAbs(el, x, y);
  if (nodes.length < 2) return;
  ctx.beginPath();
  trace(ctx, nodes, el.closed);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const shadow = () => {
    if (el.shadow) castShadow(ctx, el.shadow);
  };
  const noShadow = () => {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  };
  if (el.closed) {
    ctx.fillStyle = el.gradient ? makeGradient(ctx, el.gradient, x, y, el.width, el.height) : el.fill;
    shadow();
    ctx.fill();
    noShadow();
  }
  if (el.stroke && el.strokeWidth > 0) {
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth;
    if (!el.closed) shadow();
    ctx.stroke();
    noShadow();
  }
}

/** The Before window in Colour draws pictures and clips as they came, without their colour. */
let plain = false;
export const setPlainPictures = (on: boolean) => void (plain = on);
const gradeOf = (el: El) => (plain ? null : el.grade);
/** A picture or clip as it is drawn: with its colour, or as it came in the Before window, and then with its effects. */
const coloured = (pic: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement, el: El, still: string | null): CanvasImageSource => {
  const g = (plain ? pic : graded(pic, el.grade, still)) as HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
  return applyEffects(g, el.effects, el, still);
};

/** Pictures with rounded corners and a shadow, already cut to shape. Kept so they are not cut again on every repaint. */
const cutSheets = new Map<string, HTMLCanvasElement>();

/** The picture laid into its box without stretching (the extra is cropped), with the corners cut. */
function layPicture(ctx: CanvasRenderingContext2D, pic: HTMLImageElement, el: El, x: number, y: number) {
  ctx.save();
  try {
    roundedPath(ctx, x, y, el.width, el.height, el.radius);
    ctx.clip();
    const scale = Math.max(el.width / pic.naturalWidth, el.height / pic.naturalHeight);
    const w = pic.naturalWidth * scale;
    const h = pic.naturalHeight * scale;
    ctx.drawImage(coloured(pic, el, el.src), x + (el.width - w) / 2, y + (el.height - h) / 2, w, h);
  } finally {
    ctx.restore();
  }
}

/**
 * A picture. Nothing is painted behind it, so the see-through parts of a logo stay see-through,
 * and its shadow follows what is really there instead of the box around it.
 */
function drawImage(ctx: CanvasRenderingContext2D, el: El, x: number, y: number) {
  const pic = getPicture(el.src);
  if (!pic || !pic.naturalWidth || !pic.naturalHeight) {
    // a quiet box stands in until the picture has loaded
    roundedPath(ctx, x, y, el.width, el.height, el.radius);
    ctx.fillStyle = "#2a2a31";
    ctx.fill();
  } else {
    try {
      if (!el.shadow) {
        layPicture(ctx, pic, el, x, y);
      } else {
        // A shadow cannot be cast through a cut-out, so the picture is cut to shape on a spare sheet
        // first, at the sharpness it will be seen at, and then laid down with its shadow.
        const m = ctx.getTransform();
        const k = Math.hypot(m.a, m.b) || 1;
        const w = Math.max(1, Math.min(4096, Math.ceil(el.width * k)));
        const h = Math.max(1, Math.min(4096, Math.ceil(el.height * k)));
        const key = `${el.src}|${el.width}|${el.height}|${el.radius}|${w}x${h}|${gradeOf(el) ? JSON.stringify(el.grade) : ""}|${el.effects?.length ? JSON.stringify(el.effects) : ""}`;
        let sheet = cutSheets.get(key);
        if (!sheet) {
          sheet = document.createElement("canvas");
          sheet.width = w;
          sheet.height = h;
          const c = sheet.getContext("2d");
          if (c) {
            c.scale(w / el.width, h / el.height);
            layPicture(c, pic, el, 0, 0);
          }
          if (cutSheets.size > 40) cutSheets.clear();
          cutSheets.set(key, sheet);
        }
        castShadow(ctx, el.shadow);
        ctx.drawImage(sheet, x, y, el.width, el.height);
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }
    } catch (e) {
      logError("draw picture", e);
    }
  }
  if (el.stroke && el.strokeWidth > 0) {
    roundedPath(ctx, x, y, el.width, el.height, el.radius);
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth;
    ctx.stroke();
  }
}

/** A video clip, at the moment its player is on. It fills its box and what does not fit is cut off. */
/** Where a clip with a blend is copied before it is drawn. */
let blendSheet: HTMLCanvasElement | null = null;

function drawClip(ctx: CanvasRenderingContext2D, el: El, x: number, y: number) {
  // while a video is made, the picture comes from the export engine, read from the clip's own file
  const pic = drawingVideoNow() ? madePicture(el.id) : clipPicture(el.src);
  ctx.save();
  roundedPath(ctx, x, y, el.width, el.height, el.radius);
  ctx.clip();
  ctx.fillStyle = "#000000";
  ctx.fillRect(x, y, el.width, el.height);
  const pw = pic instanceof HTMLVideoElement ? pic.videoWidth : (pic?.width ?? 0);
  const ph = pic instanceof HTMLVideoElement ? pic.videoHeight : (pic?.height ?? 0);
  if (pic && pw && ph) {
    try {
      const k = Math.max(el.width / pw, el.height / ph);
      const w = pw * k;
      const h = ph * k;
      const frame = coloured(pic, el, null);
      if (ctx.globalCompositeOperation === "source-over") {
        ctx.drawImage(frame, x + (el.width - w) / 2, y + (el.height - h) / 2, w, h);
      } else {
        // the web view ignores a blend when a video's picture is drawn straight in, so the picture is copied to a canvas first
        const sheet = blendSheet ?? (blendSheet = document.createElement("canvas"));
        const cw = Math.max(1, Math.ceil(el.width));
        const ch = Math.max(1, Math.ceil(el.height));
        if (sheet.width !== cw || sheet.height !== ch) {
          sheet.width = cw;
          sheet.height = ch;
        }
        const bctx = sheet.getContext("2d");
        if (bctx) {
          bctx.clearRect(0, 0, cw, ch);
          bctx.drawImage(frame, (el.width - w) / 2, (el.height - h) / 2, w, h);
          ctx.drawImage(sheet, x, y, el.width, el.height);
        }
      }
    } catch (e) {
      logError("draw clip", e);
    }
  }
  ctx.restore();
}

/** From here on, draw only inside a shape. ox and oy are where the shape's parent sits. */
function clipTo(ctx: CanvasRenderingContext2D, shape: El, ox: number, oy: number) {
  const x = ox + shape.x;
  const y = oy + shape.y;
  // the outline is laid down turned the way the shape is turned, and the drawing carries on upright
  const upright = ctx.getTransform();
  const turn = turnOf(shape);
  if (turn) {
    ctx.translate(x + shape.width / 2, y + shape.height / 2);
    ctx.rotate((turn * Math.PI) / 180);
    ctx.translate(-(x + shape.width / 2), -(y + shape.height / 2));
  }
  if (shape.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + shape.width / 2, y + shape.height / 2, shape.width / 2, shape.height / 2, 0, 0, Math.PI * 2);
  } else if (shape.type === "path") {
    ctx.beginPath();
    trace(ctx, toAbs(shape, x, y), true);
  } else {
    roundedPath(ctx, x, y, shape.width, shape.height, shape.radius);
  }
  ctx.setTransform(upright);
  ctx.clip();
}

/** Scratch canvases for soft masks, one set per level of masks inside masks, so they are not made again for every picture. */
const scratch: { layer: HTMLCanvasElement; shape: HTMLCanvasElement }[] = [];
let maskDepth = 0;

function scratchAt(depth: number, w: number, h: number) {
  const made = scratch[depth] ?? (scratch[depth] = { layer: document.createElement("canvas"), shape: document.createElement("canvas") });
  for (const c of [made.layer, made.shape]) {
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }
  return made;
}

/** Lay down a shape's outline, turned the way the shape is turned, then give it to paint. The drawing carries on upright. */
function withOutline(ctx: CanvasRenderingContext2D, shape: El, ox: number, oy: number, paint: () => void) {
  const x = ox + shape.x;
  const y = oy + shape.y;
  ctx.save();
  const turn = turnOf(shape);
  if (turn) {
    ctx.translate(x + shape.width / 2, y + shape.height / 2);
    ctx.rotate((turn * Math.PI) / 180);
    ctx.translate(-(x + shape.width / 2), -(y + shape.height / 2));
  }
  ctx.beginPath();
  if (shape.type === "ellipse") ctx.ellipse(x + shape.width / 2, y + shape.height / 2, shape.width / 2, shape.height / 2, 0, 0, Math.PI * 2);
  else if (shape.type === "path") trace(ctx, toAbs(shape, x, y), true);
  else roundedPath(ctx, x, y, shape.width, shape.height, shape.radius);
  paint();
  ctx.restore();
}

/** What a mask with a soft edge, a grown or shrunk shape, or turned inside out shows: the group's contents seen through it. */
function drawSoftMask(ctx: CanvasRenderingContext2D, doc: Doc, group: El, mask: El, x: number, y: number) {
  const t = ctx.getTransform();
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const { layer, shape } = scratchAt(maskDepth, w, h);
  const lctx = layer.getContext("2d")!;
  const sctx = shape.getContext("2d")!;
  const depth = maskDepth++;
  try {
    // the contents first: masks inside them use the next level of scratch canvases
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, w, h);
    lctx.setTransform(t);
    for (const id of group.childIds) {
      const child = doc.elements[id];
      if (child && child !== mask) drawElement(lctx, doc, child, x, y);
    }
    // the shape alone, grown or shrunk
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, w, h);
    sctx.setTransform(t);
    sctx.fillStyle = "#000";
    sctx.strokeStyle = "#000";
    sctx.lineJoin = "round";
    const grow = group.maskGrow;
    withOutline(sctx, mask, x, y, () => {
      sctx.fill();
      if (grow > 0) {
        sctx.lineWidth = grow * 2;
        sctx.stroke();
      } else if (grow < 0) {
        sctx.globalCompositeOperation = "destination-out";
        sctx.lineWidth = -grow * 2;
        sctx.stroke();
        sctx.globalCompositeOperation = "source-over";
      }
    });
    // keep (or throw away) what is under the shape, softened at its edge
    const soft = group.maskFeather * Math.hypot(t.a, t.b);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = group.maskInvert ? "destination-out" : "destination-in";
    lctx.filter = soft > 0.01 ? `blur(${soft}px)` : "none";
    lctx.drawImage(shape, 0, 0);
    lctx.filter = "none";
    lctx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  } finally {
    maskDepth = depth;
  }
}

/** What each blend mode is called to the canvas. */
const BLEND_OP: Record<Blend, GlobalCompositeOperation> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  "soft-light": "soft-light",
  darken: "darken",
  lighten: "lighten",
  add: "lighter",
};

/** The text being typed into right now on the canvas, if any. Set only while the editor's canvas is painted. */
let typingId: string | null = null;

/** Draw an element and everything inside it. ox and oy are where its parent sits. */
export function drawElement(ctx: CanvasRenderingContext2D, doc: Doc, el: El, ox: number, oy: number) {
  // a sound is only heard, and a hidden thing is not drawn anywhere
  if (el.type === "sound" || el.hidden) return;
  const x = ox + el.x;
  const y = oy + el.y;
  ctx.save();
  ctx.globalAlpha *= el.opacity;
  if (el.blend && el.blend !== "normal") ctx.globalCompositeOperation = BLEND_OP[el.blend];
  const turn = turnOf(el);
  if (turn) {
    ctx.translate(x + el.width / 2, y + el.height / 2);
    ctx.rotate((turn * Math.PI) / 180);
    ctx.translate(-(x + el.width / 2), -(y + el.height / 2));
  }

  if (el.type === "text") {
    // while its words are being typed, the typing box shows them instead
    if (el.id === typingId) {
      ctx.restore();
      return;
    }
    ctx.fillStyle = el.fill;
    ctx.font = fontCss(el);
    ctx.textBaseline = "top";
    const { lines } = layoutText(el);
    const step = lineStep(el);
    lines.forEach((line, i) => {
      const w = lineWidth(line, el);
      const dx = el.textAlign === "center" ? (el.width - w) / 2 : el.textAlign === "right" ? el.width - w : 0;
      if (!el.letterSpacing) {
        ctx.fillText(line, x + dx, y + i * step);
        return;
      }
      // letter by letter, so the spacing shows on every computer
      let cx = x + dx;
      for (const ch of line) {
        ctx.fillText(ch, cx, y + i * step);
        cx += ctx.measureText(ch).width + el.letterSpacing;
      }
    });
    ctx.restore();
    return;
  }

  // a mask shows what is in the group only inside its shape, and the shape itself is not drawn
  const mask = maskOf(doc, el);
  if (el.type === "group" || mask || isLooseCopy(doc, el)) {
    if (mask && (el.maskFeather || el.maskInvert || el.maskGrow)) {
      drawSoftMask(ctx, doc, el, mask, x, y);
      ctx.restore();
      return;
    }
    if (mask) clipTo(ctx, mask, x, y);
    for (const id of el.childIds) {
      const child = doc.elements[id];
      if (child && child !== mask) drawElement(ctx, doc, child, x, y);
    }
    ctx.restore();
    return;
  }

  if (el.type === "path") {
    drawLine(ctx, el, x, y);
    ctx.restore();
    return;
  }

  if (el.type === "image") {
    drawImage(ctx, el, x, y);
    ctx.restore();
    return;
  }

  if (el.type === "video") {
    drawClip(ctx, el, x, y);
    ctx.restore();
    return;
  }

  if (el.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + el.width / 2, y + el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
  } else {
    roundedPath(ctx, x, y, el.width, el.height, el.radius);
  }
  ctx.fillStyle = el.gradient ? makeGradient(ctx, el.gradient, x, y, el.width, el.height) : el.fill;
  if (el.shadow) castShadow(ctx, el.shadow);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  if (el.stroke && el.strokeWidth > 0) {
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth;
    ctx.stroke();
  }

  if (el.childIds.length) {
    ctx.save();
    if (el.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(x + el.width / 2, y + el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
    } else {
      roundedPath(ctx, x, y, el.width, el.height, el.radius);
    }
    ctx.clip();
    const scrolled = presentScroll[el.id] ?? 0;
    if (scrolled) ctx.translate(0, -scrolled);
    for (const id of el.childIds) {
      const child = doc.elements[id];
      if (child) drawElement(ctx, doc, child, x, y);
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Dots that show up on the canvas colour, lighter on dark and darker on light. */
function dotColour(bg?: string): string {
  if (!bg) return COLORS.dot;
  const hex = bg.length === 4 ? bg.replace(/[0-9a-f]/gi, (c) => c + c).slice(1) : bg.slice(1);
  const n = parseInt(hex, 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.5 ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.14)";
}

function drawGrid(ctx: CanvasRenderingContext2D, s: State, w: number, h: number, bg?: string) {
  const { zoom, x, y } = s.viewport;
  let step = 24;
  while (step * zoom < 14) step *= 2;
  const sp = step * zoom;
  const startX = ((x % sp) + sp) % sp;
  const startY = ((y % sp) + sp) % sp;
  ctx.fillStyle = dotColour(bg);
  for (let px = startX; px < w; px += sp) {
    for (let py = startY; py < h; py += sp) ctx.fillRect(Math.round(px), Math.round(py), 1.5, 1.5);
  }
}

/** Duet's own AI, the same orange as in the history line. */
const DUET_ORANGE = "#ff8a5c";

function pill(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number) {
  ctx.font = `600 11px ${FONT_STACK}`;
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = COLORS.accent;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, y, w, 18, 5);
  ctx.fill();
  ctx.fillStyle = COLORS.white;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, cx, y + 9.5);
  ctx.textAlign = "left";
}

/** A small label on the canvas, like the one that shows the size of what is being drawn. */
function tag(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, colour: string) {
  ctx.font = `600 10px ${FONT_STACK}`;
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, y - 2, w, 14, 4);
  ctx.fill();
  ctx.fillStyle = COLORS.white;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, cx, y + 5.5);
  ctx.textAlign = "left";
}

/** The rulers along the top and the left, the ruler guides across the canvas, and the number on a guide being pulled. */
function drawRulers(ctx: CanvasRenderingContext2D, s: State, doc: Doc, w: number, h: number) {
  const z = s.viewport.zoom;
  // guides first, so the rulers sit on top of their ends
  ctx.lineWidth = 1;
  ctx.strokeStyle = COLORS.gap;
  for (const gx of doc.guides?.x ?? []) {
    const sx = Math.round(gx * z + s.viewport.x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(sx, RULER);
    ctx.lineTo(sx, h);
    ctx.stroke();
  }
  for (const gy of doc.guides?.y ?? []) {
    const sy = Math.round(gy * z + s.viewport.y) + 0.5;
    ctx.beginPath();
    ctx.moveTo(RULER, sy);
    ctx.lineTo(w, sy);
    ctx.stroke();
  }
  // the strips
  ctx.fillStyle = COLORS.ruler;
  ctx.fillRect(0, 0, w, RULER);
  ctx.fillRect(0, 0, RULER, h);
  ctx.strokeStyle = "#2c2c33";
  ctx.beginPath();
  ctx.moveTo(0, RULER + 0.5);
  ctx.lineTo(w, RULER + 0.5);
  ctx.moveTo(RULER + 0.5, 0);
  ctx.lineTo(RULER + 0.5, h);
  ctx.stroke();
  ctx.fillStyle = COLORS.muted;
  ctx.strokeStyle = "#55555f";
  ctx.font = `500 9px ${FONT_STACK}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const t of rulerTicks((RULER - s.viewport.x) / z, (w - s.viewport.x) / z, z)) {
    const sx = Math.round(t.at * z + s.viewport.x) + 0.5;
    if (sx < RULER) continue;
    ctx.beginPath();
    ctx.moveTo(sx, RULER);
    ctx.lineTo(sx, t.major ? 6 : RULER - 4);
    ctx.stroke();
    if (t.major) ctx.fillText(String(Math.round(t.at)), sx + 3, 10);
  }
  for (const t of rulerTicks((RULER - s.viewport.y) / z, (h - s.viewport.y) / z, z)) {
    const sy = Math.round(t.at * z + s.viewport.y) + 0.5;
    if (sy < RULER) continue;
    ctx.beginPath();
    ctx.moveTo(RULER, sy);
    ctx.lineTo(t.major ? 6 : RULER - 4, sy);
    ctx.stroke();
    if (t.major) {
      ctx.save();
      ctx.translate(10, sy + 3);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(String(Math.round(t.at)), 0, 0);
      ctx.restore();
    }
  }
  ctx.fillStyle = COLORS.ruler;
  ctx.fillRect(0, 0, RULER, RULER);
  // while a guide is pulled, its place
  const now = s.overlay.guideNow;
  if (now) {
    const p = now.axis === "x" ? now.at * z + s.viewport.x : now.at * z + s.viewport.y;
    if (now.axis === "x") tag(ctx, String(Math.round(now.at)), p, RULER + 4, COLORS.gap);
    else tag(ctx, String(Math.round(now.at)), RULER + 22, p - 7, COLORS.gap);
  }
}

/** Beside the chat the canvas only looks, so it does not tell you to draw. */
let quiet = false;
export const setQuietCanvas = (on: boolean) => void (quiet = on);

/** Beside the chat you can look at one frame alone: only it is drawn, and only it can be picked. */
let only: string | null = null;
export const setOnlyFrame = (id: string | null) => void (only = id);

/** In Motion the scene being made is all there is: nothing around it is drawn or picked. */
let sceneOnly: string | null = null;
export const setSceneOnly = (id: string | null) => void (sceneOnly = id);
const alone = (doc: Doc) => (sceneOnly && doc.elements[sceneOnly] ? sceneOnly : only && doc.elements[only] ? only : null);

/** Whether a thing is on show: everything, or the one frame being looked at and what is inside it. */
export function shownOn(doc: Doc, id: string): boolean {
  const one = alone(doc);
  if (!one) return true;
  return id === one || ancestors(doc, id).includes(one);
}
const shownRoots = (doc: Doc) => {
  const one = alone(doc);
  return one ? [one] : doc.rootIds;
};

/** How far down the canvas a label sits at least, so the bar floating along its top does not cover it. */
const LABEL_CLEAR = 64;

export function draw(ctx: CanvasRenderingContext2D, s: State, w: number, h: number, dpr: number) {
  const doc = seenDoc(s);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = doc.background ?? COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, s, w, h, doc.background);

  // world space
  ctx.save();
  ctx.translate(s.viewport.x, s.viewport.y);
  ctx.scale(s.viewport.zoom, s.viewport.zoom);
  typingId = s.editingId;
  try {
    for (const id of shownRoots(doc)) {
      const el = doc.elements[id];
      if (el) drawElement(ctx, doc, el, 0, 0);
    }
  } finally {
    typingId = null;
  }
  ctx.restore();

  // screen space from here
  ctx.lineWidth = 1;

  // in Motion and Colour the scene being worked on stands out and the rest of the board goes quiet
  const open = s.clock.scene ? doc.elements[s.clock.scene] : null;
  if (open) {
    const r = screenRect(s, worldRect(doc, open.id));
    ctx.save();
    ctx.fillStyle = COLORS.bg;
    ctx.globalAlpha = 0.78;
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(r.x, r.y, r.width, r.height);
    ctx.fill("evenodd");
    ctx.restore();
  }

  // frame names
  ctx.font = `500 12px ${FONT_STACK}`;
  ctx.textBaseline = "alphabetic";
  for (const id of shownRoots(doc)) {
    const el = doc.elements[id];
    if (!el || (el.type !== "frame" && el.type !== "instance")) continue;
    const sr = screenRect(s, worldRect(doc, id));
    ctx.fillStyle = s.selection.includes(id) || el.component ? COLORS.accent : COLORS.muted;
    ctx.fillText(labelText(el), sr.x, sr.y - 7);
  }

  // hover outline
  const hover = s.overlay.hoverId;
  if (hover && doc.elements[hover] && !s.selection.includes(hover) && !s.overlay.draft) {
    const r = screenRect(s, worldRect(doc, hover));
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1;
    turned(ctx, r, turnOf(doc.elements[hover]), () => ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width, r.height));
  }

  // selection
  const sel = s.selection.filter((id) => doc.elements[id]);
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 1.5;
  for (const id of sel) {
    const r = screenRect(s, worldRect(doc, id));
    turned(ctx, r, turnOf(doc.elements[id]), () => ctx.strokeRect(r.x, r.y, r.width, r.height));
  }
  // where the AI has been pointed: a dashed outline and a small label, so it is plain what it is looking at
  const focused = s.focus.filter((id) => doc.elements[id]);
  if (focused.length) {
    ctx.save();
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    for (const id of focused) {
      const r = screenRect(s, worldBounds(doc, id));
      ctx.strokeRect(r.x - 4, r.y - 4, r.width + 8, r.height + 8);
    }
    ctx.restore();
    const boxes = focused.map((id) => screenRect(s, worldBounds(doc, id)));
    pill(ctx, "AI focus", (Math.min(...boxes.map((r) => r.x)) + Math.max(...boxes.map((r) => r.x + r.width))) / 2, Math.min(...boxes.map((r) => r.y)) - 30);
  }
  // where an AI is working right now: a faint rectangle in its colour, so the designer can work elsewhere
  const working = s.aiWork?.ids.filter((id) => doc.elements[id]) ?? [];
  const claimed = s.aiWork?.area;
  if (working.length || claimed) {
    const boxes = working.map((id) => screenRect(s, worldBounds(doc, id)));
    if (claimed) boxes.push(screenRect(s, claimed));
    // roomy and tinted, so it reads as "the AI is busy here" and people leave it be; nothing is locked
    const pad = 48;
    const x = Math.min(...boxes.map((r) => r.x)) - pad;
    const y = Math.min(...boxes.map((r) => r.y)) - pad;
    const w = Math.max(...boxes.map((r) => r.x + r.width)) + pad - x;
    const h = Math.max(...boxes.map((r) => r.y + r.height)) + pad - y;
    const by = s.aiWork?.by;
    const colour = by ? agentColour(plainName(by)) : DUET_ORANGE;
    ctx.save();
    ctx.fillStyle = colour;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 16);
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.stroke();
    // a flat glass shine, one wide band and one thin, sweeps across now and then while the AI works
    const cycle = 3200;
    const run = (Date.now() % cycle) / cycle;
    if (run < 0.6) {
      const slant = h * 0.18;
      const travel = w + slant + 160;
      const left = x - slant - 120 + (run / 0.6) * travel;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 14);
      ctx.clip();
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.16;
      const band = (from: number, width: number) => {
        ctx.beginPath();
        ctx.moveTo(from + slant, y);
        ctx.lineTo(from + slant + width, y);
        ctx.lineTo(from + width, y + h);
        ctx.lineTo(from, y + h);
        ctx.closePath();
        ctx.fill();
      };
      band(left, 70);
      band(left + 92, 18);
      ctx.restore();
    }
    ctx.fillStyle = colour;
    // the label sits on the top edge, in the AI's colour
    const label = `${by ? nameOf(by, getChat().names) : "Duet"} ${working.length ? "is working here" : "is getting ready"}`;
    ctx.globalAlpha = 1;
    ctx.font = `600 12px ${FONT_STACK}`;
    const lw = ctx.measureText(label).width + 16;
    // the bar along the top of the canvas would hide it there, so it slides down the box, never out of it
    const ly = Math.max(y, Math.min(LABEL_CLEAR, y + h - 12));
    ctx.beginPath();
    ctx.roundRect(x + 14, ly - 11, lw, 22, 11);
    ctx.fill();
    ctx.fillStyle = "#101014";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 22, ly + 0.5);
    ctx.restore();
  }
  if (sel.length === 1 && !s.overlay.nodeEdit) {
    const r = screenRect(s, worldRect(doc, sel[0]));
    turned(ctx, r, turnOf(doc.elements[sel[0]]), () => {
      for (const hd of HANDLES) {
        const hx = r.x + r.width * hd.fx;
        const hy = r.y + r.height * hd.fy;
        ctx.fillStyle = COLORS.white;
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(hx - 4, hy - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }
    });
  }
  if (sel.length > 1 && !s.overlay.nodeEdit) {
    // several picked things share one set of handles, on the box around them all
    const boxes = sel.map((id) => screenRect(s, worldBounds(doc, id)));
    const bx = Math.min(...boxes.map((r) => r.x));
    const by = Math.min(...boxes.map((r) => r.y));
    const r = { x: bx, y: by, width: Math.max(...boxes.map((b) => b.x + b.width)) - bx, height: Math.max(...boxes.map((b) => b.y + b.height)) - by };
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x, r.y, r.width, r.height);
    for (const hd of HANDLES) {
      const hx = r.x + r.width * hd.fx;
      const hy = r.y + r.height * hd.fy;
      ctx.fillStyle = COLORS.white;
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(hx - 4, hy - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    }
  }
  if (sel.length > 0) {
    const rects = sel.map((id) => screenRect(s, worldBounds(doc, id)));
    const x1 = Math.min(...rects.map((r) => r.x));
    const x2 = Math.max(...rects.map((r) => r.x + r.width));
    const y2 = Math.max(...rects.map((r) => r.y + r.height));
    // one thing shows its own size, however it is turned; several show the box around them all
    const wr = sel.map((id) => (sel.length === 1 ? worldRect(doc, id) : worldBounds(doc, id)));
    const ww = Math.max(...wr.map((r) => r.x + r.width)) - Math.min(...wr.map((r) => r.x));
    const wh = Math.max(...wr.map((r) => r.y + r.height)) - Math.min(...wr.map((r) => r.y));
    // while something is being turned, show the angle instead of the size
    const turning = s.overlay.turning;
    pill(ctx, turning !== null ? `${turning}°` : `${Math.round(ww)} × ${Math.round(wh)}`, (x1 + x2) / 2, y2 + 10);
  }

  // where the selected thing leads when presenting: an arrow to that screen
  for (const id of s.selection) {
    const el = doc.elements[id];
    const target = el?.link ? doc.elements[el.link] : null;
    if (!el || !target || target.type !== "frame") continue;
    const a = screenRect(s, worldRect(doc, id));
    const b = screenRect(s, worldRect(doc, target.id));
    const from = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const goesRight = b.x > a.x + a.width / 2;
    const to = { x: goesRight ? b.x : b.x + b.width, y: Math.max(b.y + 24, Math.min(b.y + b.height - 24, from.y)) };
    const bend = Math.max(40, Math.abs(to.x - from.x) / 2);
    ctx.strokeStyle = COLORS.accent;
    ctx.fillStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash(el.linkKind === "overlay" ? [6, 5] : []);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(from.x + (goesRight ? bend : -bend), from.y, to.x + (goesRight ? -bend : bend), to.y, to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const dir = goesRight ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - dir * 9, to.y - 5);
    ctx.lineTo(to.x - dir * 9, to.y + 5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(from.x, from.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // the points of a line being edited
  const ne = s.overlay.nodeEdit;
  if (ne && doc.elements[ne.id]?.type === "path") {
    const el = doc.elements[ne.id];
    const at = worldRect(doc, ne.id);
    const turn = turnOf(el);
    const nodes = toAbs(el, at.x, at.y).map((n) => {
      // the points follow the turn of the shape
      const p = turnPoint(n.x, n.y, at.x + at.width / 2, at.y + at.height / 2, turn);
      const a = toScreen(s, p.x, p.y);
      const z = s.viewport.zoom;
      const i = turnVector(n.ix, n.iy, turn);
      const o = turnVector(n.ox, n.oy, turn);
      return { x: a.x, y: a.y, ix: i.x * z, iy: i.y * z, ox: o.x * z, oy: o.y * z };
    });
    nodes.forEach((n, i) => {
      const chosen = ne.selected.includes(i);
      if (chosen && (n.ox || n.oy || n.ix || n.iy)) {
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(n.x + n.ix, n.y + n.iy);
        ctx.lineTo(n.x, n.y);
        ctx.lineTo(n.x + n.ox, n.y + n.oy);
        ctx.stroke();
        for (const [hx, hy, on] of [[n.x + n.ix, n.y + n.iy, n.ix || n.iy], [n.x + n.ox, n.y + n.oy, n.ox || n.oy]] as const) {
          if (!on) continue;
          ctx.fillStyle = COLORS.white;
          ctx.strokeStyle = COLORS.accent;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(hx, hy, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.fillStyle = chosen ? COLORS.accent : COLORS.white;
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(n.x - 4, n.y - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    });
  }

  // the line being drawn with the pen
  const pen = s.overlay.pen;
  if (pen && pen.nodes.length) {
    const nodes = pen.nodes.map((n) => {
      const a = toScreen(s, n.x, n.y);
      return { x: a.x, y: a.y, ix: n.ix * s.viewport.zoom, iy: n.iy * s.viewport.zoom, ox: n.ox * s.viewport.zoom, oy: n.oy * s.viewport.zoom };
    });
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    trace(ctx, nodes, false);
    ctx.stroke();
    if (pen.cursor) {
      // the next piece, from the last point to the pointer
      const last = nodes[nodes.length - 1];
      const c = toScreen(s, pen.cursor.x, pen.cursor.y);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      if (last.ox || last.oy) ctx.bezierCurveTo(last.x + last.ox, last.y + last.oy, c.x, c.y, c.x, c.y);
      else ctx.lineTo(c.x, c.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    nodes.forEach((n, i) => {
      if (n.ox || n.oy) {
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(n.x + n.ix, n.y + n.iy);
        ctx.lineTo(n.x + n.ox, n.y + n.oy);
        ctx.stroke();
        for (const [hx, hy] of [[n.x + n.ix, n.y + n.iy], [n.x + n.ox, n.y + n.oy]]) {
          ctx.fillStyle = COLORS.accent;
          ctx.beginPath();
          ctx.arc(hx, hy, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = i === 0 && nodes.length >= 2 ? COLORS.accent : COLORS.white;
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(n.x - 4, n.y - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    });
  }

  // draft shape
  if (s.overlay.draft) {
    const r = screenRect(s, s.overlay.draft.rect);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.5;
    if (s.overlay.draft.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(r.x, r.y, r.width, r.height);
    }
    pill(ctx, `${Math.round(s.overlay.draft.rect.width)} × ${Math.round(s.overlay.draft.rect.height)}`, r.x + r.width / 2, r.y + r.height + 10);
  }

  // marquee
  if (s.overlay.marquee) {
    const r = screenRect(s, s.overlay.marquee);
    ctx.fillStyle = "rgba(124,92,255,.12)";
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width, r.height);
  }

  // snapping guides
  ctx.strokeStyle = COLORS.guide;
  ctx.lineWidth = 1;
  for (const gx of s.overlay.guidesX) {
    const sx = Math.round(toScreen(s, gx, 0).x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ctx.stroke();
  }
  for (const gy of s.overlay.guidesY) {
    const sy = Math.round(toScreen(s, 0, gy).y) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
    ctx.stroke();
  }

  // measured gaps while something moves: a line across each space with its size
  for (const g of s.overlay.gaps) {
    const a = g.axis === "x" ? toScreen(s, g.from, g.at) : toScreen(s, g.at, g.from);
    const b = g.axis === "x" ? toScreen(s, g.to, g.at) : toScreen(s, g.at, g.to);
    ctx.strokeStyle = COLORS.gap;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
    ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
    const cap = 3;
    if (g.axis === "x") {
      ctx.moveTo(Math.round(a.x) + 0.5, a.y - cap);
      ctx.lineTo(Math.round(a.x) + 0.5, a.y + cap);
      ctx.moveTo(Math.round(b.x) + 0.5, b.y - cap);
      ctx.lineTo(Math.round(b.x) + 0.5, b.y + cap);
    } else {
      ctx.moveTo(a.x - cap, Math.round(a.y) + 0.5);
      ctx.lineTo(a.x + cap, Math.round(a.y) + 0.5);
      ctx.moveTo(b.x - cap, Math.round(b.y) + 0.5);
      ctx.lineTo(b.x + cap, Math.round(b.y) + 0.5);
    }
    ctx.stroke();
    tag(ctx, String(Math.round(g.to - g.from)), (a.x + b.x) / 2, (a.y + b.y) / 2 - (g.axis === "x" ? 16 : 0), COLORS.gap);
  }

  if (getLayout().rulers && !quiet) drawRulers(ctx, s, doc, w, h);

  // empty hint, but not while an AI is at work: the canvas is about to fill
  if (doc.rootIds.length === 0 && !s.overlay.draft && !s.aiWork && !quiet) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 14px ${FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("Press F, then drag to draw your first frame", w / 2, h / 2 - 8);
    ctx.font = `400 12px ${FONT_STACK}`;
    ctx.fillText("R rectangle   O ellipse   T text   V move   Space + drag to pan", w / 2, h / 2 + 14);
    ctx.textAlign = "left";
  }
}

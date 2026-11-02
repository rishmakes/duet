import { layoutText, lineWidth } from "../canvas/text";
import { descendants, pointInRect, worldRect } from "../document/geometry";
import type { Doc, El, Rect } from "../document/types";

export interface LayoutProblem {
  id: string;
  name: string;
  kind: "off-frame" | "overlap" | "too-small" | "near-edge" | "low-contrast" | "text-gap" | "glyph" | "off-centre" | "corners" | "buttons" | "edges" | "empty";
  message: string;
}

/** Parse hex color into RGB. Returns null for non-solid, transparent, or unparseable colors. */
function parseSolidHex(color: string | null | undefined): { r: number; g: number; b: number } | null {
  if (!color) return null;
  const c = color.trim().toLowerCase();
  if (!c.startsWith("#")) return null;
  const raw = c.slice(1);
  if (raw.length === 3) {
    return {
      r: parseInt(raw[0] + raw[0], 16),
      g: parseInt(raw[1] + raw[1], 16),
      b: parseInt(raw[2] + raw[2], 16),
    };
  }
  if (raw.length === 6) {
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }
  if (raw.length === 8) {
    const alpha = parseInt(raw.slice(6, 8), 16);
    if (alpha < 255) return null; // not solid
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }
  return null;
}

function channelLuminance(val: number): number {
  const c = val / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** Calculate WCAG contrast ratio between two solid colors. Returns null if either cannot be parsed. */
function wcagContrast(fgColor: string, bgColor: string): number | null {
  const fg = parseSolidHex(fgColor);
  const bg = parseSolidHex(bgColor);
  if (!fg || !bg) return null;
  const l1 = luminance(fg.r, fg.g, fg.b);
  const l2 = luminance(bg.r, bg.g, bg.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Check if an element is visible and drawn on screen within the frame. */
function isVisible(doc: Doc, el: El, frameId: string): boolean {
  if (el.hidden || el.opacity <= 0) return false;
  if (el.width <= 0 || el.height <= 0) return false;
  if (el.type === "text" && (!el.text || el.text.trim().length === 0)) return false;

  let cur = el.parentId ? doc.elements[el.parentId] : null;
  while (cur && cur.id !== frameId) {
    if (cur.hidden || cur.opacity <= 0) return false;
    cur = cur.parentId ? doc.elements[cur.parentId] : null;
  }
  return true;
}

/** Find the solid fill directly behind a text element, or "skip" if behind is picture/video/gradient. */
function findBackgroundFill(doc: Doc, frame: El, textEl: El, stackOrder: string[]): string | "skip" | null {
  const textRect = worldRect(doc, textEl.id);
  const cx = textRect.x + textRect.width / 2;
  const cy = textRect.y + textRect.height / 2;

  const textIndex = stackOrder.indexOf(textEl.id);
  for (let i = textIndex - 1; i >= 0; i--) {
    const el = doc.elements[stackOrder[i]];
    if (!el || el.type === "sound") continue;
    if (!isVisible(doc, el, frame.id)) continue;

    const r = worldRect(doc, el.id);
    if (!pointInRect(cx, cy, r)) continue;

    if (el.type === "image" || el.type === "video") return "skip";
    if (el.gradient) return "skip";
    if (el.type === "group" || el.type === "text") continue;

    if (el.opacity >= 1 && parseSolidHex(el.fill)) {
      return el.fill;
    }
    if (el.opacity < 1 && el.fill && el.fill !== "#00000000" && el.fill !== "#ffffff00") {
      return "skip";
    }
  }

  if (frame.gradient) return "skip";
  if (frame.opacity >= 1 && parseSolidHex(frame.fill)) {
    return frame.fill;
  }
  return null;
}

export function checkLayout(doc: Doc, frameId: string): LayoutProblem[] {
  const frame = doc.elements[frameId];
  if (!frame || frame.type !== "frame" || frame.hidden || frame.opacity <= 0 || frame.width <= 0 || frame.height <= 0) {
    return [];
  }

  const allDescendants = descendants(doc, frameId);
  const textEls = allDescendants
    .map((id) => doc.elements[id])
    .filter((el): el is El => !!el && el.type === "text" && isVisible(doc, el, frameId));

  const problems: LayoutProblem[] = basics(doc, frameId, allDescendants);
  if (textEls.length === 0) return cap(problems);

  const fRect = worldRect(doc, frameId);
  const shorterSide = Math.min(fRect.width, fRect.height);
  const minFontSize = shorterSide * 0.03;
  const edgeMarginThreshold = shorterSide * 0.04;

  const seenOverlapPairs = new Set<string>();

  for (const text of textEls) {
    const tRect = worldRect(doc, text.id);

    // 1. off-frame: any part of the text box outside the frame
    const leftOverhang = fRect.x - tRect.x;
    const topOverhang = fRect.y - tRect.y;
    const rightOverhang = tRect.x + tRect.width - (fRect.x + fRect.width);
    const bottomOverhang = tRect.y + tRect.height - (fRect.y + fRect.height);
    const maxOverhang = Math.max(leftOverhang, topOverhang, rightOverhang, bottomOverhang);
    const isOffFrame = maxOverhang > 1e-4;

    if (isOffFrame) {
      const dist = Math.max(1, Math.round(maxOverhang));
      problems.push({
        id: text.id,
        name: text.name,
        kind: "off-frame",
        message: `${text.name} is ${dist}px outside the frame.`,
      });
    }

    // 2. overlap: overlaps another text box by more than 10% of the smaller one
    const area = tRect.width * tRect.height;
    for (const other of textEls) {
      if (other.id === text.id) continue;
      const pairKey = [text.id, other.id].sort().join("::");
      if (seenOverlapPairs.has(pairKey)) continue;

      const oRect = worldRect(doc, other.id);
      const otherArea = oRect.width * oRect.height;
      const smallerArea = Math.min(area, otherArea);

      const ix = Math.max(0, Math.min(tRect.x + tRect.width, oRect.x + oRect.width) - Math.max(tRect.x, oRect.x));
      const iy = Math.max(0, Math.min(tRect.y + tRect.height, oRect.y + oRect.height) - Math.max(tRect.y, oRect.y));
      const overlapArea = ix * iy;

      if (smallerArea > 0 && overlapArea > 0.1 * smallerArea) {
        seenOverlapPairs.add(pairKey);
        problems.push({
          id: text.id,
          name: text.name,
          kind: "overlap",
          message: `${text.name} overlaps ${other.name}.`,
        });
      }
    }

    // 3. too-small: font size under 3% of the frame's shorter side
    if (text.fontSize < minFontSize) {
      const minPixels = Math.ceil(minFontSize);
      problems.push({
        id: text.id,
        name: text.name,
        kind: "too-small",
        message: `${text.name} is too small. It should be at least ${minPixels}px.`,
      });
    }

    // 4. near-edge: closer than 4% of the shorter side to a frame edge but still inside
    if (!isOffFrame) {
      const dLeft = tRect.x - fRect.x;
      const dTop = tRect.y - fRect.y;
      const dRight = fRect.x + fRect.width - (tRect.x + tRect.width);
      const dBottom = fRect.y + fRect.height - (tRect.y + tRect.height);
      const minEdgeDist = Math.min(dLeft, dTop, dRight, dBottom);

      if (minEdgeDist < edgeMarginThreshold) {
        problems.push({
          id: text.id,
          name: text.name,
          kind: "near-edge",
          message: `${text.name} is too close to the edge of the frame.`,
        });
      }
    }

    // 5. low-contrast: WCAG contrast ratio under 3 against solid background
    const bgFill = findBackgroundFill(doc, frame, text, allDescendants);
    if (bgFill && bgFill !== "skip") {
      const ratio = wcagContrast(text.fill, bgFill);
      if (ratio !== null && ratio < 3) {
        problems.push({
          id: text.id,
          name: text.name,
          kind: "low-contrast",
          message: `${text.name} has low contrast against its background.`,
        });
      }
    }
  }

  return cap(problems);
}

/** At most 8 problems; if more, the last one says how many more. */
function cap(problems: LayoutProblem[]): LayoutProblem[] {
  if (problems.length > 8) {
    const extra = problems.length - 8;
    const capped = problems.slice(0, 8);
    const last = capped[7];
    capped[7] = {
      ...last,
      message: `${last.message} (${extra} more problem${extra === 1 ? "" : "s"})`,
    };
    return capped;
  }

  return problems;
}

// ---------- the basics a designer never gets wrong ----------

/** Where the words of a text box really are, not the box around them. */
function inkRect(doc: Doc, el: El): Rect {
  const r = worldRect(doc, el.id);
  const m = layoutText(el);
  const widest = Math.min(r.width, Math.max(0, ...m.lines.map((l) => lineWidth(l, el))));
  const spare = r.width - widest;
  const x = r.x + (el.textAlign === "center" ? spare / 2 : el.textAlign === "right" ? spare : 0);
  return { x, y: r.y, width: widest, height: Math.min(r.height, m.height) };
}

/** How round the corners really are: a radius past half the short side draws as a pill. */
const roundness = (el: El) => Math.min(el.radius || 0, el.width / 2, el.height / 2);
const isPill = (el: El) => roundness(el) >= Math.min(el.width, el.height) / 2 - 1;
const cornerWords = (el: El) => (isPill(el) ? "fully round" : `${Math.round(roundness(el))}px round`);

/** Something with a visible body: a filled or outlined frame or rectangle. */
const isBox = (el: El) => (el.type === "frame" || el.type === "rect") && !!((el.fill && !/^#[0-9a-f]{6}00$/i.test(el.fill)) || (el.stroke && el.strokeWidth > 0));

/** A small picture-like thing: an icon, a dot, a logo. */
function isIcon(doc: Doc, el: El): boolean {
  if (el.width > 64 || el.height > 64 || el.width < 8 || el.height < 8) return false;
  if (el.type === "path" || el.type === "ellipse" || el.type === "image") return true;
  return (el.type === "frame" || el.type === "group" || el.type === "instance") && !descendants(doc, el.id).some((d) => doc.elements[d]?.type === "text");
}

const inside = (a: Rect, b: Rect) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;

function union(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
}

/** Shapes the system font draws badly at small sizes, like ▾ coming out as a dot. */
const SHAPE_GLYPH = /[■-◿✀-➿]/;

function basics(doc: Doc, frameId: string, all: string[]): LayoutProblem[] {
  const out: LayoutProblem[] = [];
  const els = all.map((id) => doc.elements[id]).filter((el): el is El => !!el && isVisible(doc, el, frameId));
  const say = (el: El, kind: LayoutProblem["kind"], message: string) => out.push({ id: el.id, name: el.name, kind, message });

  for (const el of els) {
    if (el.type !== "text") continue;
    // a box taller than its lines leaves a gap that pushes everything under it
    const gap = Math.round(el.height - layoutText(el).height);
    if (gap > 4) say(el, "text-gap", `${el.name} has ${gap}px of empty space under its last line. Fit its height to the words.`);
    if (el.fontSize < 16 && SHAPE_GLYPH.test(el.text)) say(el, "glyph", `${el.name} uses a symbol that draws as a smudge at ${el.fontSize}px. Draw it as an icon instead.`);
  }

  // what sits in one place: an icon and its label, buttons in a row, blocks stacked in a column
  const holders = [frameId, ...els.filter((el) => el.type === "frame" || el.type === "group").map((el) => el.id)];
  for (const h of holders) {
    const kids = (doc.elements[h]?.childIds ?? []).map((id) => doc.elements[id]).filter((el): el is El => !!el && els.includes(el));
    const icons = kids.filter((k) => isIcon(doc, k));
    const texts = kids.filter((k) => k.type === "text");
    if (icons.length === 1 && texts.length === 1) {
      const a = worldRect(doc, icons[0].id);
      const b = inkRect(doc, texts[0]);
      const rowWise = a.y < b.y + b.height && b.y < a.y + a.height;
      const off = rowWise ? a.y + a.height / 2 - (b.y + b.height / 2) : a.x + a.width / 2 - (b.x + b.width / 2);
      const columnWise = !rowWise && a.x < b.x + b.width && b.x < a.x + a.width;
      if ((rowWise || columnWise) && Math.abs(off) > 2)
        say(texts[0], "off-centre", `${texts[0].name} is ${Math.round(Math.abs(off))}px off the centre of ${icons[0].name}. Centre the label on its icon.`);
    }
    // stacked blocks that start together end together, and edges are never almost the same
    const blocks = kids.filter((k) => isBox(k) || (k.type === "frame" && k.childIds.length > 0)).map((k) => ({ el: k, r: worldRect(doc, k.id) }));
    blocks.sort((p, q) => p.r.y - q.r.y);
    for (let i = 1; i < blocks.length; i++) {
      const up = blocks[i - 1];
      const down = blocks[i];
      const gapY = down.r.y - (up.r.y + up.r.height);
      if (gapY < 0 || gapY > 80) continue;
      const dl = Math.abs(up.r.x - down.r.x);
      const dr = Math.abs(up.r.x + up.r.width - (down.r.x + down.r.width));
      if (dl <= 1 && dr > 2) say(down.el, "edges", `${down.el.name} starts with ${up.el.name} but ends ${Math.round(dr)}px from it. Stacked blocks share both edges.`);
      else if (dl > 1 && dl <= 12) say(down.el, "edges", `${down.el.name} is ${Math.round(dl)}px off the left edge of ${up.el.name}. Line them up.`);
    }
  }

  const boxes = els.filter(isBox).map((el) => ({ el, r: worldRect(doc, el.id) }));

  // a button inside a field follows the field's curve: its radius is the field's minus the gap between them
  for (const c of boxes) {
    const holder = boxes
      .filter((p) => p.el !== c.el && inside(c.r, p.r) && p.r.width * p.r.height > c.r.width * c.r.height && roundness(p.el) > 0)
      .sort((p, q) => p.r.width * p.r.height - q.r.width * q.r.height)[0];
    if (!holder) continue;
    const top = c.r.y - holder.r.y;
    const bottom = holder.r.y + holder.r.height - (c.r.y + c.r.height);
    if (top > 16 || bottom > 16) continue;
    const gap = Math.min(top, bottom, c.r.x - holder.r.x, holder.r.x + holder.r.width - (c.r.x + c.r.width));
    const want = Math.max(0, Math.min(roundness(holder.el) - gap, Math.min(c.r.width, c.r.height) / 2));
    if (Math.abs(roundness(c.el) - want) > Math.max(2, want * 0.25))
      say(c.el, "corners", `${c.el.name} is ${cornerWords(c.el)} inside ${holder.el.name}, which is ${cornerWords(holder.el)}. Make it about ${Math.round(want)}px so the curves match.`);
  }

  // buttons: one roundness for all of them, and one height for those side by side
  const buttons = boxes.filter(({ r }) => r.height >= 24 && r.height <= 72 && r.width <= 360 && els.some((t) => t.type === "text" && t.text.length <= 32 && inside(worldRect(doc, t.id), r) && inside(inkRect(doc, t), r)));
  const kinds = new Map<string, El>();
  for (const b of buttons) {
    const k = isPill(b.el) ? "pill" : String(Math.round(roundness(b.el) / 3));
    if (!kinds.has(k)) kinds.set(k, b.el);
  }
  if (kinds.size > 1) {
    const list = [...kinds.values()].slice(0, 3);
    say(list[1], "buttons", `Buttons do not share one roundness: ${list.map((b) => `${b.name} is ${cornerWords(b)}`).join(", ")}. Give every button the same corners.`);
  }
  for (let i = 0; i < buttons.length; i++)
    for (let j = i + 1; j < buttons.length; j++) {
      const a = buttons[i].r;
      const b = buttons[j].r;
      const sameRow = Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) <= 4;
      if (sameRow && Math.abs(a.height - b.height) > 2 && !inside(a, b) && !inside(b, a))
        say(buttons[j].el, "buttons", `${buttons[j].el.name} is ${Math.round(b.height)}px tall next to ${buttons[i].el.name} at ${Math.round(a.height)}px. Buttons side by side are the same height.`);
    }

  // a card that is mostly empty reads as unfinished
  for (const { el, r } of boxes) {
    if (el.type !== "frame" || r.width < 160 || r.height < 80 || buttons.some((b) => b.el === el)) continue;
    const content = union(el.childIds.map((id) => doc.elements[id]).filter((k): k is El => !!k && els.includes(k)).map((k) => (k.type === "text" ? inkRect(doc, k) : worldRect(doc, k.id))));
    if (!content) continue;
    const filled = (content.width * content.height) / (r.width * r.height);
    // a small tile with an icon over its label is fine; content that reaches neither across nor down is not
    const thin = content.width < r.width * 0.5 && content.height < r.height * 0.6;
    if (thin || filled < 0.15) say(el, "empty", `${el.name} is ${Math.round((1 - filled) * 100)}% empty. Fill it (a picture, a detail, proof like stars or a name) or make it smaller.`);
  }

  return out;
}

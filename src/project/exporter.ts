import { drawElement } from "../canvas/render";
import { topLevelOnly, turnOf, turnedBox } from "../document/geometry";
import type { Doc } from "../document/types";
import { makePdf } from "./pdf";

/** Every screen on the page: the frames and copies at the top. */
export const screensOf = (doc: Doc): string[] => doc.rootIds.filter((i) => doc.elements[i]?.type === "frame" || doc.elements[i]?.type === "instance");

/** What would be exported: the selection, or every screen when nothing is selected. */
export function exportTargets(doc: Doc, selection: string[]): string[] {
  const picked = topLevelOnly(doc, selection.filter((i) => doc.elements[i]));
  return picked.length ? picked : screensOf(doc);
}

/** Draw one element to a PNG at the given scale. Returns base64 text. */
export function renderPng(doc: Doc, id: string, scale: number): string {
  return drawPicture(doc, id, scale, "image/png").data;
}

export function drawPicture(doc: Doc, id: string, scale: number, kind: "image/png" | "image/jpeg") {
  const el = doc.elements[id];
  // a turned thing needs a picture big enough to hold all of it
  const box = turnedBox({ x: 0, y: 0, width: el.width, height: el.height }, turnOf(el));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the picture.");
  if (kind === "image/jpeg") {
    // a JPEG has no see-through, so see-through parts print as white paper
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.scale(scale, scale);
  drawElement(ctx, doc, { ...el, x: 0 - box.x, y: 0 - box.y }, 0, 0);
  const data = canvas.toDataURL(kind, 0.92).split(",")[1];
  return { data, box, pixelWidth: canvas.width, pixelHeight: canvas.height };
}

const fromBase64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Every exported thing as one page of a PDF, drawn sharp at 3x. Returns base64 text. */
export function renderPdf(doc: Doc, ids: string[]): string {
  const pages = ids.map((id) => {
    const p = drawPicture(doc, id, 3, "image/jpeg");
    return { width: p.box.width, height: p.box.height, jpeg: fromBase64(p.data), pixelWidth: p.pixelWidth, pixelHeight: p.pixelHeight };
  });
  return toBase64(makePdf(pages));
}

export const safe = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Untitled";

/** Names that never collide, like "Home", "Home 2". */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = safe(n);
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    return c === 1 ? k : `${k} ${c}`;
  });
}

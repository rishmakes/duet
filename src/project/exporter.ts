import { invoke } from "@tauri-apps/api/core";
import { message, open, save } from "../ui/dialog";
import { drawElement } from "../canvas/render";
import { topLevelOnly, turnOf, turnedBox } from "../document/geometry";
import { toSvg } from "../document/svg";
import type { Doc } from "../document/types";
import { currentDoc, getState } from "../state/store";
import { preloadPictures } from "./assets";
import { makePdf } from "./pdf";

export type Format = "png" | "svg" | "pdf";

/** What would be exported: the selection, or every screen when nothing is selected. */
export function exportTargets(doc: Doc, selection: string[]): string[] {
  const picked = topLevelOnly(doc, selection.filter((i) => doc.elements[i]));
  if (picked.length) return picked;
  return doc.rootIds.filter((i) => doc.elements[i]?.type === "frame" || doc.elements[i]?.type === "instance");
}

/** Draw one element to a PNG at the given scale. Returns base64 text. */
export function renderPng(doc: Doc, id: string, scale: number): string {
  return drawPicture(doc, id, scale, "image/png").data;
}

function drawPicture(doc: Doc, id: string, scale: number, kind: "image/png" | "image/jpeg") {
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
function renderPdf(doc: Doc, ids: string[]): string {
  const pages = ids.map((id) => {
    const p = drawPicture(doc, id, 3, "image/jpeg");
    return { width: p.box.width, height: p.box.height, jpeg: fromBase64(p.data), pixelWidth: p.pixelWidth, pixelHeight: p.pixelHeight };
  });
  return toBase64(makePdf(pages));
}

const safe = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Untitled";

/** Names that never collide, like "Home", "Home 2". */
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = safe(n);
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    return c === 1 ? k : `${k} ${c}`;
  });
}

/** Export and tell the designer where it went. Returns a short message. */
export async function exportDesign(format: Format, scale: number): Promise<string> {
  const doc = currentDoc();
  const ids = exportTargets(doc, getState().selection);
  if (ids.length === 0) return "Nothing to export yet. Draw a frame first.";
  await preloadPictures(doc);
  const names = uniqueNames(ids.map((i) => doc.elements[i].name));
  const ext = format;
  const suffix = format === "png" && scale !== 1 ? `@${scale}x` : "";

  const write = async (path: string, id: string) => {
    if (format === "svg") await invoke("write_text_file", { path, contents: toSvg(doc, id) });
    else await invoke("write_binary_file", { path, dataBase64: renderPng(doc, id, scale) });
  };

  try {
    // a PDF keeps every screen together, one page each, in one file
    if (format === "pdf") {
      const path = await save({
        title: "Export",
        defaultPath: `${ids.length === 1 ? names[0] : safe(getState().project.name)}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!path) return "";
      const final = path.toLowerCase().endsWith(".pdf") ? path : `${path}.pdf`;
      await invoke("write_binary_file", { path: final, dataBase64: renderPdf(doc, ids) });
      const pages = ids.length === 1 ? "" : ` with ${ids.length} pages`;
      return `Saved ${final.split(/[\\/]/).pop()}${pages}`;
    }
    if (ids.length === 1) {
      const path = await save({
        title: "Export",
        defaultPath: `${names[0]}${suffix}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (!path) return "";
      const final = path.toLowerCase().endsWith(`.${ext}`) ? path : `${path}.${ext}`;
      await write(final, ids[0]);
      return `Saved ${final.split(/[\\/]/).pop()}`;
    }
    const dir = await open({ directory: true, multiple: false, title: `Choose a folder for ${ids.length} files` });
    if (typeof dir !== "string") return "";
    for (let i = 0; i < ids.length; i++) await write(`${dir}/${names[i]}${suffix}.${ext}`, ids[i]);
    return `Saved ${ids.length} files to ${dir.split(/[\\/]/).pop()}`;
  } catch (e) {
    await message(String(e), { title: "Duet", kind: "error" });
    return "Could not export.";
  }
}

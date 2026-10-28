import { invoke } from "@tauri-apps/api/core";
import { PAINT_TILE } from "../document/types";
import type { Doc, El } from "../document/types";
import { getState } from "../state/store";
import { flushFonts } from "./fonts";

/**
 * Pictures placed on the canvas. Each one is stored once, under a name made from its contents
 * (assets/3fa9c1d2e4b5a678.png), so the same picture never takes space twice and a design
 * saved in history can always find its pictures.
 */

interface Asset {
  mime: string;
  b64: string;
  /** Project folders this picture has already been written into. */
  written: Set<string>;
}

const assets = new Map<string, Asset>();
const pictures = new Map<string, HTMLImageElement | "loading" | "failed">();

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};
const EXT: Record<string, string> = Object.fromEntries(Object.entries(MIME).filter(([k]) => k !== "jpeg").map(([k, v]) => [v, k]));

export const IMAGE_EXTENSIONS = Object.keys(MIME);
export const mimeFor = (name: string) => MIME[(name.split(".").pop() ?? "").toLowerCase()] ?? null;

const join = (dir: string, name: string) => (dir.endsWith("/") || dir.endsWith("\\") ? dir + name : `${dir}/${name}`);

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function repaint() {
  window.dispatchEvent(new Event("duet:repaint"));
}

function load(src: string, url: string) {
  const img = new Image();
  img.onload = () => {
    pictures.set(src, img);
    repaint();
  };
  img.onerror = () => pictures.set(src, "failed");
  img.src = url;
}

/** The picture as a data address, or null when it is not loaded yet. */
export function assetUrl(src: string): string | null {
  const a = assets.get(src);
  return a ? `data:${a.mime};base64,${a.b64}` : null;
}

/** The picture ready to draw, or null while it is still loading (the canvas repaints when it arrives). */
export function getPicture(src: string): HTMLImageElement | null {
  const have = pictures.get(src);
  if (have && have !== "loading" && have !== "failed") return have;
  if (have) return null;
  pictures.set(src, "loading");
  const url = assetUrl(src);
  if (url) {
    load(src, url);
    return null;
  }
  const dir = getState().project.path;
  if (!dir) {
    pictures.set(src, "failed");
    return null;
  }
  invoke<string>("read_binary_file", { path: join(dir, src) })
    .then((b64) => {
      const ext = (src.split(".").pop() ?? "").toLowerCase();
      const mime = MIME[ext] ?? "image/png";
      assets.set(src, { mime, b64, written: new Set([dir]) });
      load(src, `data:${mime};base64,${b64}`);
    })
    .catch(() => pictures.set(src, "failed"));
  return null;
}

/** The pictures a design uses, each named once. */
export function picturesIn(doc: Doc): string[] {
  return [
    ...new Set(
      Object.values(doc.elements).flatMap((e) => [
        ...(e.type === "image" && e.src ? [e.src] : []),
        ...(e.effectMask ? [e.effectMask] : []),
        ...(e.type === "image" && e.paint ? Object.values(e.paint) : []),
      ]),
    ),
  ];
}

/** A picture as it is shown, the file or a sheet with what was painted on it. */
export type Picture = HTMLImageElement | HTMLCanvasElement;

/** How many pixels a picture has across and down. */
export const pictureSize = (pic: Picture): [number, number] =>
  pic instanceof HTMLImageElement ? [pic.naturalWidth, pic.naturalHeight] : [pic.width, pic.height];

/** Names a picture together with what was painted on it, so a painted one is never mistaken for the plain file. */
export function paintKey(el: El): string {
  const keys = Object.keys(el.paint ?? {});
  if (!keys.length) return el.src;
  return `${el.src}|${keys.sort().map((k) => `${k}=${el.paint[k]}`).join(";")}`;
}

/** While a stroke is being painted, the sheet it is painted on, by the picture's id. Shown in place of the picture until the stroke is kept. */
const live = new Map<string, HTMLCanvasElement>();
/** Show this sheet for the picture while a stroke is being painted, or null to go back to the picture as saved. */
export function setLivePicture(id: string, sheet: HTMLCanvasElement | null) {
  if (sheet) live.set(id, sheet);
  else live.delete(id);
}
/** Whether a stroke is being painted on this picture right now. Its sheet changes every frame, so nothing drawn from it is kept. */
export const isLivePicture = (id: string) => live.has(id);

/** Painted pictures already put together. Each is as big as its file, so only a few are kept. */
const painted = new Map<string, HTMLCanvasElement>();

/**
 * A picture as it is shown: its file, with each painted patch laid over its square.
 * Null while the file is loading. Until every patch has loaded, the file is shown as it came.
 */
export function pictureOf(el: El): Picture | null {
  const now = live.get(el.id);
  if (now) return now;
  const base = getPicture(el.src);
  if (!base || !base.naturalWidth || !base.naturalHeight) return null;
  const keys = Object.keys(el.paint ?? {});
  if (!keys.length) return base;
  const key = paintKey(el);
  const have = painted.get(key);
  if (have) {
    // the newest goes to the back of the line, so the oldest is the one let go
    painted.delete(key);
    painted.set(key, have);
    return have;
  }
  const tiles: [string, HTMLImageElement][] = [];
  let waiting = false;
  for (const k of keys) {
    const src = el.paint[k];
    const tile = getPicture(src);
    if (tile) tiles.push([k, tile]);
    else if (pictures.get(src) !== "failed") waiting = true;
  }
  if (waiting) return base;
  const sheet = document.createElement("canvas");
  sheet.width = base.naturalWidth;
  sheet.height = base.naturalHeight;
  const c = sheet.getContext("2d");
  if (!c) return base;
  c.drawImage(base, 0, 0);
  for (const [k, tile] of tiles) {
    const [col, row] = k.split(",").map(Number);
    // a patch is the whole square as painted, so what was rubbed out there stays see-through
    c.clearRect(col * PAINT_TILE, row * PAINT_TILE, PAINT_TILE, PAINT_TILE);
    c.drawImage(tile, col * PAINT_TILE, row * PAINT_TILE);
  }
  if (painted.size >= 4) painted.delete(painted.keys().next().value!);
  painted.set(key, sheet);
  return sheet;
}

/** Wait until every picture used by this design can be drawn. Used before exporting. */
export async function preloadPictures(doc: Doc): Promise<void> {
  for (const src of picturesIn(doc)) {
    for (let i = 0; i < 100 && !getPicture(src); i++) {
      if (pictures.get(src) === "failed") break;
      await new Promise((r) => setTimeout(r, 30));
    }
  }
}

/** Keep a picture. Returns where it lives inside the project, and how big it is. */
export async function addPicture(
  name: string,
  bytes: Uint8Array,
  mimeHint?: string,
): Promise<{ src: string; width: number; height: number }> {
  const mime = mimeHint && EXT[mimeHint] ? mimeHint : (mimeFor(name) ?? "image/png");
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  const hash = Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const src = `assets/${hash}.${EXT[mime] ?? "png"}`;
  if (!assets.has(src)) assets.set(src, { mime, b64: toBase64(bytes), written: new Set() });
  const url = assetUrl(src)!;
  const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      pictures.set(src, img);
      resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 });
    };
    img.onerror = () => reject(new Error("That file could not be read as a picture."));
    img.src = url;
  });
  const dir = getState().project.path;
  if (dir) await writePicture(src, dir);
  return { src, ...size };
}

async function writePicture(src: string, dir: string) {
  const a = assets.get(src);
  if (!a || a.written.has(dir)) return;
  await invoke("write_binary_file", { path: join(dir, src), dataBase64: a.b64 });
  a.written.add(dir);
}

/** Put every picture the design uses into the project folder. Safe to call as often as you like. */
export async function flushPictures(dir: string, doc: Doc) {
  for (const src of picturesIn(doc)) await writePicture(src, dir).catch((e) => console.warn("Could not save a picture:", e));
  await flushFonts(dir, doc);
}

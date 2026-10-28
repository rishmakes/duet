import { invoke } from "@tauri-apps/api/core";
import type { Doc } from "../document/types";
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
      ]),
    ),
  ];
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

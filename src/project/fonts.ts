import { invoke } from "@tauri-apps/api/core";
import type { Doc } from "../document/types";
import { getState } from "../state/store";

/**
 * Free fonts fetched from Fontsource. A fetched font is kept as plain files in the project
 * (assets/font-Open Sans-400.woff2), so a copy sent to a friend looks the same with nothing to
 * install. A second copy sits in ~/.duet/fonts, so a font fetched once works offline everywhere.
 */

const API = "https://api.fontsource.org/v1/fonts";

export interface OnlineFont {
  id: string;
  family: string;
  category: string;
  weights: number[];
  subsets: string[];
  defSubset: string;
}

interface Kept {
  weight: number;
  b64: string;
  /** Project folders this file has already been written into. */
  written: Set<string>;
}

/** Families that are ready to draw, with the weights Duet holds. */
const kept = new Map<string, Kept[]>();
const fetching = new Map<string, Promise<void>>();

const join = (dir: string, name: string) => (dir.endsWith("/") || dir.endsWith("\\") ? dir + name : `${dir}/${name}`);
const fileName = (family: string, weight: number) => `font-${family}-${weight}.woff2`;

/** The family and weight a font file in a project is for, or null when the name is not one of ours. */
export function parseFontFile(name: string): { family: string; weight: number } | null {
  const m = /^font-(.+)-(\d{3})\.woff2$/.exec(name);
  return m ? { family: m[1], weight: Number(m[2]) } : null;
}

function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Make a font file drawable, then tell the canvas to paint again. */
async function register(family: string, weight: number, b64: string, dir?: string) {
  const have = kept.get(family) ?? [];
  if (have.some((k) => k.weight === weight)) return;
  const face = new FontFace(family, fromBase64(b64), { weight: String(weight) });
  await face.load();
  document.fonts.add(face);
  have.push({ weight, b64, written: new Set(dir ? [dir] : []) });
  kept.set(family, have);
  window.dispatchEvent(new Event("duet:repaint"));
}

/** Families fetched or opened so far. */
export const fetchedFamilies = (): string[] => [...kept.keys()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
export const isFetched = (family: string) => kept.has(family);

// ---- the catalogue ----

let catalogue: Promise<OnlineFont[]> | null = null;

/** Every free family Fontsource has, asked for once. Empty when offline. */
export function onlineFonts(): Promise<OnlineFont[]> {
  if (!catalogue) {
    catalogue = fetch(API)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: Array<OnlineFont & { styles?: string[] }>) =>
        rows.map((r) => ({ id: r.id, family: r.family, category: r.category, weights: r.weights, subsets: r.subsets, defSubset: r.defSubset })),
      )
      .catch(() => {
        catalogue = null; // try again next time the box opens
        return [];
      });
  }
  return catalogue;
}

/** Free fonts whose name holds what was typed, the ones that start with it first. Never fonts already named in `skip`. */
export function matchOnline(all: OnlineFont[], typed: string, skip: Set<string>): OnlineFont[] {
  const t = typed.trim().toLowerCase();
  if (!t) return [];
  const free = all.filter((f) => !skip.has(f.family.toLowerCase()));
  const starts = free.filter((f) => f.family.toLowerCase().startsWith(t));
  const inside = free.filter((f) => !f.family.toLowerCase().startsWith(t) && (f.family.toLowerCase().includes(t) || f.category.toLowerCase().includes(t)));
  return [...starts, ...inside];
}

// ---- fetching ----

async function cacheDir(): Promise<string | null> {
  try {
    return join(await invoke<string>("duet_home"), "fonts");
  } catch {
    return null;
  }
}

async function readCached(dir: string | null, name: string): Promise<string | null> {
  if (!dir) return null;
  try {
    return await invoke<string>("read_binary_file", { path: join(dir, name) });
  } catch {
    return null;
  }
}

async function load(font: OnlineFont) {
  const cache = await cacheDir();
  const weights = font.weights.length ? font.weights : [400];
  let details: { variants: Record<string, Record<string, Record<string, { url: { woff2: string } }>>> } | null = null;
  for (const w of weights) {
    const name = fileName(font.family, w);
    let b64 = await readCached(cache, name);
    if (!b64) {
      details ??= await fetch(`${API}/${font.id}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${font.family} was not found`))));
      const subset = font.subsets.includes(font.defSubset) ? font.defSubset : font.subsets[0];
      const url = details!.variants[String(w)]?.normal?.[subset]?.url?.woff2;
      if (!url) continue;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${font.family} could not be fetched`);
      b64 = toBase64(new Uint8Array(await res.arrayBuffer()));
      if (cache) await invoke("write_binary_file", { path: join(cache, name), dataBase64: b64 }).catch(() => {});
    }
    await register(font.family, w, b64);
  }
  if (!kept.has(font.family)) throw new Error(`${font.family} has no file to fetch`);
  // a project that is already open keeps the font from now on
  const dir = getState().project.path;
  if (dir) await writeFamily(font.family, dir);
}

/** Fetch a free font so the canvas can draw it. Resolves when it is ready; rejects with a plain reason. */
export function fetchFont(font: OnlineFont): Promise<void> {
  if (kept.has(font.family)) return Promise.resolve();
  let p = fetching.get(font.family);
  if (!p) {
    p = load(font).finally(() => fetching.delete(font.family));
    fetching.set(font.family, p);
  }
  return p;
}

export const isFetching = (family: string) => fetching.has(family);

/** Fetch a free font by its exact name, quietly: false when there is no internet or no such font. */
export async function fetchFamily(family: string): Promise<boolean> {
  if (kept.has(family)) return true;
  const hit = (await onlineFonts()).find((f) => f.family.toLowerCase() === family.toLowerCase());
  if (!hit) return false;
  return fetchFont(hit).then(
    () => true,
    () => false,
  );
}

// ---- in the project ----

async function writeFamily(family: string, dir: string) {
  for (const k of kept.get(family) ?? []) {
    if (k.written.has(dir)) continue;
    await invoke("write_binary_file", { path: join(dir, `assets/${fileName(family, k.weight)}`), dataBase64: k.b64 });
    k.written.add(dir);
  }
}

/** The fetched families a design uses. */
export function fontsIn(doc: Doc): string[] {
  const names = new Set<string>();
  for (const e of Object.values(doc.elements)) if (e.type === "text" && e.fontFamily) names.add(e.fontFamily);
  for (const s of Object.values(doc.styles ?? {})) if (s.fontFamily) names.add(s.fontFamily);
  return [...names].filter((n) => kept.has(n));
}

/** The font files a design needs, named the way a copy lists its pictures (assets/…). */
export function fontFilesIn(doc: Doc): string[] {
  return fontsIn(doc).flatMap((f) => (kept.get(f) ?? []).map((k) => `assets/${fileName(f, k.weight)}`));
}

/** Put every font the design uses into the project folder. Safe to call as often as you like. */
export async function flushFonts(dir: string, doc: Doc) {
  for (const f of fontsIn(doc)) await writeFamily(f, dir).catch((e) => console.warn("Could not save a font:", e));
}

/** Make the fonts a project carries drawable, as it opens. */
export async function adoptFonts(dir: string) {
  try {
    const entries = await invoke<Array<{ name: string }>>("list_dir", { path: join(dir, "assets") });
    for (const e of entries) {
      const f = parseFontFile(e.name);
      if (!f) continue;
      const b64 = await invoke<string>("read_binary_file", { path: join(dir, `assets/${e.name}`) });
      await register(f.family, f.weight, b64, dir).catch((err) => console.warn("Could not open a font:", err));
    }
  } catch {
    // no assets folder yet
  }
}

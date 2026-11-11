import { invoke } from "@tauri-apps/api/core";
import { ask, message, open } from "../ui/dialog";
import { newId } from "../commands";
import type { SvgLayer } from "../commands";
import { unionRect, worldRect } from "../document/geometry";
import { countLayers, readSvg } from "../document/svgImport";
import type { SvgItem, SvgPlan } from "../document/svgImport";
import { baselineDrop, layoutText } from "../canvas/text";
import { currentDoc, dispatch, select } from "../state/store";
import type { Doc } from "../document/types";
import type { ImportSvgArgs } from "../commands";
import { addPicture } from "./assets";
import { fetchedFamilies, fetchFont, matchOnline, onlineFonts } from "./fonts";
import type { OnlineFont } from "./fonts";

/** An SVG file brought in as separate layers: shapes, words, pictures and groups, so it can be edited like anything drawn in Duet. */

export const isSvgFile = (name: string) => /\.svg$/i.test(name);

const fromBase64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const baseName = (path: string) => (path.split(/[\\/]/).pop() ?? "SVG").replace(/\.svg$/i, "");

/** The file's words and the layers it makes, read with the real fonts so the lines sit where the design had them. */
function planFor(text: string, name: string): SvgPlan {
  return readSvg(text, name, {
    makeId: newId,
    measure: (face, t) => {
      const m = layoutText({ ...face, text: t, width: 0, textFixed: false });
      return { width: m.width, height: m.height };
    },
    baselineDrop,
  });
}

async function missingFonts(families: string[]): Promise<string[]> {
  if (!families.length) return [];
  let have: string[] = [];
  try {
    have = await invoke<string[]>("system_fonts");
  } catch {
    // no list: say nothing rather than wrongly say a font is missing
    return [];
  }
  const known = new Set([...have, ...fetchedFamilies()].map((f) => f.toLowerCase()));
  return families.filter((f) => !known.has(f.toLowerCase()));
}

export interface SvgImported {
  /** The frame everything came in as. */
  id: string;
  layers: number;
  /** Font families the design uses that this computer does not have. */
  missing: string[];
  /** Plain sentences about what could not be kept. */
  notes: string[];
}

/** Where the layers go: the design on screen, unless the AI is working in another project. */
export interface SvgHome {
  doc: () => Doc;
  dispatch: (args: ImportSvgArgs) => void;
}
const here: SvgHome = { doc: currentDoc, dispatch: (args) => dispatch("import_svg_layers", args) };

/** Read SVG text and bring it in as a frame of layers. `at` is the frame's top left; leave it out to put it to the right of everything. */
export async function importSvgText(text: string, fileName: string, at?: { x: number; y: number }, parentId: string | null = null, home: SvgHome = here): Promise<SvgImported> {
  const plan = planFor(text, baseName(fileName));
  if (!plan.items.length) throw new Error(plan.notes[0] ?? "Nothing in this file could be turned into layers.");
  // pictures inside the file are stored once in the project
  const srcs = new Map<string, string>();
  for (const p of plan.pictures) {
    try {
      const { src } = await addPicture(`${p.name || p.key}`, fromBase64(p.base64), p.mime);
      srcs.set(p.key, src);
    } catch {
      plan.notes.push("A picture inside the design could not be opened, so it was left out.");
    }
  }
  const toLayer = (i: SvgItem): SvgLayer | null => {
    if (i.picture) {
      const src = srcs.get(i.picture);
      if (!src) return null;
      return { id: i.id, type: "image", name: i.name, x: i.x, y: i.y, width: i.width, height: i.height, props: { ...i.props, src } };
    }
    if (i.children) {
      const kids = i.children.map(toLayer).filter((k): k is SvgLayer => !!k);
      return kids.length ? { id: i.id, type: "group", name: i.name, x: 0, y: 0, width: 1, height: 1, props: i.props, mask: i.mask, children: kids } : null;
    }
    return { id: i.id, type: i.type as SvgLayer["type"], name: i.name, x: i.x, y: i.y, width: i.width, height: i.height, props: i.props };
  };
  const layers = plan.items.map(toLayer).filter((l): l is SvgLayer => !!l);
  const doc = home.doc();
  const all = unionRect(doc.rootIds.filter((id) => doc.elements[id]).map((id) => worldRect(doc, id)));
  const place = at ?? (all ? { x: Math.round(all.x + all.width + 100), y: Math.round(all.y) } : { x: 0, y: 0 });
  const id = newId("frame");
  home.dispatch({ frame: { id, name: plan.name, ...place, width: plan.width, height: plan.height, parentId }, layers });
  if (!home.doc().elements[id]) throw new Error("The design could not be placed there.");
  return { id, layers: countLayers(plan.items), missing: await missingFonts(plan.fonts), notes: plan.notes };
}

/** Read an SVG file from a full path on this computer. */
export async function importSvgPath(path: string, at?: { x: number; y: number }, parentId: string | null = null, home: SvgHome = here): Promise<SvgImported> {
  const text = await invoke<string>("read_text_file", { path });
  return importSvgText(text, path.split(/[\\/]/).pop() ?? "SVG.svg", at, parentId, home);
}

export interface FontsFound {
  /** Fonts now ready, under the name the design used. */
  got: string[];
  /** Fonts that were not there by that name: the design's name and the closest free one now used instead. */
  swapped: Array<[string, string]>;
  /** Fonts nothing close could be found for. */
  none: string[];
}

/** The free font that is the same name, or failing that the one whose name is closest. */
export function closest(all: OnlineFont[], family: string): OnlineFont | null {
  const low = family.toLowerCase();
  const exact = all.find((f) => f.family.toLowerCase() === low);
  if (exact) return exact;
  // "Oxygen Mono Bold" -> try the shorter names too, longest first
  const words = family.split(/\s+/);
  for (let n = words.length; n >= 1; n--) {
    const hit = matchOnline(all, words.slice(0, n).join(" "), new Set())[0];
    if (hit) return hit;
  }
  return null;
}

/** Find the missing fonts online and use them. Words in a font that is not the same name are switched to the closest one. */
export async function findFonts(frameId: string, missing: string[], home: Pick<SvgHome, "doc"> = here): Promise<FontsFound> {
  const out: FontsFound = { got: [], swapped: [], none: [] };
  const all = await onlineFonts();
  for (const family of missing) {
    const hit = all.length ? closest(all, family) : null;
    if (!hit) {
      out.none.push(family);
      continue;
    }
    try {
      await fetchFont(hit);
    } catch {
      out.none.push(family);
      continue;
    }
    if (hit.family.toLowerCase() === family.toLowerCase()) {
      // the design already names it, so the words simply start drawing in it
      out.got.push(family);
      continue;
    }
    const doc = home.doc();
    const inFrame = (id: string): boolean => {
      for (let at: string | null = id; at; at = doc.elements[at]?.parentId ?? null) if (at === frameId) return true;
      return false;
    };
    const ids = Object.values(doc.elements)
      .filter((e) => e.type === "text" && e.fontFamily === family && inFrame(e.id))
      .map((e) => e.id);
    if (ids.length) dispatch("set_props", { ids, props: { fontFamily: hit.family }, label: `Use ${hit.family} for ${family}` });
    out.swapped.push([family, hit.family]);
  }
  return out;
}

export function fontsReport(f: FontsFound): string {
  const parts: string[] = [];
  if (f.got.length) parts.push(`Found online: ${f.got.join(", ")}.`);
  if (f.swapped.length) parts.push(`Used the closest instead: ${f.swapped.map(([a, b]) => `${b} for ${a}`).join(", ")}.`);
  if (f.none.length) parts.push(`Nothing close found for: ${f.none.join(", ")}. They stay in a stand-in font.`);
  return parts.join(" ");
}

/** What the designer is told after an import, in plain words. */
export function importReport(r: SvgImported): string {
  const parts = [`${r.layers} layers came in.`];
  if (r.missing.length) parts.push(`These fonts are not on this computer, so the words look different until you add them: ${r.missing.join(", ")}.`);
  if (r.notes.length) parts.push(r.notes.join("\n"));
  return parts.join("\n\n");
}

/** File menu and drop: open an SVG as layers, where it was dropped or to the right of everything else. */
export async function openSvgFile(source?: string | File, at?: { x: number; y: number }): Promise<boolean> {
  try {
    const picked = source ?? (await open({ multiple: false, title: "Import an SVG as layers", filters: [{ name: "SVG", extensions: ["svg"] }] }));
    if (!picked || Array.isArray(picked)) return false;
    const done =
      typeof picked === "string"
        ? await importSvgPath(picked, undefined)
        : await importSvgText(await picked.text(), picked.name, at ? { x: Math.round(at.x), y: Math.round(at.y) } : undefined);
    select([done.id]);
    requestAnimationFrame(() => window.dispatchEvent(new Event("duet:show-selection")));
    let text = importReport(done);
    if (done.missing.length && (await ask(`These fonts are not on this computer: ${done.missing.join(", ")}.\n\nFind them online and use them? Where a font is not there by that name, Duet uses the closest one.`, { title: "Missing fonts", okLabel: "Find fonts", cancelLabel: "Not now" }))) {
      const found = await findFonts(done.id, done.missing);
      text = [`${done.layers} layers came in.`, fontsReport(found), done.notes.join("\n")].filter(Boolean).join("\n\n");
    }
    if (done.missing.length || done.notes.length) await message(text, { title: "The design is open", kind: "info" });
    return true;
  } catch (e) {
    await message(e instanceof Error ? e.message : String(e), { title: "Duet", kind: "error" });
    return false;
  }
}

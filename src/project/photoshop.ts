import { invoke } from "@tauri-apps/api/core";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { newId } from "../commands";
import type { PlacedLayer } from "../commands";
import { ancestors, turnOf, turnedBox, unionRect, worldPos, worldRect } from "../document/geometry";
import type { Blend, Doc, El } from "../document/types";
import { currentDoc, dispatch, getState, select } from "../state/store";
import { addPicture, preloadPictures } from "./assets";
import { renderPng } from "./exporter";

/** Photoshop files in and out. Each layer comes in as a picture, and each thing goes out as a layer. */

interface PsdLayer {
  name: string;
  group: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  blend: Blend;
  hidden: boolean;
  png: string;
  children: PsdLayer[];
}

interface PsdRead {
  width: number;
  height: number;
  layers: PsdLayer[];
  flattened: string[];
  leftOut: string[];
}

const fromBase64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const baseName = (path: string) => (path.split(/[\\/]/).pop() ?? "Photoshop file").replace(/\.(psd|psb)$/i, "");

async function toPlaced(layers: PsdLayer[]): Promise<PlacedLayer[]> {
  const out: PlacedLayer[] = [];
  for (const l of layers) {
    const look = { name: l.name || "Layer", opacity: l.opacity, blend: l.blend, hidden: l.hidden };
    if (l.group) {
      out.push({ id: newId("group"), ...look, x: 0, y: 0, width: 1, height: 1, children: await toPlaced(l.children) });
      continue;
    }
    const { src } = await addPicture(`${l.name}.png`, fromBase64(l.png), "image/png");
    out.push({ id: newId("image"), ...look, x: l.left, y: l.top, width: l.width, height: l.height, src });
  }
  return out;
}

/** Open a Photoshop file into the project, as a frame of its size to the right of everything else. */
export async function openPhotoshopFile(path?: string): Promise<boolean> {
  try {
    const picked = path ?? (await open({ multiple: false, title: "Open a Photoshop file", filters: [{ name: "Photoshop", extensions: ["psd", "psb"] }] }));
    if (typeof picked !== "string") return false;
    const read = await invoke<PsdRead>("psd_read", { path: picked });
    const doc = currentDoc();
    const all = unionRect(doc.rootIds.filter((id) => doc.elements[id]).map((id) => worldRect(doc, id)));
    const id = newId("frame");
    const name = baseName(picked);
    dispatch("place_layers", {
      frame: { id, name, x: all ? Math.round(all.x + all.width + 100) : 0, y: all ? Math.round(all.y) : 0, width: read.width, height: read.height },
      layers: await toPlaced(read.layers),
    });
    select([id]);
    const notes = [
      read.flattened.length ? `These came in as pictures, so change them in Photoshop for now:\n${read.flattened.join("\n")}` : "",
      read.leftOut.length ? `Duet cannot show these yet, so they look different or are left out:\n${read.leftOut.join("\n")}` : "",
    ].filter(Boolean);
    if (notes.length) await message(notes.join("\n\n"), { title: `${name} is open`, kind: "info" });
    return true;
  } catch (e) {
    await message(e instanceof Error ? e.message : String(e), { title: "Duet", kind: "error" });
    return false;
  }
}

/** The frame a Photoshop file is made from: the picked frame, or the one the picked thing sits in. */
export function photoshopFrame(doc: Doc, selection: string[]): string | null {
  const id = selection.find((i) => doc.elements[i]);
  if (!id) return doc.rootIds.find((i) => doc.elements[i]?.type === "frame") ?? null;
  const chain = [id, ...ancestors(doc, id)].filter((i) => doc.elements[i]?.type === "frame");
  return chain.length ? chain[chain.length - 1] : null;
}

/** Draw one thing on its own, as it looks before its see-through and mixing are applied: those go into the layer. */
function layerOf(doc: Doc, el: El, frameAt: { x: number; y: number }): PsdLayer {
  const look = { name: el.name, opacity: el.opacity, blend: el.blend, hidden: el.hidden };
  // a group that cuts what is inside it to a shape goes out as one picture, as it looks
  if (el.type === "group" && !el.mask) {
    const children = el.childIds.map((c) => doc.elements[c]).filter((c): c is El => !!c && c.type !== "sound");
    return { ...look, group: true, left: 0, top: 0, width: 0, height: 0, png: "", children: children.map((c) => layerOf(doc, c, frameAt)) };
  }
  const bare: Doc = { ...doc, elements: { ...doc.elements, [el.id]: { ...el, opacity: 1, blend: "normal", hidden: false } } };
  const at = worldPos(doc, el.id);
  const box = turnedBox({ x: 0, y: 0, width: el.width, height: el.height }, turnOf(el));
  return {
    ...look,
    group: false,
    left: Math.round(at.x - frameAt.x + box.x),
    top: Math.round(at.y - frameAt.y + box.y),
    width: 0,
    height: 0,
    png: renderPng(bare, el.id, 1),
    children: [],
  };
}

/** Save a frame as a Photoshop file, each thing in it as its own layer, groups kept. Returns a short message. */
export async function savePhotoshopFile(): Promise<string> {
  const doc = currentDoc();
  const id = photoshopFrame(doc, getState().selection);
  if (!id) return "Pick a frame to save as a Photoshop file.";
  const frame = doc.elements[id];
  try {
    const path = await save({ title: "Save as a Photoshop file", defaultPath: `${frame.name}.psd`, filters: [{ name: "Photoshop", extensions: ["psd"] }] });
    if (!path) return "";
    const final = path.toLowerCase().endsWith(".psd") ? path : `${path}.psd`;
    await preloadPictures(doc);
    const frameAt = worldPos(doc, id);
    const width = Math.max(1, Math.round(frame.width));
    const height = Math.max(1, Math.round(frame.height));
    const layers = frame.childIds
      .map((c) => doc.elements[c])
      .filter((c): c is El => !!c && c.type !== "sound")
      .map((c) => layerOf(doc, c, frameAt));
    // the frame's own colour is the bottom layer, when it has one
    const empty: Doc = { ...doc, elements: { ...doc.elements, [id]: { ...frame, childIds: [], opacity: 1, rotation: 0 } } };
    const background = renderPng(empty, id, 1);
    if (!/^#?[0-9a-f]{6}00$/i.test(frame.fill)) {
      layers.unshift({ name: "Background", group: false, left: 0, top: 0, width, height, opacity: 1, blend: "normal", hidden: false, png: background, children: [] });
    }
    await invoke("psd_write", { path: final, width, height, layers, composite: renderPng(doc, id, 1) });
    return `Saved ${final.split(/[\\/]/).pop()}`;
  } catch (e) {
    await message(e instanceof Error ? e.message : String(e), { title: "Duet", kind: "error" });
    return "Could not save the Photoshop file.";
  }
}

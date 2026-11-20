import type { El } from "../document/types";
import { addPicture, canvasToPngBytes, pictureOf, pictureSize } from "../project/assets";
import { dispatch, setTool } from "../state/store";
import { getLayout, setLayout } from "../ui/layout";
import { alphaToLuminance, newMaskSize } from "./layerMask";
import { seedAlphaMask } from "./render";

/** Keeps a black and white mask sheet as a picture in the project. */
async function keepMask(sheet: HTMLCanvasElement, name: string): Promise<string | null> {
  const bytes = await canvasToPngBytes(sheet);
  if (!bytes) return null;
  const { src } = await addPicture(name, bytes, "image/png");
  return src;
}

/** Gives a layer an all-white mask (everything still shows), then hands the brush to it in Photo. */
export async function addLayerMask(el: El): Promise<void> {
  const pic = el.type === "image" ? pictureOf(el) : null;
  const [w, h] = newMaskSize(el, pic ? pictureSize(pic) : null);
  const sheet = document.createElement("canvas");
  sheet.width = w;
  sheet.height = h;
  const c = sheet.getContext("2d");
  if (!c) return;
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, w, h);
  const src = await keepMask(sheet, "mask.png");
  if (!src) return;
  dispatch("set_layer_mask", { ids: [el.id], src, label: "Add mask" }, "you");
  paintMaskOf(el.id);
}

/** The brush and the eraser now work on this layer's mask, in Photo, where the brush lives. */
export function paintMaskOf(id: string | null): void {
  if (!id) {
    setLayout({ maskPaint: null });
    return;
  }
  setLayout({ maskPaint: id, ...(getLayout().mode === "photo" ? {} : { mode: "photo" as const }) });
  setTool("brush");
}

/**
 * Saves a painted mask. The sheet holds how much of the layer shows (see-through pixels);
 * it is kept as black and white, inverted back if the mask is inverted, so the file always means the same.
 */
export async function savePaintedMask(el: El, shows: HTMLCanvasElement, label: string): Promise<void> {
  const w = shows.width;
  const h = shows.height;
  const grey = document.createElement("canvas");
  grey.width = w;
  grey.height = h;
  const c = grey.getContext("2d");
  if (!c) return;
  c.drawImage(shows, 0, 0);
  const data = c.getImageData(0, 0, w, h);
  alphaToLuminance(data.data, el.layerMaskInvert);
  c.putImageData(data, 0, 0);
  const src = await keepMask(grey, "mask.png");
  if (!src) return;
  // the layer keeps its painted look while the new file loads
  seedAlphaMask(src, el.layerMaskInvert, shows);
  // painting a mask that was off turns it on: you just saw it at work
  dispatch("set_layer_mask", { ids: [el.id], src, label, disabled: false }, "you");
}

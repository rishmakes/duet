/** Layer masks are saved as black and white pictures: white shows the layer, black hides it, grey is see-through. */

/** Turns a black and white mask into see-through pixels, in place. With invert, black shows and white hides. */
export function convertLuminanceToAlpha(data: Uint8ClampedArray | Uint8Array, invert: boolean): void {
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    data[i + 3] = invert ? 255 - lum : lum;
  }
}

/** The way back, for saving what was painted: how much shows becomes white, how much is hidden becomes black. */
export function alphaToLuminance(data: Uint8ClampedArray | Uint8Array, invert: boolean): void {
  for (let i = 0; i < data.length; i += 4) {
    const v = invert ? 255 - data[i + 3] : data[i + 3];
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
}

/** How big a new mask is: as big as the picture under it, or twice the layer's size for anything else, at most 2048 on its long side. */
export function newMaskSize(layer: { width: number; height: number }, picture?: [number, number] | null): [number, number] {
  const [w, h] = picture && picture[0] > 0 && picture[1] > 0 ? picture : [layer.width * 2, layer.height * 2];
  const scale = Math.min(1, 2048 / Math.max(w, h, 1));
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}

/**
 * One rule for the mouse wheel, so every place that zooms agrees.
 *
 * Measured on a Mac in Duet (18 Nov): this mouse sends only up and down steps that grow
 * through a notch (4, 35, 130, 150...) with fractions, while the trackpad sends whole
 * numbers up to about 25, often with a sideways part, every 33 ms. So fractions or
 * big steps with no sideways part mean a wheel, and for 400 ms after one the steps that follow are too.
 */
let wheelUntil = 0;
export function isMouseWheel(e: WheelEvent): boolean {
  if (e.deltaMode !== 0) return true;
  const now = e.timeStamp;
  if (e.deltaX !== 0) {
    wheelUntil = 0;
    return false;
  }
  if (!Number.isInteger(e.deltaY) || Math.abs(e.deltaY) >= 40) wheelUntil = now + 400;
  return now < wheelUntil;
}

/** How much one wheel step zooms: more than 1 zooms in. A whole notch of this mouse adds up to about 1.5 times, since big steps are capped. */
export function wheelZoomFactor(e: WheelEvent): number {
  const lines = e.deltaMode !== 0 ? e.deltaY * 16 : e.deltaY;
  return Math.exp(-Math.max(-60, Math.min(60, lines)) * 0.0025);
}

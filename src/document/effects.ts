/**
 * Effects on pictures and video clips.
 *
 * Each effect runs live on top of the original picture or clip, after colour grading.
 * Adding a new effect kind is one entry in EFFECT_DEFS.
 */

export type EffectKind = "blur" | "sharpen" | "grain" | "glow" | "pixelate";

export interface EffectControl {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step: number;
  unit?: string;
}

export interface EffectDef {
  kind: EffectKind;
  label: string;
  description: string;
  controls: EffectControl[];
}

export interface Effect {
  id: string;
  kind: EffectKind;
  on: boolean;
  values: Record<string, number>;
}

export const EFFECT_DEFS: Record<EffectKind, EffectDef> = {
  blur: {
    kind: "blur",
    label: "Blur",
    description: "Softens the picture by spreading colours into their neighbours.",
    controls: [{ key: "amount", label: "Amount", min: 0, max: 200, default: 20, step: 1, unit: "px" }],
  },
  sharpen: {
    kind: "sharpen",
    label: "Sharpen",
    description: "Brings out edges and fine detail.",
    controls: [
      { key: "amount", label: "Amount", min: 0, max: 100, default: 50, step: 1 },
      { key: "radius", label: "Radius", min: 0.5, max: 10, default: 1, step: 0.5, unit: "px" },
    ],
  },
  grain: {
    kind: "grain",
    label: "Grain",
    description: "Adds subtle film texture across the picture.",
    controls: [
      { key: "amount", label: "Amount", min: 0, max: 100, default: 25, step: 1 },
      { key: "size", label: "Size", min: 1, max: 4, default: 1, step: 1 },
    ],
  },
  glow: {
    kind: "glow",
    label: "Glow",
    description: "Makes the bright parts bleed light into surrounding areas.",
    controls: [
      { key: "amount", label: "Amount", min: 0, max: 100, default: 50, step: 1 },
      { key: "radius", label: "Radius", min: 0, max: 200, default: 20, step: 1, unit: "px" },
    ],
  },
  pixelate: {
    kind: "pixelate",
    label: "Pixelate",
    description: "Turns the picture into visible square blocks of colour.",
    controls: [{ key: "size", label: "Size", min: 1, max: 100, default: 10, step: 1, unit: "px" }],
  },
};

export const EFFECT_KINDS: EffectKind[] = ["blur", "sharpen", "grain", "glow", "pixelate"];

let effectCounter = 0;
export const newEffectId = (kind: EffectKind): string =>
  `effect-${kind}-${Date.now().toString(36)}${(effectCounter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function defaultEffectValues(kind: EffectKind): Record<string, number> {
  const def = EFFECT_DEFS[kind];
  if (!def) return {};
  const vals: Record<string, number> = {};
  for (const c of def.controls) {
    vals[c.key] = c.default;
  }
  return vals;
}

export function newEffect(kind: EffectKind, id?: string): Effect {
  return {
    id: id || newEffectId(kind),
    kind,
    on: true,
    values: defaultEffectValues(kind),
  };
}

export const canHaveEffects = (el: { type: string }): boolean => el.type === "image" || el.type === "video";

export function hasActiveEffects(effects: Effect[] | undefined | null): boolean {
  if (!effects || !effects.length) return false;
  return effects.some((e) => e.on);
}

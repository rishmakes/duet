import { useSyncExternalStore } from "react";

export interface BrushSettings {
  /** Size in picture-file pixels (1–1000, default 40). */
  size: number;
  /** Edge softness (0–1, default 0.5). */
  softness: number;
  /** Stroke opacity (0–1, default 1). */
  opacity: number;
  /** Brush colour in hex/css (default #000000). */
  colour: string;
}

const STORAGE_KEY = "duet:brush";

const DEFAULTS: BrushSettings = {
  size: 40,
  softness: 0.5,
  opacity: 1,
  colour: "#000000",
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function loadSettings(): BrushSettings {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULTS };
    return {
      size: typeof parsed.size === "number" && Number.isFinite(parsed.size) ? clamp(Math.round(parsed.size), 1, 1000) : DEFAULTS.size,
      softness: typeof parsed.softness === "number" && Number.isFinite(parsed.softness) ? clamp(parsed.softness, 0, 1) : DEFAULTS.softness,
      opacity: typeof parsed.opacity === "number" && Number.isFinite(parsed.opacity) ? clamp(parsed.opacity, 0, 1) : DEFAULTS.opacity,
      colour: typeof parsed.colour === "string" && parsed.colour ? parsed.colour : DEFAULTS.colour,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings: BrushSettings) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  } catch {
    // ignore localStorage errors (e.g. sandbox or full quota)
  }
}

let currentSettings: BrushSettings = loadSettings();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      console.warn("Error in brush settings listener:", e);
    }
  }
}

export function getBrushSettings(): BrushSettings {
  return currentSettings;
}

export function setBrushSettings(patch: Partial<BrushSettings>) {
  const next: BrushSettings = {
    size: patch.size !== undefined && Number.isFinite(patch.size) ? clamp(Math.round(patch.size), 1, 1000) : currentSettings.size,
    softness: patch.softness !== undefined && Number.isFinite(patch.softness) ? clamp(patch.softness, 0, 1) : currentSettings.softness,
    opacity: patch.opacity !== undefined && Number.isFinite(patch.opacity) ? clamp(patch.opacity, 0, 1) : currentSettings.opacity,
    colour: patch.colour !== undefined && typeof patch.colour === "string" && patch.colour ? patch.colour : currentSettings.colour,
  };
  if (
    next.size === currentSettings.size &&
    next.softness === currentSettings.softness &&
    next.opacity === currentSettings.opacity &&
    next.colour === currentSettings.colour
  ) {
    return;
  }
  currentSettings = next;
  saveSettings(currentSettings);
  notify();
}

/** Step brush size smaller (-1) or bigger (+1) in intuitive increments. */
export function stepBrushSize(direction: -1 | 1): number {
  const cur = currentSettings.size;
  const step = cur < 10 ? 1 : cur < 20 ? 2 : cur < 50 ? 5 : cur < 100 ? 10 : cur < 300 ? 25 : 50;
  const target = direction > 0 ? Math.floor(cur / step + 1) * step : Math.ceil(cur / step - 1) * step;
  const next = clamp(target === cur ? cur + direction * step : target, 1, 1000);
  setBrushSettings({ size: next });
  return next;
}

export function subscribeBrushSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBrushSettings(): BrushSettings {
  return useSyncExternalStore(subscribeBrushSettings, getBrushSettings, getBrushSettings);
}

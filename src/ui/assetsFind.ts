import { useSyncExternalStore } from "react";
import type { Mode } from "./layout";
/** The chips above the Assets shelves (#338). "all" shows every shelf. */
export type AssetsChip = "all" | "transitions" | "effects" | "yours" | "brand";

export const ASSETS_CHIPS: [AssetsChip, string][] = [
  ["all", "All"],
  ["transitions", "Transitions"],
  ["effects", "Effects"],
  ["yours", "Your styles"],
  ["brand", "Brand kit"],
];

/** The shelves in Assets, top to bottom, and the chip that shows each one alone (none: only under All). */
export const ASSETS_SHELVES = {
  favourites: null,
  transitions: "transitions",
  effects: "effects",
  yours: "yours",
  brand: "brand",
  system: null,
  components: null,
} as const satisfies Record<string, AssetsChip | null>;

export type AssetsShelf = keyof typeof ASSETS_SHELVES;

/** Whether a shelf shows under the picked chip. */
export const shelfOn = (shelf: AssetsShelf, chip: AssetsChip) => chip === "all" || ASSETS_SHELVES[shelf] === chip;

/** Shelves that belong to some kinds of work only: transitions join clips, so they live in Video. Effects are one library everywhere, each effect tagged with where it fits. */
const ONLY_IN: Partial<Record<AssetsShelf, Mode[]>> = { transitions: ["motion"] };

/** Whether a shelf belongs in this kind of work at all. */
export const shelfFits = (shelf: AssetsShelf, mode: Mode) => !ONLY_IN[shelf] || ONLY_IN[shelf]!.includes(mode);

/** The chips for this kind of work: a chip whose shelf does not belong here is left out. */
export const chipsFor = (mode: Mode) => ASSETS_CHIPS.filter(([key]) => (Object.keys(ASSETS_SHELVES) as AssetsShelf[]).every((sh) => ASSETS_SHELVES[sh] !== key || shelfFits(sh, mode)));

/** Whether any of these names holds what the designer typed; an empty search finds everything. */
export function finds(query: string, ...names: string[]): boolean {
  const q = query.trim().toLowerCase();
  return !q || names.some((n) => n.toLowerCase().includes(q));
}

// the picked chip lives outside the panel, so the picker at a cut can open Assets on Transitions
let chip: AssetsChip = "all";
const listeners = new Set<() => void>();

export function setAssetsChip(next: AssetsChip) {
  chip = next;
  listeners.forEach((l) => l());
}

export function useAssetsChip(): AssetsChip {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, () => chip);
}

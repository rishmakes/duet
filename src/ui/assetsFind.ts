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

/** Whether any of these names holds what the designer typed; an empty search finds everything. */
export function finds(query: string, ...names: string[]): boolean {
  const q = query.trim().toLowerCase();
  return !q || names.some((n) => n.toLowerCase().includes(q));
}

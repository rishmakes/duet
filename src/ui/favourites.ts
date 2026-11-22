import { useSyncExternalStore } from "react";

/**
 * Favourites (#338): any tile in Assets can be starred, and it waits on the Favourites shelf and in the
 * picker at a cut. Kept on this computer for every project, as "transition:dissolve" or "style:<id>".
 */
const KEY = "duet.assets.favourites";

export const faveOf = {
  transition: (kind: string) => `transition:${kind}`,
  style: (id: string) => `style:${id}`,
};

/** Stars a thing that is not starred, or takes the star off one that is. New ones come first. */
export const toggleIn = (list: string[], key: string): string[] => (list.includes(key) ? list.filter((k) => k !== key) : [key, ...list]);

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

let faves: string[] | null = null;
const listeners = new Set<() => void>();
const get = (): string[] => (faves ??= read());

export function toggleFavourite(key: string) {
  faves = toggleIn(get(), key);
  try {
    localStorage.setItem(KEY, JSON.stringify(faves));
  } catch {
    /* kept for this session only */
  }
  listeners.forEach((l) => l());
}

export function useFavourites(): string[] {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, get);
}

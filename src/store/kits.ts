import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { kitFromDoc, readKit } from "../commands/designSystem";
import type { Kit } from "../commands/designSystem";
import type { Doc } from "../document/types";

/**
 * Kits: a design system made once and used in any project. Each is one file in `~/.duet/kits/`,
 * with its pieces inside it, so it can also be sent to someone else.
 */
export interface SavedKit {
  /** `kit-<file name>`, unique among things in the Store. */
  id: string;
  kit: Kit;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

let kits: SavedKit[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadKits() {
  try {
    const list = await invoke<{ id: string; body: string }[]>("list_kits");
    kits = list.flatMap(({ id, body }) => {
      const kit = readKit(body);
      return kit ? [{ id: `kit-${id}`, kit }] : [];
    });
  } catch {
    kits = [];
  }
  emit();
}

export const getKits = () => kits;
export function useKits(): SavedKit[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => kits,
  );
}

/** Save the project's design system as a kit. A kit with the same name is brought up to date. */
export async function saveKit(doc: Doc, name: string): Promise<{ id: string } | { error: string }> {
  const file = slug(name);
  if (!name.trim() || !file) return { error: "Give the kit a name." };
  const kit = kitFromDoc(doc, name);
  if (!kit.colours.length && !kit.fonts.length && !kit.textStyles.length && !kit.pieces.length && !kit.spacing?.length) return { error: "This project has no design system yet." };
  try {
    await invoke("write_kit", { id: file, body: JSON.stringify(kit, null, 2) });
  } catch (e) {
    return { error: String(e) };
  }
  await loadKits();
  return { id: `kit-${file}` };
}

export async function deleteKit(id: string) {
  try {
    await invoke("delete_kit", { id: id.replace(/^kit-/, "") });
  } catch {
    /* ignore */
  }
  await loadKits();
}

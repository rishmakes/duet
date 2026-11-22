import { useSyncExternalStore } from "react";
import { copyLook, nameStyle } from "../document/captions";
import type { CustomLook } from "../document/captions";
import type { El } from "../document/types";

/** Caption styles the designer saved under a name (#404, #338), kept on this computer for every project. */
const KEY = "duet.captions.custom";

function read(): CustomLook[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    // looks Duet once kept by itself had no name; only the ones the designer named stay
    return Array.isArray(v) ? v.filter((l) => l && typeof l.id === "string" && typeof l.name === "string" && l.props) : [];
  } catch {
    return [];
  }
}

let looks: CustomLook[] | null = null;
const listeners = new Set<() => void>();

const get = (): CustomLook[] => (looks ??= read());

function write(next: CustomLook[]) {
  if (next === looks) return;
  looks = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* kept for this session only */
  }
  listeners.forEach((l) => l());
}

/** An empty name changes nothing. */
export const renameLook = (id: string, name: string) => name.trim() && write(get().map((l) => (l.id === id ? { ...l, name: name.trim() } : l)));

/** Keeps the style the captions have now under a name the designer gives it. */
export const saveStyle = (props: Partial<El>, name: string) => write(nameStyle(get(), props, name, () => crypto.randomUUID()));

export const duplicateLook = (id: string) => write(copyLook(get(), id, () => crypto.randomUUID()));

export const removeLook = (id: string) => write(get().filter((l) => l.id !== id));

export function useCustomLooks(): CustomLook[] {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, get);
}

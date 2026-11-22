import { useSyncExternalStore } from "react";
import { copyLook, keepCustom, nameStyle, sameLook } from "../document/captions";
import type { CustomLook } from "../document/captions";
import type { El } from "../document/types";

/** Caption looks the designer made (#404), kept on this computer for every project. */
const KEY = "duet.captions.custom";

function read(): CustomLook[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((l) => l && typeof l.id === "string" && (l.name === null || typeof l.name === "string") && l.props) : [];
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

/** The style of the last look removed, so a style still on the captions does not come straight back. */
let removed: Partial<El> | null = null;

/** The style the captions have now goes into the Custom look, unless it already is a look. */
export function keepStyle(props: Partial<El>) {
  if (!sameLook(props, removed)) write(keepCustom(get(), props, () => crypto.randomUUID()));
}

/** A named look stays as it is; the next new style starts a new Custom look. An empty name changes nothing. */
export const renameLook = (id: string, name: string) => name.trim() && write(get().map((l) => (l.id === id ? { ...l, name: name.trim() } : l)));

/** Keeps the style the captions have now under a name the designer gives it. */
export const saveStyle = (props: Partial<El>, name: string) => write(nameStyle(get(), props, name, () => crypto.randomUUID()));

export const duplicateLook = (id: string) => write(copyLook(get(), id, () => crypto.randomUUID()));

export function removeLook(id: string) {
  removed = get().find((l) => l.id === id)?.props ?? null;
  write(get().filter((l) => l.id !== id));
}

export function useCustomLooks(): CustomLook[] {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, get);
}

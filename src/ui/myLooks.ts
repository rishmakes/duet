import { useSyncExternalStore } from "react";
import type { MyLook } from "../document/captions";

/** Caption looks the designer saved, kept on this computer for every project. */
const KEY = "duet.captions.mine";

function read(): MyLook[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((l) => l && typeof l.id === "string" && typeof l.name === "string" && l.props) : [];
  } catch {
    return [];
  }
}

let looks: MyLook[] | null = null;
const listeners = new Set<() => void>();

export function getMyLooks(): MyLook[] {
  if (!looks) looks = read();
  return looks;
}

function write(next: MyLook[]) {
  looks = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* kept for this session only */
  }
  listeners.forEach((l) => l());
}

export const saveMyLook = (look: MyLook) => write([...getMyLooks(), look]);
export const removeMyLook = (id: string) => write(getMyLooks().filter((l) => l.id !== id));

export function useMyLooks(): MyLook[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getMyLooks,
  );
}

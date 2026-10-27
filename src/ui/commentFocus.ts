import { useSyncExternalStore } from "react";

/** The comment open on the canvas, shared by its pin and the list of comments. */
let open: string | null = null;
const listeners = new Set<() => void>();

export function setOpenComment(id: string | null) {
  open = id;
  listeners.forEach((l) => l());
}

/** Open a comment and bring its spot to the middle of the canvas. */
export function showComment(id: string) {
  setOpenComment(id);
  window.dispatchEvent(new CustomEvent("duet:show-comment", { detail: id }));
}

export function useOpenComment(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => open,
  );
}

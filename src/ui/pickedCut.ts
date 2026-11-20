import { useSyncExternalStore } from "react";
import { dispatch, getState, select, subscribe } from "../state/store";

/**
 * The transition picked by its badge on the timeline, named by the clip coming in. Picking it picks no
 * clip, so the clips stay as they were and Delete takes away only the transition. Picking anything
 * else lets it go.
 */
let picked: string | null = null;
const watchers = new Set<() => void>();
const tell = () => watchers.forEach((w) => w());

export function pickCut(id: string | null) {
  if (id && getState().selection.length) select([]);
  picked = id;
  tell();
}

export const getPickedCut = () => picked;

// a thing picked anywhere, on the canvas, the timeline or the layers, takes the place of the transition
subscribe(() => {
  if (picked && getState().selection.length) {
    picked = null;
    tell();
  }
});

// Delete takes away the picked transition and leaves a plain cut; Escape lets it go
if (typeof window !== "undefined")
  window.addEventListener(
    "keydown",
    (e) => {
      if (!picked) return;
      const on = document.activeElement as HTMLElement | null;
      if (
        on &&
        (on.tagName === "INPUT" ||
          on.tagName === "TEXTAREA" ||
          on.tagName === "SELECT" ||
          on.isContentEditable)
      )
        return;
      if (e.key === "Escape") return pickCut(null);
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      dispatch("set_transition", { ids: [picked], kind: "cut" });
      pickCut(null);
    },
    true,
  );

const watch = (w: () => void) => {
  watchers.add(w);
  return () => void watchers.delete(w);
};

/** The clip coming in at the picked transition, or null. */
export const usePickedCut = (): string | null =>
  useSyncExternalStore(watch, getPickedCut);

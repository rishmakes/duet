import { useSyncExternalStore } from "react";
import type { CutMove } from "../document/types";
import { currentDoc, dispatch, getState, select, subscribe } from "../state/store";

/**
 * The cut picked on the timeline, by its badge or its "+", named by the clip coming in. Picking it picks no
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

/**
 * The transition last copied, kind and length, so it can be put on another cut. Kept in this window only:
 * the system clipboard keeps whatever was copied before, text or things.
 */
let copied: CutMove | null = null;

export const getCopiedCut = () => copied;

/** Keep the transition at the cut before this clip, so it can be pasted on another cut. */
export function copyCut(id: string) {
  const move = currentDoc(getState()).elements[id]?.cutIn;
  if (move) copied = { ...move };
}

/** Put the copied transition, with its length, on the cut before this clip, and pick it. */
export function pasteCut(id: string) {
  if (!copied) return;
  dispatch("set_transition", { ids: [id], kind: copied.kind, seconds: copied.seconds });
  pickCut(id);
}

/** What a key does to the picked cut, or null when it is not for the cut and goes on as usual. */
export type CutKey = "copy" | "paste" | "remove" | "let-go";

export function cutKeyAction(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean },
  at: { picked: boolean; hasMove: boolean; copied: boolean; typing: boolean },
): CutKey | null {
  if (!at.picked || at.typing) return null;
  if (e.key === "Escape") return "let-go";
  if ((e.key === "Delete" || e.key === "Backspace") && at.hasMove) return "remove";
  const command = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
  const k = e.key.toLowerCase();
  if (command && k === "c" && at.hasMove) return "copy";
  if (command && k === "v" && at.copied) return "paste";
  return null;
}

const typingIn = (on: Element | null) => {
  const el = on as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

// Keys on a picked cut, caught on the key itself: the Mac sends no copy or paste to the page when no text
// is selected, and a picked cut selects none. Nothing picked, and the keys go on to clips and things as usual.
if (typeof window !== "undefined")
  window.addEventListener(
    "keydown",
    (e) => {
      const act = cutKeyAction(e, {
        picked: !!picked,
        hasMove: !!(picked && currentDoc(getState()).elements[picked]?.cutIn),
        copied: !!copied,
        typing: typingIn(document.activeElement),
      });
      if (!act || !picked) return;
      // Escape also goes on, so an open menu closes with it
      if (act === "let-go") return pickCut(null);
      e.preventDefault();
      e.stopImmediatePropagation();
      if (act === "copy") copyCut(picked);
      else if (act === "paste") pasteCut(picked);
      else {
        dispatch("set_transition", { ids: [picked], kind: "cut" });
        pickCut(null);
      }
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

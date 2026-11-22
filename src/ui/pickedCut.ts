import { useSyncExternalStore } from "react";
import { CUT_MOVES } from "../document/types";
import type { CutMove, CutMoveKind } from "../document/types";
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

// the transitions you used last come first in the picker; kept on this computer only, so a lost list just falls back to the usual order
const RECENT_KEY = "duet.cuts.recent";
export const recentKinds = (): CutMoveKind[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((k): k is CutMoveKind => (CUT_MOVES as readonly string[]).includes(k)) : [];
  } catch {
    return [];
  }
};
const usedKind = (kind: CutMoveKind) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([kind, ...recentKinds().filter((k) => k !== kind)]));
  } catch {
    // nothing to keep it in: the order stays the usual one
  }
};

/**
 * Put a transition on the cut before this clip, or take it away with "cut". The one way it happens by hand:
 * from the picker at a cut, a tile dropped on a cut, or a tile clicked while a cut is picked. A transition put
 * on is picked, so its settings show; one taken away lets go.
 */
export function putTransition(id: string, kind: CutMoveKind | "cut") {
  if (kind !== "cut") usedKind(kind);
  dispatch("set_transition", { ids: [id], kind });
  pickCut(kind === "cut" ? null : id);
}

/** What a transition tile carries while it is dragged to a cut. */
export const TRANSITION_DRAG = "application/x-duet-transition";

/** The kind a drag carries, if it is a transition tile's. */
export const draggedKind = (types: readonly string[], read: (t: string) => string): CutMoveKind | null => {
  if (!types.includes(TRANSITION_DRAG)) return null;
  const k = read(TRANSITION_DRAG);
  return (CUT_MOVES as readonly string[]).includes(k) ? (k as CutMoveKind) : null;
};

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
      else putTransition(picked, "cut");
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

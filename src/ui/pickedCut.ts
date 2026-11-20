import { useSyncExternalStore } from "react";
import { getState, select, useStore } from "../state/store";

/**
 * The cut picked by its transition badge on the timeline: the clip coming in. It holds only while the
 * selection is the one picking it made, so picking anything else, even the same clip, lets it go.
 */
let picked: { id: string; selection: string[] } | null = null;
const watchers = new Set<() => void>();

export function pickCut(id: string | null) {
  if (id) {
    select([id]);
    picked = { id, selection: getState().selection };
  } else picked = null;
  watchers.forEach((w) => w());
}

const watch = (w: () => void) => {
  watchers.add(w);
  return () => void watchers.delete(w);
};

/** The clip coming in at the picked cut, or null when no cut is picked. */
export function usePickedCut(): string | null {
  const p = useSyncExternalStore(watch, () => picked);
  const selection = useStore((s) => s.selection);
  return p && p.selection === selection ? p.id : null;
}

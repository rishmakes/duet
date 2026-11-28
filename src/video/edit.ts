import { cuttable, newId, runCommand } from "../commands";
import { currentDoc, dispatch, getState, restoreDoc, select } from "../state/store";
import { seek } from "./play";

/**
 * Cutting at the playhead, the same from a key or from the toolbar. What is selected is cut, and with
 * nothing selected under the playhead, everything there is.
 *   split   cut here (S)
 *   remove  delete what is selected and close the gap (D)
 *   before  take away what comes before the playhead, and close the gap (Q)
 *   after   take away what comes after the playhead, and close the gap (W)
 */
export type CutKind = "split" | "remove" | "before" | "after";

export function cutNow(kind: CutKind) {
  const s = getState();
  const sceneId = s.clock.scene;
  if (!sceneId) return;
  const now = currentDoc(s);
  const t = s.clock.t;
  const mine = s.selection.filter((id) => now.elements[id]?.parentId === sceneId);
  if (kind === "remove") {
    // only their own tracks close up, so music and the rest stay where they are (#236)
    if (mine.length) dispatch("ripple_delete", { ids: mine, ownTrack: true });
    return;
  }
  let under = cuttable(now, sceneId, t, mine.length ? mine : undefined);
  if (!under.length) under = cuttable(now, sceneId, t);
  if (!under.length) return;
  if (kind === "split") {
    dispatch("split_at", { sceneId, t, ids: under });
    return;
  }
  const newIds = Object.fromEntries(under.map((id) => [id, newId(now.elements[id].type)]));
  const cut = runCommand(now, "split_at", { sceneId, t, ids: under, newIds });
  const out = runCommand(cut, "ripple_delete", { ids: kind === "before" ? under : Object.values(newIds) });
  restoreDoc(out, kind === "before" ? "Cut away what comes before" : "Cut away what comes after");
  if (kind === "before") {
    seek(Math.min(...under.map((id) => now.elements[id].start)));
    select(Object.values(newIds));
  }
}

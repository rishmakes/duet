import { makePaintLayer, pastePayload } from "../canvas/CanvasView";
import { newId } from "../commands";
import { extractPayload } from "../document/clipboard";
import { canBeComponent } from "../document/components";
import { canMask } from "../document/geometry";
import { defaultLayout } from "../document/layout";
import type { Doc, El } from "../document/types";
import { message } from "./dialog";
import { tracePicture } from "../project/trace";
import { currentDoc, dispatch, getState, select } from "../state/store";

/** Things you can do with the selection. The menus, the right-click menu and the panel all use these. */

const picked = () => {
  const doc = currentDoc();
  return { doc, els: getState().selection.map((i) => doc.elements[i]).filter(Boolean) };
};

export function duplicateSelection() {
  const { doc, els } = picked();
  const p = extractPayload(doc, els.map((e) => e.id));
  if (p) pastePayload(p, true);
}

export function groupSelection() {
  const { els } = picked();
  if (!els.length) return;
  const id = newId("group");
  dispatch("group_elements", { ids: els.map((e) => e.id), groupId: id });
  if (currentDoc().elements[id]) select([id]);
}

/**
 * Which of the chosen things would be the mask. If only one of them is a plain shape, it is that one,
 * wherever it sits in the stack. If several are, it is the one at the bottom. Null when it cannot be done.
 */
export function maskChoice(doc: Doc, els: El[]): El | null {
  if (els.length < 2 || !els.every((e) => (e.parentId ?? null) === (els[0].parentId ?? null))) return null;
  const shapes = els.filter(canMask);
  if (shapes.length === 0) return null;
  const order = els[0].parentId ? doc.elements[els[0].parentId].childIds : doc.rootIds;
  return [...shapes].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))[0];
}

/** Show the chosen things only inside the chosen shape. */
export function maskSelection() {
  const { doc, els } = picked();
  const shape = maskChoice(doc, els);
  if (!shape) return;
  const id = newId("group");
  dispatch("make_mask", { maskId: shape.id, ids: els.filter((e) => e !== shape).map((e) => e.id), groupId: id });
  if (currentDoc().elements[id]) select([id]);
}

/** Turn the chosen picture into flat drawn shapes, laid over it. Says why when it cannot. */
export async function traceSelection() {
  const { els } = picked();
  const result = els.length === 1 && els[0].type === "image" ? await tracePicture(els[0].id) : { why: "Choose one picture to trace." };
  if ("why" in result) await message(result.why, { title: "Duet" }).catch(() => console.warn(result.why));
}

export function ungroupSelection() {
  const { els } = picked();
  const kids = els.flatMap((e) => (e.type === "group" ? e.childIds : []));
  if (!kids.length) return;
  dispatch("ungroup", { ids: els.map((e) => e.id) });
  select(kids);
}

export function makeComponent() {
  for (const e of picked().els) if (canBeComponent(e)) dispatch("create_component", { id: e.id });
}

export function detachSelection() {
  for (const e of picked().els) if (e.type === "instance") dispatch("detach_instance", { id: e.id });
}

export function toggleLock() {
  const { els } = picked();
  if (!els.length) return;
  const lock = !els.every((e) => e.locked);
  dispatch("set_props", { ids: els.map((e) => e.id), props: { locked: lock }, label: lock ? "Lock" : "Unlock" });
}

export function toggleAutoLayout() {
  const { els } = picked();
  if (!els.length) return;
  if (els.length === 1 && els[0].type === "frame") {
    dispatch("set_layout", { id: els[0].id, layout: els[0].layout ? null : defaultLayout() });
    return;
  }
  const id = newId("frame");
  dispatch("wrap_in_layout", { ids: els.map((e) => e.id), frameId: id });
  if (currentDoc().elements[id]) select([id]);
}

export function deleteSelection() {
  const { els } = picked();
  if (!els.length) return;
  dispatch("delete_elements", { ids: els.map((e) => e.id) });
  select([]);
}

/** Where a new paint layer would go: straight over the picked picture, or over the frame the pick is in. Null when there is nowhere. */
export function paintLayerSpot(doc: Doc, els: El[]): { above: El } | { frameId: string } | null {
  if (els.length !== 1) return null;
  if (els[0].type === "image") return { above: els[0] };
  for (let el: El | undefined = els[0]; el; el = el.parentId ? doc.elements[el.parentId] : undefined) {
    if (el.type === "frame") return { frameId: el.id };
  }
  return null;
}

/** A new clear layer to paint on, picked so the brush paints on it next. */
export async function newPaintLayer() {
  const { doc, els } = picked();
  const spot = paintLayerSpot(doc, els);
  if (!spot) return;
  const id = await makePaintLayer(spot);
  if (id) select([id]);
}

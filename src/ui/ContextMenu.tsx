import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { playsFile } from "../document/types";
import { logError } from "../errorLog";
import { pastePayload } from "../canvas/CanvasView";
import { newId } from "../commands";
import { defaultLayout } from "../document/layout";
import { extractPayload } from "../document/clipboard";
import { currentDoc, dispatch, getState, select } from "../state/store";
import { maskChoice, maskSelection, newPaintLayer, paintLayerSpot, traceSelection } from "./actions";
import { getLayout } from "./layout";
import { canBeComponent } from "../document/components";
import { useDismiss } from "./useDismiss";

/** What you can do with the selection, found where you right-click. */
interface Item {
  label: string;
  hint?: string;
  run: () => void;
}

function itemsFor(): Item[] {
  const s = getState();
  const doc = currentDoc(s);
  const els = s.selection.map((i) => doc.elements[i]).filter(Boolean);
  if (els.length === 0) return [];
  const ids = els.map((e) => e.id);
  const one = els.length === 1 ? els[0] : null;
  const out: Item[] = [];

  out.push({
    label: "Duplicate",
    hint: "Cmd D",
    run: () => {
      const p = extractPayload(doc, ids);
      if (p) pastePayload(p, true);
    },
  });

  // a clip or a sound is kept where it is on the computer, so it can be shown there; pictures are saved inside the file
  if (one && playsFile(one) && one.src) out.push({ label: "Show in Finder", run: () => void revealItemInDir(one.src).catch((e) => logError("show in finder", e)) });

  if (canBeComponent(one ?? undefined)) {
    out.push({ label: "Make a component", hint: "Cmd Option K", run: () => dispatch("create_component", { id: one!.id }) });
  }
  if (one?.type === "instance") out.push({ label: "Detach from the original", hint: "Cmd Option B", run: () => dispatch("detach_instance", { id: one.id }) });
  if (one?.type === "instance") out.push({ label: "Go to the original", run: () => select([one.componentId]) });

  out.push({ label: "Bring forward", hint: "Cmd ]", run: () => dispatch("arrange_elements", { ids, to: "up" }) });
  out.push({ label: "Bring to front", hint: "Shift Cmd ]", run: () => dispatch("arrange_elements", { ids, to: "top" }) });
  out.push({ label: "Send backward", hint: "Cmd [", run: () => dispatch("arrange_elements", { ids, to: "down" }) });
  out.push({ label: "Send to back", hint: "Shift Cmd [", run: () => dispatch("arrange_elements", { ids, to: "bottom" }) });

  out.push({
    label: "Group",
    hint: "Cmd G",
    run: () => {
      const id = newId("group");
      dispatch("group_elements", { ids, groupId: id });
      if (currentDoc().elements[id]) select([id]);
    },
  });
  if (getLayout().mode === "photo" && paintLayerSpot(doc, els)) out.push({ label: "New paint layer", hint: "Shift Cmd N", run: () => void newPaintLayer() });
  if (one?.type === "image") out.push({ label: "Trace into shapes", run: () => void traceSelection() });
  if (maskChoice(doc, els)) out.push({ label: "Use as mask", hint: "Cmd Option M", run: maskSelection });
  if (els.some((e) => e.type === "group")) {
    out.push({
      label: els.every((e) => e.type === "group" && e.mask) ? "Remove the mask" : "Ungroup",
      hint: "Shift Cmd G",
      run: () => {
        const kids = els.flatMap((e) => (e.type === "group" ? e.childIds : []));
        dispatch("ungroup", { ids });
        if (kids.length) select(kids);
      },
    });
  }

  if (one?.type === "frame") {
    out.push({
      label: one.layout ? "Remove auto layout" : "Add auto layout",
      hint: "Shift A",
      run: () => dispatch("set_layout", { id: one.id, layout: one.layout ? null : defaultLayout() }),
    });
  } else {
    out.push({
      label: "Add auto layout around this",
      hint: "Shift A",
      run: () => {
        const id = newId("frame");
        dispatch("wrap_in_layout", { ids, frameId: id });
        if (currentDoc().elements[id]) select([id]);
      },
    });
  }

  const locked = els.every((e) => e.locked);
  out.push({ label: locked ? "Unlock" : "Lock", hint: "Shift Cmd L", run: () => dispatch("set_props", { ids, props: { locked: !locked }, label: locked ? "Unlock" : "Lock" }) });
  out.push({
    label: "Delete",
    hint: "Delete",
    run: () => {
      dispatch("delete_elements", { ids });
      select([]);
    },
  });
  return out;
}

/** A small menu that opens where you right-click, on the canvas or in the layers list. */
export default function ContextMenu() {
  const [at, setAt] = useState<{ x: number; y: number; items: Item[] } | null>(null);
  useDismiss(!!at, () => setAt(null), ".ctx");

  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent<{ x: number; y: number }>).detail;
      const items = itemsFor();
      setAt(items.length ? { x: d.x, y: d.y, items } : null);
    };
    window.addEventListener("duet:context", open);
    return () => window.removeEventListener("duet:context", open);
  }, []);

  if (!at) return null;
  const x = Math.min(at.x, window.innerWidth - 230);
  const y = Math.min(at.y, window.innerHeight - at.items.length * 30 - 20);
  return (
    <div className="ctx" style={{ left: x, top: y }}>
      {at.items.map((it) => (
        <div
          key={it.label}
          className="ctx-item"
          onClick={() => {
            setAt(null);
            it.run();
          }}
        >
          <span>{it.label}</span>
          {it.hint && <kbd>{it.hint}</kbd>}
        </div>
      ))}
    </div>
  );
}

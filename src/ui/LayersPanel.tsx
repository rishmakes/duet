import { lengthText } from "../canvas/render";
import AssetsPanel from "./AssetsPanel";
import Icon from "./Icons";
import { useEffect, useRef, useState } from "react";
import { ancestors, descendants, topLevelOnly } from "../document/geometry";
import type { Doc, El } from "../document/types";
import { currentDoc, dispatch, getState, select, useStore } from "../state/store";
import SkillsPanel from "./SkillsPanel";

/** Which parent IDs are currently folded and need to be unfolded for this selection. */
export function idsToUnfoldForSelection(
  doc: Doc,
  selection: readonly string[],
  folded?: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const id of selection) {
    for (const a of ancestors(doc, id)) {
      if (!folded || folded.has(a)) {
        out.add(a);
      }
    }
  }
  return out;
}

/** Fold or unfold an element, optionally including all its descendants (e.g. Option click). */
export function toggleFold(
  folded: ReadonlySet<string>,
  id: string,
  deep: boolean,
  doc: Doc,
): Set<string> {
  const next = new Set(folded);
  const isFolded = folded.has(id);
  const targets = deep ? [id, ...descendants(doc, id)] : [id];

  if (isFolded) {
    for (const t of targets) next.delete(t);
  } else {
    for (const t of targets) {
      if ((doc.elements[t]?.childIds.length ?? 0) > 0) {
        next.add(t);
      }
    }
  }
  return next;
}

/** Every row in the order the list shows it, front first, leaving out what sits inside a folded one. */
export function rowsInOrder(doc: Doc, folded: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const walk = (ids: string[]) => {
    for (const id of [...ids].reverse()) {
      const el = doc.elements[id];
      if (!el) continue;
      out.push(id);
      if (!folded.has(id)) walk(el.childIds);
    }
  };
  walk(doc.rootIds);
  return out;
}

/** The rows from the one clicked before to this one, both included. */
export function rowsBetween(order: string[], from: string | null, to: string): string[] {
  const a = from ? order.indexOf(from) : -1;
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** The row a Shift click counts from: the last one clicked without Shift. */
let anchor: string | null = null;

type Zone = "before" | "after" | "inside";
interface Drop {
  id: string | null; // null means the empty space at the bottom of the list
  zone: Zone;
}

function LayerIcon({ el }: { el: El }) {
  const type = el.type;
  const name = el.component ? "component" : type === "instance" ? "instance" : type === "text" ? "text" : type === "group" ? (el.mask ? "mask" : "group") : type === "image" ? "image" : type === "path" ? "pen" : type === "frame" ? "frame" : type === "ellipse" ? "ellipse" : "rect";
  return <Icon name={name} size={14} className="ico" />;
}

interface DndProps {
  drop: Drop | null;
  setDrop: (d: Drop | null) => void;
  onStart: (id: string) => void;
  onDropOn: (d: Drop) => void;
  canDrop: (targetId: string) => boolean;
}

interface RowProps {
  doc: Doc;
  id: string;
  depth: number;
  dnd: DndProps;
  folded: ReadonlySet<string>;
  onToggleFold: (id: string, deep: boolean) => void;
}

function Row({ doc, id, depth, dnd, folded, onToggleFold }: RowProps) {
  const el = doc.elements[id];
  const selection = useStore((s) => s.selection);
  const [renaming, setRenaming] = useState(false);
  if (!el) return null;
  const selected = selection.includes(id);
  const over = dnd.drop?.id === id ? dnd.drop.zone : null;
  const hasChildren = el.childIds.length > 0;
  const isFolded = folded.has(id);

  const commitName = (value: string) => {
    setRenaming(false);
    const name = value.trim();
    if (name && name !== el.name) dispatch("set_props", { ids: [id], props: { name }, label: "Rename" });
  };

  const zoneFor = (e: React.DragEvent<HTMLDivElement>): Zone => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    if (el.type === "frame") return t < 0.25 ? "before" : t > 0.75 ? "after" : "inside";
    return t < 0.5 ? "before" : "after";
  };

  return (
    <>
      <div
        className={`row ${selected ? "sel" : ""} ${el.hidden ? "is-hidden" : ""} ${over ? `drop-${over}` : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={!renaming}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", id);
          dnd.onStart(id);
        }}
        onDragOver={(e) => {
          if (!dnd.canDrop(id)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const zone = zoneFor(e);
          if (dnd.drop?.id !== id || dnd.drop.zone !== zone) dnd.setDrop({ id, zone });
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dnd.onDropOn({ id, zone: zoneFor(e) });
        }}
        onClick={(e) => {
          // Cmd adds or takes away one, Shift picks every row from the last one clicked to this one
          if (e.metaKey || e.ctrlKey) {
            anchor = id;
            select(selected ? selection.filter((i) => i !== id) : [...selection, id]);
          } else if (e.shiftKey) select(rowsBetween(rowsInOrder(doc, folded), anchor, id));
          else {
            anchor = id;
            select([id]);
            window.dispatchEvent(new CustomEvent("duet:reveal", { detail: [id] }));
          }
        }}
        onDoubleClick={() => setRenaming(true)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!selected) select([id]);
          window.dispatchEvent(new CustomEvent("duet:context", { detail: { x: e.clientX, y: e.clientY } }));
        }}
      >
        {hasChildren ? (
          <span
            className={`fold-arrow ${isFolded ? "folded" : ""}`}
            title={isFolded ? "Unfold" : "Fold"}
            draggable={false}
            onDragStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleFold(id, e.altKey);
            }}
          >
            <Icon name="arrow" size={12} />
          </span>
        ) : (
          <span className="fold-arrow-gap" />
        )}
        <LayerIcon el={el} />
        {renaming ? (
          <input
            className="rename"
            autoFocus
            defaultValue={el.name}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commitName(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <span className="name">
            {el.name}
            {el.duration > 0 && (
              <i className="scene-mark" title="A scene: this frame plays">
                ▶ {lengthText(el.duration)}
              </i>
            )}
          </span>
        )}
        <span
          className={`lockbtn eyebtn ${el.hidden ? "on" : ""}`}
          title={el.hidden ? "Show" : "Hide, so it is not drawn, picked or exported"}
          onClick={(e) => {
            e.stopPropagation();
            dispatch("set_props", { ids: [id], props: { hidden: !el.hidden }, label: el.hidden ? "Show" : "Hide" });
          }}
        >
          <Icon name={el.hidden ? "eye-off" : "eye"} size={13} />
        </span>
        <span
          className={`lockbtn ${el.locked ? "on" : ""}`}
          title={el.locked ? "Unlock" : "Lock, so it cannot be picked on the canvas (Shift Cmd L)"}
          onClick={(e) => {
            e.stopPropagation();
            dispatch("set_props", { ids: [id], props: { locked: !el.locked }, label: el.locked ? "Unlock" : "Lock" });
          }}
        >
          <Icon name={el.locked ? "lock" : "unlock"} size={13} />
        </span>
      </div>
      {!isFolded &&
        [...el.childIds].reverse().map((c) => (
          <Row
            key={c}
            doc={doc}
            id={c}
            depth={depth + 1}
            dnd={dnd}
            folded={folded}
            onToggleFold={onToggleFold}
          />
        ))}
    </>
  );
}

export default function LayersPanel() {
  useStore((s) => s.timeline[s.cursor]);
  useStore((s) => s.transientDoc);
  const selection = useStore((s) => s.selection);
  const doc = currentDoc();
  const [drop, setDrop] = useState<Drop | null>(null);
  const [tab, setTab] = useState<"layers" | "assets" | "skills">("layers");
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const dragging = useRef<string[]>([]);

  useEffect(() => {
    if (selection.length === 0) return;
    setFolded((prev) => {
      const toUnfold = idsToUnfoldForSelection(doc, selection, prev);
      if (toUnfold.size === 0) return prev;
      const next = new Set(prev);
      for (const id of toUnfold) next.delete(id);
      return next;
    });
  }, [selection, doc]);

  const onToggleFold = (id: string, deep: boolean) => {
    setFolded((prev) => toggleFold(prev, id, deep, doc));
  };

  const end = () => {
    dragging.current = [];
    setDrop(null);
  };

  /** Where would things land? Translate a visual drop target into a parent and a position. */
  const apply = (d: Drop) => {
    const ids = dragging.current;
    end();
    if (ids.length === 0) return;
    let parentId: string | null = null;
    let index: number | undefined;
    let label = "Reorder layers";

    if (d.id === null) {
      parentId = null; // bottom of the list: back to the page, in front
    } else {
      const target = doc.elements[d.id];
      if (d.zone === "inside" && target.type === "frame") {
        parentId = target.id;
        label = `Move into ${target.name}`;
      } else {
        parentId = target.parentId;
        const siblings = parentId ? doc.elements[parentId].childIds : doc.rootIds;
        const at = siblings.indexOf(target.id);
        // The list is shown front to back, so "above" a row means later in the array.
        index = d.zone === "before" ? at + 1 : at;
        label = parentId ? `Move into ${doc.elements[parentId].name}` : "Move out of frame";
        if (ids.every((i) => (doc.elements[i].parentId ?? null) === parentId)) label = "Reorder layers";
      }
    }
    dispatch("reparent_elements", { ids, parentId, index, label });
  };

  const dnd: DndProps = {
    drop,
    setDrop,
    onStart: (id) => {
      const selection = getState().selection;
      // Dragging a selected layer drags the whole selection, keeping its stacking order.
      if (selection.includes(id)) {
        const picked = new Set(topLevelOnly(currentDoc(), selection));
        const order: string[] = [];
        const walk = (ids: string[]) =>
          ids.forEach((i) => {
            if (picked.has(i)) order.push(i);
            walk(currentDoc().elements[i]?.childIds ?? []);
          });
        walk(currentDoc().rootIds);
        dragging.current = order;
      } else {
        dragging.current = [id];
      }
    },
    onDropOn: apply,
    canDrop: (targetId) => {
      const ids = dragging.current;
      if (ids.length === 0) return false;
      return !ids.some((i) => i === targetId || descendants(doc, i).includes(targetId));
    },
  };

  return (
    <aside className="left">
      {/* the tabs and the hint stay put while the list under them scrolls */}
      <div className="left-head">
      <div className="tabs">
        <div className={`tab ${tab === "layers" ? "on" : ""}`} onClick={() => setTab("layers")}>
          Layers
        </div>
        <div className={`tab ${tab === "assets" ? "on" : ""}`} onClick={() => setTab("assets")}>
          Assets
        </div>
        <div className={`tab ${tab === "skills" ? "on" : ""}`} onClick={() => setTab("skills")}>
          Skills
        </div>
      </div>
      {tab === "layers" && <div className="tip-line">Click a layer to find it. Cmd or Ctrl click to zoom to it.</div>}
      </div>
      {tab === "skills" && <SkillsPanel />}
      {tab === "assets" && <AssetsPanel />}
      <div
        className="layers"
        hidden={tab !== "layers"}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
        }}
        onDragEnd={end}
      >
        {doc.rootIds.length === 0 && <div className="empty">Nothing here yet.</div>}
        {[...doc.rootIds].reverse().map((id) => (
          <Row
            key={id}
            doc={doc}
            id={id}
            depth={0}
            dnd={dnd}
            folded={folded}
            onToggleFold={onToggleFold}
          />
        ))}
        <div
          className={`tail ${drop?.id === null && drop ? "drop-end" : ""}`}
          onDragOver={(e) => {
            if (dragging.current.length === 0) return;
            e.preventDefault();
            setDrop({ id: null, zone: "after" });
          }}
          onDrop={(e) => {
            e.preventDefault();
            apply({ id: null, zone: "after" });
          }}
        />
      </div>
    </aside>
  );
}

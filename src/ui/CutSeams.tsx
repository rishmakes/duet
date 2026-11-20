import { useState } from "react";
import { CUT_MOVE_NAMES, clipBefore, moveLength } from "../document/moves";
import { spanOf } from "../document/time";
import { CUT_MOVES } from "../document/types";
import type { CutMoveKind, Doc, El } from "../document/types";
import { dispatch } from "../state/store";
import { pickCut, usePickedCut } from "./pickedCut";
import { useDismiss } from "./useDismiss";

/** The ready-made transitions a cut can have. */
const CHOICES: [CutMoveKind, string][] = CUT_MOVES.map((k) => [k, CUT_MOVE_NAMES[k]]);

/**
 * The cuts on one track in Edit: where one clip ends and the next starts. A cut with no transition shows a
 * "+" while the pointer is over the track; one with a transition shows a badge as long as the transition.
 */
export default function CutSeams({ doc, frame, items, pps }: { doc: Doc; frame: El; items: El[]; pps: number }) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const picked = usePickedCut();
  useDismiss(!!menu, () => setMenu(null), ".cut-menu, .cut-plus, .cut-badge");
  const here = new Set(items.map((el) => el.id));
  const seams = items.flatMap((b) => {
    const a = b.type === "video" ? clipBefore(doc, b, frame) : null;
    return a && here.has(a.id) ? [{ a, b, at: spanOf(b, frame).start }] : [];
  });
  if (!seams.length) return null;
  const choose = (id: string, kind: CutMoveKind | "cut") => {
    setMenu(null);
    dispatch("set_transition", { ids: [id], kind });
    // a transition put on or changed is picked, so its settings show; one taken away lets go
    pickCut(kind === "cut" ? null : id);
  };
  const open = menu ? doc.elements[menu.id] : null;
  return (
    <>
      {seams.map(({ a, b, at }) => {
        const move = b.cutIn;
        if (!move) {
          return (
            <button
              key={b.id}
              className={`cut-plus ${menu?.id === b.id ? "open" : ""}`}
              data-name={`cut-plus-${b.name}`}
              style={{ left: at * pps }}
              title="Add a transition at this cut"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setMenu(menu?.id === b.id ? null : { id: b.id, x: r.left + r.width / 2, y: r.bottom + 4 });
              }}
            >
              +
            </button>
          );
        }
        const len = moveLength(move, a, b, frame);
        const w = Math.max(18, len * pps);
        return (
          <button
            key={b.id}
            className={`cut-badge ${move.kind} ${picked === b.id ? "picked" : ""}`}
            data-name={`cut-badge-${b.name}`}
            style={{ left: at * pps - w / 2, width: w }}
            title={`${CUT_MOVE_NAMES[move.kind]}, ${Math.round(len * 100) / 100} s. Click for its settings, Delete to remove, right click for more`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              pickCut(b.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              pickCut(b.id);
              setMenu({ id: b.id, x: e.clientX + 80, y: e.clientY });
            }}
          >
            <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true">
              <path d="M1 1 6 4 1 7Z M11 1 6 4 11 7Z" fill="currentColor" />
            </svg>
          </button>
        );
      })}
      {menu && open && (
        <div className="ctx cut-menu" style={{ left: menu.x - 80, top: menu.y, minWidth: 160 }} data-name="cut-menu">
          {CHOICES.map(([kind, name]) => (
            <div key={kind} className={`ctx-item ${open.cutIn?.kind === kind ? "on" : ""}`} data-name={`cut-choice-${kind}`} onClick={() => choose(open.id, kind)}>
              {name}
            </div>
          ))}
          {open.cutIn && (
            <>
              <div className="ctx-line" />
              <div className="ctx-item" data-name="cut-remove" onClick={() => choose(open.id, "cut")}>
                Remove transition<kbd>Delete</kbd>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

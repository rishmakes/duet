import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CUT_MOVE_NAMES, clipBefore, moveLength } from "../document/moves";
import { spanOf } from "../document/time";
import { CUT_MOVES } from "../document/types";
import type { CutMoveKind, Doc, El } from "../document/types";
import { dispatch } from "../state/store";
import { copyCut, getCopiedCut, pasteCut, pickCut, usePickedCut } from "./pickedCut";
import { useDismiss } from "./useDismiss";

/** The ready-made transitions a cut can have. */
const CHOICES: [CutMoveKind, string][] = CUT_MOVES.map((k) => [
  k,
  CUT_MOVE_NAMES[k],
]);

// the transitions you used last come first; kept on this computer only, so a lost list just falls back to the usual order
const RECENT_KEY = "duet.cuts.recent";
const recentKinds = (): CutMoveKind[] => {
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
const inOrder = (): [CutMoveKind, string][] => {
  const recent = recentKinds();
  return [...CHOICES].sort((a, b) => (recent.indexOf(a[0]) + 1 || 99) - (recent.indexOf(b[0]) + 1 || 99));
};

/**
 * The cuts on one track in Edit: where one clip ends and the next starts. A cut with no transition shows a
 * "+" while the pointer is over the track; one with a transition shows a badge as long as the transition.
 */
export default function CutSeams({
  doc,
  frame,
  items,
  pps,
}: {
  doc: Doc;
  frame: El;
  items: El[];
  pps: number;
}) {
  // y is just under the cut's button, top just over it: the card opens below, or above when there is no room below
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; top: number } | null>(
    null,
  );
  const [find, setFind] = useState("");
  const card = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState(false);
  // measured before it is painted, so the card never shows below and then jumps
  useLayoutEffect(() => {
    if (!menu || !card.current) return;
    const h = card.current.offsetHeight;
    setUp(menu.y + h > window.innerHeight - 8 && menu.top - h > 8);
  }, [menu, find]);
  const picked = usePickedCut();
  useDismiss(!!menu, () => setMenu(null), ".cut-menu, .cut-plus, .cut-badge");
  // each time the picker opens, its search starts empty
  useEffect(() => setFind(""), [menu?.id]);
  const here = new Set(items.map((el) => el.id));
  const seams = items.flatMap((b) => {
    const a = b.type === "video" ? clipBefore(doc, b, frame) : null;
    return a && here.has(a.id) ? [{ a, b, at: spanOf(b, frame).start }] : [];
  });
  if (!seams.length) return null;
  const choose = (id: string, kind: CutMoveKind | "cut") => {
    setMenu(null);
    if (kind !== "cut") usedKind(kind);
    dispatch("set_transition", { ids: [id], kind });
    // a transition put on or changed is picked, so its settings show; one taken away lets go
    pickCut(kind === "cut" ? null : id);
  };
  const open = menu ? doc.elements[menu.id] : null;
  const copied = getCopiedCut();
  return (
    <>
      {seams.map(({ a, b, at }) => {
        const move = b.cutIn;
        if (!move) {
          return (
            <button
              key={b.id}
              className={`cut-plus ${menu?.id === b.id ? "open" : ""} ${picked === b.id ? "picked" : ""}`}
              data-name={`cut-plus-${b.name}`}
              style={{ left: at * pps }}
              title="Add a transition at this cut"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                // the cut is picked too, so Cmd+V pastes a copied transition onto it
                pickCut(b.id);
                const r = e.currentTarget.getBoundingClientRect();
                setMenu(
                  menu?.id === b.id
                    ? null
                    : { id: b.id, x: r.left + r.width / 2, y: r.bottom + 4, top: r.top - 4 },
                );
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
            title={`${CUT_MOVE_NAMES[move.kind]}, ${Math.round(len * 100) / 100} s. Click to change or remove it`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              // one click picks it, so its settings show on the right, and opens its choices here
              pickCut(b.id);
              const r = e.currentTarget.getBoundingClientRect();
              setMenu(
                menu?.id === b.id
                  ? null
                  : { id: b.id, x: r.left + r.width / 2, y: r.bottom + 4, top: r.top - 4 },
              );
            }}
          >
            <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true">
              <path d="M1 1 6 4 1 7Z M11 1 6 4 11 7Z" fill="currentColor" />
            </svg>
          </button>
        );
      })}
      {menu &&
        open &&
        // on the page itself, over everything: inside the timeline the shade outside the work area lay over it
        createPortal(
          <div
            ref={card}
            className="ctx cut-menu"
            style={up ? { left: Math.max(8, menu.x - 105), bottom: window.innerHeight - menu.top } : { left: Math.max(8, menu.x - 105), top: menu.y }}
            data-name="cut-menu"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <label className="cut-find">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M16 16l4 4" />
              </svg>
              <input
                autoFocus
                placeholder="Find a transition"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </label>
            <div className="cut-list-title">Transitions</div>
            <div className="cut-list">
              {inOrder()
                .filter(([, name]) => name.toLowerCase().includes(find.trim().toLowerCase()))
                .map(([kind, name]) => (
                  <div
                    key={kind}
                    className={`cut-row ${open.cutIn?.kind === kind ? "on" : ""}`}
                    data-name={`cut-choice-${kind}`}
                    onClick={() => choose(open.id, kind)}
                  >
                    {/* a small picture of the transition, moving: one shot giving way to the next */}
                    <span className={`cut-preview cut-preview-${kind}`} aria-hidden="true" />
                    {name}
                  </div>
                ))}
              {!inOrder().some(([, name]) => name.toLowerCase().includes(find.trim().toLowerCase())) && <div className="cut-none">No transition is called that.</div>}
            </div>
            {(open.cutIn || copied) && <div className="ctx-line" />}
            {open.cutIn && (
              <div
                className="ctx-item"
                data-name="cut-copy"
                onClick={() => {
                  copyCut(open.id);
                  setMenu(null);
                }}
              >
                Copy transition<kbd>⌘C</kbd>
              </div>
            )}
            {copied && (
              <div
                className="ctx-item"
                data-name="cut-paste"
                onClick={() => {
                  setMenu(null);
                  pasteCut(open.id);
                }}
              >
                Paste {CUT_MOVE_NAMES[copied.kind]}, {copied.seconds} s
                <kbd>⌘V</kbd>
              </div>
            )}
            {open.cutIn && (
              <>
                <div
                  className="ctx-item"
                  data-name="cut-remove"
                  onClick={() => choose(open.id, "cut")}
                >
                  Remove transition<kbd>Delete</kbd>
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

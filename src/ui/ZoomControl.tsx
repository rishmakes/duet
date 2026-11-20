import { useState } from "react";
import { useStore } from "../state/store";
import { useDismiss } from "./useDismiss";

const send = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

/** The zoom of the canvas or preview it sits on: the percentage, and a menu to fit it or set a level. With `fit`, a button beside it brings the scene back to the middle in one click. */
export default function ZoomControl({ fit }: { fit?: () => void }) {
  const zoom = useStore((s) => s.viewport.zoom);
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false), ".zoom-control");
  return (
    <div className="zoom-control" onPointerDown={(e) => e.stopPropagation()}>
      {fit && (
        <button className="pill zoom-fit" data-name="fit-scene" title="Fit the scene in the middle" onClick={fit}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      )}
      <button className="pill" data-name="zoom-control" onClick={() => setOpen(!open)} title="Zoom this view">
        {Math.round(zoom * 100)}%
      </button>
      {open && (
        <div className="zmenu up" onClick={() => setOpen(false)}>
          <div onClick={() => send("duet:fit")}>
            Show everything <kbd>Shift 1</kbd>
          </div>
          <div onClick={() => send("duet:fit-selection")}>
            Show what's picked <kbd>Shift 2</kbd>
          </div>
          {[0.25, 0.5, 1, 2].map((z) => (
            <div key={z} onClick={() => send("duet:zoom", z)}>
              {z * 100}%
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

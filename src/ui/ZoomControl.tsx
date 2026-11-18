import { useState } from "react";
import { useStore } from "../state/store";
import { useDismiss } from "./useDismiss";

const send = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

/** The zoom of the canvas or preview it sits on: the percentage, and a menu to fit it or set a level. */
export default function ZoomControl() {
  const zoom = useStore((s) => s.viewport.zoom);
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false), ".zoom-control");
  return (
    <div className="zoom-control" onPointerDown={(e) => e.stopPropagation()}>
      <button className="pill" data-name="zoom-control" onClick={() => setOpen(!open)} title="Zoom this view">
        {Math.round(zoom * 100)}%
      </button>
      {open && (
        <div className="zmenu up" onClick={() => setOpen(false)}>
          <div onClick={() => send("duet:fit")}>
            Fit everything <kbd>Shift 1</kbd>
          </div>
          <div onClick={() => send("duet:fit-selection")}>
            Zoom to selection <kbd>Shift 2</kbd>
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

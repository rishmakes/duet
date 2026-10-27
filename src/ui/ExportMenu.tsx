import { useState } from "react";
import { useDismiss } from "./useDismiss";
import { exportDesign, exportTargets } from "../project/exporter";
import type { Format } from "../project/exporter";
import { currentDoc, useStore } from "../state/store";

export default function ExportMenu() {
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false), ".zoomwrap.exportwrap");
  const [format, setFormat] = useState<Format>("png");
  const [scale, setScale] = useState(2);
  const [note, setNote] = useState("");
  const selection = useStore((s) => s.selection);
  useStore((s) => s.timeline[s.cursor]);
  const doc = currentDoc();
  const ids = exportTargets(doc, selection);
  const what =
    ids.length === 0
      ? "Nothing to export yet."
      : ids.length === 1
        ? `"${doc.elements[ids[0]].name}"`
        : selection.length
          ? `${ids.length} selected things`
          : `All ${ids.length} screens`;

  return (
    <div className="zoomwrap exportwrap">
      <button className="pill primary" onClick={() => setOpen(!open)}>
        Export
      </button>
      {open && (
        <div className="zmenu export">
          <div className="x-title">Export {what}</div>
          <div className="seg2">
            {(["png", "svg", "pdf"] as Format[]).map((f) => (
              <span key={f} className={format === f ? "on" : ""} onClick={() => setFormat(f)}>
                {f.toUpperCase()}
              </span>
            ))}
          </div>
          {format === "png" && (
            <div className="seg2">
              {[1, 2, 3].map((k) => (
                <span key={k} className={scale === k ? "on" : ""} onClick={() => setScale(k)}>
                  {k}x
                </span>
              ))}
            </div>
          )}
          <button
            className="mini primary wide"
            disabled={ids.length === 0}
            onClick={async () => {
              const r = await exportDesign(format, scale);
              setNote(r);
              if (r.startsWith("Saved")) setOpen(false);
            }}
          >
            {ids.length > 1 && format !== "pdf" ? `Export ${ids.length} files` : "Export"}
          </button>
          {note && <div className="hint2">{note}</div>}
          <div className="hint2">Select something to export just that. With nothing selected, every screen is exported.</div>
        </div>
      )}
    </div>
  );
}

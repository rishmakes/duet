import { useEffect, useRef, useState } from "react";
import type { Doc, El } from "../document/types";
import { drawElement } from "../canvas/render";
import { currentDoc, dispatch, select, useStore } from "../state/store";
import { useLayout } from "./layout";
import { newId } from "../commands";
import { openPage, showAllPages, usePageFocus } from "./pageFocus";

function PageThumbnailCanvas({ doc, frame }: { doc: Doc; frame: El }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = 48;
    const h = 48;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const pad = 3;
    const availW = w - pad * 2;
    const availH = h - pad * 2;
    const scale = Math.min(availW / Math.max(1, frame.width), availH / Math.max(1, frame.height));
    const fw = frame.width * scale;
    const fh = frame.height * scale;
    const ox = (w - fw) / 2;
    const oy = (h - fh) / 2;

    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    drawElement(ctx, doc, { ...frame, x: 0, y: 0 }, 0, 0);
    ctx.restore();
  }, [doc, frame]);

  return <canvas ref={canvasRef} />;
}

export default function PageStrip() {
  const doc = useStore((s) => currentDoc(s));
  const mode = useLayout((d) => d.mode);
  const space = useLayout((d) => d.space);
  const { activePageId, isAllPages } = usePageFocus(doc);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: "before" | "after" } | null>(null);

  const isVisible = doc.pages === true && (mode === "design" || mode === "photo") && space === "edit";
  if (!isVisible) return null;

  const rootFrames = doc.rootIds
    .filter((id) => doc.elements[id]?.type === "frame")
    .map((id) => doc.elements[id]);

  const handleAddPage = () => {
    const current = activePageId ? doc.elements[activePageId] : rootFrames[rootFrames.length - 1];
    const id = newId("frame");
    dispatch("add_page", {
      id,
      sourceId: current?.id,
      afterId: current?.id,
    });
    openPage(id);
    select([id]);
  };

  const handleAllPages = () => {
    showAllPages();
    window.dispatchEvent(new Event("duet:all-pages"));
  };

  const handleSelectPage = (id: string) => {
    openPage(id);
    select([id]);
  };

  return (
    <div className="page-strip-container" data-name="page-strip">
      {rootFrames.map((frame, index) => {
        const isActive = !isAllPages && activePageId === frame.id;
        const isTarget = dropTarget?.id === frame.id;
        const dropClass = isTarget ? (dropTarget.zone === "before" ? "drop-before" : "drop-after") : "";

        return (
          <div
            key={frame.id}
            className={`page-thumbnail-item ${isActive ? "active" : ""} ${dropClass}`}
            draggable
            title={frame.name}
            onDragStart={(e) => {
              setDraggingId(frame.id);
              e.dataTransfer.setData("text/plain", frame.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (!draggingId || draggingId === frame.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const r = e.currentTarget.getBoundingClientRect();
              const zone = (e.clientX - r.left) / r.width < 0.5 ? "before" : "after";
              if (dropTarget?.id !== frame.id || dropTarget?.zone !== zone) {
                setDropTarget({ id: frame.id, zone });
              }
            }}
            onDragLeave={() => {
              if (dropTarget?.id === frame.id) setDropTarget(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!draggingId || !dropTarget) return;
              const ids = rootFrames.map((f) => f.id);
              const from = ids.indexOf(draggingId);
              if (from !== -1) {
                ids.splice(from, 1);
                let to = ids.indexOf(dropTarget.id);
                if (dropTarget.zone === "after") to += 1;
                dispatch("reorder_pages", { id: draggingId, toIndex: to });
              }
              setDraggingId(null);
              setDropTarget(null);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTarget(null);
            }}
            onClick={() => handleSelectPage(frame.id)}
          >
            <div className="page-mini-card">
              <PageThumbnailCanvas doc={doc} frame={frame} />
            </div>
            <span className="page-number-pill">{index + 1}</span>
          </div>
        );
      })}

      <button className="add-page-btn" title="Add page" onClick={handleAddPage}>
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5.5v13M5.5 12h13" />
        </svg>
        <span>Add page</span>
      </button>

      <button
        className={`all-pages-btn ${isAllPages ? "active" : ""}`}
        title="All pages"
        onClick={handleAllPages}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
        <span>All pages</span>
      </button>
    </div>
  );
}

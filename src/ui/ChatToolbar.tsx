import { useEffect, useRef, useState } from "react";
import { setOnlyFrame } from "../canvas/render";
import { useStore } from "../state/store";
import Toolbar from "./Toolbar";
import CommentsList from "./CommentsList";
import { setLayout, useLayout } from "./layout";
import type { Mode } from "./layout";
import { useDismiss } from "./useDismiss";

/**
 * The thin bar over the canvas beside the chat: the kind of work on the left, the same tools as Edit
 * in the middle, and on the right the comments, when there are some, and the whole canvas or one frame on its own.
 */

const KINDS: { mode: Mode; label: string; key: string }[] = [
  { mode: "design", label: "Design", key: "1" },
  { mode: "motion", label: "Video", key: "2" },
  { mode: "color", label: "Colour", key: "3" },
];
const CMD = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl ";

export default function ChatToolbar() {
  const mode = useLayout((d) => d.mode);
  const doc = useStore((s) => s.timeline[s.cursor].doc);
  const frames = doc.rootIds.filter((id) => doc.elements[id]?.type === "frame" || doc.elements[id]?.type === "instance");
  const [only, setOnly] = useState<string | null>(null);
  const [open, setOpen] = useState<"kind" | "frame" | "comments" | null>(null);
  const commentsRef = useRef<HTMLButtonElement>(null);
  const openComments = (doc.comments ?? []).filter((c) => !c.resolved).length;
  const kindRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLButtonElement>(null);

  useDismiss(open !== null, () => setOpen(null), ".chatbar-menu, .chatbar-drop");

  // a frame that is gone, or a project closed, brings the whole canvas back
  const shown = only && doc.elements[only] ? only : null;
  useEffect(() => {
    setOnlyFrame(shown);
    if (!shown && only) setOnly(null);
  }, [shown, only]);
  useEffect(() => () => setOnlyFrame(null), []);

  const look = (id: string | null) => {
    setOnly(id);
    setOnlyFrame(id);
    setOpen(null);
    if (id) window.dispatchEvent(new CustomEvent("duet:fit-selection", { detail: [id] }));
    else window.dispatchEvent(new Event("duet:fit"));
  };

  const below = (el: HTMLElement | null, right = false) => {
    const r = el?.getBoundingClientRect();
    if (!r) return {};
    return right ? { top: r.bottom + 6, right: window.innerWidth - r.right } : { top: r.bottom + 6, left: r.left };
  };

  return (
    <div className="chatbar" data-name="chat-toolbar">
      <button ref={kindRef} className={`chatbar-drop ${open === "kind" ? "on" : ""}`} onClick={() => setOpen(open === "kind" ? null : "kind")}>
        {KINDS.find((k) => k.mode === mode)?.label}
      </button>
      <Toolbar row />
      {!!doc.comments?.length && (
        <button
          ref={commentsRef}
          className={`chatbar-drop end ${open === "comments" ? "on" : ""}`}
          title="The comments pinned on the canvas"
          onClick={() => setOpen(open === "comments" ? null : "comments")}
        >
          Comments{openComments ? ` ${openComments}` : ""}
        </button>
      )}
      <button
        ref={frameRef}
        className={`chatbar-drop end ${open === "frame" ? "on" : ""}`}
        title="Look at the whole canvas, or one frame on its own"
        onClick={() => setOpen(open === "frame" ? null : "frame")}
      >
        {shown ? doc.elements[shown].name : "Whole canvas"}
      </button>

      {open === "kind" && (
        <div className="ctx chatbar-menu" style={below(kindRef.current)}>
          {KINDS.map((k) => (
            <div
              key={k.mode}
              className={`ctx-item ${k.mode === mode ? "on" : ""}`}
              onClick={() => {
                setLayout({ mode: k.mode });
                setOpen(null);
              }}
            >
              {k.label}
              <kbd>{`${CMD}${k.key}`}</kbd>
            </div>
          ))}
        </div>
      )}
      {open === "comments" && (
        <div className="ctx chatbar-menu chatbar-comments" style={below(commentsRef.current, true)}>
          <CommentsList />
        </div>
      )}
      {open === "frame" && (
        <div className="ctx chatbar-menu" style={below(frameRef.current, true)}>
          <div className={`ctx-item ${shown ? "" : "on"}`} onClick={() => look(null)}>
            Whole canvas
          </div>
          {frames.length > 0 && <div className="ctx-line" />}
          {frames.map((id) => (
            <div key={id} className={`ctx-item ${id === shown ? "on" : ""}`} onClick={() => look(id)}>
              {doc.elements[id].name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

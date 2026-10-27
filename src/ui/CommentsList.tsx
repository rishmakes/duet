import { useState } from "react";
import { dispatch, useStore, workDoc } from "../state/store";
import { setLayout, useLayout } from "./layout";
import { showComment, useOpenComment } from "./commentFocus";

/** Every comment on the canvas: open ones by number, as on their pins, and the resolved ones folded away with what was done. */
export default function CommentsList({ floating = false }: { floating?: boolean }) {
  const list = useStore((s) => workDoc(s).comments);
  const hidden = useLayout((d) => d.commentsHidden);
  const open = useOpenComment();
  const [showDone, setShowDone] = useState(false);
  if (!list?.length) return null;
  const live = list.filter((c) => !c.resolved);
  const done = list.filter((c) => c.resolved);
  return (
    <div className={`sec comments-list${floating ? " floating" : ""}`}>
      <div className="comments-head">
        <h4>Comments{live.length ? ` ${live.length}` : ""}</h4>
        <button className="mini" title="Show or hide the pins on the canvas (Shift C)" onClick={() => setLayout({ commentsHidden: !hidden })}>
          {hidden ? "Show pins" : "Hide pins"}
        </button>
      </div>
      {live.map((c, i) => (
        <button key={c.id} className={`comment-row${open === c.id ? " sel" : ""}`} title="Show it on the canvas" onClick={() => showComment(c.id)}>
          <span className={`comment-dot${c.by === "ai" ? " ai" : ""}`}>{i + 1}</span>
          <span className="comment-words">{c.text}</span>
        </button>
      ))}
      {!live.length && <div className="empty">All dealt with.</div>}
      {done.length > 0 && (
        <button className="mini" onClick={() => setShowDone(!showDone)}>
          {showDone ? "Fold resolved" : `Resolved ${done.length}`}
        </button>
      )}
      {showDone &&
        done.map((c) => (
          <div key={c.id} className="comment-row done">
            <span className="comment-words">
              {c.text}
              {c.reply && <small>{c.reply}</small>}
            </span>
            <button className="mini" title="Delete this comment" onClick={() => dispatch("delete_comment", { id: c.id })}>
              Delete
            </button>
          </div>
        ))}
    </div>
  );
}

import { dispatch, getState, useStore, workDoc } from "../state/store";
import { useLayout } from "./layout";
import { openPage, resetPageFocus } from "./pageFocus";

/** One click, or Shift P: from the open canvas to page view (one page at a time, the picked page or the first), and back to the open canvas. */
export function flipPageView() {
  const d = workDoc();
  if (d.pages) {
    dispatch("set_pages", { on: false });
    resetPageFocus();
    window.dispatchEvent(new Event("duet:fit"));
    return;
  }
  let top = getState().selection[0];
  while (top && d.elements[top]?.parentId) top = d.elements[top].parentId!;
  const page = top && d.rootIds.includes(top) && d.elements[top]?.type === "frame" ? top : d.rootIds.find((id) => d.elements[id]?.type === "frame");
  dispatch("set_pages", { on: true });
  if (page) openPage(page);
}

/** The flip as an icon button. The icon is two arrows going opposite ways and never changes; it is lit while the design is in page view. */
export default function PageFlipButton({ className }: { className: string }) {
  const doc = useStore((s) => workDoc(s));
  const designing = useLayout((d) => d.mode === "design" || d.mode === "photo");
  if (!designing) return null;
  const label = doc.pages ? "Switch to the open canvas (Shift P)" : "Switch to page view, one page at a time (Shift P)";
  return (
    <button
      className={`${className} ${doc.pages ? "on" : ""}`}
      data-name="view-flip"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.currentTarget.blur();
        flipPageView();
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8h15M15 4l4 4-4 4" />
        <path d="M20 16H5M9 12l-4 4 4 4" />
      </svg>
    </button>
  );
}

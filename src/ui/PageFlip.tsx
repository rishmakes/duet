import { dispatch, getState, useStore, workDoc } from "../state/store";
import { useLayout } from "./layout";
import { isAllPages as allPagesNow, openPage, showAllPages, usePageFocus } from "./pageFocus";

/** One click, or Shift P: from one page at a time to the open canvas of all pages, and back to the page that was picked.
 *  A design without pages turns page view on first. */
export function flipPageView() {
  const d = workDoc();
  if (!d.pages) {
    dispatch("set_pages", { on: true });
    const first = d.rootIds.find((id) => d.elements[id]?.type === "frame");
    if (first) openPage(first);
    return;
  }
  if (allPagesNow(d)) {
    let top = getState().selection[0];
    while (top && d.elements[top]?.parentId) top = d.elements[top].parentId!;
    const page = top && d.rootIds.includes(top) && d.elements[top]?.type === "frame" ? top : d.rootIds.find((id) => d.elements[id]?.type === "frame");
    if (page) openPage(page);
  } else {
    showAllPages();
    window.dispatchEvent(new Event("duet:all-pages"));
  }
}

/** The flip as an icon button. The icon is two arrows going opposite ways and never changes; it is lit while all pages are on one open canvas. */
export default function PageFlipButton({ className }: { className: string }) {
  const doc = useStore((s) => workDoc(s));
  const { isAllPages } = usePageFocus(doc);
  const designing = useLayout((d) => d.mode === "design" || d.mode === "photo");
  if (!designing) return null;
  const label = !doc.pages || isAllPages ? "Work on one page at a time (Shift P)" : "See all pages on one open canvas (Shift P)";
  return (
    <button
      className={`${className} ${isAllPages ? "on" : ""}`}
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

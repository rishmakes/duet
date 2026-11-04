import { dispatch, getState, useStore, workDoc } from "../state/store";
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

/** The flip as an icon button, for the end of a toolbar. It shows where a click goes: the grid for all pages, the single page for one at a time. */
export default function PageFlipButton({ className }: { className: string }) {
  const doc = useStore((s) => workDoc(s));
  const { isAllPages } = usePageFocus(doc);
  const toOne = !doc.pages || isAllPages;
  const label = toOne ? "One page at a time (Shift P)" : "All pages on one open canvas (Shift P)";
  return (
    <button
      className={className}
      data-name="view-flip"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.currentTarget.blur();
        flipPageView();
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
        {toOne ? (
          <rect x="6" y="3.5" width="12" height="17" rx="2" />
        ) : (
          <>
            <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
            <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
            <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
            <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
          </>
        )}
      </svg>
    </button>
  );
}

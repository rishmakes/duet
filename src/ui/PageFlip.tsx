import { getState, setPagesView, useStore, workDoc } from "../state/store";
import { useLayout } from "./layout";
import { openPage, resetPageFocus } from "./pageFocus";

/** One click, or Shift P: from the open canvas to page view (one page at a time, the picked page or the first), and back to the open canvas. */
export function flipPageView() {
  const d = workDoc();
  if (d.pages) {
    setPagesView(false);
    resetPageFocus();
    window.dispatchEvent(new Event("duet:fit"));
    return;
  }
  let top = getState().selection[0];
  while (top && d.elements[top]?.parentId) top = d.elements[top].parentId!;
  const page = top && d.rootIds.includes(top) && d.elements[top]?.type === "frame" ? top : d.rootIds.find((id) => d.elements[id]?.type === "frame");
  setPagesView(true);
  if (page) openPage(page);
}

/** Two views of the same design, side by side like a switch: page view (one page at a time) and the open canvas (everything at once).
 *  The one you are in is dark; the other is a click away. Shift P flips. */
export default function PageFlipButton({ className }: { className: string }) {
  const doc = useStore((s) => workDoc(s));
  const designing = useLayout((d) => d.mode === "design" || d.mode === "photo");
  if (!designing) return null;
  const pageView = !!doc.pages;
  const svg = { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const pick = (want: boolean) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    if (want !== pageView) flipPageView();
  };
  return (
    <div className={className} data-name="view-switch">
      <button className={pageView ? "on" : ""} data-name="view-page" aria-label="Page view" title={pageView ? "Page view: one page at a time (Shift P for the open canvas)" : "Switch to page view, one page at a time (Shift P)"} onClick={pick(true)}>
        <svg {...svg}>
          <path d="M7 3.5h7l4 4v13H7z" />
          <path d="M14 3.5v4h4" />
        </svg>
      </button>
      <button className={pageView ? "" : "on"} data-name="view-canvas" aria-label="Open canvas" title={pageView ? "Switch to the open canvas, everything at once (Shift P)" : "Open canvas: everything at once (Shift P for page view)"} onClick={pick(false)}>
        <svg {...svg}>
          <rect x="3" y="4.5" width="10" height="7.5" rx="1.5" />
          <rect x="11" y="13" width="9.5" height="6.5" rx="1.5" />
          <path d="M17 4.5v.01M20 7.5v.01" />
        </svg>
      </button>
    </div>
  );
}

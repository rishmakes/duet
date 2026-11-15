/** A folded panel: a thin strip with its names written down the side. One click picks one and opens the panel. */
export interface StripItem {
  key: string;
  name: string;
  on: boolean;
}

/** The small arrow on a panel's own edge. `side` is the side of the window the panel is on; folding points toward that edge. */
export function FoldButton({ side, folding, title, onClick }: { side: "l" | "r"; folding: boolean; title: string; onClick: () => void }) {
  const toLeft = (side === "l") === folding;
  return (
    <button type="button" className="fold-btn" title={title} aria-label={title} onClick={onClick}>
      {toLeft ? "‹" : "›"}
    </button>
  );
}

export default function PanelStrip({
  side,
  label,
  items,
  onPick,
  onOpen,
}: {
  side: "l" | "r";
  label: string;
  items: StripItem[];
  onPick: (key: string) => void;
  onOpen: () => void;
}) {
  return (
    <aside className={`panel-strip ${side === "l" ? "strip-l" : "strip-r"}`} aria-label={label}>
      <FoldButton side={side} folding={false} title={`Show ${label}`} onClick={onOpen} />
      {items.map((it) => (
        <button key={it.key} type="button" className={`strip-tab ${it.on ? "on" : ""}`} data-name={`strip-${it.key}`} onClick={() => onPick(it.key)}>
          {it.name}
        </button>
      ))}
    </aside>
  );
}

import type { ReactNode } from "react";
import Icon from "./Icons";
import { getLayout, setLayout, useLayout } from "./layout";

/** Opens a shut shelf, or shuts an open one. Kept on this computer. */
export function toggleShelf(name: string) {
  const shut = getLayout().shelvesShut;
  setLayout({ shelvesShut: shut.includes(name) ? shut.filter((n) => n !== name) : [...shut, name] });
}

/**
 * A shelf of tiles under a name and a count (#338). Its arrow folds it shut, and Duet remembers which
 * shelves are shut, so someone who only uses their own styles never scrolls past the ready ones.
 * Used by Captions and Assets.
 */
export default function Shelf({ name, title, count, children }: { name: string; title: string; count?: number; children: ReactNode }) {
  const open = useLayout((d) => !d.shelvesShut.includes(name));
  return (
    <section className={`shelf${open ? " open" : ""}`} data-name={`shelf-${name}`}>
      <button type="button" className="shelf-head" aria-expanded={open} onClick={() => toggleShelf(name)}>
        <span className={`fold-arrow ${open ? "" : "folded"}`}>
          <Icon name="arrow" size={10} />
        </span>
        <span className="shelf-title">{title}</span>
        {count !== undefined && <span className="shelf-count">{count}</span>}
      </button>
      {open && children}
    </section>
  );
}

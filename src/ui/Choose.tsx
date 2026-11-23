import { useRef, useState } from "react";
import Icon from "./Icons";
import { useDismiss } from "./useDismiss";

export interface ChooseOption<T extends string> {
  value: T;
  label: string;
  /** A few quiet words on what this one is for. */
  hint?: string;
}

/**
 * Duet's own dropdown: a field showing the chosen one, and a small list in groups under it, the chosen one ticked.
 * Use it in place of the system's list, so every choice in Duet looks and feels the same.
 */
export default function Choose<T extends string>({ value, groups, onChange, name }: { value: T; groups: { name: string; options: ChooseOption<T>[] }[]; onChange: (v: T) => void; name: string }) {
  const [open, setOpen] = useState(false);
  const id = useRef(`choose-${Math.random().toString(36).slice(2, 8)}`).current;
  useDismiss(open, () => setOpen(false), `[data-choose="${id}"]`);
  const chosen = groups.flatMap((g) => g.options).find((o) => o.value === value);
  return (
    <div className="choose" data-choose={id}>
      <button type="button" className={`choose-field ${open ? "open" : ""}`} data-name={name} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{chosen?.label ?? value}</span>
        <Icon name="chevron-down" size={13} />
      </button>
      {open && (
        <div className="choose-list" role="listbox">
          {groups.map((g) => (
            <div key={g.name} role="group" aria-label={g.name}>
              <div className="choose-group">{g.name}</div>
              {g.options.map((o) => (
                <button
                  type="button"
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  data-name={`${name}-${o.value}`}
                  onClick={() => {
                    setOpen(false);
                    onChange(o.value);
                  }}
                >
                  <span className="choose-label">{o.label}</span>
                  {o.hint && <span className="choose-hint">{o.hint}</span>}
                  <span className="choose-tick">{o.value === value && <Icon name="check" size={14} />}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

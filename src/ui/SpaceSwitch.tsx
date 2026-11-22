import { useState } from "react";
import Icon, { type IconName } from "./Icons";
import { setLayout, useLayout, type Mode } from "./layout";
import { useDismiss } from "./useDismiss";

/** What Studio is for, with the icon Studio wears while you are in it. */
export const STUDIO_FOR: { mode: Mode; name: string; icon: IconName; keys: string }[] = [
  { mode: "design", name: "Design", icon: "shapes", keys: "Cmd or Ctrl 1" },
  { mode: "motion", name: "Video", icon: "film", keys: "Cmd or Ctrl 2" },
  { mode: "photo", name: "Photo", icon: "image", keys: "Cmd or Ctrl 3" },
];

export const studioIcon = (mode: Mode): IconName => STUDIO_FOR.find((k) => k.mode === mode)?.icon ?? "shapes";

/**
 * Kitchen or Studio, in the middle of the top bar. Studio always says Studio; its icon shows what it is for.
 * From Kitchen one click on Studio goes there. In Studio the same click opens "Studio for": Design, Video, Photo.
 */
export default function SpaceSwitch({ onGo }: { onGo?: () => void }) {
  const space = useLayout((d) => d.space);
  const mode = useLayout((d) => d.mode);
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false), ".studio-for, [data-name=\"space-edit\"]");
  const cooking = space === "kitchen";
  const go = (patch: { space: "kitchen" | "edit"; mode?: Mode }) => {
    setOpen(false);
    onGo?.();
    setLayout(patch);
  };

  return (
    <div className="pill mode-switch space-switch">
      <button className={cooking ? "active" : ""} data-name="space-kitchen" onClick={() => go({ space: "kitchen" })} title="Work with AI agents: chat, mark what to change, or follow a recipe step by step">
        <Icon name="wand" size={14} />
        Kitchen
      </button>
      <button
        className={`studio-btn ${cooking ? "" : "active"} ${open ? "open" : ""}`}
        data-name="space-edit"
        aria-haspopup="menu"
        aria-expanded={open}
        title={cooking ? "Every tool, to work on the design yourself" : "What Studio is for: Design, Video or Photo"}
        onClick={() => (cooking ? go({ space: "edit" }) : setOpen(!open))}
      >
        <Icon name={studioIcon(mode)} size={14} />
        Studio
        <Icon name="chevron-down" size={13} className="studio-caret" />
      </button>
      {open && (
        <div className="studio-for" role="menu">
          <div className="studio-for-title">Studio for</div>
          {STUDIO_FOR.map((k) => (
            <button key={k.mode} role="menuitemradio" aria-checked={mode === k.mode} data-name={`mode-${k.mode}`} title={k.keys} onClick={() => go({ space: "edit", mode: k.mode })}>
              <Icon name={k.icon} size={15} />
              <span>{k.name}</span>
              {mode === k.mode && <Icon name="check" size={14} className="studio-tick" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

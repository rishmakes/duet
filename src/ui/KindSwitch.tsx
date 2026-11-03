import { setLayout, useLayout, type Mode } from "./layout";

const KINDS: { mode: Mode; name: string; title: string }[] = [
  { mode: "design", name: "Design", title: "Design (Cmd or Ctrl 1)" },
  { mode: "motion", name: "Video", title: "Video: edit, animate and tell the story over time (Cmd or Ctrl 2)" },
  { mode: "photo", name: "Photo", title: "Photo (Cmd or Ctrl 3)" },
];

/** The kind of work: grey words, the one you are in a white button standing up a little. */
export default function KindSwitch() {
  const mode = useLayout((d) => d.mode);
  return (
    <div className="kind-quiet" role="tablist" aria-label="Kind of work">
      {KINDS.map((k) => (
        <button
          key={k.mode}
          role="tab"
          aria-selected={mode === k.mode}
          className={mode === k.mode ? "on" : ""}
          data-name={`mode-${k.mode}`}
          title={k.title}
          onClick={() => setLayout({ mode: k.mode })}
        >
          {k.name}
        </button>
      ))}
    </div>
  );
}

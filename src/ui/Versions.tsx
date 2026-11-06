import { useEffect, useState } from "react";
import { saveVersion } from "../project/project";
import { restoreDoc, stepDoc, useStore } from "../state/store";
import { useLayout } from "./layout";
import { useDismiss } from "./useDismiss";

/**
 * Save a version, and go back to one. Opened from File, with Cmd or Ctrl + Shift + S, or from the
 * history line when it is shown. It does not need the history line to be there.
 */
export default function Versions() {
  const timeline = useStore((s) => s.timeline);
  const lineShown = useLayout((d) => d.historyLine);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  useDismiss(open, () => setOpen(false), ".versions-pop, [data-toggle=\"versions\"]");

  useEffect(() => {
    const show = (e: Event) => setOpen((was) => ((e as CustomEvent<string | undefined>).detail === "toggle" ? !was : true));
    window.addEventListener("duet:versions", show);
    return () => window.removeEventListener("duet:versions", show);
  }, []);

  if (!open) return null;
  const versions = timeline.map((e, i) => ({ e, i })).filter(({ e }) => e.version).reverse();

  const submit = async () => {
    const result = await saveVersion(name);
    setNote(result);
    if (!result) setName("");
  };

  return (
    <div className={`popover versions-pop ${lineShown ? "over-line" : ""}`}>
      <div className="pop-title">
        Save a version
        <span className="pop-close" title="Close" onClick={() => setOpen(false)}>
          ×
        </span>
      </div>
      <div className="pop-row">
        <input
          autoFocus
          value={name}
          placeholder="Name it, like Client round 1"
          onChange={(e) => {
            setName(e.target.value);
            setNote(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") submit();
          }}
        />
        <button className="mini primary" onClick={submit}>
          Save
        </button>
      </div>
      {note && <div className="pop-note">{note}</div>}
      <div className="pop-title">Your versions</div>
      {versions.length === 0 && <div className="pop-empty">None yet. A version is a moment you want to come back to.</div>}
      {versions.map(({ e, i }) => (
        <div className="pop-version" key={i}>
          <div>
            <div className="v-name">{e.version}</div>
            <div className="v-time">{new Date(e.time).toLocaleString()}</div>
          </div>
          <button
            className="mini"
            onClick={() => {
              void stepDoc(e).then((doc) => doc && restoreDoc(doc, `Went back to version "${e.version}"`));
              setOpen(false);
            }}
          >
            Go back
          </button>
        </div>
      ))}
    </div>
  );
}

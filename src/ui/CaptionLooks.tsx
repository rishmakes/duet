import { useStore, currentDoc, dispatch, getState } from "../state/store";
import { CAPTION_LOOKS, CAPTIONS_TRACK } from "../document/captions";
import type { CaptionLook } from "../document/captions";

/**
 * The caption looks as tiles (#71): each shows example words in its look, and while the pointer is on
 * it the words light up one after another, the way they will when spoken. Used in the Captions tab and
 * in the Auto captions box.
 */

const EXAMPLE = ["Pick", "a", "style"];

/** Example words drawn in a look. With `moving`, the spoken word walks along them. */
export function LookSample({ look, words = EXAMPLE }: { look: CaptionLook; words?: string[] }) {
  const shown = look === "one" ? words.slice(-1) : words;
  return (
    <span className={`look-sample sample-${look}`}>
      {shown.map((w, i) => (
        <i key={i} style={{ animationDelay: `${i * 0.45}s`, animationDuration: `${shown.length * 0.45}s` }}>
          {w}
        </i>
      ))}
    </span>
  );
}

/** What a look click changes: the picked text in the open video, or else every caption in it. */
function targets(): string[] {
  const s = getState();
  const doc = currentDoc(s);
  const picked = s.selection.filter((id) => doc.elements[id]?.type === "text");
  if (picked.length) return picked;
  const scene = s.clock.scene ? doc.elements[s.clock.scene] : null;
  const track = scene?.tracks?.find((t) => t.name === CAPTIONS_TRACK);
  if (!scene || !track) return [];
  return scene.childIds.filter((id) => doc.elements[id]?.type === "text" && doc.elements[id].track === track.id);
}

/** The Captions tab in the left panel, in Video. */
export default function CaptionsPanel() {
  // the hint follows what a click would change
  const picked = useStore((s) => s.selection.filter((id) => currentDoc(s).elements[id]?.type === "text").length);
  const all = useStore(() => targets().length);
  return (
    <div className="captions-panel" data-name="captions-panel">
      <div className="captions-panel-hint">
        {picked ? `Click a look to change the ${picked === 1 ? "picked text" : `${picked} picked texts`}.` : all ? `Click a look to change all ${all} captions.` : "Make captions with Auto captions under the timeline, or pick any text, then click a look."}
      </div>
      <div className="captions-tiles">
        {CAPTION_LOOKS.map((l) => (
          <button
            key={l.key}
            className="captions-tile"
            data-name={`captions-tile-${l.key}`}
            title={l.name}
            disabled={!all}
            onClick={() => {
              const ids = targets();
              if (ids.length) dispatch("style_captions", { ids, look: l.key });
            }}
          >
            <LookSample look={l.key} />
            <span className="captions-tile-name">{l.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

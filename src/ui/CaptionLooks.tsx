import { useStore, currentDoc, dispatch, getState } from "../state/store";
import { useEffect } from "react";
import { CAPTION_FONTS, CAPTION_LOOKS, CAPTIONS_TRACK } from "../document/captions";
import { fetchFamily } from "../project/fonts";
import type { CaptionLook, MyLook } from "../document/captions";
import { removeMyLook, useMyLooks } from "./myLooks";

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
    <span className={`look-sample sample-${look}`} style={{ fontFamily: `"${CAPTION_FONTS[look]}", system-ui, sans-serif` }}>
      {shown.map((w, i) => (
        <i key={i} style={{ animationDelay: `${i * 0.45}s`, animationDuration: `${shown.length * 0.45}s` }}>
          {w}
        </i>
      ))}
    </span>
  );
}

/** Example words drawn in a saved look, from its own font, colours, outline, shadow and box. */
function MySample({ look }: { look: MyLook }) {
  const p = look.props;
  const k = 22 / Math.max(1, p.fontSize ?? 60);
  const sh = p.shadow ? `${p.shadow.x * k}px ${p.shadow.y * k}px ${p.shadow.blur * k}px ${p.shadow.color}` : undefined;
  return (
    <span
      className="look-sample sample-mine"
      style={{
        fontFamily: p.fontFamily ? `"${p.fontFamily}", system-ui, sans-serif` : undefined,
        fontWeight: p.fontWeight,
        color: p.fill,
        textTransform: p.caps ? "uppercase" : "none",
        WebkitTextStroke: p.stroke && p.strokeWidth ? `${Math.max(0.5, p.strokeWidth * k)}px ${p.stroke}` : undefined,
        paintOrder: "stroke fill",
        textShadow: sh,
        background: p.plate?.fill,
        borderRadius: p.plate ? p.plate.radius * k : undefined,
        padding: p.plate ? `${p.plate.padY * k}px ${p.plate.padX * k}px` : undefined,
      }}
    >
      {EXAMPLE.join(" ")}
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
/** The fonts of every look, fetched once so the tiles and the captions show in them. */
export function useCaptionFonts() {
  useEffect(() => {
    for (const family of new Set(Object.values(CAPTION_FONTS))) void fetchFamily(family);
  }, []);
}

export default function CaptionsPanel() {
  useCaptionFonts();
  // the hint follows what a click would change
  const picked = useStore((s) => s.selection.filter((id) => currentDoc(s).elements[id]?.type === "text").length);
  const all = useStore(() => targets().length);
  const mine = useMyLooks();
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
        {mine.map((m) => (
          <button
            key={m.id}
            className="captions-tile mine"
            data-name={`captions-mine-${m.name}`}
            title={m.name}
            disabled={!all}
            onClick={() => {
              const ids = targets();
              if (!ids.length) return;
              if (m.props.fontFamily) void fetchFamily(m.props.fontFamily);
              dispatch("style_captions", { ids, look: "bold", mine: { name: m.name, props: m.props } });
            }}
          >
            <MySample look={m} />
            <span className="captions-tile-name">{m.name}</span>
            <span
              className="captions-tile-remove"
              role="button"
              title="Remove this look. Captions already made with it stay as they are."
              onClick={(e) => {
                e.stopPropagation();
                removeMyLook(m.id);
              }}
            >
              ×
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

import { useStore, currentDoc, dispatch, getState } from "../state/store";
import { memo, useEffect } from "react";
import { CAPTION_FONTS, CAPTION_LOOKS, captionsIn, lookNow } from "../document/captions";
import { fetchFamily } from "../project/fonts";
import type { CaptionLook } from "../document/captions";

/**
 * Caption styles (#71, #404): each look as a big tile showing example words in it, and while the pointer
 * is on it the words light up one after another, the way they will when spoken. Picking one changes
 * every caption in the open video. Changing the look in detail is the Customize panel on the right.
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

/** The fonts of every look, fetched once so the tiles and the captions show in them. */
export function useCaptionFonts() {
  useEffect(() => {
    for (const family of new Set(Object.values(CAPTION_FONTS))) void fetchFamily(family);
  }, []);
}

/** Kept as it is while the panel around it redraws, so dragging a slider in Customize does not redraw every tile. */
export default memo(function CaptionsPanel() {
  useCaptionFonts();
  const count = useStore((s) => captionsIn(currentDoc(s), s.clock.scene).length);
  // the look these captions have now, while it is still one of Duet's
  const now = useStore((s) => {
    const doc = currentDoc(s);
    const first = doc.elements[captionsIn(doc, s.clock.scene)[0]];
    const frame = first?.parentId ? doc.elements[first.parentId] : null;
    return first && frame ? lookNow(first, frame) : null;
  });
  return (
    <div className="captions-panel" data-name="captions-panel">
      <div className="captions-panel-hint">{count ? "Pick a style. Every caption changes." : "Make captions first with Auto captions under the timeline, then pick a style."}</div>
      <div className="captions-tiles">
        {CAPTION_LOOKS.map((l) => (
          <button
            key={l.key}
            className={`captions-tile${now === l.key ? " on" : ""}`}
            data-name={`captions-tile-${l.key}`}
            disabled={!count}
            onClick={() => {
              const all = captionsIn(currentDoc(getState()), getState().clock.scene);
              if (all.length) dispatch("style_captions", { ids: all, look: l.key });
            }}
          >
            <span className="captions-tile-face">
              <LookSample look={l.key} />
            </span>
            <span className="captions-tile-name">{l.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

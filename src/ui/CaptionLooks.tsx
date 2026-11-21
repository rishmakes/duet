import { useStore, currentDoc, dispatch, getState } from "../state/store";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { CAPTION_FONTS, CAPTION_LOOKS, captionsIn, lookNow, lookOf, sameLook } from "../document/captions";
import { fetchFamily } from "../project/fonts";
import type { CaptionLook, CustomLook } from "../document/captions";
import type { El } from "../document/types";
import { keepStyle, removeLook, renameLook, useCustomLooks } from "./customLooks";

/**
 * Caption styles (#71, #404): each look as a big tile showing example words in it, and while the pointer
 * is on it the words light up one after another, the way they will when spoken. Picking one changes
 * every caption in the open video. Changing the look in detail is the Customize panel on the right.
 * Once the captions match none of the looks, their style is kept as a Custom tile first in the list,
 * on this computer for every project. Naming it keeps it; the next new style starts a new Custom tile.
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

/** Example words drawn in a custom look, sized down to the tile. */
function CustomSample({ props, words = EXAMPLE }: { props: Partial<El>; words?: string[] }) {
  const k = 19 / Math.max(1, props.fontSize ?? 60);
  const px = (n: number | undefined) => `${Math.round((n ?? 0) * k * 10) / 10}px`;
  const plate = props.plate;
  const boxed = !!props.spokenBox;
  const box: CSSProperties = plate ? { background: plate.fill, borderRadius: px(plate.radius), padding: `${px(plate.padY)} ${px(plate.padX)}` } : {};
  const word: CSSProperties = {
    ...(plate?.each ? box : {}),
    ...(props.stroke ? { WebkitTextStroke: `${px(props.strokeWidth)} ${props.stroke}`, paintOrder: "stroke fill" } : {}),
    ...(props.shadow ? { textShadow: `${px(props.shadow.x)} ${px(props.shadow.y)} ${px(props.shadow.blur)} ${props.shadow.color}` } : {}),
  };
  const vars = { "--base": props.fill ?? "#ffffff", "--lit": props.spokenFill ?? "transparent", "--word-bg": plate?.each ? plate.fill : "transparent" } as CSSProperties;
  return (
    <span
      className={`look-sample sample-custom${props.spokenFill ? " lit" : ""}${boxed ? " boxed" : ""}`}
      style={{ ...vars, ...(plate && !plate.each ? box : {}), fontFamily: `"${props.fontFamily}", system-ui, sans-serif`, fontWeight: props.fontWeight, textTransform: props.caps ? "uppercase" : undefined, letterSpacing: px(props.letterSpacing) }}
    >
      {words.map((w, i) => (
        <i key={i} style={{ ...word, animationDelay: `${i * 0.45}s`, animationDuration: `${words.length * 0.45}s` }}>
          {w}
        </i>
      ))}
    </span>
  );
}

/** A custom look's tile: pick it to use it, click its name to rename it, the cross removes it. */
function CustomTile({ look, on, off, apply }: { look: CustomLook; on: boolean; off: boolean; apply: () => void }) {
  const [naming, setNaming] = useState(false);
  const name = look.name ?? "Custom";
  return (
    <div className={`captions-tile custom${on ? " on" : ""}${off ? " off" : ""}`} data-name={`captions-tile-custom-${look.name ?? "new"}`}>
      <button className="captions-tile-face" disabled={off} onClick={apply}>
        <CustomSample props={look.props} />
      </button>
      <button className="captions-tile-remove" data-name="captions-tile-remove" title={`Remove ${name}`} onClick={() => removeLook(look.id)}>
        ×
      </button>
      {naming ? (
        <input
          className="captions-tile-rename"
          data-name="captions-tile-rename"
          autoFocus
          defaultValue={look.name ?? ""}
          placeholder="Name this style"
          onBlur={(e) => {
            renameLook(look.id, e.currentTarget.value);
            setNaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setNaming(false);
            e.stopPropagation();
          }}
        />
      ) : (
        <span className="captions-tile-name" title="Click to rename" onClick={() => setNaming(true)}>
          {name}
        </span>
      )}
    </div>
  );
}

/** The fonts of every look, fetched once so the tiles and the captions show in them. */
export function useCaptionFonts() {
  useEffect(() => {
    for (const family of new Set(Object.values(CAPTION_FONTS))) void fetchFamily(family);
  }, []);
}

export default function CaptionsPanel() {
  useCaptionFonts();
  const count = useStore((s) => captionsIn(currentDoc(s), s.clock.scene).length);
  // the look these captions have now, while it is still one of Duet's
  const now = useStore((s) => {
    const doc = currentDoc(s);
    const first = doc.elements[captionsIn(doc, s.clock.scene)[0]];
    const frame = first?.parentId ? doc.elements[first.parentId] : null;
    return first && frame ? lookNow(first, frame) : null;
  });
  // the captions' style now, as text so the panel redraws only when it changes
  const styleKey = useStore((s) => {
    const doc = currentDoc(s);
    const first = doc.elements[captionsIn(doc, s.clock.scene)[0]];
    const frame = first?.parentId ? doc.elements[first.parentId] : null;
    return first && frame ? JSON.stringify(lookOf(first, frame)) : "";
  });
  const style = useMemo(() => (styleKey ? (JSON.parse(styleKey) as Partial<El>) : null), [styleKey]);
  const custom = useCustomLooks();
  useEffect(() => {
    if (style && now === null) keepStyle(style);
  }, [style, now]);
  useEffect(() => {
    for (const l of custom) if (l.props.fontFamily) void fetchFamily(l.props.fontFamily);
  }, [custom]);
  const all = () => captionsIn(currentDoc(getState()), getState().clock.scene);
  // the new Custom tile first, then the named ones
  const ordered = [...custom.filter((l) => l.name === null), ...custom.filter((l) => l.name !== null)];
  return (
    <div className="captions-panel" data-name="captions-panel">
      <div className="captions-panel-hint">{count ? "Pick a style. Every caption changes." : "Make captions first with Auto captions under the timeline, then pick a style."}</div>
      <div className="captions-tiles">
        {ordered.map((l) => (
          <CustomTile
            key={l.id}
            look={l}
            on={now === null && !!style && sameLook(style, l.props)}
            off={!count}
            apply={() => {
              const ids = all();
              if (ids.length) dispatch("style_captions", { ids, look: "bold", custom: { name: l.name ?? "Custom", props: l.props } });
            }}
          />
        ))}
        {CAPTION_LOOKS.map((l) => (
          <button
            key={l.key}
            className={`captions-tile${now === l.key ? " on" : ""}`}
            data-name={`captions-tile-${l.key}`}
            disabled={!count}
            onClick={() => {
              const ids = all();
              if (ids.length) dispatch("style_captions", { ids, look: l.key });
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
}

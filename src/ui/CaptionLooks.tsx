import { useStore, currentDoc, dispatch, getState } from "../state/store";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { CAPTION_FONTS, CAPTION_FONTS_2, CAPTION_LOOKS, SPOKEN_COLOURS, captionProps, captionsIn, lookNow, lookOf, sameLook } from "../document/captions";
import { fetchFamily } from "../project/fonts";
import type { CaptionLook, CustomLook } from "../document/captions";
import type { El } from "../document/types";
import { duplicateLook, removeLook, renameLook, saveStyle, useCustomLooks } from "./customLooks";
import { useDismiss } from "./useDismiss";
import Shelf from "./Shelf";

/**
 * Caption styles (#71, #404): each look as a big tile showing example words in it, and while the pointer
 * is on it the words light up one after another, the way they will when spoken. Picking one changes
 * every caption in the open video. Changing the look in detail is the Customize panel on the right.
 * The look stays on the captions in the project. To use it again in another video, the designer saves it
 * under a name: it shows in Your styles, on this computer for every project (#338).
 */

const EXAMPLE = ["Pick", "a", "style"];

/** Example words drawn in a look. With `moving`, the spoken word walks along them. */
export function LookSample({ look, words = EXAMPLE }: { look: CaptionLook; words?: string[] }) {
  const ready = CAPTION_LOOKS.find((l) => l.key === look);
  if (ready?.styled) return <StyleSample props={readyProps(ready)} words={words} />;
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

/** Example words drawn in a style from its own settings, sized down to the tile: a custom look or a ready style. */
function StyleSample({ props, words = EXAMPLE }: { props: Partial<El>; words?: string[] }) {
  const k = 19 / Math.max(1, props.fontSize ?? 60);
  const px = (n: number | undefined) => `${Math.round((n ?? 0) * k * 10) / 10}px`;
  const plate = props.plate;
  const boxed = !!props.spokenBox;
  const box: CSSProperties = plate ? { background: plate.fill, borderRadius: px(plate.radius), padding: `${px(plate.padY)} ${px(plate.padX)}` } : {};
  // copies stack down and to the right, under any shadow
  const shadows = [
    ...Array.from({ length: props.copies?.n ?? 0 }, (_, i) => `${(i + 1) * 2}px ${(i + 1) * 2}px 0 ${props.copies!.color}`),
    ...(props.shadow ? [`${px(props.shadow.x)} ${px(props.shadow.y)} ${px(props.shadow.blur)} ${props.shadow.color}`] : []),
  ];
  const edge = props.sticker ? { colour: props.sticker, width: "4px" } : props.stroke ? { colour: props.stroke, width: px(props.strokeWidth) } : null;
  const word: CSSProperties = {
    ...(plate?.each ? box : {}),
    ...(edge ? { WebkitTextStroke: `${edge.width} ${edge.colour}`, paintOrder: "stroke fill" } : {}),
    ...(shadows.length ? { textShadow: shadows.join(", ") } : {}),
  };
  const second = (w: string, i: number) => !!props.font2 && (props.font2Words === "short" ? w.replace(/[^\p{L}\p{N}]/gu, "").length <= 2 : i === words.length - 1);
  const vars = { "--base": props.fill ?? "#ffffff", "--lit": props.spokenFill ?? "transparent", "--word-bg": plate?.each ? plate.fill : "transparent" } as CSSProperties;
  const kinds = ["sample-custom", props.spokenFill ? "lit" : "", boxed ? "boxed" : "", props.spokenBold ? "bolden" : "", props.arrive ? `arrive ${props.arrive}` : "", props.rainbow ? "rainbow" : "", props.breaks === "stack" ? "stack" : "", props.drawnBox ? "drawn" : ""];
  return (
    <span
      className={`look-sample ${kinds.filter(Boolean).join(" ")}`}
      style={{ ...vars, ...(plate && !plate.each ? box : {}), ...(props.drawnBox ? { borderColor: props.drawnBox } : {}), fontFamily: `"${props.fontFamily}", system-ui, sans-serif`, fontWeight: props.fontWeight, textTransform: props.caps ? "uppercase" : undefined, letterSpacing: px(props.letterSpacing) }}
    >
      {words.map((w, i) => (
        <i
          key={i}
          style={{ ...word, animationDelay: `${i * 0.45}s`, animationDuration: `${words.length * 0.45}s`, ...(second(w, i) ? { fontFamily: `"${props.font2}", cursive`, textTransform: "none", fontWeight: 400 } : {}) }}
        >
          {w}
        </i>
      ))}
    </span>
  );
}

/** A ready style's settings at 1080, with the colour it lights the spoken word in. */
function readyProps(look: (typeof CAPTION_LOOKS)[number]): Partial<El> {
  return { ...captionProps(look.key, { width: 1080, height: 1080 }), spokenFill: look.unlit ? undefined : (look.lit ?? SPOKEN_COLOURS[0]) };
}

/** A box to type a style's name in: Enter or leaving it keeps the name, Esc leaves it as it was. */
export function NameField({ initial = "", onDone, className = "captions-tile-rename" }: { initial?: string; onDone: (name: string | null) => void; className?: string }) {
  return (
    <input
      className={className}
      data-name="style-name"
      autoFocus
      defaultValue={initial}
      placeholder="Name this style"
      onBlur={(e) => onDone(e.currentTarget.value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") onDone(null);
        e.stopPropagation();
      }}
    />
  );
}

/** One of your styles: pick it to use it; the ⋯ on hover renames, duplicates or deletes it. Shown in Captions and Assets. */
export function CustomTile({ look, on, off, apply }: { look: CustomLook; on: boolean; off: boolean; apply: () => void }) {
  const [naming, setNaming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useDismiss(!!menu, () => setMenu(null), ".captions-tile-menu, .captions-tile-more");
  const name = look.name;
  const act = (f: () => void) => () => (setMenu(null), f());
  return (
    <div className={`captions-tile custom${on ? " on" : ""}${off ? " off" : ""}${menu ? " menu-open" : ""}`} data-name={`captions-tile-custom-${look.name}`}>
      <button className="captions-tile-face" disabled={off} onClick={apply}>
        <StyleSample props={look.props} />
      </button>
      <button
        className="captions-tile-more"
        data-name="captions-tile-more"
        title={`More for ${name}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: Math.min(r.right - 150, window.innerWidth - 160), y: r.bottom + 4 });
        }}
      >
        ⋯
      </button>
      {menu && (
        <div className="ctx captions-tile-menu" style={{ left: menu.x, top: menu.y }}>
          <button type="button" className="ctx-item" data-name="style-rename" onClick={act(() => setNaming(true))}>
            Rename
          </button>
          <button type="button" className="ctx-item" data-name="style-duplicate" onClick={act(() => duplicateLook(look.id))}>
            Duplicate
          </button>
          <button type="button" className="ctx-item danger" data-name="style-delete" onClick={act(() => removeLook(look.id))}>
            Delete
          </button>
        </div>
      )}
      {naming ? <NameField initial={look.name} onDone={(n) => (n && renameLook(look.id, n), setNaming(false))} /> : <span className="captions-tile-name">{name}</span>}
    </div>
  );
}

/** The empty tile at the end of your styles: it asks for a name and keeps the look the captions have now. */
function SaveTile({ style }: { style: Partial<El> | null }) {
  const [naming, setNaming] = useState(false);
  return (
    <div className="captions-tile save" data-name="captions-tile-save">
      {naming && style ? (
        <div className="captions-tile-face">
          <NameField onDone={(n) => (n && saveStyle(style, n), setNaming(false))} />
        </div>
      ) : (
        <button className="captions-tile-face" disabled={!style} onClick={() => setNaming(true)}>
          <span className="captions-save-plus">+</span>
          <span>Save the look you made</span>
        </button>
      )}
    </div>
  );
}

/** The fonts of every look, fetched once so the tiles and the captions show in them. */
export function useCaptionFonts() {
  useEffect(() => {
    for (const family of new Set([...Object.values(CAPTION_FONTS), ...CAPTION_FONTS_2])) void fetchFamily(family);
  }, []);
}

/** How many captions the open video has, the ready look they have now, and their style now. Captions and Assets share it. */
export function useCaptionStyle() {
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
  return { count, now, style };
}

const allCaptions = () => captionsIn(currentDoc(getState()), getState().clock.scene);

/** Gives every caption in the open video one of your styles. */
export function applyStyle(l: CustomLook) {
  const ids = allCaptions();
  if (ids.length) dispatch("style_captions", { ids, look: "bold", custom: { name: l.name, props: l.props } });
}

/** Your styles, with their fonts fetched so the tiles show in them. */
export function useYourStyles(): CustomLook[] {
  const custom = useCustomLooks();
  useEffect(() => {
    for (const l of custom) if (l.props.fontFamily) void fetchFamily(l.props.fontFamily);
  }, [custom]);
  return custom;
}

export default function CaptionsPanel() {
  useCaptionFonts();
  const { count, now, style } = useCaptionStyle();
  const custom = useYourStyles();
  return (
    <div className="captions-panel" data-name="captions-panel">
      <div className="captions-panel-hint">{count ? "Pick a style. Every caption changes." : "Make captions first with Auto captions under the timeline, then pick a style."}</div>
      <Shelf name="captions-yours" title="Your styles" count={custom.length}>
        <div className="captions-tiles">
          {custom.map((l) => (
            <CustomTile
              key={l.id}
              look={l}
              on={!!style && sameLook(style, l.props)}
              off={!count}
              apply={() => applyStyle(l)}
            />
          ))}
          <SaveTile style={count ? style : null} />
        </div>
      </Shelf>
      <Shelf name="captions-ready" title="Ready styles" count={CAPTION_LOOKS.length}>
        <div className="captions-tiles">
          {CAPTION_LOOKS.map((l) => (
            <button
              key={l.key}
              className={`captions-tile${now === l.key ? " on" : ""}`}
              data-name={`captions-tile-${l.key}`}
              disabled={!count}
              onClick={() => {
                const ids = allCaptions();
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
      </Shelf>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { dragCancel, dragPreview, getState, workDoc, dispatch, select, useStore } from "../state/store";
import { playsFile } from "../document/types";
import { BLENDS } from "../document/types";
import type { Blend, El, Layout, Moving } from "../document/types";
import { canBeComponent, isLooseCopy } from "../document/components";
import { canTurn } from "../document/geometry";
import { defaultLayout } from "../document/layout";
import { newId } from "../commands";
import type { AlignHow } from "../commands";
import { useLayout, setLayout } from "./layout";
import type { RightTab } from "./layout";
import { KEY_GROUPS, entranceOf, sceneOf, spanOf } from "../document/time";
import { useKeyFocus } from "./keyFocus";
import type { Entrance } from "../document/time";
import SpeedGraph from "./SpeedGraph";
import CommentsList from "./CommentsList";
import ColorPanel from "./ColorPanel";
import { rootOf } from "./BeforeAfter";
import { gradablesIn } from "../document/grade";
import FontPicker from "./FontPicker";
import { ColorField } from "./ColorPicker";
import { colorOpacity, withOpacity } from "./color";

function NumField({
  label,
  value,
  onCommit,
  onDrag,
  min,
  mark,
  diamond = true,
}: {
  label: string;
  value: number | "";
  onCommit: (n: number) => void;
  onDrag?: (n: number) => void;
  min?: number;
  /** In Motion, a property that can change over time shows its keyframe diamond and its colour. */
  mark?: KeyMark;
  /** False when the diamond sits on the row instead, shared with the field beside it. Option click on the label still keys this one alone. */
  diamond?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const [dragging, setDragging] = useState<"x" | "y" | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    axis: "x" | "y";
    startX: number;
    startY: number;
    startVal: number;
    hasDragged: boolean;
    currentVal: number;
    target: HTMLElement;
  } | null>(null);

  useEffect(() => {
    if (!dragRef.current?.hasDragged) setText(String(value));
  }, [value]);

  const commit = () => {
    if (dragRef.current?.hasDragged) return;
    const n = parseFloat(text);
    if (Number.isFinite(n) && n !== value) onCommit(min !== undefined ? Math.max(min, n) : n);
    else setText(String(value));
  };

  const startDrag = (e: React.PointerEvent<HTMLElement>, axis: "x" | "y") => {
    if (e.button !== 0) return;
    if (axis === "x" && e.altKey && mark && !diamond) {
      e.preventDefault();
      mark.toggle();
      return;
    }
    if (axis === "x") {
      e.preventDefault();
    }
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const parsed = parseFloat(text);
    const startVal = typeof value === "number" ? value : Number.isFinite(parsed) ? parsed : 0;

    dragRef.current = {
      pointerId: e.pointerId,
      axis,
      startX: e.clientX,
      startY: e.clientY,
      startVal,
      hasDragged: false,
      currentVal: startVal,
      target,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;

    const dx = e.clientX - d.startX;
    const dy = d.startY - e.clientY;
    const dist = d.axis === "x" ? Math.abs(dx) : Math.abs(e.clientY - d.startY);

    if (!d.hasDragged) {
      if (dist < 3) return;
      d.hasDragged = true;
      setDragging(d.axis);
      if (d.axis === "y") {
        d.target.style.cursor = "ns-resize";
        window.getSelection()?.removeAllRanges();
      }
    }

    e.preventDefault();
    const rawDelta = d.axis === "x" ? dx : dy;
    const multiplier = e.shiftKey ? 10 : 1;
    let next = d.startVal + rawDelta * multiplier;
    if (min !== undefined) next = Math.max(min, next);
    const rounded = Math.round(next * 100) / 100;

    d.currentVal = rounded;
    setText(String(rounded));
    onDrag?.(rounded);
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;

    try {
      d.target.releasePointerCapture(e.pointerId);
    } catch {}

    if (d.axis === "y") {
      d.target.style.cursor = "";
    }
    setDragging(null);
    const hadDragged = d.hasDragged;
    const finalVal = d.currentVal;
    dragRef.current = null;

    if (hadDragged) {
      dragCancel();
      onCommit(finalVal);
      if (d.axis === "y") {
        (d.target as HTMLInputElement).blur();
        window.getSelection()?.removeAllRanges();
      }
    }
  };

  const cancelDrag = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;

    try {
      d.target.releasePointerCapture(e.pointerId);
    } catch {}

    if (d.axis === "y") {
      d.target.style.cursor = "";
    }
    setDragging(null);
    const hadDragged = d.hasDragged;
    dragRef.current = null;

    if (hadDragged) {
      dragCancel();
      setText(String(value));
    }
  };

  return (
    <label className={`f${mark ? ` moves-${mark.state}` : ""}`}>
      <span
        className="num-label"
        title={mark && !diamond ? `Option click to key ${label} on its own` : undefined}
        onPointerDown={(e) => startDrag(e, "x")}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
      >
        {label}
      </span>
      <input
        value={text}
        className={dragging === "y" ? "dragging-ns" : ""}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onPointerDown={(e) => startDrag(e, "y")}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(String(value));
            e.currentTarget.blur();
          }
        }}
      />
      {mark && diamond && <KeyDiamond mark={mark} />}
    </label>
  );
}

/** The keyframe at the playhead: empty when there is none, filled when there is one. A click adds or takes it away. */
function KeyDiamond({ mark }: { mark: KeyMark }) {
  return (
    <button
      type="button"
      className={`key-here moves-${mark.state}`}
      data-name={`key-${mark.name}`}
      title={mark.state === "here" ? `Take away the ${mark.name} keyframe here` : `Add ${/^[aeiou]/i.test(mark.name) ? "an" : "a"} ${mark.name} keyframe here`}
      onClick={(e) => {
        e.preventDefault();
        mark.toggle();
      }}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1 11 6 6 11 1 6Z" fill={mark.state === "here" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** Whether a property changes over time: not at all, yes but with no keyframe at the playhead, or with one here. */
interface KeyMark {
  name: string;
  state: "none" | "animated" | "here";
  toggle: () => void;
}

const BLEND_NAMES: Record<Blend, string> = { normal: "Normal", multiply: "Multiply", screen: "Screen", overlay: "Overlay", "soft-light": "Soft light", darken: "Darken", lighten: "Lighten", add: "Add" };

const KEY_NAMES: Record<Moving, string> = { x: "X", y: "Y", width: "width", height: "height", rotation: "rotation", opacity: "opacity" };

/**
 * The keyframe mark for some properties of one thing at the playhead. Position and size key both of their
 * numbers together, as people nearly always want. The diamond adds or takes away the keyframe.
 */
function keyMark(el: El, props: Moving[], t: number, name = KEY_NAMES[props[0]]): KeyMark {
  const here = props.some((p) => el.keys[p]?.some((k) => Math.abs(k.t - t) < 0.004));
  const moving = props.some((p) => el.keys[p]?.length);
  return {
    name,
    state: here ? "here" : moving ? "animated" : "none",
    toggle: () => dispatch(here ? "remove_key" : "key_now", { ids: [el.id], props, t }),
  };
}

function Seg<T extends string>({ value, options, onPick }: { value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="seg2">
      {options.map(([v, label]) => (
        <span key={v} className={value === v ? "on" : ""} onClick={() => onPick(v)}>
          {label}
        </span>
      ))}
    </div>
  );
}

function LayoutSection({ frame }: { frame: El }) {
  const l = frame.layout;
  if (!l) {
    return (
      <div className="sec">
        <h4>Auto layout</h4>
        <div className="linkbtn" onClick={() => dispatch("set_layout", { id: frame.id, layout: defaultLayout() })}>
          + Add auto layout
        </div>
        <div className="hint2">Lines up what is inside this frame. Shortcut: Shift A.</div>
      </div>
    );
  }
  const change = (patch: Partial<Layout>, label: string) => dispatch("set_props", { ids: [frame.id], props: { layout: { ...l, ...patch } }, label });
  const preview = (patch: Partial<Layout>) => dragPreview("set_props", { ids: [frame.id], props: { layout: { ...l, ...patch } } });
  return (
    <div className="sec">
      <h4>Auto layout</h4>
      <Seg value={l.dir} options={[["column", "Vertical"], ["row", "Horizontal"]]} onPick={(dir) => change({ dir }, "Change direction")} />
      <div className="gap" />
      <div className="field">
        <NumField label="Gap" value={l.gap} min={0} onCommit={(n) => change({ gap: n }, "Change gap")} onDrag={(n) => preview({ gap: n })} />
        <div />
        <NumField label="Pad X" value={l.padX} min={0} onCommit={(n) => change({ padX: n }, "Change padding")} onDrag={(n) => preview({ padX: n })} />
        <NumField label="Pad Y" value={l.padY} min={0} onCommit={(n) => change({ padY: n }, "Change padding")} onDrag={(n) => preview({ padY: n })} />
      </div>
      <div className="gap" />
      <Seg value={l.align} options={[["start", "Start"], ["center", "Middle"], ["end", "End"], ["stretch", "Stretch"]]} onPick={(align) => change({ align }, "Change alignment")} />
      <div className="gap" />
      <Seg value={l.justify} options={l.dir === "row" ? [["start", "Left"], ["center", "Centre"], ["end", "Right"], ["between", "Spread"]] : [["start", "Top"], ["center", "Centre"], ["end", "Bottom"], ["between", "Spread"]]} onPick={(justify) => change({ justify }, "Change spacing")} />
      <div className="gap" />
      <Seg value={l.hug ? "hug" : "fixed"} options={[["hug", "Hug content"], ["fixed", "Fixed size"]]} onPick={(v) => change({ hug: v === "hug" }, "Change sizing")} />
      <div className="linkbtn" style={{ marginTop: 10 }} onClick={() => dispatch("set_layout", { id: frame.id, layout: null })}>
        Remove auto layout
      </div>
    </div>
  );
}

const WEIGHTS: [number, string][] = [
  [300, "Light"],
  [400, "Regular"],
  [500, "Medium"],
  [600, "Semibold"],
  [700, "Bold"],
  [900, "Black"],
];

function TextSection({ els }: { els: El[] }) {
  const doc = workDoc();
  const ids = els.map((e) => e.id);
  const first = els[0];
  const styles = Object.entries(doc.styles ?? {});
  const linked = els.every((e) => e.textStyleId && e.textStyleId === first.textStyleId) ? first.textStyleId : "";
  const [naming, setNaming] = useState(false);
  const [styleName, setStyleName] = useState("");
  const set = (props: Partial<El>, label: string) => dispatch("set_props", { ids, props, label });
  // Part of a saved style? Then the look belongs to the style, and changing it changes every text that uses it.
  const look = (props: Partial<El> & Record<string, unknown>, label: string) => {
    if (linked) dispatch("update_text_style", { styleId: linked, props: props as never, label } as never);
    else set(props, label);
  };
  const lookPreview = (props: Partial<El> & Record<string, unknown>) => {
    if (linked) dragPreview("update_text_style", { styleId: linked, props: props as never });
    else dragPreview("set_props", { ids, props });
  };
  const saveStyle = () => {
    const name = styleName.trim();
    if (!name) return;
    dispatch("create_text_style", { styleId: newId("style"), fromId: first.id, name });
    setNaming(false);
    setStyleName("");
  };
  return (
    <div className="sec">
      <h4>Text</h4>
      <label className="f">
        <span>Style</span>
        <select
          value={linked}
          onChange={(e) => dispatch("apply_text_style", { ids, styleId: e.target.value || null })}
        >
          <option value="">None</option>
          {styles.map(([id, st]) => (
            <option key={id} value={id}>
              {st.name}
            </option>
          ))}
        </select>
      </label>
      {linked && <div className="hint2">Changes here change every text that uses {doc.styles?.[linked]?.name}.</div>}
      <div className="gap" />
      <label className="f">
        <span>Font</span>
        <FontPicker value={first.fontFamily} onCommit={(v) => look({ fontFamily: v }, "Change font")} />
      </label>
      <div className="gap" />
      <div className="field">
        <label className="f">
          <span>Weight</span>
          <select value={first.fontWeight} onChange={(e) => look({ fontWeight: Number(e.target.value) }, "Change weight")}>
            {WEIGHTS.map(([w, name]) => (
              <option key={w} value={w}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <NumField label="Size" value={first.fontSize} min={1} onCommit={(n) => look({ fontSize: n }, "Change font size")} onDrag={(n) => lookPreview({ fontSize: n })} />
        <NumField label="Line" value={first.lineHeight ? Math.round(first.lineHeight * 100) / 100 : 1.3} min={0.5} onCommit={(n) => look({ lineHeight: n }, "Change line height")} onDrag={(n) => lookPreview({ lineHeight: n })} />
        <NumField label="Space" value={first.letterSpacing} onCommit={(n) => look({ letterSpacing: n }, "Change letter spacing")} onDrag={(n) => lookPreview({ letterSpacing: n })} />
      </div>
      <div className="gap" />
      <Seg value={first.textAlign} options={[["left", "Left"], ["center", "Centre"], ["right", "Right"]]} onPick={(textAlign) => set({ textAlign }, "Change alignment")} />
      <div className="gap" />
      <Seg value={first.textFixed ? "fixed" : "auto"} options={[["auto", "Auto width"], ["fixed", "Fixed width"]]} onPick={(v) => set({ textFixed: v === "fixed" }, "Change text box")} />
      <div className="gap" />
      {linked ? (
        <div className="linkbtn" onClick={() => dispatch("apply_text_style", { ids, styleId: null })}>
          Detach from the style
        </div>
      ) : naming ? (
        <div className="field">
          <input
            className="f"
            autoFocus
            value={styleName}
            placeholder="Name, like Heading"
            onChange={(e) => setStyleName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") saveStyle();
              if (e.key === "Escape") setNaming(false);
            }}
            style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--text)" }}
          />
          <div className="linkbtn" onClick={saveStyle}>
            Save
          </div>
        </div>
      ) : (
        els.length === 1 && (
          <div className="linkbtn" onClick={() => setNaming(true)}>
            + Save as a text style
          </div>
        )
      )}
    </div>
  );
}

function ComponentSection({ el, copies }: { el: El; copies: number }) {
  const doc = workDoc();
  if (el.component) {
    return (
      <div className="sec">
        <h4>Component</h4>
        <div className="hint2">
          This is the original. Change it and {copies === 0 ? "every copy you place" : copies === 1 ? "its one copy" : `all ${copies} copies`} will follow.
        </div>
      </div>
    );
  }
  const main = doc.elements[el.componentId];
  const changed = Object.keys(el.overrides).length > 0;
  return (
    <div className="sec">
      <h4>Copy of {main ? main.name : "a component"}</h4>
      <div className="hint2">
        It follows the original, except for what you change here.
      </div>
      <div className="gap" />
      {main && (
        <div className="linkbtn" onClick={() => select([main.id])}>
          Go to the original
        </div>
      )}
      {changed && (
        <div className="linkbtn" style={{ marginTop: 6 }} onClick={() => dispatch("reset_overrides", { id: el.id })}>
          Undo my changes to this copy
        </div>
      )}
      <div className="linkbtn" style={{ marginTop: 6 }} onClick={() => dispatch("detach_instance", { id: el.id })}>
        Detach from the original
      </div>
    </div>
  );
}

const ENTRANCE_CHOICES: [Entrance, string][] = [
  ["none", "Straight away"],
  ["fade", "Fade"],
  ["slide-left", "Slide from the right"],
  ["slide-right", "Slide from the left"],
  ["slide-up", "Slide up"],
  ["slide-down", "Slide down"],
  ["grow", "Grow"],
];


/** The seconds a group of properties has a moment at, in order. */
function momentTimes(el: El, props: Moving[]): number[] {
  const times = new Set<number>();
  for (const p of props) for (const k of el.keys[p] ?? []) times.add(Math.round(k.t * 1000) / 1000);
  return [...times].sort((a, b) => a - b);
}

/** A frame that plays: how long it is. */
function LengthSection({ el }: { el: El }) {
  return (
    <div className="sec">
      <h4>Scene</h4>
      <NumField label="Length" value={Math.round(el.duration * 100) / 100} min={0} onCommit={(seconds) => dispatch("set_duration", { id: el.id, seconds })} />
    </div>
  );
}

const ALIGNS: { how: AlignHow; label: string; need: number; icon: React.ReactNode }[] = [
  { how: "left", label: "Line up left edges", need: 1, icon: <><path d="M3 2v12" /><rect x="5" y="4" width="8" height="3" /><rect x="5" y="9" width="5" height="3" /></> },
  { how: "centre", label: "Line up centres", need: 1, icon: <><path d="M8 2v12" /><rect x="3" y="4" width="10" height="3" /><rect x="5" y="9" width="6" height="3" /></> },
  { how: "right", label: "Line up right edges", need: 1, icon: <><path d="M13 2v12" /><rect x="3" y="4" width="8" height="3" /><rect x="6" y="9" width="5" height="3" /></> },
  { how: "top", label: "Line up tops", need: 1, icon: <><path d="M2 3h12" /><rect x="4" y="5" width="3" height="8" /><rect x="9" y="5" width="3" height="5" /></> },
  { how: "middle", label: "Line up middles", need: 1, icon: <><path d="M2 8h12" /><rect x="4" y="3" width="3" height="10" /><rect x="9" y="5" width="3" height="6" /></> },
  { how: "bottom", label: "Line up bottoms", need: 1, icon: <><path d="M2 13h12" /><rect x="4" y="3" width="3" height="8" /><rect x="9" y="6" width="3" height="5" /></> },
  { how: "space-across", label: "Space evenly across, three or more", need: 3, icon: <><path d="M2 2v12M14 2v12" /><rect x="6" y="4" width="4" height="8" /></> },
  { how: "space-down", label: "Space evenly down, three or more", need: 3, icon: <><path d="M2 2h12M2 14h12" /><rect x="4" y="6" width="8" height="4" /></> },
  { how: "tidy", label: "Tidy up into neat rows, two or more", need: 2, icon: <><rect x="2.5" y="2.5" width="5" height="5" /><rect x="9" y="2.5" width="4.5" height="5" /><rect x="2.5" y="9" width="5" height="4.5" /><rect x="9" y="9" width="4.5" height="4.5" /></> },
];

/** Line things up with each other, space them evenly, or tidy them into rows. One thing lines up with the frame that holds it. */
function AlignSection({ ids }: { ids: string[] }) {
  return (
    <div className="sec">
      <h4>Line up</h4>
      <div className="align-row">
        {ALIGNS.map((a) => (
          <button
            key={a.how}
            type="button"
            className="align-btn"
            data-name={`align-${a.how}`}
            title={a.label}
            disabled={ids.length < a.need}
            onClick={() => dispatch("align_elements", { ids, how: a.how })}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {a.icon}
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Clips and sounds: how fast the file plays, in percent. 200 is twice as fast. The bar in the timeline gets shorter or longer to match. */
function PlaySpeedSection({ els }: { els: El[] }) {
  const same = els.every((e) => (e.speed || 1) === (els[0].speed || 1));
  return (
    <div className="sec">
      <h4>Speed</h4>
      <NumField
        label="Speed %"
        value={same ? Math.round((els[0].speed || 1) * 100) : ""}
        min={10}
        onCommit={(n) => dispatch("set_speed", { ids: els.map((e) => e.id), speed: n / 100 })}
      />
    </div>
  );
}

/** How the move that ends at the keyframe picked in the timeline speeds up and slows down. */
function SpeedSection({ el }: { el: El }) {
  const focus = useKeyFocus();
  const moves = (g: (typeof KEY_GROUPS)[number]) => momentTimes(el, g.props).length > 1;
  // a keyframe picked in the timeline shows its move; with none picked, the first thing that moves shows, so the graph is always there
  const picked = focus && focus.id === el.id ? KEY_GROUPS.find((g) => g.props.some((p) => el.keys[p]?.some((k) => Math.abs(k.t - focus.t) < 0.005)) && moves(g)) : undefined;
  const group = picked ?? KEY_GROUPS.find(moves);
  if (!group) return null;
  return (
    <div className="sec">
      <h4>{group.name}, speed</h4>
      <SpeedGraph key={group.name + el.id} el={el} props={group.props} times={momentTimes(el, group.props)} />
    </div>
  );
}

/** When a thing appears and leaves inside its frame, and how it arrives and goes. Closed until opened. */
function InAndOut({ el, scene }: { el: El; scene: El }) {
  const [open, setOpen] = useState(false);
  const span = spanOf(el, scene);
  return (
    <div className="sec">
      <button type="button" className={`sec-fold ${open ? "open" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M2.5 1.5 5.5 4l-3 2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        In and out
      </button>
      {open && (
        <>
          <div className="field">
            <NumField
              label="Appears"
              value={Math.round(span.start * 100) / 100}
              min={0}
              onCommit={(start) => dispatch("set_timing", { ids: [el.id], start, end: span.end })}
            />
            <NumField
              label="Leaves"
              value={Math.round(span.end * 100) / 100}
              min={0}
              onCommit={(end) => dispatch("set_timing", { ids: [el.id], start: span.start, end })}
            />
          </div>
          <div className="gap" />
          <label className="f">
            <span>Arrives</span>
            <select
              value={entranceOf(el, scene, "in")}
              onChange={(e) => dispatch("set_entrance", { ids: [el.id], when: "in", kind: e.target.value as Entrance })}
            >
              {ENTRANCE_CHOICES.map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="gap" />
          <label className="f">
            <span>Goes</span>
            <select
              value={entranceOf(el, scene, "out")}
              onChange={(e) => dispatch("set_entrance", { ids: [el.id], when: "out", kind: e.target.value as Entrance })}
            >
              {ENTRANCE_CHOICES.map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}

export default function PropertiesPanel() {
  const mode = useLayout((d) => d.mode);
  const videoTab = useLayout((d) => d.videoTab);
  const photoTab = useLayout((d) => d.photoTab);
  const selection = useStore((s) => s.selection);
  useStore((s) => s.timeline[s.cursor]);
  useStore((s) => s.transientDoc);
  // the values are the ones at the moment the clock is on, and they stand still while it plays
  useStore((s) => (s.clock.playing ? -1 : s.clock.t));
  const openScene = useStore((s) => s.clock.scene);
  const every = useLayout((d) => d.gradeEvery);
  const doc = workDoc();
  const els = selection.map((id) => doc.elements[id]).filter(Boolean) as El[];

  const tab: RightTab = mode === "photo" ? (photoTab ?? "color") : mode === "motion" ? (videoTab ?? "properties") : "properties";
  const setTab = (next: RightTab) => {
    if (mode === "photo") setLayout({ photoTab: next });
    else if (mode === "motion") setLayout({ videoTab: next });
  };

  const showSwitch = mode === "motion" || mode === "photo";
  const switchElement = showSwitch ? (
    <div className="panel-switch-wrap">
      <div className="pill time-look panel-switch">
        <button
          type="button"
          className={tab === "properties" ? "active" : ""}
          data-name="switch-properties"
          title="Properties"
          onClick={() => setTab("properties")}
        >
          Properties
        </button>
        <button
          type="button"
          className={tab === "color" ? "active" : ""}
          data-name="switch-color"
          title="Colour"
          onClick={() => setTab("color")}
        >
          Colour
        </button>
      </div>
    </div>
  ) : null;

  if (tab === "color") {
    // Every clip: what is changed goes to every picture and clip in the scene, like a layer over them all
    const root = rootOf(doc, selection[0])?.id ?? openScene;
    if (every && root) {
      return (
        <ColorPanel
          els={gradablesIn(doc, root).map((id) => doc.elements[id])}
          every={doc.elements[root]?.name ?? ""}
          top={switchElement}
        />
      );
    }
    return <ColorPanel els={els} top={switchElement} />;
  }

  if (els.length === 0) {
    return (
      <aside className="right">
        {switchElement}
        <div className="panel-title">Design</div>
        <div className="sec">
          <h4>Background</h4>
          <ColorField value={doc.background ?? "#141417"} onCommit={(c) => dispatch("set_background", { color: c })} />
          {doc.background && (
            <button className="mini" onClick={() => dispatch("set_background", { color: null })}>
              Back to dark
            </button>
          )}
        </div>
        <div className="empty pad">Select something to change it.</div>
        <CommentsList />
      </aside>
    );
  }

  const ids = els.map((e) => e.id);
  const frames = Object.values(doc.elements).filter((e) => e.type === "frame");
  const one = els.length === 1 ? els[0] : null;
  const scene = one ? sceneOf(doc, one.id) : null;
  const set = (props: Partial<El>, label?: string) => dispatch("set_props", { ids, props, label });
  const preview = (props: Partial<El>) => dragPreview("set_props", { ids, props });
  const first = els[0];
  const allText = els.every((e) => e.type === "text");
  const allImages = els.every((e) => e.type === "image");
  // a group, or a copy of a single thing, has no fill or line of its own: those belong to what is inside
  const allGroups = els.every((e) => e.type === "group" || isLooseCopy(doc, e));
  const noFill = allImages || allGroups || els.every((e) => e.type === "path" && !e.closed);
  const hasRadius = els.every((e) => e.type === "frame" || e.type === "rect" || e.type === "image");
  // in Motion, one thing inside a frame that plays shows a keyframe diamond beside each property that can change over time
  const keyed = mode === "motion" && one && scene && one.id !== scene.id ? one : null;
  const now = Math.round(getState().clock.t * 1000) / 1000;
  const mark = (prop: Moving) => (keyed ? keyMark(keyed, [prop], now) : undefined);

  return (
    <aside className="right">
      {switchElement}
      <div className="panel-title">{one ? one.name : `${els.length} selected`}</div>

      {els.length > 0 && !els.every((e) => e.type === "frame" && !e.parentId) && <AlignSection ids={els.map((e) => e.id)} />}

      {mode === "motion" && one && scene && one.id === scene.id && <LengthSection el={one} />}
      {mode === "motion" && one && one.type === "frame" && !(one.duration > 0) && (
        <div className="sec">
          <h4>Scene</h4>
          <button className="pill" data-name="make-video" title="Give this frame a length, so what is in it can appear, move and leave" onClick={() => dispatch("set_duration", { id: one.id, seconds: 10 })}>
            Make this frame a scene
          </button>
        </div>
      )}
      {mode === "motion" && els.length > 0 && els.every(playsFile) && <PlaySpeedSection els={els} />}
      {keyed && <SpeedSection el={keyed} />}

      {one && (
        <div className="sec">
          <h4>Position and size</h4>
          <div className={`field${keyed ? " paired" : ""}`}>
            <NumField label="X" mark={mark("x")} diamond={false} value={Math.round(one.x * 100) / 100} onCommit={(n) => dispatch("move_elements", { ids, dx: n - one.x, dy: 0 })} />
            <NumField label="Y" mark={mark("y")} diamond={false} value={Math.round(one.y * 100) / 100} onCommit={(n) => dispatch("move_elements", { ids, dx: 0, dy: n - one.y })} />
            {keyed && <KeyDiamond mark={keyMark(keyed, ["x", "y"], now, "position")} />}
            <NumField
              label="W"
              mark={mark("width")}
              diamond={false}
              value={Math.round(one.width * 100) / 100}
              min={1}
              onCommit={(n) => dispatch("resize_element", { id: one.id, x: one.x, y: one.y, width: n, height: one.height })}
            />
            <NumField
              label="H"
              mark={mark("height")}
              diamond={false}
              value={Math.round(one.height * 100) / 100}
              min={1}
              onCommit={(n) => dispatch("resize_element", { id: one.id, x: one.x, y: one.y, width: one.width, height: n })}
            />
            {keyed && <KeyDiamond mark={keyMark(keyed, ["width", "height"], now, "size")} />}
          </div>
          {canTurn(doc, one.id) && (
            <>
              <div className="gap" />
              <NumField label="Rotation" mark={mark("rotation")} value={Math.round((one.rotation || 0) * 100) / 100} onCommit={(n) => set({ rotation: n }, "Rotate")} onDrag={(n) => preview({ rotation: n })} />
            </>
          )}
        </div>
      )}

      {hasRadius && (
        <div className="sec">
          <h4>Corners</h4>
          <NumField label="Radius" value={first.radius} min={0} onCommit={(n) => set({ radius: n }, "Change corner radius")} onDrag={(n) => preview({ radius: n })} />
        </div>
      )}

      {mode !== "motion" && one && canBeComponent(one) && (
        <div className="sec">
          <h4>Component</h4>
          <button className="pill" onClick={() => dispatch("create_component", { id: one.id })}>
            Make a component
          </button>
          <div className="hint2">Turn this into something you can reuse. Place copies from the Assets tab, and changing it changes them all.</div>
        </div>
      )}

      {mode !== "motion" && one && (one.component || one.type === "instance") && (
        <ComponentSection el={one} copies={Object.values(doc.elements).filter((e) => e.type === "instance" && e.componentId === one.id && !e.id.includes("::")).length} />
      )}

      {!noFill && (
        <div className="sec">
          <h4>{allText ? "Text colour" : "Fill"}</h4>
          {!allText && (
            <div className="seg2">
              <span className={!first.gradient ? "on" : ""} onClick={() => first.gradient && set({ gradient: null }, "Use a solid fill")}>
                Solid
              </span>
              <span
                className={first.gradient ? "on" : ""}
                onClick={() => !first.gradient && set({ gradient: { from: first.fill, to: "#7c5cff", angle: 90 } }, "Use a gradient")}
              >
                Gradient
              </span>
            </div>
          )}
          {first.gradient && !allText ? (
            <>
              <ColorField value={first.gradient.from} onCommit={(c) => c && set({ gradient: { ...first.gradient!, from: c } }, "Change gradient")} onPreview={(c) => preview({ gradient: { ...first.gradient!, from: c } })} />
              <div className="gap" />
              <ColorField value={first.gradient.to} onCommit={(c) => c && set({ gradient: { ...first.gradient!, to: c } }, "Change gradient")} onPreview={(c) => preview({ gradient: { ...first.gradient!, to: c } })} />
              <div className="gap" />
              <NumField label="Angle" value={first.gradient.angle} onCommit={(n) => set({ gradient: { ...first.gradient!, angle: n } }, "Change gradient angle")} onDrag={(n) => preview({ gradient: { ...first.gradient!, angle: n } })} />
            </>
          ) : (
            <div className="field">
              <ColorField value={first.fill} onCommit={(c) => c && set({ fill: c }, "Change fill")} onPreview={(c) => preview({ fill: c })} />
              <NumField
                label="%"
                value={colorOpacity(first.fill)}
                min={0}
                onCommit={(n) => set({ fill: withOpacity(first.fill, Math.min(100, Math.max(0, n))) }, "Change fill opacity")}
                onDrag={(n) => preview({ fill: withOpacity(first.fill, Math.min(100, Math.max(0, n))) })}
              />
            </div>
          )}
        </div>
      )}

      {!allText && !allGroups && (
        <div className="sec">
          <h4>Stroke</h4>
          <div className="field">
            <ColorField
              none
              value={first.stroke}
              onCommit={(c) => set({ stroke: c }, "Change stroke")}
              onPreview={(c) => preview({ stroke: c })}
            />
            <NumField
              label="%"
              value={colorOpacity(first.stroke)}
              min={0}
              onCommit={(n) => set({ stroke: withOpacity(first.stroke ?? "#000000", Math.min(100, Math.max(0, n))) }, "Change stroke opacity")}
              onDrag={(n) => preview({ stroke: withOpacity(first.stroke ?? "#000000", Math.min(100, Math.max(0, n))) })}
            />
          </div>
          <div className="gap" />
          <NumField label="Width" value={first.strokeWidth} min={0} onCommit={(n) => set({ strokeWidth: n }, "Change stroke width")} onDrag={(n) => preview({ strokeWidth: n })} />
        </div>
      )}

      {one?.type === "frame" && <LayoutSection frame={one} />}

      {one && one.parentId && doc.elements[one.parentId]?.layout && (
        <div className="sec">
          <h4>In auto layout</h4>
          <Seg value={one.grow ? "fill" : "keep"} options={[["keep", "Keep size"], ["fill", "Fill space"]]} onPick={(v) => set({ grow: v === "fill" ? 1 : 0 }, "Change sizing")} />
        </div>
      )}

      {allText && <TextSection els={els} />}

      <div className="sec">
        <h4>Opacity</h4>
        <NumField label="%" mark={mark("opacity")} value={Math.round(first.opacity * 100)} min={0} onCommit={(n) => set({ opacity: Math.min(100, n) / 100 }, "Change opacity")} onDrag={(n) => preview({ opacity: Math.min(100, n) / 100 })} />
        <select value={first.blend ?? "normal"} title="How it mixes with what is under it. Screen makes black clear." onChange={(e) => set({ blend: e.target.value as Blend }, "Change blend")}>
          {BLENDS.map((b) => (
            <option key={b} value={b}>
              {BLEND_NAMES[b]}
            </option>
          ))}
        </select>
      </div>

      {one?.mask && (
        <div className="sec">
          <h4>Mask</h4>
          <div className="field">
            <NumField label="Soft edge" value={one.maskFeather} min={0} onCommit={(n) => set({ maskFeather: n }, "Change soft edge")} onDrag={(n) => preview({ maskFeather: n })} />
            <NumField label="Grow" value={one.maskGrow} onCommit={(n) => set({ maskGrow: n }, "Change mask size")} onDrag={(n) => preview({ maskGrow: n })} />
          </div>
          <div className="gap" />
          <Seg value={one.maskInvert ? "out" : "in"} options={[["in", "Show inside"], ["out", "Show outside"]]} onPick={(v) => set({ maskInvert: v === "out" }, "Turn the mask inside out")} />
        </div>
      )}

      {!allText && !allGroups && (
        <div className="sec">
          <h4>Shadow</h4>
          {first.shadow ? (
            <>
              <div className="field">
                <NumField label="X" value={first.shadow.x} onCommit={(n) => set({ shadow: { ...first.shadow!, x: n } }, "Change shadow")} onDrag={(n) => preview({ shadow: { ...first.shadow!, x: n } })} />
                <NumField label="Y" value={first.shadow.y} onCommit={(n) => set({ shadow: { ...first.shadow!, y: n } }, "Change shadow")} onDrag={(n) => preview({ shadow: { ...first.shadow!, y: n } })} />
                <NumField label="Blur" value={first.shadow.blur} min={0} onCommit={(n) => set({ shadow: { ...first.shadow!, blur: n } }, "Change shadow")} onDrag={(n) => preview({ shadow: { ...first.shadow!, blur: n } })} />
              </div>
              <div className="gap" />
              <ColorField value={first.shadow.color} onCommit={(c) => c && set({ shadow: { ...first.shadow!, color: c } }, "Change shadow")} onPreview={(c) => preview({ shadow: { ...first.shadow!, color: c } })} />
              <div className="gap" />
              <div className="linkbtn" onClick={() => set({ shadow: null }, "Remove shadow")}>
                Remove shadow
              </div>
            </>
          ) : (
            <div className="linkbtn" onClick={() => set({ shadow: { x: 0, y: 8, blur: 24, color: "#00000040" } }, "Add shadow")}>
              + Add a shadow
            </div>
          )}
        </div>
      )}

      {mode !== "motion" && one && frames.length > 0 && (
        <div className="sec">
          <h4>Prototype</h4>
          <Seg
            value={one.linkKind === "back" ? "back" : one.linkKind === "overlay" ? "overlay" : "go"}
            options={[["go", "Go to"], ["overlay", "Open on top"], ["back", "Go back"]]}
            onPick={(v) => set({ linkKind: v === "go" ? "" : (v as "overlay" | "back") }, "Change what a click does")}
          />
          {one.linkKind !== "back" && (
            <>
              <div className="gap" />
              <label className="f">
                <span>Screen</span>
                <select value={one.link ?? ""} onChange={(e) => set({ link: e.target.value || null }, e.target.value ? "Link to a screen" : "Remove link")}>
                  <option value="">Nothing</option>
                  {frames
                    .filter((f) => f.id !== one.id && !f.id.includes("::"))
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          {(one.link || one.linkKind === "back") && (
            <>
              <div className="gap" />
              <label className="f">
                <span>Moves</span>
                <select value={one.transition} onChange={(e) => set({ transition: e.target.value }, "Change the animation")}>
                  <option value="">Instantly</option>
                  <option value="dissolve">Dissolve</option>
                  <option value="push-left">Push left</option>
                  <option value="push-right">Push right</option>
                  <option value="push-up">Push up</option>
                  <option value="push-down">Push down</option>
                </select>
              </label>
              {one.transition && (
                <>
                  <div className="gap" />
                  <NumField label="Ms" value={one.transitionMs || 300} min={50} onCommit={(n) => set({ transitionMs: Math.round(n) }, "Change the animation time")} onDrag={(n) => preview({ transitionMs: Math.round(n) })} />
                </>
              )}
            </>
          )}
          {one.type === "frame" && !one.parentId && (
            <>
              <div className="gap" />
              <Seg value={one.scroll ? "on" : "off"} options={[["off", "Fixed"], ["on", "Scrolls in Present"]]} onPick={(v) => set({ scroll: v === "on" }, "Change scrolling")} />
            </>
          )}
          <div className="hint2">Press Present at the top to click through your screens.</div>
        </div>
      )}


      {keyed && scene && <InAndOut el={keyed} scene={scene} />}
      <CommentsList />
    </aside>
  );
}

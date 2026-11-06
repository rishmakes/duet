import { useEffect, useState } from "react";
import { currentDoc, dispatch, dragCancel, dragPreview, useStore } from "../state/store";
import { spanOf } from "../document/time";
import { QUIETEST_DB, fromDb, toDb, volumeAt } from "../document/sound";
import type { El } from "../document/types";

type Kind = "volume" | "fadeIn" | "fadeOut";

const shown = (kind: Kind, v: number) => (kind === "volume" ? (v <= 0 ? "Off" : `${Math.round(toDb(v) * 10) / 10}`) : v.toFixed(1));

/** One sound control: drag it, type a number, or double click its name to put it back. */
function Row({ ids, kind, label, value, max, unit, hint }: { ids: string[]; kind: Kind; label: string; value: number | null; max: number; unit: string; hint: string }) {
  const rest = kind === "volume" ? 1 : 0;
  const v = value ?? rest;
  // the volume slider moves in decibels, the way loudness is heard; the bottom is silent
  const pos = kind === "volume" ? (v <= 0 ? QUIETEST_DB : Math.max(QUIETEST_DB, toDb(v))) : v;
  const [text, setText] = useState(value === null ? "" : shown(kind, v));
  useEffect(() => setText(value === null ? "" : shown(kind, v)), [kind, v, value]);
  const fromPos = (p: number) => (kind === "volume" ? fromDb(p) : Math.round(p * 10) / 10);
  const live = (n: number) => dragPreview("set_props", { ids, props: { [kind]: n } });
  const done = (n: number) => {
    dragCancel();
    const kept = currentDoc().elements;
    if (ids.some((id) => kept[id] && kept[id][kind] !== n) || kind === "volume") dispatch("set_props", { ids, props: { [kind]: n }, label: `Change ${label.toLowerCase()}` });
  };
  const typed = () => {
    const t = text.trim().toLowerCase();
    const n = kind === "volume" ? (t === "off" || t === "" ? 0 : fromDb(Math.min(0, parseFloat(t)))) : Math.max(0, Math.min(max, parseFloat(t)));
    if (Number.isFinite(n)) done(n);
    else setText(shown(kind, v));
  };
  return (
    <div className={`grade-row sound-${kind}${v !== rest ? " moved" : ""}`} title={hint}>
      <span className="grade-name" title="Double click to put it back" onDoubleClick={() => done(rest)}>
        {label}
      </span>
      <input
        type="range"
        data-name={`sound-${kind}`}
        min={kind === "volume" ? QUIETEST_DB : 0}
        max={max}
        step={kind === "volume" ? 0.5 : 0.1}
        value={pos}
        onInput={(e) => live(fromPos(parseFloat(e.currentTarget.value)))}
        onChange={(e) => live(fromPos(parseFloat(e.currentTarget.value)))}
        onPointerUp={(e) => done(fromPos(parseFloat(e.currentTarget.value)))}
        onKeyUp={(e) => done(fromPos(parseFloat(e.currentTarget.value)))}
        onDoubleClick={() => done(rest)}
      />
      <span className="sound-num">
        <input className="grade-num" value={text} onChange={(e) => setText(e.target.value)} onBlur={typed} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
        <small>{unit}</small>
      </span>
    </div>
  );
}

/** Clips and sounds: how loud they are, and how they fade in and out. The same settings show on the clip in the timeline. */
export default function SoundSection({ els, scene }: { els: El[]; scene: El | null }) {
  const t = useStore((s) => s.clock.t);
  const ids = els.map((e) => e.id);
  const same = (f: (e: El) => number) => (els.every((e) => Math.abs(f(e) - f(els[0])) < 0.0001) ? f(els[0]) : null);
  const keyed = els.some((e) => (e.keys.volume?.length ?? 0) > 0);
  const longest = scene ? Math.min(...els.map((e) => spanOf(e, scene).end - spanOf(e, scene).start)) : 10;
  const most = Math.max(0.5, Math.min(10, Math.floor(longest * 5) / 10));
  return (
    <div className="sec sound-sec">
      <h4>Sound</h4>
      <Row ids={ids} kind="volume" label="Volume" value={same((e) => volumeAt(e, t))} max={0} unit="dB" hint="How loud it is. 0 dB is the file as it is; drag down to make it quieter." />
      <Row ids={ids} kind="fadeIn" label="Fade in" value={same((e) => e.fadeIn || 0)} max={most} unit="s" hint="Seconds the sound takes to rise at its start." />
      <Row ids={ids} kind="fadeOut" label="Fade out" value={same((e) => e.fadeOut || 0)} max={most} unit="s" hint="Seconds the sound takes to die away at its end." />
      <p className="sound-hint">
        {keyed
          ? "The volume changes over time. The slider sets it at the playhead. Drag the points on the clip's line to change them."
          : "Shape it over time on the clip: click its volume line to add a point, or drag across a stretch to lower that part."}
      </p>
    </div>
  );
}

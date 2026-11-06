import { useEffect, useRef, useState } from "react";
import { currentDoc, dispatch, dragCancel, dragPreview } from "../state/store";
import { spanOf, withKey } from "../document/time";
import { QUIETEST_DB, dbText, dipKeys, fadeAt, fromDb, toDb, volumeAt } from "../document/sound";
import type { El, Key } from "../document/types";

/** Room above and below the line, so it can be grabbed at the top and the bottom. */
const PAD = 5;
const round = (t: number) => Math.round(t * 1000) / 1000;

/**
 * How loud a clip is, drawn over its waves, and changed right there. Once the clip is picked: drag the
 * line up or down for the whole clip, click it to add a point, drag a point, drag sideways across a
 * stretch to lower that part, and drag the dots at the top corners to fade in and out.
 */
export default function VolumeLine({ el, scene, pps, width, height, on }: { el: El; scene: El; pps: number; width: number; height: number; on: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const span = spanOf(el, scene);
  const [picked, setPicked] = useState<number | null>(null);
  const [stretch, setStretch] = useState<{ a: number; b: number } | null>(null);
  const [dip, setDip] = useState<{ a: number; b: number; db: number } | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const keys = el.keys.volume ?? [];

  const room = Math.max(1, height - PAD * 2);
  const yOf = (v: number) => PAD + (1 - (v <= 0 ? 0 : Math.max(0, Math.min(1, (toDb(v) - QUIETEST_DB) / -QUIETEST_DB)))) * room;
  const vOf = (y: number) => {
    const p = 1 - (y - PAD) / room;
    return p <= 0 ? 0 : fromDb(QUIETEST_DB + Math.min(1, p) * -QUIETEST_DB);
  };
  const xOf = (t: number) => (t - span.start) * pps;
  const local = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: Math.max(span.start, Math.min(span.end, span.start + (e.clientX - r.left) / pps)) };
  };

  // a picked point goes with Delete or Backspace too; it is never the only way
  useEffect(() => {
    if (picked === null) return;
    const key = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        e.stopPropagation();
        removePoint(picked);
      }
      if (e.key === "Escape") setPicked(null);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  useEffect(() => {
    if (!on) (setPicked(null), setDip(null), setStretch(null));
  }, [on]);

  const setKeys = (list: Key[], label: string, live: boolean) => {
    const args = { id: el.id, prop: "volume" as const, keys: list.map((k) => ({ t: k.t, v: k.v, ease: k.ease })) };
    if (live) dragPreview("set_keys", args);
    else {
      dragCancel();
      dispatch("set_keys", { ...args, label } as never);
    }
  };
  const removePoint = (t: number) => {
    setPicked(null);
    dispatch("set_keys", { id: el.id, prop: "volume", keys: keys.filter((k) => Math.abs(k.t - t) > 0.004).map((k) => ({ t: k.t, v: k.v, ease: k.ease })) });
  };

  /** Down on the line: a click adds a point, up or down moves the whole line, sideways picks a stretch. */
  const downOnLine = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const start = local(e);
    let mode: "level" | "stretch" | null = null;
    const base = keys.map((k) => ({ ...k }));
    const rest = el.volume;
    setPicked(null);
    setDip(null);
    const move = (ev: PointerEvent) => {
      const p = local(ev);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (!mode && Math.hypot(dx, dy) > 4) mode = Math.abs(dy) >= Math.abs(dx) ? "level" : "stretch";
      if (mode === "level") {
        // the line moves by the same number of decibels everywhere
        const by = toDb(vOf(start.y + dy)) - toDb(vOf(start.y));
        const shift = (v: number) => fromDb(Math.min(0, (v <= 0 ? QUIETEST_DB : toDb(v)) + by));
        if (base.length) setKeys(base.map((k) => ({ ...k, v: shift(k.v) })), "", true);
        else dragPreview("set_props", { ids: [el.id], props: { volume: shift(rest) } });
        setTip(dbText(base.length ? shift(volumeAt({ ...el, keys: { volume: base } }, start.t)) : shift(rest)));
      }
      if (mode === "stretch") setStretch({ a: Math.min(start.t, p.t), b: Math.max(start.t, p.t) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTip(null);
      const p = local(ev);
      if (mode === "level") {
        const by = toDb(vOf(p.y)) - toDb(vOf(start.y));
        const shift = (v: number) => fromDb(Math.min(0, (v <= 0 ? QUIETEST_DB : toDb(v)) + by));
        if (base.length) setKeys(base.map((k) => ({ ...k, v: shift(k.v) })), "Change volume", false);
        else {
          dragCancel();
          dispatch("set_props", { ids: [el.id], props: { volume: shift(rest) }, label: "Change volume" });
        }
      } else if (mode === "stretch") {
        setStretch(null);
        const a = Math.min(start.t, p.t);
        const b = Math.max(start.t, p.t);
        if (b - a > 0.05) setDip({ a, b, db: 0 });
      } else {
        // a click: a new point on the line, where it is now
        const t = round(start.t);
        dispatch("set_keys", { id: el.id, prop: "volume", keys: withKey(keys, { t, v: volumeAt(el, t), ease: "linear" }, true).map((k) => ({ t: k.t, v: k.v, ease: k.ease })), label: "Add a volume point" } as never);
        setPicked(t);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** A point: drag it up, down and along, between its neighbours. A click picks it. */
  const downOnPoint = (e: React.PointerEvent, k: Key) => {
    e.stopPropagation();
    e.preventDefault();
    const start = local(e);
    const i = keys.findIndex((x) => x.t === k.t);
    const lo = i > 0 ? keys[i - 1].t + 0.01 : span.start;
    const hi = i < keys.length - 1 ? keys[i + 1].t - 0.01 : span.end;
    let moved = false;
    const at = (ev: PointerEvent) => {
      const p = local(ev);
      const t = round(Math.max(lo, Math.min(hi, k.t + (p.x - start.x) / pps)));
      const v = vOf(yOf(k.v) + (p.y - start.y));
      return { t, v, list: keys.map((x, j) => (j === i ? { ...x, t, v } : x)) };
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      moved = true;
      const n = at(ev);
      setKeys(n.list, "", true);
      setTip(dbText(n.v));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTip(null);
      if (moved) {
        const n = at(ev);
        setKeys(n.list, "Move a volume point", false);
        setPicked(n.t);
      } else setPicked(k.t);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** A fade dot: drag it along the top, inward to fade longer. */
  const downOnFade = (e: React.PointerEvent, which: "fadeIn" | "fadeOut") => {
    e.stopPropagation();
    e.preventDefault();
    const start = e.clientX;
    const was = el[which] || 0;
    const most = (span.end - span.start) / 2;
    const at = (ev: PointerEvent) => Math.round(Math.max(0, Math.min(most, was + ((ev.clientX - start) / pps) * (which === "fadeIn" ? 1 : -1))) * 10) / 10;
    const move = (ev: PointerEvent) => {
      const s = at(ev);
      dragPreview("set_props", { ids: [el.id], props: { [which]: s } });
      setTip(`${which === "fadeIn" ? "Fade in" : "Fade out"} ${s.toFixed(1)} s`);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTip(null);
      dragCancel();
      const s = at(ev);
      if (s !== was) dispatch("set_props", { ids: [el.id], props: { [which]: s }, label: which === "fadeIn" ? "Fade in" : "Fade out" });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Lowering a stretch: shown live while the slider moves, kept with Done. */
  const tryDip = (db: number) => {
    if (!dip) return;
    setDip({ ...dip, db });
    const real = currentDoc().elements[el.id] ?? el;
    setKeys(dipKeys(real, scene, dip.a, dip.b, db), "", true);
  };
  const keepDip = () => {
    if (!dip) return;
    const real = currentDoc().elements[el.id] ?? el;
    if (dip.db !== 0) setKeys(dipKeys(real, scene, dip.a, dip.b, dip.db), dip.db < 0 ? "Lower part of the sound" : "Raise part of the sound", false);
    else dragCancel();
    setDip(null);
  };

  // the line: how loud the clip is over time with its fades, a point every few pixels
  const pts: string[] = [];
  const stepPx = 3;
  for (let x = 0; x <= width; x += stepPx) {
    const t = span.start + x / pps;
    pts.push(`${x.toFixed(1)},${yOf(volumeAt(el, t) * fadeAt(el, span, t)).toFixed(1)}`);
  }
  pts.push(`${width.toFixed(1)},${yOf(volumeAt(el, span.end) * fadeAt(el, span, span.end - 0.0005)).toFixed(1)}`);
  const line = pts.join(" ");
  const fin = Math.min(width / 2, (el.fadeIn || 0) * pps);
  const fout = Math.min(width / 2, (el.fadeOut || 0) * pps);
  const pickedKey = picked === null ? null : keys.find((k) => Math.abs(k.t - picked) < 0.004);

  return (
    <>
      <svg ref={svg} className={`volume-line${on ? " on" : ""}`} width={width} height={height} data-name="volume-line">
        {stretch && <rect className="volume-stretch" x={xOf(stretch.a)} y={0} width={Math.max(1, xOf(stretch.b) - xOf(stretch.a))} height={height} />}
        {dip && <rect className="volume-stretch" x={xOf(dip.a)} y={0} width={Math.max(1, xOf(dip.b) - xOf(dip.a))} height={height} />}
        <polyline className="volume-path" points={line} />
        {on && (
          <polyline
            className="volume-hit"
            points={line}
            data-name="volume-hit"
            onPointerDown={downOnLine}
            onMouseEnter={() => !tip && setTip("Drag up or down for volume · click to add a point · drag sideways to pick a part")}
            onMouseLeave={() => setTip((t) => (t?.startsWith("Drag up") ? null : t))}
          />
        )}
        {on &&
          keys
            .filter((k) => k.t >= span.start - 0.004 && k.t <= span.end + 0.004)
            .map((k) => (
              <circle
                key={k.t}
                className={`volume-point${pickedKey === k ? " picked" : ""}`}
                data-name="volume-point"
                cx={xOf(k.t)}
                cy={yOf(volumeAt(el, k.t) * fadeAt(el, span, k.t))}
                r={4}
                onPointerDown={(e) => downOnPoint(e, k)}
              >
                <title>{`${dbText(k.v)}. Drag to change, click to pick`}</title>
              </circle>
            ))}
        {on && (
          <>
            <circle className="volume-fade" data-name="fade-in" cx={Math.max(5, fin)} cy={PAD} r={4} onPointerDown={(e) => downOnFade(e, "fadeIn")}>
              <title>Fade in: drag to the right</title>
            </circle>
            <circle className="volume-fade" data-name="fade-out" cx={Math.min(width - 5, width - fout)} cy={PAD} r={4} onPointerDown={(e) => downOnFade(e, "fadeOut")}>
              <title>Fade out: drag to the left</title>
            </circle>
          </>
        )}
      </svg>
      {on && pickedKey && (
        <button
          className="volume-remove"
          data-name="remove-volume-point"
          title="Remove this volume point"
          style={{ left: xOf(pickedKey.t) + 7, top: Math.max(0, yOf(volumeAt(el, pickedKey.t)) - 9) }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            removePoint(pickedKey.t);
          }}
        >
          ×
        </button>
      )}
      {tip && <span className="volume-tip">{tip}</span>}
      {on && dip && (
        <div className="volume-dip" style={{ left: Math.max(0, xOf(dip.a)) }} onPointerDown={(e) => e.stopPropagation()} data-name="volume-dip">
          <span>Lower or raise this part</span>
          <input type="range" min={-40} max={20} step={1} value={dip.db} onChange={(e) => tryDip(parseFloat(e.currentTarget.value))} data-name="volume-dip-amount" />
          <b>{dip.db > 0 ? "+" : ""}{dip.db} dB</b>
          <button className="pill" onClick={keepDip}>
            Done
          </button>
          <button
            className="pill quiet"
            onClick={() => {
              dragCancel();
              setDip(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </>
  );
}

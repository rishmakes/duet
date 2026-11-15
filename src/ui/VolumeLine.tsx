import { useEffect, useRef, useState } from "react";
import { currentDoc, dispatch, dragCancel, dragPreview } from "../state/store";
import { spanOf } from "../document/time";
import { dipKeys, fadeAt, fromLevel, levelText, ratioDb, toLevel, volumeAt } from "../document/sound";
import type { El, Key } from "../document/types";

/** Room below the line, so it can be grabbed at the bottom. */
const PAD = 6;
/** Room above it: the clip's name sits at the top, so full volume runs just under it. */
const TOP = 20;
const round = (t: number) => Math.round(t * 1000) / 1000;
const unit = (x: number) => Math.max(0, Math.min(1, x));

type C = [number, number, number, number];
/** A stretch that runs straight, so the points at its ends are sharp corners. */
const LINE: C = [1 / 3, 1 / 3, 2 / 3, 2 / 3];
/** A stretch that leaves and arrives level, so the points at its ends are smooth. New points are smooth. */
const SMOOTH: C = [1 / 3, 0, 2 / 3, 1];
/**
 * A volume point as the line works with it. Its handles live on the stretch arriving here: `curve` [0] and [2] say
 * how far along in time the handle of the point before and its own handle sit, `lift` how far above their points.
 */
type P = { t: number; v: number; curve: C; lift: [number, number] };
const curveOf = (k: Key): C => (k.curve ? ([...k.curve] as C) : k.ease === "linear" ? [...LINE] : [...SMOOTH]);
/** The points with every handle placed, so older points (shaped by an ease or a curve) keep the shape they had. */
const plain = (keys: Key[]): P[] =>
  keys.map((k, i) => {
    const c = curveOf(k);
    const d = i > 0 ? toLevel(k.v) - toLevel(keys[i - 1].v) : 0;
    return { t: k.t, v: k.v, curve: c, lift: k.lift ? [...k.lift] : [c[1] * d, (c[3] - 1) * d] };
  });
const near = (a: number, b: number) => Math.abs(a - b) < 0.004;
const sorted = (list: P[]) => [...list].sort((a, b) => a.t - b.t);

/**
 * How loud a clip is, drawn over its waves from silent at the bottom to the file as it is at the top,
 * and changed right there. Once the clip is picked: drag the line up or down, click it to add a point,
 * drag a point, Shift-click to pick several, pull a picked point's
 * handles to shape the curve on that side, drag sideways across a stretch to lower that part, and drag the
 * dots at the two ends up or down for the level there, or inward for how long it takes to get going.
 */
export default function VolumeLine({ el, scene, pps, width, height, on }: { el: El; scene: El; pps: number; width: number; height: number; on: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const span = spanOf(el, scene);
  const [picked, setPicked] = useState<number[]>([]);
  const [stretch, setStretch] = useState<{ a: number; b: number } | null>(null);
  const [dip, setDip] = useState<{ a: number; b: number; pct: number } | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const keys = el.keys.volume ?? [];

  const top = height >= 44 ? TOP : PAD;
  const room = Math.max(1, height - top - PAD);
  /** Up and down is loudness as it is heard: halfway up sounds half as loud. */
  const yL = (p: number) => top + (1 - p) * room;
  const yOf = (v: number) => yL(toLevel(v));
  const xOf = (t: number) => (t - span.start) * pps;
  const local = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: Math.max(span.start, Math.min(span.end, span.start + (e.clientX - r.left) / pps)) };
  };
  const isEdge = (t: number) => near(t, span.start) || near(t, span.end);
  /** The volume a list of points gives at a moment, before fades. */
  const valAt = (list: P[], t: number) => volumeAt({ ...el, keys: { ...el.keys, volume: list.map((k) => ({ ...k, ease: "in-out" as const })) } }, t);
  const isPicked = (t: number) => picked.some((p) => near(p, t));

  // picked points go with Delete or Backspace too; the × is never the only way
  useEffect(() => {
    if (!picked.length) return;
    const key = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        e.stopPropagation();
        removePoints(picked);
      }
      if (e.key === "Escape") setPicked([]);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  useEffect(() => {
    if (!on) (setPicked([]), setDip(null), setStretch(null));
  }, [on]);

  const save = (list: P[], label: string, live: boolean, extra: { volume?: number; fadeIn?: number; fadeOut?: number } = {}) => {
    const args = { id: el.id, keys: sorted(list).map((k) => ({ t: k.t, v: k.v, curve: k.curve, lift: k.lift })), ...extra };
    if (live) dragPreview("set_volume_line", args as never);
    else {
      dragCancel();
      dispatch("set_volume_line", { ...args, label } as never);
    }
  };
  const removePoints = (ts: number[]) => {
    setPicked([]);
    save(
      plain(keys).filter((k) => !ts.some((t) => near(t, k.t))),
      ts.length > 1 ? "Remove volume points" : "Remove a volume point",
      false,
    );
  };

  /** Down on the line: a click adds a point, up or down moves the whole line, sideways picks a stretch. */
  const downOnLine = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const start = local(e);
    let mode: "level" | "stretch" | null = null;
    const base = plain(keys);
    const rest = el.volume;
    setPicked([]);
    setDip(null);
    // the whole line moves up or down by the same share of loudness
    const shifted = (y: number) => {
      const by = (start.y - y) / room;
      const shift = (v: number) => fromLevel(unit(toLevel(v) + by));
      return { list: base.map((k) => ({ ...k, v: shift(k.v) })), volume: shift(rest), here: shift(base.length ? valAt(base, start.t) : rest) };
    };
    const move = (ev: PointerEvent) => {
      const p = local(ev);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (!mode && Math.hypot(dx, dy) > 4) mode = Math.abs(dy) >= Math.abs(dx) ? "level" : "stretch";
      if (mode === "level") {
        const s = shifted(p.y);
        if (base.length) save(s.list, "", true);
        else dragPreview("set_props", { ids: [el.id], props: { volume: s.volume } });
        setTip(levelText(s.here));
      }
      if (mode === "stretch") setStretch({ a: Math.min(start.t, p.t), b: Math.max(start.t, p.t) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTip(null);
      const p = local(ev);
      if (mode === "level") {
        const s = shifted(p.y);
        if (base.length) save(s.list, "Change volume", false);
        else {
          dragCancel();
          dispatch("set_props", { ids: [el.id], props: { volume: s.volume }, label: "Change volume" });
        }
      } else if (mode === "stretch") {
        setStretch(null);
        const a = Math.min(start.t, p.t);
        const b = Math.max(start.t, p.t);
        if (b - a > 0.05) setDip({ a, b, pct: 100 });
      } else {
        // a click: a new smooth point on the line, where it is now
        const t = round(start.t);
        let list = base.filter((k) => !near(k.t, t)).concat({ t, v: valAt(base, t), curve: [...SMOOTH], lift: [0, 0] });
        // the line holds still past its last point, so the clip's ends get a point too: moving this one then bends only its own part
        for (const edge of [round(span.start), round(span.end)]) if (!list.some((k) => near(k.t, edge))) list = list.concat({ t: edge, v: valAt(base, edge), curve: [...SMOOTH], lift: [0, 0] });
        save(list, "Add a volume point", false);
        setPicked([t]);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** A point: drag it, with every picked point, up, down and along between its neighbours. A click picks it, Shift-click adds it. */
  const downOnPoint = (e: React.PointerEvent, k: Key) => {
    e.stopPropagation();
    e.preventDefault();
    const shift = e.shiftKey;
    const startX = e.clientX;
    const startY = e.clientY;
    const base = plain(keys);
    const sel = isPicked(k.t) && !shift ? picked : [k.t];
    const idx = base.flatMap((x, i) => (sel.some((t) => near(t, x.t)) ? [i] : []));
    const inSel = (i: number) => idx.includes(i);
    let lo = -Infinity;
    let hi = Infinity;
    for (const i of idx) {
      if (!inSel(i - 1)) lo = Math.max(lo, (i > 0 ? base[i - 1].t + 0.01 : span.start) - base[i].t);
      if (!inSel(i + 1)) hi = Math.min(hi, (i < base.length - 1 ? base[i + 1].t - 0.01 : span.end) - base[i].t);
    }
    // the points at the clip's two ends stay at the ends
    if (idx.some((i) => isEdge(base[i].t))) lo = hi = 0;
    let moved = false;
    const at = (ev: PointerEvent) => {
      const dt = Math.max(lo, Math.min(hi, (ev.clientX - startX) / pps));
      const dp = -(ev.clientY - startY) / room;
      const list = base.map((x, i) => (inSel(i) ? { ...x, t: round(x.t + dt), v: fromLevel(unit(toLevel(x.v) + dp)) } : x));
      const me = list[base.findIndex((x) => near(x.t, k.t))];
      return { list, me, ts: idx.map((i) => list[i].t) };
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
      moved = true;
      const n = at(ev);
      save(n.list, "", true);
      setTip(levelText(n.me.v));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTip(null);
      if (moved) {
        const n = at(ev);
        save(n.list, idx.length > 1 ? "Move volume points" : "Move a volume point", false);
        setPicked(n.ts);
      } else if (shift) setPicked(isPicked(k.t) ? picked.filter((t) => !near(t, k.t)) : [...picked, k.t]);
      else setPicked([k.t]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /**
   * A dot at one end of the clip: up or down sets the level there, inward sets how long it takes to
   * reach the next level. An old fade on that end turns into points first, so nothing sounds different.
   */
  const downOnEnd = (e: React.PointerEvent, which: "start" | "end") => {
    e.stopPropagation();
    e.preventDefault();
    const edge = round(which === "start" ? span.start : span.end);
    const other = round(which === "start" ? span.end : span.start);
    const dir = which === "start" ? 1 : -1;
    const fadeKey = which === "start" ? "fadeIn" : "fadeOut";
    const fade = Math.min(el[fadeKey] || 0, (span.end - span.start) / 2);
    let base = plain(keys);
    if (fade > 0) {
      const inner = round(edge + dir * fade);
      const level = valAt(base, inner);
      base = base.filter((k) => (dir > 0 ? k.t > inner + 0.004 || k.t < edge - 0.004 : k.t < inner - 0.004 || k.t > edge + 0.004));
      base.push({ t: edge, v: 0, curve: [...SMOOTH], lift: [0, 0] }, { t: inner, v: level, curve: [...SMOOTH], lift: [0, 0] });
    }
    for (const t of [edge, other]) if (!base.some((k) => near(k.t, t))) base.push({ t, v: valAt(base, t), curve: [...SMOOTH], lift: [0, 0] });
    base = sorted(base);
    const ei = which === "start" ? 0 : base.length - 1;
    const ni = ei + dir;
    // the next point inward, unless that is the other end: then dragging inward makes one
    const hasInner = ni > 0 && ni < base.length - 1;
    const p0 = toLevel(base[ei].v);
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const at = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const p = unit(p0 - (ev.clientY - startY) / room);
      const list = base.map((k) => ({ ...k, curve: [...k.curve] as C, lift: [...k.lift] as [number, number] }));
      list[ei] = { ...list[ei], v: fromLevel(p) };
      let len: number | null = null;
      if (Math.abs(dx) > 4) {
        if (hasInner) {
          const lo = dir > 0 ? edge + 0.05 : base[ni - 1].t + 0.01;
          const hi = dir > 0 ? base[ni + 1].t - 0.01 : edge - 0.05;
          list[ni] = { ...list[ni], t: round(Math.max(lo, Math.min(hi, base[ni].t + dx / pps))) };
          len = Math.abs(list[ni].t - edge);
        } else if (dx * dir > 0) {
          const far = base[ni].t - dir * 0.05;
          const t = round(dir > 0 ? Math.min(far, edge + dx / pps) : Math.max(far, edge + dx / pps));
          if ((t - edge) * dir > 0.02) {
            list.push({ t, v: valAt(base, t), curve: [...SMOOTH], lift: [0, 0] });
            len = Math.abs(t - edge);
          }
        }
      }
      return { list, p, len };
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
      moved = true;
      const n = at(ev);
      save(n.list, "", true, fade > 0 ? { [fadeKey]: 0 } : {});
      setTip(`${levelText(fromLevel(n.p))}${n.len !== null ? `, ${n.len.toFixed(1)} s` : ""}`);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTip(null);
      if (moved) {
        save(at(ev).list, which === "start" ? "Shape how the sound starts" : "Shape how the sound ends", false, fade > 0 ? { [fadeKey]: 0 } : {});
        setPicked([edge]);
      } else if (keys.some((k) => near(k.t, edge))) setPicked(e.shiftKey ? [...picked, edge] : [edge]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** The two handles of a picked point, like the pen tool: where each sits, in the stretch it shapes. */
  const handleAt = (list: P[], i: number, side: "in" | "out") => {
    const ai = side === "in" ? i - 1 : i;
    const bi = ai + 1;
    if (ai < 0 || bi >= list.length) return null;
    const a = list[ai];
    const b = list[bi];
    const cx = side === "in" ? b.curve[2] : b.curve[0];
    const lvl = side === "in" ? toLevel(b.v) + b.lift[1] : toLevel(a.v) + b.lift[0];
    return { x: xOf(a.t) + cx * (xOf(b.t) - xOf(a.t)), y: yL(lvl) };
  };
  /** Pull a handle: the curve on that side follows, and the point becomes a corner. A new point is smooth again. */
  const downOnHandle = (e: React.PointerEvent, i: number, side: "in" | "out") => {
    e.stopPropagation();
    e.preventDefault();
    const base = plain(keys);
    /** Puts one handle of point i at a spot on screen, in the numbers of the stretch it shapes. */
    const place = (list: P[], s: "in" | "out", x: number, y: number) => {
      const ai = s === "in" ? i - 1 : i;
      const a = list[ai];
      const b = list[ai + 1];
      const c = [...b.curve] as C;
      const lift = [...b.lift] as [number, number];
      const nx = unit((x - xOf(a.t)) / Math.max(1, xOf(b.t) - xOf(a.t)));
      const lvl = Math.max(-0.5, Math.min(1.5, 1 - (y - top) / room));
      if (s === "in") (c[2] = nx), (lift[1] = lvl - toLevel(b.v));
      else (c[0] = nx), (lift[0] = lvl - toLevel(a.v));
      list[ai + 1] = { ...b, curve: c, lift };
    };
    const at = (ev: PointerEvent) => {
      const p = local(ev);
      const list = base.map((k) => ({ ...k, curve: [...k.curve] as C, lift: [...k.lift] as [number, number] }));
      place(list, side, p.x, p.y);
      return list;
    };
    const move = (ev: PointerEvent) => save(at(ev), "", true);
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      save(at(ev), "Shape the volume curve", false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Lowering or raising a stretch: shown live while the slider moves, kept with Done. */
  const tryDip = (pct: number) => {
    if (!dip) return;
    setDip({ ...dip, pct });
    const real = currentDoc().elements[el.id] ?? el;
    save(plain(dipKeys(real, scene, dip.a, dip.b, ratioDb(pct / 100))), "", true);
  };
  const keepDip = () => {
    if (!dip) return;
    const real = currentDoc().elements[el.id] ?? el;
    if (dip.pct !== 100) save(plain(dipKeys(real, scene, dip.a, dip.b, ratioDb(dip.pct / 100))), dip.pct < 100 ? "Lower part of the sound" : "Raise part of the sound", false);
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
  const shown = keys.filter((k) => k.t >= span.start - 0.004 && k.t <= span.end + 0.004);
  const dotX = (t: number) => Math.max(5, Math.min(width - 5, xOf(t)));
  const dotY = (t: number) => yOf(volumeAt(el, t) * fadeAt(el, span, Math.max(span.start, Math.min(span.end - 0.0005, t))));
  const hasStart = shown.some((k) => near(k.t, span.start));
  const hasEnd = shown.some((k) => near(k.t, span.end));
  const all = plain(keys);
  const one = picked.length === 1 ? all.findIndex((k) => near(k.t, picked[0])) : -1;
  const handles = one >= 0 ? (["in", "out"] as const).flatMap((s) => {
    const h = handleAt(all, one, s);
    return h ? [{ s, ...h }] : [];
  }) : [];
  const first = picked.length ? Math.min(...picked) : null;

  return (
    <>
      <svg ref={svg} className={`volume-line${on ? " on" : ""}`} width={width} height={height} data-name="volume-line">
        {stretch && <rect className="volume-stretch" x={xOf(stretch.a)} y={0} width={Math.max(1, xOf(stretch.b) - xOf(stretch.a))} height={height} />}
        {dip && <rect className="volume-stretch" x={xOf(dip.a)} y={0} width={Math.max(1, xOf(dip.b) - xOf(dip.a))} height={height} />}
        <polyline className="volume-path" points={line} />
        {on && (
          <polyline className="volume-hit" points={line} data-name="volume-hit" onPointerDown={downOnLine}>
            <title>Volume. Drag up or down, click to add a point, drag sideways to pick a part</title>
          </polyline>
        )}
        {on &&
          handles.map((h) => (
            <g key={h.s}>
              <line className="volume-handle-arm" x1={xOf(all[one].t)} y1={yOf(all[one].v)} x2={h.x} y2={h.y} />
              <rect className="volume-handle" data-name={`volume-handle-${h.s}`} x={h.x - 3} y={h.y - 3} width={6} height={6} transform={`rotate(45 ${h.x} ${h.y})`} onPointerDown={(e) => downOnHandle(e, one, h.s)}>
                <title>Pull to shape the curve on this side</title>
              </rect>
            </g>
          ))}
        {on &&
          shown.map((k) => {
            const end = near(k.t, span.start) ? "start" : near(k.t, span.end) ? "end" : null;
            return (
              <circle
                key={k.t}
                className={`volume-point${isPicked(k.t) ? " picked" : ""}`}
                data-name={end ? `volume-${end}` : "volume-point"}
                cx={dotX(k.t)}
                cy={dotY(k.t)}
                r={5.5}
                onPointerDown={(e) => (end ? downOnEnd(e, end) : downOnPoint(e, k))}
              >
                <title>{`${levelText(k.v)}. ${end ? `Drag up or down for the level at the ${end}, ${end === "start" ? "right" : "left"} for how long it takes to change` : "Drag to change, Shift-click to pick more"}`}</title>
              </circle>
            );
          })}
        {on && !hasStart && (
          <circle className="volume-point" data-name="volume-start" cx={5} cy={dotY(span.start)} r={5.5} onPointerDown={(e) => downOnEnd(e, "start")}>
            <title>Start. Drag up or down for the level here, right for how long it takes to rise</title>
          </circle>
        )}
        {on && !hasEnd && (
          <circle className="volume-point" data-name="volume-end" cx={width - 5} cy={dotY(span.end)} r={5.5} onPointerDown={(e) => downOnEnd(e, "end")}>
            <title>End. Drag up or down for the level here, left for how long it takes to die away</title>
          </circle>
        )}
      </svg>
      {on && first !== null && (
        <button
          className="volume-remove"
          data-name="remove-volume-point"
          title={picked.length > 1 ? "Remove these volume points" : "Remove this volume point"}
          style={{ left: dotX(first) - 7, top: Math.max(0, dotY(first) - 24) }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            removePoints(picked);
          }}
        >
          ×
        </button>
      )}
      {tip && <span className="volume-tip">{tip}</span>}
      {on && dip && (
        <div className="volume-dip" style={{ left: Math.max(0, xOf(dip.a)) }} onPointerDown={(e) => e.stopPropagation()} data-name="volume-dip">
          <span>Lower or raise this part</span>
          <input type="range" min={0} max={200} step={5} value={dip.pct} onChange={(e) => tryDip(parseFloat(e.currentTarget.value))} data-name="volume-dip-amount" />
          <b>{dip.pct}%</b>
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

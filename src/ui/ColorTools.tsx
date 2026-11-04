import { useEffect, useRef, useState } from "react";
import { currentDoc, dispatch, dragCancel, dragPreview } from "../state/store";
import { colourAt, curveTable, noCurves, withColour } from "../document/grade";
import type { CurveKey, CurvePoint, Grade } from "../document/grade";
import { setShowSkin, showingSkin } from "../canvas/grade";
import { onPickedColour, pickColour, pickingColour } from "./colourPick";

/** The curves the picked pictures have now, as kept, not as the drag shows them. */
const keptCurves = (ids: string[]) => {
  const el = currentDoc().elements[ids[0]];
  return { ...noCurves(), ...(el?.grade?.curves ?? {}) };
};

/** Change one curve: shown while dragging, kept when let go, and only when it really changed. */
function curveChange(ids: string[], key: CurveKey, label: string) {
  return {
    live: (pts: CurvePoint[]) => dragPreview("set_grade", { ids, grade: { curves: { [key]: pts } } }),
    done: (pts: CurvePoint[]) => {
      dragCancel();
      if (JSON.stringify(keptCurves(ids)[key]) !== JSON.stringify(pts)) dispatch("set_grade", { ids, grade: { curves: { [key]: pts } }, label });
    },
  };
}

/** A slider that is not one of the grade's own numbers: one colour's change, say. */
function Line({ label, value, min, max, onLive, onDone, tint }: { label: string; value: number; min: number; max: number; onLive: (n: number) => void; onDone: (n: number) => void; tint?: string }) {
  const [text, setText] = useState(String(Math.round(value)));
  useEffect(() => setText(String(Math.round(value))), [value]);
  const typed = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n)) onDone(Math.min(max, Math.max(min, n)));
    else setText(String(Math.round(value)));
  };
  return (
    <div className={`grade-row${value !== 0 ? " moved" : ""}`}>
      <span className="grade-name" title="Double click to put it back" onDoubleClick={() => onDone(0)}>
        {label}
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={value}
        style={tint ? { background: tint } : undefined}
        onInput={(e) => onLive(parseFloat(e.currentTarget.value))}
        onChange={(e) => onLive(parseFloat(e.currentTarget.value))}
        onPointerUp={(e) => onDone(parseFloat(e.currentTarget.value))}
        onKeyUp={(e) => onDone(parseFloat(e.currentTarget.value))}
        onDoubleClick={() => onDone(0)}
      />
      <input className="grade-num" value={text} onChange={(e) => setText(e.target.value)} onBlur={typed} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
    </div>
  );
}

const TONE: { key: CurveKey; label: string; ink: string }[] = [
  { key: "light", label: "Light", ink: "var(--text)" },
  { key: "red", label: "Red", ink: "#e5604f" },
  { key: "green", label: "Green", ink: "#5fbf6a" },
  { key: "blue", label: "Blue", ink: "#5b8fe8" },
];
const W = 280;
const H = 150;
const STRAIGHT: CurvePoint[] = [
  [0, 0],
  [1, 1],
];

/**
 * Curves: drag a point to bend the light, click the line to add a point, double click a point to take it
 * away. Light moves every colour at once; red, green and blue move only their own.
 */
export function CurvesBox({ ids, grade }: { ids: string[]; grade: Grade }) {
  const [tab, setTab] = useState<CurveKey>("light");
  const [drag, setDrag] = useState<{ pts: CurvePoint[]; i: number } | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const curves = { ...noCurves(), ...(grade.curves ?? {}) };
  const saved = curves[tab].length ? curves[tab] : STRAIGHT;
  const pts = drag?.pts ?? saved;
  const ink = TONE.find((t) => t.key === tab)!.ink;
  const change = curveChange(ids, tab, `Change the ${TONE.find((t) => t.key === tab)!.label.toLowerCase()} curve`);
  const table = curveTable(pts, false);
  const line = Array.from(table, (v, i) => `${i ? "L" : "M"}${((i / (table.length - 1)) * W).toFixed(1)} ${((1 - v) * H).toFixed(1)}`).join(" ");
  const toPoint = (e: { clientX: number; clientY: number }): CurvePoint => {
    const r = box.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };
  // a point is kept between its neighbours, so the curve never folds back on itself
  const moveTo = (list: CurvePoint[], i: number, [x, y]: CurvePoint): CurvePoint[] => {
    const lo = i > 0 ? list[i - 1][0] + 0.01 : 0;
    const hi = i < list.length - 1 ? list[i + 1][0] - 0.01 : 1;
    const edge = i === 0 || i === list.length - 1;
    return list.map((p, j) => (j === i ? [edge ? p[0] : Math.min(hi, Math.max(lo, x)), y] : p)) as CurvePoint[];
  };
  const grab = (e: React.PointerEvent, i: number, list: CurvePoint[]) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ pts: list, i });
  };
  const down = (e: React.PointerEvent) => {
    // a click on the line adds a point there and starts dragging it
    const p = toPoint(e);
    const list = [...pts, p].sort((a, b) => a[0] - b[0]) as CurvePoint[];
    grab(e, list.indexOf(p), list);
    change.live(list);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const next = moveTo(drag.pts, drag.i, toPoint(e));
    setDrag({ pts: next, i: drag.i });
    change.live(next);
  };
  const up = () => {
    if (!drag) return;
    const straight = drag.pts.length === 2 && drag.pts[0][1] === 0 && drag.pts[1][1] === 1;
    change.done(straight ? [] : drag.pts);
    setDrag(null);
  };
  const remove = (i: number) => {
    if (i === 0 || i === pts.length - 1) return;
    const next = pts.filter((_, j) => j !== i);
    change.done(next.length === 2 && next[0][1] === 0 && next[1][1] === 1 ? [] : next);
  };
  return (
    <div className="sec">
      <h4>Curves</h4>
      <svg ref={box} className="curve-box" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f} className="curve-grid">
            <line x1={f * W} y1={0} x2={f * W} y2={H} />
            <line x1={0} y1={f * H} x2={W} y2={f * H} />
          </g>
        ))}
        <line className="curve-straight" x1={0} y1={H} x2={W} y2={0} />
        <path d={line} fill="none" style={{ stroke: ink }} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        {pts.map(([x, y], i) => (
          <circle
            key={i}
            className="curve-point"
            cx={x * W}
            cy={(1 - y) * H}
            r={4}
            style={{ stroke: ink }}
            onPointerDown={(e) => grab(e, i, pts)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              remove(i);
            }}
          />
        ))}
      </svg>
      <div className="curve-tabs">
        {TONE.map((t) => (
          <button key={t.key} className={`curve-tab${tab === t.key ? " on" : ""}${curves[t.key].length ? " moved" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
        <button className="curve-tab reset" disabled={!curves[tab].length} onClick={() => change.done([])} title="Put this curve back to a straight line">
          Straight
        </button>
      </div>
    </div>
  );
}

/** The colours to pick from, round the wheel: red, orange, yellow, green, cyan, blue, purple, pink. */
const SWATCHES = [0, 0.07, 0.14, 0.3, 0.47, 0.6, 0.75, 0.88];
const swatch = (h: number) => `hsl(${Math.round(h * 360)} 75% 55%)`;

/** One colour: pick a colour, from the row or from the picture, then turn it, make it richer or duller, lighter or darker. */
export function OneColour({ ids, grade }: { ids: string[]; grade: Grade }) {
  const [hue, setHue] = useState<number | null>(null);
  const [picking, setPicking] = useState(pickingColour());
  useEffect(
    () =>
      onPickedColour((h) => {
        setPicking(false);
        if (h !== null) setHue(h);
      }),
    [],
  );
  // leaving the panel stops the picking
  useEffect(() => () => pickColour(false), []);
  const curves = { ...noCurves(), ...(grade.curves ?? {}) };
  const moved = (h: number) => (["hueHue", "hueSat", "hueLight"] as const).some((k) => colourAt(curves[k], h) !== 0.5);
  // colours already changed, so they can be found again
  const changed = [...new Set(curves.hueHue.concat(curves.hueSat, curves.hueLight).filter((p) => p[1] !== 0.5).map((p) => p[0]))];
  const row = [...new Set([...SWATCHES, ...changed])].sort((a, b) => a - b);
  const part = (key: "hueHue" | "hueSat" | "hueLight", label: string) => {
    if (hue === null) return null;
    const v = Math.round((colourAt(curves[key], hue) - 0.5) * 200);
    const change = curveChange(ids, key, `Change ${label.toLowerCase()} of one colour`);
    const pts = (n: number) => withColour(keptCurves(ids)[key], hue, 0.5 + n / 200);
    const tint =
      key === "hueHue"
        ? `linear-gradient(90deg, ${swatch(hue - 1 / 6)}, ${swatch(hue)} 50%, ${swatch(hue + 1 / 6)})`
        : key === "hueSat"
          ? `linear-gradient(90deg, #8a8a90, ${swatch(hue)})`
          : `linear-gradient(90deg, #111, ${swatch(hue)} 50%, #eee)`;
    return <Line label={label} value={v} min={-100} max={100} tint={tint} onLive={(n) => change.live(pts(n))} onDone={(n) => change.done(pts(n))} />;
  };
  return (
    <div className="sec">
      <h4>One colour</h4>
      <div className="one-colours">
        {row.map((h) => (
          <button key={h} className={`one-colour${hue !== null && Math.abs(hue - h) < 0.001 ? " on" : ""}${moved(h) ? " moved" : ""}`} style={{ background: swatch(h) }} title={moved(h) ? "Changed. Click to change it again" : "Change this colour"} onClick={() => setHue(h)} />
        ))}
      </div>
      <button className={`mini wide${picking ? " primary" : ""}`} onClick={() => {
          pickColour(!picking);
          setPicking(!picking);
        }}>
        {picking ? "Click a colour in the picture" : "Pick it from the picture"}
      </button>
      {part("hueHue", "Hue")}
      {part("hueSat", "Richness")}
      {part("hueLight", "Brightness")}
    </div>
  );
}

/** Skin: found by its colour, so no masks to draw. Keep it natural while the rest changes, or move only the skin. */
export function SkinBox({ grade, Slider }: { grade: Grade; Slider: (p: { k: "skinKeep" | "skinTone" | "skinLight" }) => React.ReactElement }) {
  const [show, setShow] = useState(showingSkin());
  useEffect(() => () => setShowSkin(false), []);
  const used = (grade.skinKeep ?? 0) || (grade.skinTone ?? 0) || (grade.skinLight ?? 0);
  return (
    <div className="sec">
      <h4>Skin</h4>
      <Slider k="skinKeep" />
      <Slider k="skinTone" />
      <Slider k="skinLight" />
      <button
        className={`mini wide${show ? " primary" : ""}`}
        onClick={() => {
          setShowSkin(!show);
          setShow(!show);
        }}
        title="Mark in pink what Duet takes for skin, in the After picture"
      >
        {show ? "Hide the skin marks" : used ? "Show what counts as skin" : "Show the skin Duet finds"}
      </button>
    </div>
  );
}

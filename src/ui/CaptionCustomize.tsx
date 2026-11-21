import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { dispatch, dragCancel, dragPreview, getState, useStore, workDoc } from "../state/store";
import { SPOKEN_COLOURS, captionsIn } from "../document/captions";
import type { El, Plate, Shadow } from "../document/types";
import FontPicker from "./FontPicker";
import { ColorField } from "./ColorPicker";
import CommentsList from "./CommentsList";

/**
 * Customize (#404): the right panel while captions are the work, either with the Caption styles tab open
 * or with a caption picked. Every change here reaches every caption in the video, so a video has one
 * caption style. Font, spoken word, size and colour are always out; the rest waits behind closed rows.
 */

const COLOURS = ["#ffffff", "#111013", "#e5383b", "#ffe14d", "#e6ff3d", "#2f7bff"];

type Props = Partial<Omit<El, "id" | "type" | "parentId" | "childIds">>;

/**
 * Runs `fn` at most once per screen frame, with the newest value. A slider sends more changes than the
 * screen can draw; each one redraws every caption, so without this they pile up and the captions trail
 * behind the hand (#404). `cancel` drops a change still waiting, so none lands after letting go.
 */
export function oncePerFrame<T>(fn: (v: T) => void, frame: (cb: () => void) => number = requestAnimationFrame, unframe: (id: number) => void = cancelAnimationFrame) {
  let waiting = 0;
  let latest: T;
  return {
    run(v: T) {
      latest = v;
      if (!waiting)
        waiting = frame(() => {
          waiting = 0;
          fn(latest);
        });
    },
    cancel() {
      if (waiting) unframe(waiting);
      waiting = 0;
    },
  };
}

/** A value picked on a slider, or typed exactly in the box beside it. */
function Slide({ label, value, min, max, step = 1, onPreview, onCommit, name }: { label: string; value: number; min: number; max: number; step?: number; onPreview: (n: number) => void; onCommit: (n: number) => void; name: string }) {
  const [typed, setTyped] = useState(String(value));
  useEffect(() => setTyped(String(value)), [value]);
  const [moving, setMoving] = useState<number | null>(null);
  const shown = moving ?? value;
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const [frame] = useState(() => oncePerFrame<number>((n) => previewRef.current(n)));
  useEffect(() => frame.cancel, [frame]);
  const commit = (n: number) => {
    frame.cancel();
    setMoving(null);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else dragCancel();
  };
  return (
    <div className="cz-row">
      <div className="cz-label">{label}</div>
      <div className="cz-slide">
        <input
          type="range"
          data-name={`${name}-slider`}
          min={min}
          max={Math.max(max, value)}
          step={step}
          value={shown}
          onChange={(e) => {
            const n = Number(e.target.value);
            setMoving(n);
            frame.run(n);
          }}
          onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        />
        <input
          className="cz-num"
          data-name={name}
          value={moving ?? typed}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={() => commit(Number(typed))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setTyped(String(value));
          }}
        />
      </div>
    </div>
  );
}

/** One choice out of a few, side by side. */
function Pick<T extends string>({ value, options, onPick, name }: { value: T; options: [T, string][]; onPick: (v: T) => void; name: string }) {
  return (
    <div className="cz-pick" role="group">
      {options.map(([v, label]) => (
        <button key={v} type="button" data-name={`${name}-${v}`} className={value === v ? "on" : ""} aria-pressed={value === v} onClick={() => value !== v && onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** A row of colour dots; any other colour is typed or picked in the field after them. */
function Dots({ value, colours, onPick, none, name }: { value: string | null | undefined; colours: string[]; onPick: (c: string | null) => void; none?: boolean; name: string }) {
  const now = (value ?? "").toLowerCase();
  return (
    <div className="cz-dots">
      {none && <button type="button" className={`cz-dot none${!now ? " on" : ""}`} data-name={`${name}-none`} title="None" onClick={() => onPick(null)} />}
      {colours.map((c) => (
        <button key={c} type="button" className={`cz-dot${now === c ? " on" : ""}`} data-name={`${name}-${c.slice(1)}`} style={{ background: c }} title={c} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

/** A closed row that opens what it holds. */
function Fold({ title, name, children }: { title: string; name: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`cz-fold${open ? " open" : ""}`}>
      <button type="button" className="cz-fold-head" data-name={`customize-${name}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 2l3 3-3 3" />
        </svg>
      </button>
      {open && <div className="cz-fold-body">{children}</div>}
    </div>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

export default function CaptionCustomize({ top }: { top: ReactNode }) {
  // follow every change, so the values shown are the captions' own
  useStore((s) => s.timeline[s.cursor]);
  useStore((s) => s.transientDoc);
  const sceneId = useStore((s) => s.clock.scene);
  const doc = workDoc();
  const ids = captionsIn(doc, sceneId);
  const first = doc.elements[ids[0]];
  const frame = sceneId ? doc.elements[sceneId] : null;

  if (!first || !frame) {
    return (
      <aside className="right customize" data-name="customize">
        {top}
        <div className="cz-head">
          <div className="cz-title">Customize</div>
          <div className="cz-sub">This video has no captions yet.</div>
        </div>
        <div className="cz-body">
          <button className="pill" data-name="make-captions" onClick={() => window.dispatchEvent(new Event("duet:auto-captions"))}>
            Make captions
          </button>
          <div className="hint2">Duet listens to what is said and writes it on the video. Then pick a style on the left and change it here.</div>
        </div>
      </aside>
    );
  }

  const all = () => captionsIn(workDoc(), getState().clock.scene);
  const set = (props: Props, label: string) => dispatch("set_props", { ids: all(), props, label });
  const preview = (props: Props) => dragPreview("set_props", { ids: all(), props });
  const k = Math.min(frame.width, frame.height) / 1080;
  const px = (n: number) => Math.max(1, Math.round(n * k));
  const lights = !!first.spoken?.length;
  const plate = first.plate;
  const setPlate = (p: Partial<Plate>, label: string) => plate && set({ plate: { ...plate, ...p } }, label);
  const shadow = first.shadow;
  const glow = !!shadow && !shadow.x && !shadow.y;
  const setShadow = (p: Partial<Shadow>, label: string) => shadow && set({ shadow: { ...shadow, ...p } }, label);
  // how high the captions sit, as a share of the video's height, measured at their middle
  const middle = Math.round(((first.y + first.height / 2) / frame.height) * 100);
  const moveTo = (pc: number) => {
    const ids = all();
    const el = workDoc().elements[ids[0]];
    if (el) dispatch("move_elements", { ids, dx: 0, dy: Math.round((pc / 100) * frame.height - (el.y + el.height / 2)) });
  };

  return (
    <aside className="right customize" data-name="customize">
      {top}
      <div className="cz-head">
        <div className="cz-title">Customize</div>
        <div className="cz-sub">Every caption in this video</div>
      </div>
      <div className="cz-body">
        <div className="cz-row">
          <div className="cz-label">Font</div>
          <FontPicker value={first.fontFamily} onCommit={(v) => set({ fontFamily: v }, "Change caption font")} />
        </div>

        {lights && (
          <div className="cz-row">
            <div className="cz-label">Spoken word</div>
            <Dots value={first.spokenFill} colours={SPOKEN_COLOURS} none name="spoken" onPick={(c) => set({ spokenFill: c ?? "" }, c ? "Light the spoken word" : "Stop lighting the spoken word")} />
          </div>
        )}

        <Slide label="Size" name="caption-size" value={first.fontSize} min={px(20)} max={px(200)} onPreview={(n) => preview({ fontSize: n })} onCommit={(n) => set({ fontSize: Math.max(1, n) }, "Change caption size")} />

        <div className="cz-row">
          <div className="cz-label">Colour</div>
          <div className="cz-colour">
            <Dots value={first.fill} colours={COLOURS} name="colour" onPick={(c) => c && set({ fill: c }, "Change caption colour")} />
            <ColorField value={first.fill} onCommit={(c) => c && set({ fill: c }, "Change caption colour")} onPreview={(c) => preview({ fill: c })} />
          </div>
        </div>
      </div>

      <Fold title="Lines and alignment" name="lines">
        <div className="cz-row">
          <div className="cz-label">Alignment</div>
          <Pick value={first.textAlign} name="align" options={[["left", "Left"], ["center", "Centre"], ["right", "Right"]]} onPick={(textAlign) => set({ textAlign }, "Change caption alignment")} />
        </div>
        <div className="cz-row">
          <div className="cz-label">Letters</div>
          <Pick value={first.caps ? "caps" : "as-said"} name="caps" options={[["as-said", "As said"], ["caps", "CAPITALS"]]} onPick={(v) => set({ caps: v === "caps" }, "Change capitals")} />
        </div>
        <Slide label="Line height" name="caption-line" value={round(first.lineHeight || 1.2)} min={0.8} max={2.4} step={0.05} onPreview={(n) => preview({ lineHeight: n })} onCommit={(n) => set({ lineHeight: n }, "Change caption line height")} />
        <Slide label="Letter spacing" name="caption-spacing" value={round(first.letterSpacing || 0)} min={-px(5)} max={px(20)} onPreview={(n) => preview({ letterSpacing: n })} onCommit={(n) => set({ letterSpacing: n }, "Change caption letter spacing")} />
      </Fold>

      <Fold title="Shape around words" name="shape">
        <div className="cz-row">
          <Pick
            value={!plate ? "none" : plate.each ? "each" : "line"}
            name="shape"
            options={[["none", "None"], ["line", "Each line"], ["each", "Each word"]]}
            onPick={(v) =>
              set(
                { plate: v === "none" ? undefined : { fill: plate?.fill ?? "#000000", radius: plate?.radius ?? px(12), padX: plate?.padX ?? px(16), padY: plate?.padY ?? px(8), each: v === "each" } },
                v === "none" ? "Remove the shape around words" : "Put a shape around words",
              )
            }
          />
        </div>
        {plate && (
          <>
            <div className="cz-row">
              <div className="cz-label">Shape colour</div>
              <ColorField value={plate.fill} onCommit={(c) => c && setPlate({ fill: c }, "Change shape colour")} onPreview={(c) => preview({ plate: { ...plate, fill: c } })} />
            </div>
            <Slide label="Corners" name="shape-corners" value={plate.radius} min={0} max={px(60)} onPreview={(n) => preview({ plate: { ...plate, radius: n } })} onCommit={(n) => setPlate({ radius: n }, "Change shape corners")} />
          </>
        )}
      </Fold>

      <Fold title="Depth and glow" name="depth">
        <div className="cz-row">
          <div className="cz-label">Outline</div>
          <Dots value={first.stroke} colours={["#000000", "#ffffff"]} none name="outline" onPick={(c) => set(c ? { stroke: c, strokeWidth: first.stroke ? first.strokeWidth : px(4) } : { stroke: null }, c ? "Outline the captions" : "Remove the outline")} />
        </div>
        {first.stroke && <Slide label="Outline width" name="outline-width" value={first.strokeWidth} min={1} max={px(16)} onPreview={(n) => preview({ strokeWidth: n })} onCommit={(n) => set({ strokeWidth: n }, "Change outline width")} />}
        <div className="cz-row">
          <div className="cz-label">Depth</div>
          <Pick
            value={!shadow ? "none" : glow ? "glow" : "shadow"}
            name="depth"
            options={[["none", "None"], ["shadow", "Shadow"], ["glow", "Glow"]]}
            onPick={(v) =>
              set(
                { shadow: v === "none" ? null : v === "glow" ? { x: 0, y: 0, blur: px(28), color: shadow?.color ?? "#b49cff" } : { x: 0, y: px(6), blur: px(10), color: shadow?.color ?? "#000000" } },
                v === "none" ? "Remove the shadow" : v === "glow" ? "Make the captions glow" : "Give the captions a shadow",
              )
            }
          />
        </div>
        {shadow && (
          <>
            <div className="cz-row">
              <div className="cz-label">{glow ? "Glow colour" : "Shadow colour"}</div>
              <ColorField value={shadow.color} onCommit={(c) => c && setShadow({ color: c }, "Change shadow colour")} onPreview={(c) => preview({ shadow: { ...shadow, color: c } })} />
            </div>
            <Slide label="Softness" name="shadow-blur" value={shadow.blur} min={0} max={px(60)} onPreview={(n) => preview({ shadow: { ...shadow, blur: n } })} onCommit={(n) => setShadow({ blur: n }, "Change shadow softness")} />
            {!glow && <Slide label="Distance" name="shadow-distance" value={shadow.y} min={0} max={px(30)} onPreview={(n) => preview({ shadow: { ...shadow, y: n } })} onCommit={(n) => setShadow({ y: n }, "Change shadow distance")} />}
          </>
        )}
      </Fold>

      <Fold title="Position and size" name="position">
        <Slide label="Height on screen, %" name="caption-height" value={middle} min={5} max={95} onPreview={() => undefined} onCommit={moveTo} />
        <div className="hint2">0 is the top of the video, 100 the bottom. Drag one caption on the video to move only that one.</div>
      </Fold>

      <CommentsList />
    </aside>
  );
}

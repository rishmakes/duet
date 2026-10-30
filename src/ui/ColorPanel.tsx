import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "./dialog";
import { currentDoc, dispatch, dragCancel, dragPreview } from "../state/store";
import type { El } from "../document/types";
import { GRADE_CONTROLS, canGrade, isNeutral, neutralGrade } from "../document/grade";
import type { Grade, GradeNumber } from "../document/grade";
import { lookFailed } from "../canvas/grade";
import { CurvesBox, OneColour, SkinBox } from "./ColorTools";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const shown = (key: GradeNumber, v: number) => (key === "exposure" ? v.toFixed(2) : key === "lookAmount" ? `${Math.round(v * 100)}%` : String(Math.round(v)));

/** One control: drag the track, type a number, or double click the name to put it back. */
function Slider({ ids, grade, k }: { ids: string[]; grade: Grade; k: (typeof GRADE_CONTROLS)[number] }) {
  const value = grade[k.key];
  const [text, setText] = useState(shown(k.key, value));
  useEffect(() => setText(shown(k.key, value)), [k.key, value]);
  const live = (n: number) => dragPreview("set_grade", { ids, grade: { [k.key]: n } });
  const done = (n: number) => {
    dragCancel();
    // while dragging, the panel already shows the new number, so compare with what is kept, not with what is shown
    const kept = currentDoc().elements;
    if (ids.some((id) => (kept[id]?.grade?.[k.key] ?? neutralGrade()[k.key]) !== n)) dispatch("set_grade", { ids, grade: { [k.key]: n }, label: `Change ${k.label.toLowerCase()}` });
  };
  const typed = () => {
    const n = parseFloat(text) / (k.key === "lookAmount" ? 100 : 1);
    if (Number.isFinite(n)) done(n);
    else setText(shown(k.key, value));
  };
  return (
    <div className={`grade-row grade-${k.key}${value !== neutralGrade()[k.key] ? " moved" : ""}`}>
      <span className="grade-name" title="Double click to put it back" onDoubleClick={() => done(neutralGrade()[k.key])}>
        {k.label}
      </span>
      <input
        type="range"
        min={k.min}
        max={k.max}
        step={k.step}
        value={value}
        onInput={(e) => live(parseFloat(e.currentTarget.value))}
        onChange={(e) => live(parseFloat(e.currentTarget.value))}
        onPointerUp={(e) => done(parseFloat(e.currentTarget.value))}
        onKeyUp={(e) => done(parseFloat(e.currentTarget.value))}
        onDoubleClick={() => done(neutralGrade()[k.key])}
      />
      <input
        className="grade-num"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={typed}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
    </div>
  );
}

/** The few that do almost everything, under the names a person grading uses. */
const FEW: { key: GradeNumber; label: string }[] = [
  { key: "exposure", label: "Brightness" },
  { key: "highlights", label: "Highlights" },
  { key: "contrast", label: "Contrast" },
  { key: "saturation", label: "Saturation" },
  { key: "temperature", label: "Warmth" },
  { key: "hue", label: "Hue" },
  { key: "vignette", label: "Vignette" },
];
/** The rest stay out of the way, and show only on a picture that already uses them, so that work can still be changed. */
const REST: GradeNumber[] = ["tint", "shadows", "whites", "blacks", "vibrance"];

/** The Color tab's panel: the colour of the picked pictures and clips. */
export default function ColorPanel({ els, every, top }: { els: El[]; every?: string; top?: React.ReactNode }) {
  const graded = els.filter(canGrade);
  const [problem, setProblem] = useState("");
  if (graded.length === 0) {
    return (
      <aside className="right">
        {top}
        <div className="panel-title">Colour</div>
        <div className="empty pad">{every !== undefined ? "There are no pictures or clips in this scene yet." : els.length ? "Only pictures and clips have colour to change here." : "Pick a picture or a clip to change its colour."}</div>
      </aside>
    );
  }
  const ids = graded.map((e) => e.id);
  const grade = { ...neutralGrade(), ...(graded[0].grade ?? {}) };
  const control = (key: GradeNumber) => GRADE_CONTROLS.find((c) => c.key === key)!;

  const loadLook = async () => {
    setProblem("");
    const picked = await open({ multiple: false, title: "Load a look", filters: [{ name: "Look (.cube)", extensions: ["cube"] }] });
    if (typeof picked !== "string") return;
    try {
      const kept = await invoke<string>("look_keep", { path: picked });
      dispatch("set_grade", { ids, grade: { look: kept, lookAmount: 1 }, label: `Use the look ${fileName(kept)}` });
    } catch (e) {
      setProblem(String(e));
    }
  };

  return (
    <aside className="right">
      {top}
      <div className="panel-title">{every !== undefined ? `Every clip in ${every || "this scene"}` : graded.length === 1 ? graded[0].name : `${graded.length} pictures and clips`}</div>
      <div className="sec grade-top">
        <button className="mini" disabled={graded.every((e) => isNeutral(e.grade))} onClick={() => dispatch("set_grade", { ids, grade: null })}>
          Reset colour
        </button>
      </div>
      <div className="sec">
        {FEW.map((f) => (
          <Slider key={f.key} ids={ids} grade={grade} k={{ ...control(f.key), label: f.label }} />
        ))}
        {REST.filter((key) => graded.some((e) => (e.grade?.[key] ?? 0) !== 0)).map((key) => (
          <Slider key={key} ids={ids} grade={grade} k={control(key)} />
        ))}
      </div>
      <CurvesBox ids={ids} grade={grade} />
      <OneColour ids={ids} grade={grade} />
      <SkinBox grade={grade} Slider={({ k }) => <Slider ids={ids} grade={grade} k={control(k)} />} />
      <div className="sec">
        <h4>Look</h4>
        {grade.look ? (
          <>
            <div className="grade-look">
              <span title={grade.look}>{fileName(grade.look)}</span>
              <button className="mini" onClick={() => dispatch("set_grade", { ids, grade: { look: "" }, label: "Remove the look" })}>
                Remove
              </button>
            </div>
            {lookFailed(grade.look) && <div className="grade-problem">This look could not be read. Load it again.</div>}
            <Slider ids={ids} grade={grade} k={control("lookAmount")} />
          </>
        ) : (
          <button className="mini wide" onClick={loadLook}>
            Load a look (.cube)
          </button>
        )}
        {problem && <div className="grade-problem">{problem}</div>}
      </div>
    </aside>
  );
}

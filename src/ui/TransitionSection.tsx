import { CUT_MOVE_MAX, CUT_MOVE_MIN, CUT_MOVE_NAMES, CUT_MOVE_SECONDS, clipBefore, cutsIn, holdsStill, moveLength } from "../document/moves";
import { CUT_MOVES } from "../document/types";
import type { CutMoveKind, Doc, El } from "../document/types";
import { dispatch, dragCancel, dragPreview } from "../state/store";
import { clipLength } from "../video/clips";
import Icon from "./Icons";
import { pickCut } from "./pickedCut";

/**
 * The settings of the transition at a cut, picked by its badge on the timeline: what kind, how long, and
 * using it on every cut of the scene. Choosing Cut takes it away.
 */
export default function TransitionSection({ doc, el, scene }: { doc: Doc; el: El; scene: El }) {
  const move = el.cutIn;
  const before = clipBefore(doc, el, scene);
  if (!move || !before) return null;
  const seconds = move.seconds || CUT_MOVE_SECONDS;
  const real = moveLength(move, before, el, scene);
  // a file whose length is not known yet is taken to have footage to spare: the note waits until it is
  const still = holdsStill(doc, el, scene, (src) => clipLength(src) || Infinity);
  const set = (kind: CutMoveKind | "cut", s?: number) => dispatch("set_transition", { ids: [el.id], kind, ...(s ? { seconds: s } : {}) });
  const live = (s: number) => dragPreview("set_transition", { ids: [el.id], kind: move.kind, seconds: s });
  const done = (s: number) => {
    dragCancel();
    if (Math.abs(s - seconds) > 0.001) set(move.kind, s);
  };
  const others = cutsIn(doc, scene);
  return (
    <div className="sec" data-name="transition-settings">
      <label className="f">
        <span>Kind</span>
        <select value={move.kind} data-name="transition-kind" onChange={(e) => set(e.target.value as CutMoveKind | "cut")}>
          {CUT_MOVES.map((k) => (
            <option key={k} value={k}>
              {CUT_MOVE_NAMES[k]}
            </option>
          ))}
        </select>
      </label>
      <div className="gap" />
      <div className="grade-row moved">
        <span className="grade-name" title="Double click for the usual length" onDoubleClick={() => done(CUT_MOVE_SECONDS)}>
          Length
        </span>
        <input
          type="range"
          data-name="transition-length"
          min={CUT_MOVE_MIN}
          max={CUT_MOVE_MAX}
          step={0.05}
          value={seconds}
          onInput={(e) => live(parseFloat(e.currentTarget.value))}
          onChange={(e) => live(parseFloat(e.currentTarget.value))}
          onPointerUp={(e) => done(parseFloat(e.currentTarget.value))}
          onKeyUp={(e) => done(parseFloat(e.currentTarget.value))}
        />
        <span className="grade-num">{Math.round(seconds * 100) / 100} s</span>
      </div>
      {real < seconds - 0.005 && <p className="hint">Shortened to {Math.round(real * 100) / 100} s here, so it fits inside the shorter clip.</p>}
      {still && <p className="hint">One of these clips has no more footage past the cut, so its end picture holds still for part of the dissolve.</p>}
      <div className="gap" />
      <div className="transition-actions">
        <button
          className="mini"
          data-name="transition-every-cut"
          disabled={others.length < 2}
          title={others.length < 2 ? "This is the only cut in the scene" : `Put this ${CUT_MOVE_NAMES[move.kind].toLowerCase()} on all ${others.length} cuts in the scene`}
          onClick={() => dispatch("set_transition", { ids: others, kind: move.kind, seconds })}
        >
          <Icon name="cuts-all" size={14} />
          Apply to all cuts
        </button>
        <button className="mini" data-name="transition-remove" title="Take this transition away and leave a plain cut. Delete does the same" onClick={() => (set("cut"), pickCut(null))}>
          <Icon name="cut-remove" size={14} />
          Remove
        </button>
      </div>
    </div>
  );
}

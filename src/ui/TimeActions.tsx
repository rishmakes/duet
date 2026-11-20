import { useState } from "react";
import type { ReactNode } from "react";
import { dispatch } from "../state/store";
import type { El } from "../document/types";
import Icon from "./Icons";
import type { IconName } from "./Icons";
import SoundSection from "./SoundSection";
import { useDismiss } from "./useDismiss";

/** One action in the bar under the timeline: its icon, with its name under it. */
export function ActButton({ icon, label, hint, on, busy, disabled, onClick, name }: { icon: IconName; label: string; hint?: string; on?: boolean; busy?: boolean; disabled?: boolean; onClick: () => void; name: string }) {
  return (
    <button type="button" className={`time-act ${on ? "on" : ""} ${busy ? "busy" : ""}`} data-name={name} disabled={disabled} title={hint ? `${label} (${hint})` : label} onClick={onClick}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </button>
  );
}

/** An action that opens a small card above itself, closed by a click anywhere else. */
function ActCard({ icon, label, name, children }: { icon: IconName; label: string; name: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false), `[data-card='${name}']`);
  return (
    <div className="time-act-anchor" data-card={name}>
      <ActButton icon={icon} label={label} name={name} on={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className="export-pop act-pop" data-name={`${name}-card`}>
          {children}
        </div>
      )}
    </div>
  );
}

const QUICK_SPEEDS = [0.5, 1, 1.5, 2];

/** How fast the picked clips play. The same setting as Speed in Properties. */
export function SpeedCard({ els }: { els: El[] }) {
  const now = els[0]?.speed || 1;
  const same = els.every((e) => (e.speed || 1) === now);
  const set = (speed: number) => dispatch("set_speed", { ids: els.map((e) => e.id), speed });
  return (
    <ActCard icon="speed" label="Speed" name="act-speed">
      <h4 className="act-pop-title">Speed</h4>
      <div className="act-chips">
        {QUICK_SPEEDS.map((s) => (
          <button key={s} type="button" className={`act-chip ${same && Math.abs(now - s) < 0.001 ? "on" : ""}`} data-name={`speed-${s}`} onClick={() => set(s)}>
            {s}×
          </button>
        ))}
      </div>
      <label className="act-row">
        Exact
        <input
          key={same ? now : "mixed"}
          type="number"
          min={10}
          step={5}
          data-name="speed-exact"
          defaultValue={same ? Math.round(now * 100) : ""}
          placeholder="Mixed"
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => {
            const n = Number(e.currentTarget.value);
            if (e.currentTarget.value !== "" && Number.isFinite(n) && n >= 10 && (!same || Math.round(now * 100) !== n)) set(n / 100);
          }}
        />
        <span className="act-unit">%</span>
      </label>
    </ActCard>
  );
}

/** How loud the picked clips are and how they fade. The same controls as Sound in Properties. */
export function VolumeCard({ els, scene }: { els: El[]; scene: El | null }) {
  return (
    <ActCard icon="sound" label="Volume" name="act-volume">
      <SoundSection els={els} scene={scene} />
    </ActCard>
  );
}

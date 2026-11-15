import { useState, useSyncExternalStore } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { clearTrace, subscribeTrace, tally, traceFolder, traceSteps, type TraceStep } from "../ai/trace";

/**
 * Duet dev only: the AI trail, live. Each step an AI takes in Duet, newest on top: what it asked for and what it got
 * back, word for word, with the picture it saw. Above it, how much each tool is used, how often it fails and how slow it is.
 */

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const size = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

export default function AiTrail() {
  const steps = useSyncExternalStore(subscribeTrace, () => traceSteps().length, () => 0);
  const all = traceSteps();
  const [builderToo, setBuilderToo] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  void steps;
  const shown = builderToo ? all : all.filter((s) => !s.tool.startsWith("dev_"));
  const rows = tally(shown);
  const most = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="trail">
      <div className="trail-bar">
        <span className="trail-count">
          {shown.length} {shown.length === 1 ? "step" : "steps"} since Duet dev started
        </span>
        <label className="trail-check">
          <input type="checkbox" checked={builderToo} onChange={(e) => setBuilderToo(e.target.checked)} /> Show checking tools (dev_)
        </label>
        <button className="mini" onClick={() => void traceFolder().then((f) => (f ? revealItemInDir(f).catch(() => undefined) : undefined))}>
          Show in Finder
        </button>
        <button className="mini" onClick={clearTrace}>
          Clear
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="settings-empty">No AI has worked in Duet dev yet. Steps show here as they happen.</div>
      ) : (
        <>
          <div className="settings-subtitle">Tools used</div>
          <div className="trail-tally">
            {rows.map((r) => (
              <div key={r.tool} className="trail-tally-row" title={`${r.count} times, ${r.errors} failed, about ${r.ms} ms and ${size(r.chars)} characters back each time`}>
                <span className="trail-tool">{r.tool}</span>
                <span className="trail-heat">
                  <i style={{ width: `${(r.count / most) * 100}%` }} className={r.errors ? "has-errors" : ""} />
                </span>
                <span className="trail-num">{r.count}</span>
                <span className={`trail-num ${r.errors ? "bad" : ""}`}>{r.errors ? `${r.errors} failed` : ""}</span>
                <span className="trail-num">{r.ms} ms</span>
              </div>
            ))}
          </div>

          <div className="settings-subtitle">Every step, newest first</div>
          <div className="trail-list">
            {[...shown].reverse().map((s) => (
              <Step key={s.n} s={s} open={open === s.n} onToggle={() => setOpen(open === s.n ? null : s.n)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Step({ s, open, onToggle }: { s: TraceStep; open: boolean; onToggle: () => void }) {
  return (
    <div className={`trail-step ${s.error ? "failed" : ""} ${open ? "open" : ""}`}>
      <button className="trail-step-head" onClick={onToggle}>
        <span className="trail-n">{s.n}</span>
        <span className="trail-time">{clock(s.at)}</span>
        <span className="trail-who">{s.who}</span>
        <span className="trail-tool">{s.tool}</span>
        {s.image && <span className="trail-tag">picture</span>}
        {s.error && <span className="trail-tag bad">failed</span>}
        <span className="trail-num">{s.ms} ms</span>
        <span className="trail-num">{size(s.text.length)} chars</span>
      </button>
      {open && (
        <div className="trail-step-body">
          <div className="trail-label">Asked for</div>
          <pre>{JSON.stringify(s.args, null, 2)}</pre>
          <div className="trail-label">Got back</div>
          <pre>{s.text}</pre>
          {s.image && (
            <>
              <div className="trail-label">The picture it saw</div>
              <img src={`data:${s.image.mime};base64,${s.image.data}`} alt="" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

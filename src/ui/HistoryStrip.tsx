import { whoColour } from "../ai/colours";
import { Fragment, useEffect, useRef, useState } from "react";
import { useChat } from "../ai/chat";
import { nameOf } from "../ai/names";
import { toolLabel } from "../ai/who";
import { wordsBehind } from "../memory/steps";
import { goTo, redo, undo, useStore } from "../state/store";
import { childOf, directionOf } from "../state/directions";
import type { Actor } from "../commands";

const STEP = 30;
const OLD_STEP = 10;
const PAD = 16;
const Y = 24;

function outlineFor(actor: Actor, by?: string, version?: string): string {
  if (version) return "#fff";
  return whoColour(actor, by);
}

function getX(i: number, len: number): number {
  const cutoff = Math.max(0, len - 40);
  if (i <= cutoff) {
    return PAD + i * OLD_STEP;
  }
  return PAD + cutoff * OLD_STEP + (i - cutoff) * STEP;
}

const timeText = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function HistoryStrip() {
  const timeline = useStore((s) => s.timeline);
  const cursor = useStore((s) => s.cursor);
  const said = useChat((s) => s.messages);
  const earlier = useChat((s) => s.earlier);
  const scroller = useRef<HTMLDivElement>(null);
  // The tooltip is drawn outside the scrolling strip, so it is never clipped.
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const names = useChat((s) => s.names);

  // keep the current step in view
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const currentX = getX(cursor, timeline.length);
    if (currentX < el.scrollLeft + 20 || currentX > el.scrollLeft + el.clientWidth - 20) {
      el.scrollLeft = Math.max(0, currentX - el.clientWidth / 2);
    }
  }, [cursor, timeline.length]);

  const width = timeline.length > 0 ? getX(timeline.length - 1, timeline.length) + PAD : PAD * 2;
  const versions = timeline.filter((e) => e.version).length;

  const legendItems: { name: string; color: string }[] = [{ name: "You", color: "var(--text)" }];
  const seenAi = new Set<string>();
  for (const e of timeline) {
    if (e.actor === "ai") {
      const aiName = e.by ? nameOf(e.by, names) : "Duet";
      if (!seenAi.has(aiName)) {
        seenAi.add(aiName);
        legendItems.push({
          name: aiName,
          color: whoColour("ai", e.by),
        });
      }
    }
  }

  const cutoff = Math.max(0, timeline.length - 40);
  const line = directionOf(timeline, cursor);

  return (
    <footer className="hist">
      <div className="hist-legend">
        {legendItems.map((item) => (
          <span key={item.name} className="hist-legend-item">
            <span className="hist-legend-dot" style={{ backgroundColor: item.color }} />
            <span>{item.name}</span>
          </span>
        ))}
      </div>

      <div className="scroller" ref={scroller}>
        <div className="lanes" style={{ width }}>
          <svg width={width} height={48} className="links">
            {timeline.length > 1 && (
              <line
                x1={getX(0, timeline.length)}
                y1={Y}
                x2={getX(timeline.length - 1, timeline.length)}
                y2={Y}
                className="link"
              />
            )}
          </svg>
          {timeline.map((e, i) => {
            const isOld = i < cutoff;
            const words = wordsBehind(said, e) ?? wordsBehind(earlier, e);
            const who = e.actor === "ai" ? (e.by ? `${nameOf(e.by, names)} · ${toolLabel(e.by)}` : "Duet") : "You";
            const asked = words ? ` · You asked: “${words.length > 90 ? `${words.slice(0, 89).trimEnd()}…` : words}”` : "";
            const ringX = getX(i, timeline.length);
            const outlineColor = outlineFor(e.actor, e.by, e.version);
            const ringRadius = e.version ? 8 : (isOld ? 4 : 6);
            const dotTop = Y - ringRadius - 7;
            const verTop = words ? 0 : 2;

            return (
              <Fragment key={i}>
                {e.version && (
                  <span className={`ver-text ${i > cursor && line.has(i) ? "future" : ""} ${!line.has(i) ? "other" : ""}`} style={{ left: ringX, top: verTop }}>
                    {e.version}
                  </span>
                )}
                {words && (
                  <span
                    className={`req-dot ${i > cursor && line.has(i) ? "future" : ""} ${!line.has(i) ? "other" : ""}`}
                    style={{ left: ringX, top: dotTop }}
                    title="A request started here"
                    onClick={() => {
                      goTo(i);
                      window.dispatchEvent(new CustomEvent("duet:show-request", { detail: e.step }));
                    }}
                  />
                )}
                <button
                  className={`pt ${isOld && !e.version ? "old" : ""} ${e.version ? "ver" : ""} ${i === cursor ? "now" : ""} ${i > cursor && line.has(i) ? "future" : ""} ${!line.has(i) ? "other" : ""}`}
                  style={{
                    left: ringX,
                    top: Y,
                    borderColor: outlineColor,
                  }}
                  onMouseEnter={(ev) => {
                    const r = ev.currentTarget.getBoundingClientRect();
                    setTip({
                      text: `${who} · ${e.label} · ${timeText(e.time)}${asked}`,
                      x: r.left + r.width / 2,
                      y: r.top,
                    });
                  }}
                  onMouseLeave={() => setTip(null)}
                  onClick={() => goTo(i)}
                  aria-label={e.label}
                />
              </Fragment>
            );
          })}
        </div>
      </div>

      <div className="hist-actions">
        <button className="mini" disabled={cursor === 0} onClick={undo} title="Undo (Ctrl or Cmd Z)">
          Undo
        </button>
        <button className="mini" disabled={childOf(timeline, cursor) < 0} onClick={redo} title="Redo (Shift Ctrl or Cmd Z)">
          Redo
        </button>
        <button data-toggle="versions" className="mini" onClick={() => window.dispatchEvent(new CustomEvent("duet:versions", { detail: "toggle" }))}>
          Versions{versions ? ` (${versions})` : ""}
        </button>
      </div>

      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y - 10 }}>
          {tip.text}
        </div>
      )}

    </footer>
  );
}

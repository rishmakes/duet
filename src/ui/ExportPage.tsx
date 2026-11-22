import { useEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import Icon from "./Icons";
import { aboutTime, allJobs, holdLine, lineHeld, moveJob, pauseJob, secondsLeft, stopJob, subscribeJobs } from "../ai/jobs";
import type { Job } from "../ai/jobs";
import { logError } from "../errorLog";

/**
 * Export, as its own page: every video in the line, yours and the ones an AI asked for, in the order they
 * are made. Pause one, stop one, drag a waiting one up or down, and find the finished ones.
 */

/** Re-draw whenever the line moves. */
function useJobs(): readonly Job[] {
  const [, moved] = useState(0);
  useEffect(() => subscribeJobs(() => moved((n) => n + 1)), []);
  return allJobs();
}

const WHO_COLORS = ["#4cc38a", "#e5b84c", "#5aa9e6", "#e57373", "#b388ff"];
const whoColor = (by?: string) => (by ? WHO_COLORS[[...by].reduce((a, c) => a + c.charCodeAt(0), 0) % WHO_COLORS.length] : "var(--text)");

const clock = (ms: number) => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `today ${time}` : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
};

const took = (j: Job) => {
  const s = Math.max(1, Math.round(((j.ended ?? 0) - (j.started ?? 0)) / 1000));
  return s < 90 ? `made in ${s} seconds` : `made in ${Math.round(s / 60)} minutes`;
};

function whereItIs(j: Job, first: boolean): string {
  if (j.state === "running") return j.paused ? "paused" : `${Math.round(j.done * 100)}%, ${aboutTime(secondsLeft(j))} left`;
  return first ? "up next" : "waiting";
}

export default function ExportPage({ onClose }: { onClose: () => void }) {
  const jobs = useJobs();
  const busy = jobs.filter((j) => j.state === "running" || j.state === "waiting");
  const over = jobs.filter((j) => j.state === "done" || j.state === "failed" || j.state === "stopped").reverse();
  const paused = busy.filter((j) => j.state === "running" && j.paused).length;
  const making = busy.filter((j) => j.state === "running").length - paused;
  const waiting = busy.length - making - paused;
  const held = lineHeld();
  const firstWaiting = busy.find((j) => j.state === "waiting");

  // a waiting video is dragged by its grip; the line it would land before shows while it moves
  const list = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ n: number; place: number } | null>(null);
  const placeAt = (y: number) => {
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-waiting]") ?? []);
    const i = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return y < b.top + b.height / 2;
    });
    return i < 0 ? rows.length : i;
  };
  const grab = (e: React.PointerEvent, n: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    let place = placeAt(e.clientY);
    setDrag({ n, place });
    const move = (ev: PointerEvent) => {
      place = placeAt(ev.clientY);
      setDrag({ n, place });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      // the places counted include the dragged row itself; past it, one fewer
      const from = busy.filter((j) => j.state === "waiting").findIndex((j) => j.n === n);
      moveJob(n, place > from ? place - 1 : place);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const show = (file: string) => void revealItemInDir(file).catch((e) => logError("show export", e));
  let waitingIndex = -1;

  return (
    <section className="skills-page export-page" data-name="export-page">
      <div className="skills-page-head">
        <h2>Export</h2>
        <button className="page-close" data-name="close-export-page" title="Back to your work (Esc)" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="export-sum">
        <span>{busy.length ? [making && `${making} being made`, paused && `${paused} paused`, waiting && `${waiting} waiting`].filter(Boolean).join(", ") : "Nothing is being made."}</span>
        {busy.length > 0 && (
          <button className="pill" data-name="pause-all" onClick={() => holdLine(!held)} title={held ? "Carry on with the line" : "Hold the line: the video being made pauses, and none starts after it"}>
            {held ? "Resume all" : "Pause all"}
          </button>
        )}
      </div>

      <div className="export-rows" ref={list}>
        {busy.map((j) => {
          const isWaiting = j.state === "waiting";
          if (isWaiting) waitingIndex++;
          const lineBefore = drag && isWaiting && drag.place === waitingIndex && drag.n !== j.n;
          return (
            <div key={j.n} className={`export-row ${drag?.n === j.n ? "lifted" : ""} ${lineBefore ? "drop-before" : ""}`} data-name={`export-row-${j.what}`} {...(isWaiting ? { "data-waiting": "" } : {})}>
              {isWaiting ? (
                <span className="export-grip" data-name="export-grip" title="Drag to change when it is made" onPointerDown={(e) => grab(e, j.n)}>
                  ⋮⋮
                </span>
              ) : (
                <span className="export-grip" />
              )}
              <div className="export-what">
                <b>
                  {j.what}
                  {j.kind ? ` · ${j.kind}` : ""}
                </b>
                {j.state === "running" && (
                  <span className="export-bar">
                    <span style={{ width: `${Math.round(j.done * 100)}%` }} />
                  </span>
                )}
                <span className="export-who">
                  <i style={{ background: whoColor(j.by) }} />
                  {j.by ? `Asked by ${j.by}` : "You"} · {whereItIs(j, j === firstWaiting)}
                </span>
              </div>
              {j.state === "running" && (
                <button className={`pill ${j.paused ? "primary" : ""}`} data-name="export-pause" onClick={() => pauseJob(j.n, !j.paused)}>
                  {j.paused ? "Resume" : "Pause"}
                </button>
              )}
              <button className="pill" data-name="export-stop" onClick={() => stopJob(j.n)} title={isWaiting ? "Take it out of the line" : "Stop making it"}>
                {isWaiting ? "Remove" : "Stop"}
              </button>
            </div>
          );
        })}
        {drag && drag.place === busy.filter((j) => j.state === "waiting").length && <div className="export-drop-end" />}
      </div>

      {over.length > 0 && (
        <>
          <h3 className="export-done-head">Done</h3>
          <div className="export-rows">
            {over.map((j) => (
              <div key={j.n} className="export-row" data-name={`export-done-${j.what}`}>
                <span className="export-grip" />
                <div className="export-what">
                  <b>
                    {j.what}
                    {j.kind ? ` · ${j.kind}` : ""}
                  </b>
                  <span className="export-who">
                    <i style={{ background: whoColor(j.by) }} />
                    {j.by ? `Asked by ${j.by}` : "You"} · {j.state === "done" ? took(j) : j.state === "stopped" ? "stopped" : `not made. ${j.error ?? ""}`} · {clock(j.ended ?? Date.now())}
                  </span>
                </div>
                {j.state === "done" && j.file && (
                  <button className="pill" data-name="export-show" onClick={() => show(j.file!)}>
                    Show in Finder
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { aboutTime, afterLine, allJobs, guessSeconds, holdLine, lineHeld, setAfterLine, moveJob, pauseJob, putFirst, secondsLeft, stopJob, subscribeJobs } from "../ai/jobs";
import type { AfterLine, Job } from "../ai/jobs";
import { logError } from "../errorLog";
import { currentDoc, useStore } from "../state/store";
import { QUALITIES, SIZES, exportSize, queueVideo } from "../video/scene";
import type { ExportChoice } from "../video/scene";
import { lastChoice, rememberExport, shortFolder } from "../video/exportPrefs";
import { open as openDialog } from "./dialog";
import ExportPicture from "./ExportPicture";
import DesignSetUp from "./ExportDesign";
import { useLayout } from "./layout";

/**
 * Export, as its own page. Set up: how a scene, or a design's screens, are made into files. Queue: every
 * export in the line, yours and the ones an AI asked for, in the order they are made; pause one, stop one,
 * drag a waiting one up or down, and find the finished ones.
 */

export type ExportTab = "setup" | "queue";

/** Re-draw whenever the line moves. */
export function useJobs(): readonly Job[] {
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
  return s === 1 ? "made in 1 second" : s < 90 ? `made in ${s} seconds` : `made in ${Math.round(s / 60)} minutes`;
};

export function whereItIs(j: Job, first: boolean): string {
  if (j.state === "running") return j.paused ? "paused" : `${Math.round(j.done * 100)}%, ${aboutTime(secondsLeft(j))} left`;
  return first ? "up next" : "waiting";
}

function QueueTab() {
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

  const show = (file: string) => void revealItemInDir(file).catch((e) => logError("show export", e));
  let waitingIndex = -1;

  return (
    <>
      <div className="export-sum">
        <span>{busy.length ? [making && `${making} being made`, paused && `${paused} paused`, waiting && `${waiting} waiting`].filter(Boolean).join(", ") : "Nothing is being made."}</span>
        {busy.length > 0 && (
          <label className="export-after" title="What the computer does once every export in the line is made. You get a minute to cancel.">
            When it is all done
            <select data-name="export-after" value={afterLine()} onChange={(e) => setAfterLine(e.target.value as AfterLine)}>
              <option value="nothing">Do nothing</option>
              <option value="sleep">Sleep</option>
              <option value="shutdown">Shut down</option>
            </select>
          </label>
        )}
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
    </>
  );
}

/** One file to make from the scene: its kind, how fine, and with sound or without. */
interface FileRow {
  master: boolean;
  quality: number;
  mute: boolean;
}

const clockText = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

function SetUpTab({ sceneId, onQueued }: { sceneId?: string; onQueued: () => void }) {
  const doc = useStore((s) => currentDoc(s));
  const projectFile = useStore((s) => s.project.file);
  const projectName = useStore((s) => s.project.name);
  const openScene = useStore((s) => s.clock.scene);
  const scene = doc.elements[sceneId ?? openScene ?? ""];
  const [base, setBase] = useState<ExportChoice>(() => lastChoice(projectFile));
  const [rows, setRows] = useState<FileRow[]>(() => [{ master: !!base.master, quality: base.quality, mute: !!base.mute }]);
  const [more, setMore] = useState(false);
  const [problem, setProblem] = useState("");
  if (!scene?.duration) return <p className="export-empty">Open a scene to export it.</p>;

  const part = base.whole || !scene.workArea ? { start: 0, end: scene.duration } : scene.workArea;
  const span = part.end - part.start;
  const [w, h] = exportSize(scene, base.longSide);
  const sameSize = base.longSide === 0 || base.longSide >= Math.max(scene.width, scene.height);
  const setRow = (i: number, r: Partial<FileRow>) => setRows(rows.map((x, k) => (k === i ? { ...x, ...r } : x)));

  const go = (now: boolean) => {
    setProblem("");
    const made: number[] = [];
    for (const r of rows) {
      const job = queueVideo(scene.id, { ...base, ...r }, { project: projectName }, doc);
      if (!("n" in job)) {
        setProblem(job.error);
        break;
      }
      made.push(job.n);
    }
    if (now) putFirst(made);
    if (made.length) {
      rememberExport(projectFile, { ...base, ...rows[0] });
      onQueued();
    }
  };

  return (
    <div className="export-setup">
      <div className="export-left">
        {scene.workArea && (
          <div className="kind-quiet export-part">
            <button className={base.whole ? "on" : ""} data-name="export-whole" onClick={() => setBase({ ...base, whole: true })}>
              Whole scene
            </button>
            <button className={base.whole ? "" : "on"} data-name="export-work-area" onClick={() => setBase({ ...base, whole: false })}>
              Work area
            </button>
          </div>
        )}
        <div className="export-picture">
          <ExportPicture doc={doc} el={scene} at={part.start} />
        </div>
        <div className="export-caption">
          <span>{scene.name}</span>
          <span>
            {clockText(part.start)} to {clockText(part.end)}
          </span>
        </div>
      </div>

      <div className="export-right">
        <span className="export-label">Save to</span>
        <div className="export-field">
          <span title={base.dir ?? "Documents, Duet, Exports"}>{base.dir ? shortFolder(base.dir) : "Documents, Duet, Exports"}</span>
          <button
            className="pill"
            data-name="export-folder"
            title="Choose the folder this project's videos go into. Duet remembers it."
            onClick={async () => {
              const dir = await openDialog({ directory: true, title: "Where this project's videos go", defaultPath: base.dir });
              if (typeof dir === "string" && dir) setBase({ ...base, dir });
            }}
          >
            Change
          </button>
        </div>

        <span className="export-label">Files</span>
        {rows.map((r, i) => (
          <div className="export-file" key={i} data-name="export-file">
            <select data-name="export-kind" value={r.master ? "master" : "mp4"} onChange={(e) => setRow(i, { master: e.target.value === "master" })}>
              <option value="mp4">MP4</option>
              <option value="master">ProRes MOV</option>
            </select>
            <select data-name="export-quality" value={r.quality} disabled={r.master} title={r.master ? "ProRes keeps everything" : undefined} onChange={(e) => setRow(i, { quality: Number(e.target.value) })}>
              {QUALITIES.map((q) => (
                <option key={q.quality} value={q.quality}>
                  {q.name}
                </option>
              ))}
            </select>
            <select data-name="export-sound" value={r.mute ? "off" : "on"} onChange={(e) => setRow(i, { mute: e.target.value === "off" })}>
              <option value="on">Sound on</option>
              <option value="off">No sound</option>
            </select>
            {rows.length > 1 && (
              <button className="export-x" data-name="export-file-remove" title="Do not make this file" onClick={() => setRows(rows.filter((_, k) => k !== i))}>
                ×
              </button>
            )}
          </div>
        ))}
        <button className="export-add" data-name="export-add-file" onClick={() => setRows([...rows, { ...rows[rows.length - 1], master: !rows[rows.length - 1].master }])}>
          + Add a file type
        </button>

        <button className="export-field export-more" data-name="export-size-fps" onClick={() => setMore(!more)}>
          <span className="export-label">Size and frames a second</span>
          <span>{sameSize && base.fps === 30 ? "Same as your scene" : `${w} × ${h}, ${base.fps} a second`} ›</span>
        </button>
        {more && (
          <div className="export-file">
            <select data-name="export-size" value={sameSize ? 0 : base.longSide} onChange={(e) => setBase({ ...base, longSide: Number(e.target.value) })}>
              <option value={0}>
                Same as your scene, {exportSize(scene, 0).join(" × ")}
              </option>
              {SIZES.filter((z) => z.longSide > 0 && z.longSide < Math.max(scene.width, scene.height)).map((z) => (
                <option key={z.longSide} value={z.longSide}>
                  {z.name}, {exportSize(scene, z.longSide).join(" × ")}
                </option>
              ))}
            </select>
            <select data-name="export-fps" value={base.fps} onChange={(e) => setBase({ ...base, fps: Number(e.target.value) })}>
              {[24, 25, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n} a second
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="export-tiles">
          <div>
            <b>{clockText(span)}</b>
            <span>long</span>
          </div>
          <div>
            <b>{rows.length}</b>
            <span>{rows.length === 1 ? "file" : "files"}</span>
          </div>
          <div>
            <b>{aboutTime(guessSeconds(span) * rows.length).replace("about ", "")}</b>
            <span>to make, about</span>
          </div>
        </div>
        {problem && <p className="export-problem">{problem}</p>}
        <div className="export-go">
          <button className="pill primary" data-name="export-now" onClick={() => go(true)} title="Make it next, before anything still waiting">
            Export now
          </button>
          <button className="pill" data-name="export-add-queue" onClick={() => go(false)} title="Make it after everything already in the line">
            Add to queue
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ExportPage({ onClose, tab: startTab, sceneId }: { onClose: () => void; tab: ExportTab; sceneId?: string }) {
  const [tab, setTab] = useState<ExportTab>(startTab);
  useEffect(() => setTab(startTab), [startTab, sceneId]);
  const busy = useJobs().filter((j) => j.state === "running" || j.state === "waiting").length;
  const video = useLayout((d) => d.mode) === "motion";
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <section className="skills-page export-page" data-name="export-page">
      <button className="export-back" data-name="close-export-page" title="Back to your work (Esc)" onClick={onClose}>
        ‹ Back to your work
      </button>
      <div className="skills-page-head">
        <h2>Export</h2>
        <div className="kind-quiet export-tabs">
          <button className={tab === "setup" ? "on" : ""} data-name="export-tab-setup" onClick={() => setTab("setup")}>
            Set up
          </button>
          <button className={tab === "queue" ? "on" : ""} data-name="export-tab-queue" onClick={() => setTab("queue")}>
            Queue {busy > 0 && <i className="export-badge">{busy}</i>}
          </button>
        </div>
      </div>
      {tab === "queue" ? <QueueTab /> : video ? <SetUpTab key={sceneId} sceneId={sceneId} onQueued={() => setTab("queue")} /> : <DesignSetUp onQueued={() => setTab("queue")} />}
    </section>
  );
}

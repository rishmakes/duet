import { useEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { aboutTime, addPlanned, afterLine, allJobs, clearFinished, guessSeconds, holdLine, lineHeld, setAfterLine, startPlanned, moveJob, pauseJob, putFirst, secondsLeft, stopJob, subscribeJobs } from "../ai/jobs";
import type { AfterLine, Job } from "../ai/jobs";
import { logError } from "../errorLog";
import { currentDoc, dragCancel, dragCommit, dragPreview, useStore } from "../state/store";
import type { El } from "../document/types";
import { QUALITIES, SIZES, exportSize, queueVideo } from "../video/scene";
import type { ExportChoice } from "../video/scene";
import { lastChoice, rememberExport, shortFolder } from "../video/exportPrefs";
import type { ExportTab } from "../video/exportPrefs";
import { open as openDialog } from "./dialog";
import ExportPicture from "./ExportPicture";
import DesignSetUp from "./ExportDesign";
import { useLayout } from "./layout";
import Icon from "./Icons";

/**
 * Export, as its own page. Export: how a scene, or a design's screens, are made into files. Queue: every
 * export in the line, yours and the ones an AI asked for, in the order they are made; pause one, stop one,
 * drag a waiting one up or down, and find the finished ones.
 */

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
  if (j.planned) return "planned, starts when you press Start";
  if (j.state === "running") return j.paused ? "paused" : `${Math.round(j.done * 100)}%, ${aboutTime(secondsLeft(j))} left`;
  return first ? "up next" : "waiting";
}

function QueueTab() {
  const jobs = useJobs();
  const busy = jobs.filter((j) => j.state === "running" || j.state === "waiting");
  const over = jobs.filter((j) => j.state === "done" || j.state === "failed" || j.state === "stopped").reverse();
  const paused = busy.filter((j) => j.state === "running" && j.paused).length;
  const making = busy.filter((j) => j.state === "running").length - paused;
  const planned = busy.filter((j) => j.planned).length;
  const waiting = busy.length - making - paused - planned;
  const held = lineHeld();
  const firstWaiting = busy.find((j) => j.state === "waiting" && !j.planned);

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
        <span>{busy.length ? [making && `${making} being made`, paused && `${paused} paused`, waiting && `${waiting} waiting`, planned && `${planned} planned`].filter(Boolean).join(", ") : "Nothing is being made."}</span>
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
        {planned > 0 && (
          <button className="pill primary" data-name="export-start" onClick={() => startPlanned()} title="Start making the planned files, in their order">
            Start
          </button>
        )}
        {busy.length > planned && (
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
              {j.planned && (
                <button className="pill" data-name="export-start-one" onClick={() => startPlanned([j.n])} title="Start this one now, keeping its place in the line">
                  Start
                </button>
              )}
              {j.state === "running" && (
                <button className={`pill ${j.paused ? "primary" : ""}`} data-name="export-pause" onClick={() => pauseJob(j.n, !j.paused)}>
                  {j.paused ? "Resume" : "Pause"}
                </button>
              )}
              <button className="export-x" data-name="export-remove" onClick={() => stopJob(j.n)} title={isWaiting ? "Take it out of the line" : "Stop making it"}>
                ✕
              </button>
            </div>
          );
        })}
        {drag && drag.place === busy.filter((j) => j.state === "waiting").length && <div className="export-drop-end" />}
      </div>

      {over.length > 0 && (
        <>
          <div className="export-done-head">
            <h3>Done</h3>
            <button className="pill" data-name="export-clear-finished" onClick={clearFinished} title="Take every finished file off this list. The files stay where they are.">
              Clear finished
            </button>
          </div>
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
                <button className="export-x" data-name="export-remove" onClick={() => stopJob(j.n)} title="Take it off the list. The file stays where it is.">
                  ✕
                </button>
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

/** Good, Better, Best from left to right on the slider. */
/** Common frame rates; anything else is typed in as Custom. */
const FPS_CHOICES = [24, 25, 30, 60];
const STEPS = [...QUALITIES].reverse();
const stepOf = (quality: number) => Math.max(0, STEPS.findIndex((q) => q.quality === quality));

/**
 * The scene as a strip: the part that is made is lit, and its two ends drag. Dragging marks the work area,
 * the same one the timeline shows, so the two never disagree. While an end moves, the picture shows that moment.
 */
function PartStrip({ scene, part, onDragged, onLook }: { scene: El; part: { start: number; end: number }; onDragged: () => void; onLook: (t: number | null) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  const length = scene.duration;
  const grab = (e: React.PointerEvent, which: "start" | "end") => {
    if (e.button !== 0) return;
    e.preventDefault();
    const box = strip.current!.getBoundingClientRect();
    let moved = false;
    const move = (ev: PointerEvent) => {
      const t = Math.max(0, Math.min(length, ((ev.clientX - box.left) / box.width) * length));
      const to = which === "start" ? Math.min(part.end - 0.1, t) : Math.max(part.start + 0.1, t);
      moved = true;
      onLook(to);
      dragPreview("set_work_area", { id: scene.id, start: which === "start" ? to : part.start, end: which === "end" ? to : part.end });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onLook(null);
      if (!moved) return dragCancel();
      dragCommit("Change the work area");
      onDragged();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const at = (t: number) => `${(t / length) * 100}%`;
  return (
    <div className="export-strip" ref={strip} data-name="export-strip">
      <span className="export-strip-lit" style={{ left: at(part.start), width: `${((part.end - part.start) / length) * 100}%` }} />
      <span className="export-strip-end" data-name="export-part-start" style={{ left: at(part.start) }} title="Drag to choose where the video starts" onPointerDown={(e) => grab(e, "start")} />
      <span className="export-strip-end" data-name="export-part-end" style={{ left: at(part.end) }} title="Drag to choose where the video ends" onPointerDown={(e) => grab(e, "end")} />
    </div>
  );
}

function SetUpTab({ sceneId, onQueued }: { sceneId?: string; onQueued: () => void }) {
  const doc = useStore((s) => currentDoc(s));
  const projectFile = useStore((s) => s.project.file);
  const projectName = useStore((s) => s.project.name);
  const openScene = useStore((s) => s.clock.scene);
  const scene = doc.elements[sceneId ?? openScene ?? ""];
  const [base, setBase] = useState<ExportChoice>(() => lastChoice(projectFile));
  const [rows, setRows] = useState<FileRow[]>(() => [{ master: !!base.master, quality: base.quality, mute: !!base.mute }]);
  const [problem, setProblem] = useState("");
  const [look, setLook] = useState<number | null>(null);
  const [customFps, setCustomFps] = useState(() => !FPS_CHOICES.includes(base.fps));
  if (!scene?.duration) return <p className="export-empty">Open a scene to export it.</p>;

  const part = base.whole || !scene.workArea ? { start: 0, end: scene.duration } : scene.workArea;
  const span = part.end - part.start;
  const sameSize = base.longSide === 0 || base.longSide >= Math.max(scene.width, scene.height);
  const setRow = (i: number, r: Partial<FileRow>) => setRows(rows.map((x, k) => (k === i ? { ...x, ...r } : x)));

  const go = (now: boolean) => {
    setProblem("");
    const made: number[] = [];
    // Add to queue only plans: nothing starts until the designer presses Start
    const add = () => {
      for (const r of rows) {
        const job = queueVideo(scene.id, { ...base, ...r }, { project: projectName }, doc);
        if (!("n" in job)) {
          setProblem(job.error);
          break;
        }
        made.push(job.n);
      }
    };
    if (now) add();
    else addPlanned(add);
    if (now) putFirst(made);
    if (made.length) {
      rememberExport(projectFile, { ...base, ...rows[0] });
      onQueued();
    }
  };

  return (
    <div className="export-setup">
      <div className="export-left">
        <div className="export-picture">
          <ExportPicture doc={doc} el={scene} at={look ?? part.start} />
        </div>
        <div className="export-caption">
          <span>{scene.name}</span>
          <span>
            {clockText(part.start)} to {clockText(part.end)}
          </span>
        </div>
        <PartStrip scene={scene} part={part} onDragged={() => setBase((b) => ({ ...b, whole: false }))} onLook={setLook} />
        <div className="kind-quiet export-part">
          <button className={base.whole || !scene.workArea ? "on" : ""} data-name="export-whole" onClick={() => setBase({ ...base, whole: true })}>
            Whole scene
          </button>
          <button className={base.whole || !scene.workArea ? "" : "on"} data-name="export-work-area" disabled={!scene.workArea} title={scene.workArea ? undefined : "Drag the ends of the strip to choose a part"} onClick={() => setBase({ ...base, whole: false })}>
            Work area
          </button>
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
          <div className="export-file export-card" key={i} data-name="export-file">
            <div className="export-file-top">
              <select data-name="export-kind" value={r.master ? "master" : "mp4"} onChange={(e) => setRow(i, { master: e.target.value === "master" })}>
                <option value="mp4">MP4</option>
                <option value="master">ProRes MOV</option>
              </select>
              <label className="export-sound">
                Sound
                <button type="button" className={`sw ${r.mute ? "" : "on"}`} role="switch" aria-checked={!r.mute} data-name="export-sound" title={r.mute ? "No sound in this file" : "Sound in this file"} onClick={() => setRow(i, { mute: !r.mute })} />
              </label>
              {rows.length > 1 && (
                <button className="export-x" data-name="export-file-remove" title="Do not make this file" onClick={() => setRows(rows.filter((_, k) => k !== i))}>
                  ✕
                </button>
              )}
            </div>
            {r.master ? (
              <span className="export-full">Full quality, to keep editing or grading elsewhere</span>
            ) : (
              <div className="export-quality">
                <input type="range" min={0} max={STEPS.length - 1} step={1} value={stepOf(r.quality)} data-name="export-quality" onChange={(e) => setRow(i, { quality: STEPS[Number(e.target.value)].quality })} />
                <div>
                  {STEPS.map((q, k) => (
                    <button key={q.name} className={k === stepOf(r.quality) ? "on" : ""} onClick={() => setRow(i, { quality: q.quality })}>
                      {q.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        <button className="export-add" data-name="export-add-file" onClick={() => setRows([...rows, { ...rows[rows.length - 1], master: !rows[rows.length - 1].master }])}>
          + Add a file type
        </button>

        <div className="export-file export-two">
          <label className="export-pick">
            <span className="export-label">Size</span>
            <select data-name="export-size" value={sameSize ? 0 : base.longSide} onChange={(e) => setBase({ ...base, longSide: Number(e.target.value) })}>
              <option value={0}>
                Match scene, {exportSize(scene, 0).join(" × ")}
              </option>
              {SIZES.filter((z) => z.longSide > 0 && z.longSide < Math.max(scene.width, scene.height)).map((z) => (
                <option key={z.longSide} value={z.longSide}>
                  {z.name}, {exportSize(scene, z.longSide).join(" × ")}
                </option>
              ))}
            </select>
          </label>
          <label className="export-pick">
            <span className="export-label">Frame rate</span>
            <span className="export-fps">
              <select
                data-name="export-fps"
                value={customFps ? "custom" : base.fps}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustomFps(v === "custom");
                  if (v !== "custom") setBase({ ...base, fps: Number(v) });
                }}
              >
                {FPS_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n} fps
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
              {customFps && (
                <input
                  data-name="export-fps-custom"
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  defaultValue={base.fps}
                  aria-label="Frames per second"
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (n >= 1 && n <= 120) setBase({ ...base, fps: n });
                  }}
                />
              )}
            </span>
          </label>
        </div>

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
          <button className="pill" data-name="export-add-queue" onClick={() => go(false)} title="Plan it in the line. It starts when you press Start in the Queue">
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
      <div className="skills-page-head">
        <div className="kind-quiet export-tabs">
          <button className={tab === "export" ? "on" : ""} data-name="export-tab-export" onClick={() => setTab("export")}>
            Export
          </button>
          <button className={tab === "queue" ? "on" : ""} data-name="export-tab-queue" onClick={() => setTab("queue")}>
            Queue {busy > 0 && <i className="export-badge">{busy}</i>}
          </button>
        </div>
        <button className="page-close ringed" data-name="close-export-page" title="Back to your work (Esc)" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {tab === "queue" ? <QueueTab /> : video ? <SetUpTab key={sceneId} sceneId={sceneId} onQueued={() => setTab("queue")} /> : <DesignSetUp onQueued={() => setTab("queue")} />}
    </section>
  );
}

import { useState } from "react";
import { useDismiss } from "./useDismiss";
import { exportTargets } from "../project/exporter";
import { designFileName, queueDesign } from "../project/designExport";
import { currentDoc, useStore } from "../state/store";
import { useLayout } from "./layout";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { clearFinished, pauseJob, stopJob } from "../ai/jobs";
import type { Job } from "../ai/jobs";
import { logError } from "../errorLog";
import { useJobs, whereItIs } from "./ExportPage";
import { QUALITIES, exportSize, queueVideo } from "../video/scene";
import { lastChoice, lastDesign, lastMenuTab, rememberMenuTab, shortFolder } from "../video/exportPrefs";
import type { ExportTab } from "../video/exportPrefs";

const openPage = (tab: ExportTab, scene?: string) => window.dispatchEvent(new CustomEvent("duet:export-page", { detail: { tab, scene } }));

/** One job in a few words: who asked, and where it is. */
function glanceLine(j: Job, first: boolean): string {
  const where = j.state === "done" ? "done" : j.state === "stopped" ? "stopped" : j.state === "failed" ? "not made" : whereItIs(j, first);
  const line = j.by ? `for ${j.by}, ${where}` : where;
  return line[0].toUpperCase() + line.slice(1);
}

/** The top-bar Export: two halves, making a file the way the last one was made, and the line of files being made. While the Export page is open it takes you back to your work instead. */
export default function ExportMenu({ pageOpen, onBack }: { pageOpen: boolean; onBack: () => void }) {
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false), ".zoomwrap.exportwrap");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<ExportTab>(lastMenuTab);
  const mode = useLayout((d) => d.mode);
  const jobs = useJobs();
  const busy = jobs.filter((j) => j.state === "running" || j.state === "waiting");
  const pick = (t: ExportTab) => {
    setTab(t);
    rememberMenuTab(t);
  };
  const toggle = () => {
    setNote("");
    setOpen(!open);
  };
  // after an export starts, show the line so the designer sees it begin, without changing which half opens next time
  const started = () => setTab("queue");

  if (pageOpen)
    return (
      <div className="zoomwrap exportwrap">
        <button className="pill" data-name="export-back" onClick={onBack} title="Close the Export page (Esc)">
          Back to work
        </button>
      </div>
    );
  return (
    <div className="zoomwrap exportwrap">
      <button className="pill primary" data-name="export-menu" onClick={toggle}>
        Export
      </button>
      {open && (
        <div className="zmenu export" data-name="export-dropdown">
          <div className="x-tabs">
            <button className={tab === "export" ? "on" : ""} data-name="export-tab-export" onClick={() => pick("export")}>
              Export
            </button>
            <button className={tab === "queue" ? "on" : ""} data-name="export-tab-queue" onClick={() => pick("queue")}>
              Queue{busy.length ? ` · ${busy.length}` : ""}
            </button>
          </div>
          {tab === "export" ? (
            <>
              {mode === "motion" ? <VideoPart setNote={setNote} close={() => setOpen(false)} started={started} /> : <DesignPart photo={mode === "photo"} setNote={setNote} close={() => setOpen(false)} started={started} />}
              {note && <div className="hint2">{note}</div>}
            </>
          ) : (
            <QueuePart jobs={jobs} close={() => setOpen(false)} />
          )}
        </div>
      )}
    </div>
  );
}

/** The line of files, newest work first, in rows that alternate so each one is easy to find. */
function QueuePart({ jobs, close }: { jobs: readonly Job[]; close: () => void }) {
  const firstWaiting = jobs.find((j) => j.state === "waiting");
  const busy = jobs.filter((j) => j.state === "running" || j.state === "waiting");
  const over = jobs.filter((j) => !busy.includes(j)).reverse();
  const rows = [...busy, ...over];
  if (!rows.length) return <div className="hint2">Nothing here yet. Files you export show up in this list.</div>;
  return (
    <>
      <div className="x-rows">
        {rows.map((j) => (
          <div key={j.n} className="x-job" data-name={`export-glance-${j.what}`}>
            <span className="x-kind">{(j.kind ?? "File").split(/[ ,]/)[0]}</span>
            <div className="x-what">
              <b>{j.what}</b>
              <span className="x-where">
                {glanceLine(j, j === firstWaiting)}
                {j.state === "done" && j.file && (
                  <>
                    {" · "}
                    <button className="x-act" data-name="export-glance-show" onClick={() => void revealItemInDir(j.file!).catch((e) => logError("show export", e))}>
                      Show in Finder
                    </button>
                  </>
                )}
              </span>
              {j.state === "running" && (
                <span className="export-bar">
                  <span style={{ width: `${Math.round(j.done * 100)}%` }} />
                </span>
              )}
            </div>
            {j.state === "running" && (
              <button className="x-act" data-name="export-glance-pause" onClick={() => pauseJob(j.n, !j.paused)}>
                {j.paused ? "Resume" : "Pause"}
              </button>
            )}
            <button className="x-remove" data-name="export-glance-remove" title={j.state === "running" ? "Stop making it" : j.state === "waiting" ? "Take it out of the line" : "Take it off the list"} onClick={() => stopJob(j.n)}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="x-foot">
        <button
          className="x-act"
          data-name="export-clear-finished"
          disabled={!over.length}
          onClick={clearFinished}
        >
          Clear finished
        </button>
        <button
          className="x-act"
          data-name="export-open-queue"
          onClick={() => {
            close();
            openPage("queue");
          }}
        >
          Open the whole queue ›
        </button>
      </div>
    </>
  );
}

/** Video: the open scene, made again the way the last one was, or more options on the full page. */
function VideoPart({ setNote, close, started }: { setNote: (s: string) => void; close: () => void; started: () => void }) {
  const doc = useStore((s) => currentDoc(s));
  const sceneId = useStore((s) => s.clock.scene);
  const projectFile = useStore((s) => s.project.file);
  const projectName = useStore((s) => s.project.name);
  const scene = sceneId ? doc.elements[sceneId] : undefined;
  if (!scene?.duration) return <div className="hint2">Open a scene first.</div>;
  const last = lastChoice(projectFile);
  const [w, h] = exportSize(scene, last.longSide);
  const part = last.whole || !scene.workArea ? "whole scene" : "work area";
  const quality = last.master ? "Full quality" : `${QUALITIES.find((q) => q.quality === last.quality)?.name ?? "Own"} quality`;
  return (
    <>
      <span className="x-label">{scene.name}</span>
      <div className="x-what-line" title={`${w} × ${h}, ${part}, into ${last.dir ? shortFolder(last.dir) : "Documents, Duet, Exports"}`}>
        <span className="x-kind">{last.master ? "MOV" : "MP4"}</span>
        <span>
          {quality} · {last.mute ? "no sound" : "with sound"}
        </span>
      </div>
      <button
        className="pill primary wide x-go"
        data-name="export-last"
        title="Make it the way your last video was made"
        onClick={() => {
          const job = queueVideo(scene.id, last, { project: projectName }, doc);
          setNote("n" in job ? "" : job.error);
          if ("n" in job) started();
        }}
      >
        Export
      </button>
      <div className="hint2">Starts now and joins the queue.</div>
      <button
        className="x-row"
        data-name="export-set-up"
        onClick={() => {
          close();
          openPage("export", scene.id);
        }}
      >
        More options <span>›</span>
      </button>
    </>
  );
}

/** Design and Photo: the picked things, or every screen, made the way the last ones were, or more options on the full page. */
function DesignPart({ photo, setNote, close, started }: { photo: boolean; setNote: (s: string) => void; close: () => void; started: () => void }) {
  const selection = useStore((s) => s.selection);
  const doc = useStore((s) => currentDoc(s));
  const projectFile = useStore((s) => s.project.file);
  const projectName = useStore((s) => s.project.name);
  const ids = exportTargets(doc, selection);
  if (!ids.length) return <div className="hint2">Nothing to export yet. Draw a frame first.</div>;
  const files = lastDesign(photo);
  const what = ids.length === 1 ? doc.elements[ids[0]].name : selection.length ? `${ids.length} picked things` : `All ${ids.length} screens`;
  return (
    <>
      <span className="x-label">{what}</span>
      <div className="x-what-line">
        <span>{files.map(designFileName).join(" · ")}</span>
      </div>
      <button
        className="pill primary wide x-go"
        data-name="export-last"
        title="Make them the way your last ones were made"
        onClick={() => {
          const dir = lastChoice(projectFile).dir;
          for (const f of files) {
            const job = queueDesign(ids, f, { project: projectName }, dir, doc);
            if (!("n" in job)) return setNote(job.error);
          }
          setNote("");
          started();
        }}
      >
        Export
      </button>
      <div className="hint2">Starts now and joins the queue.</div>
      <button
        className="x-row"
        data-name="export-set-up"
        onClick={() => {
          close();
          openPage("export");
        }}
      >
        More options <span>›</span>
      </button>
    </>
  );
}

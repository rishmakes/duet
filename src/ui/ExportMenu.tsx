import { useState } from "react";
import { useDismiss } from "./useDismiss";
import Icon from "./Icons";
import { exportTargets } from "../project/exporter";
import { designFileName, queueDesign, standardEnding, takesSize } from "../project/designExport";
import type { DesignFile } from "../project/designExport";
import KindSelect from "./KindSelect";
import { currentDoc, useStore } from "../state/store";
import { useLayout } from "./layout";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { clearFinished, pauseJob, stopJob } from "../ai/jobs";
import type { Job } from "../ai/jobs";
import { logError } from "../errorLog";
import { useJobs, whereItIs } from "./ExportPage";
import { QUALITIES, exportSize, queueVideo } from "../video/scene";
import { lastChoice, lastDesign, lastMenuTab, rememberDesign, rememberMenuTab, shortFolder } from "../video/exportPrefs";
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
  // something to make: an open scene in Video, a screen or a picked thing elsewhere
  const canMake = useStore((s) => {
    const doc = currentDoc(s);
    return mode === "motion" ? !!doc.elements[s.clock.scene ?? ""]?.duration : exportTargets(doc, s.selection).length > 0;
  });
  // nothing to make and nothing in the line: the button rests, greyed out; with only the line, it opens on the line
  const shown: ExportTab = canMake ? tab : "queue";
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
          <Icon name="back" size={14} />
          Back
        </button>
      </div>
    );
  return (
    <div className="zoomwrap exportwrap">
      <button className="pill primary" data-name="export-menu" disabled={!canMake && !jobs.length} title={!canMake && !jobs.length ? (mode === "motion" ? "Open a scene to export it" : "Draw a frame to export it") : undefined} onClick={toggle}>
        Export
      </button>
      {open && (canMake || jobs.length > 0) && (
        <div className="zmenu export" data-name="export-dropdown">
          <div className="x-tabs">
            <button className={shown === "export" ? "on" : ""} data-name="export-tab-export" disabled={!canMake} onClick={() => pick("export")}>
              Export
            </button>
            <button className={shown === "queue" ? "on" : ""} data-name="export-tab-queue" onClick={() => pick("queue")}>
              Queue{busy.length ? ` · ${busy.length}` : ""}
            </button>
          </div>
          {shown === "export" ? (
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

/** Design and Photo: the picked things, or every screen, as one file type the designer picks here, or more options on the full page. */
function DesignPart({ photo, setNote, close, started }: { photo: boolean; setNote: (s: string) => void; close: () => void; started: () => void }) {
  const selection = useStore((s) => s.selection);
  const doc = useStore((s) => currentDoc(s));
  const projectFile = useStore((s) => s.project.file);
  const projectName = useStore((s) => s.project.name);
  // starts as the first file type made last time; the rest stay remembered for the Export panel
  const [file, setFile] = useState<DesignFile>(() => lastDesign(photo)[0]);
  const ids = exportTargets(doc, selection);
  if (!ids.length) return <div className="hint2">Nothing to export yet. Draw a frame first.</div>;
  const what = ids.length === 1 ? doc.elements[ids[0]].name : selection.length ? `${ids.length} picked things` : `All ${ids.length} screens`;
  const change = (c: Partial<DesignFile>) => {
    const next = { ...file, ...c };
    setFile(file.ending === standardEnding(file) ? { ...next, ending: standardEnding(next) } : next);
  };
  return (
    <>
      <span className="x-label">{what}</span>
      <span className="x-label">File type</span>
      <div className="x-kind-pick">
        <KindSelect value={file.kind} photo={photo} onChange={(kind) => change({ kind })} />
      </div>
      {takesSize(file.kind) && (
        <>
          <span className="x-label">Scale</span>
          <div className="kind-quiet x-scale">
            {[1, 2, 3, 4].map((k) => (
              <button key={k} className={file.scale === k ? "on" : ""} data-name={`export-scale-${k}`} onClick={() => change({ scale: k })}>
                {k}x
              </button>
            ))}
          </div>
        </>
      )}
      <button
        className="pill primary wide x-go"
        data-name="export-last"
        title={`Make ${designFileName(file)} files`}
        onClick={() => {
          const last = lastChoice(projectFile).dir;
          const job = queueDesign(ids, file, { project: projectName }, last, doc);
          if (!("n" in job)) return setNote(job.error);
          rememberDesign(projectFile, [file, ...lastDesign(photo).slice(1)], last);
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

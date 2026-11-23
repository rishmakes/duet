import { useState } from "react";
import { useDismiss } from "./useDismiss";
import { exportTargets } from "../project/exporter";
import { designFileName, queueDesign } from "../project/designExport";
import { currentDoc, useStore } from "../state/store";
import { useLayout } from "./layout";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { pauseJob } from "../ai/jobs";
import type { Job } from "../ai/jobs";
import { logError } from "../errorLog";
import { useJobs, whereItIs } from "./ExportPage";
import type { ExportTab } from "./ExportPage";
import { exportSize, fileKindName, queueVideo } from "../video/scene";
import { lastChoice, lastDesign, shortFolder } from "../video/exportPrefs";

const openPage = (tab: ExportTab, scene?: string) => window.dispatchEvent(new CustomEvent("duet:export-page", { detail: { tab, scene } }));

/** One job in a few words: who asked, and where it is. */
function glanceLine(j: Job, first: boolean): string {
  const where = j.state === "done" ? "done" : j.state === "stopped" ? "stopped" : j.state === "failed" ? "not made" : whereItIs(j, first);
  const line = j.by ? `for ${j.by}, ${where}` : where;
  return line[0].toUpperCase() + line.slice(1);
}

/** The top-bar Export: make the open video, or a design's screens, again the way the last ones were made, and see the line at a glance. */
export default function ExportMenu() {
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false), ".zoomwrap.exportwrap");
  const [note, setNote] = useState("");
  const mode = useLayout((d) => d.mode);
  const jobs = useJobs();
  const busy = jobs.filter((j) => j.state === "running" || j.state === "waiting");
  const firstWaiting = busy.find((j) => j.state === "waiting");
  // at a glance: what is being made and waits first, then the newest finished ones, three at most
  const glance = [...busy, ...jobs.filter((j) => !busy.includes(j)).reverse()].slice(0, 3);
  const toggle = () => {
    setNote("");
    setOpen(!open);
  };

  return (
    <div className="zoomwrap exportwrap">
      <button className="pill primary" data-name="export-menu" onClick={toggle}>
        Export
      </button>
      {open && (
        <div className="zmenu export" data-name="export-dropdown">
          {mode === "motion" ? <VideoPart setNote={setNote} close={() => setOpen(false)} /> : <DesignPart photo={mode === "photo"} setNote={setNote} close={() => setOpen(false)} />}
          {note && <div className="hint2">{note}</div>}
          {glance.length > 0 && (
            <div className="x-line">
              <span className="x-label">Queue</span>
              {glance.map((j) => (
                <div key={j.n} className="x-job" data-name={`export-glance-${j.what}`}>
                  <b>
                    {j.what}
                    {j.kind ? ` · ${j.kind}` : ""}
                  </b>
                  {j.state === "running" ? (
                    <button className="x-act" data-name="export-glance-pause" onClick={() => pauseJob(j.n, !j.paused)}>
                      {j.paused ? "Resume" : "Pause"}
                    </button>
                  ) : j.state === "done" && j.file ? (
                    <button className="x-act" data-name="export-glance-show" onClick={() => void revealItemInDir(j.file!).catch((e) => logError("show export", e))}>
                      Show in Finder
                    </button>
                  ) : (
                    <span />
                  )}
                  {j.state === "running" && (
                    <span className="export-bar">
                      <span style={{ width: `${Math.round(j.done * 100)}%` }} />
                    </span>
                  )}
                  <span className="x-where">{glanceLine(j, j === firstWaiting)}</span>
                </div>
              ))}
            </div>
          )}
          {jobs.length > 0 && (
            <button
              className="x-row"
              data-name="export-open-queue"
              onClick={() => {
                setOpen(false);
                openPage("queue");
              }}
            >
              Open the whole queue <span>›</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Video: the open scene, made again with the last settings, or set up on the full page. */
function VideoPart({ setNote, close }: { setNote: (s: string) => void; close: () => void }) {
  const doc = useStore((s) => currentDoc(s));
  const sceneId = useStore((s) => s.clock.scene);
  const projectFile = useStore((s) => s.project.file);
  const projectName = useStore((s) => s.project.name);
  const scene = sceneId ? doc.elements[sceneId] : undefined;
  if (!scene?.duration) return <div className="hint2">Open a scene to export it.</div>;
  const last = lastChoice(projectFile);
  const [w, h] = exportSize(scene, last.longSide);
  const part = last.whole || !scene.workArea ? "whole scene" : "work area";
  return (
    <>
      <span className="x-label">{scene.name}</span>
      <div className="x-start">
        <span title={`${w} × ${h}, ${part}, into ${last.dir ? shortFolder(last.dir) : "Documents, Duet, Exports"}`}>{fileKindName({ ...last, mute: false }).replace(/, /g, " · ")} · {last.mute ? "No sound" : "Sound on"}</span>
        <button
          className="mini primary"
          data-name="export-last"
          title="Make it the way your last video was made"
          onClick={() => {
            const job = queueVideo(scene.id, last, { project: projectName }, doc);
            setNote("n" in job ? "" : job.error);
          }}
        >
          Start
        </button>
      </div>
      <button
        className="x-row"
        data-name="export-set-up"
        onClick={() => {
          close();
          openPage("setup", scene.id);
        }}
      >
        Choose part, files and size <span>›</span>
      </button>
    </>
  );
}

/** Design and Photo: the picked things, or every screen, made the way the last ones were, or set up on the full page. */
function DesignPart({ photo, setNote, close }: { photo: boolean; setNote: (s: string) => void; close: () => void }) {
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
      <div className="x-start">
        <span>{files.map(designFileName).join(" · ")}</span>
        <button
          className="mini primary"
          data-name="export-last"
          title="Make them the way your last ones were made"
          onClick={() => {
            const dir = lastChoice(projectFile).dir;
            for (const f of files) {
              const job = queueDesign(ids, f, { project: projectName }, dir, doc);
              if (!("n" in job)) return setNote(job.error);
            }
            setNote("");
          }}
        >
          Start
        </button>
      </div>
      <button
        className="x-row"
        data-name="export-set-up"
        onClick={() => {
          close();
          openPage("setup");
        }}
      >
        Choose screens, files and sizes <span>›</span>
      </button>
    </>
  );
}

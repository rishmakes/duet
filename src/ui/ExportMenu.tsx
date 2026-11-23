import { useState } from "react";
import { useDismiss } from "./useDismiss";
import { exportDesign, exportTargets } from "../project/exporter";
import type { Format } from "../project/exporter";
import { savePhotoshopFile } from "../project/photoshop";
import { currentDoc, useStore } from "../state/store";
import { useLayout } from "./layout";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { pauseJob } from "../ai/jobs";
import type { Job } from "../ai/jobs";
import { logError } from "../errorLog";
import { useJobs, whereItIs } from "./ExportPage";
import type { ExportTab } from "./ExportPage";
import { exportSize, fileKindName, queueVideo } from "../video/scene";
import { lastChoice, shortFolder } from "../video/exportPrefs";

const openPage = (tab: ExportTab, scene?: string) => window.dispatchEvent(new CustomEvent("duet:export-page", { detail: { tab, scene } }));

/** One job in a few words: who asked, and where it is. */
function glanceLine(j: Job, first: boolean): string {
  const where = j.state === "done" ? "done" : j.state === "stopped" ? "stopped" : j.state === "failed" ? "not made" : whereItIs(j, first);
  const line = j.by ? `for ${j.by}, ${where}` : where;
  return line[0].toUpperCase() + line.slice(1);
}

/** The top-bar Export: make the open video again the way the last one was made, or a design's screens, and see the line at a glance. */
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

/** Design and Photo: screens as PNG, SVG or PDF, and a Photoshop file in Photo. */
function DesignPart({ photo, setNote, close }: { photo: boolean; setNote: (s: string) => void; close: () => void }) {
  const [format, setFormat] = useState<Format | "psd">("png");
  const formats: (Format | "psd")[] = photo ? ["png", "svg", "pdf", "psd"] : ["png", "svg", "pdf"];
  const chosen = !photo && format === "psd" ? "png" : format;
  const [scale, setScale] = useState(2);
  const selection = useStore((s) => s.selection);
  useStore((s) => s.timeline[s.cursor]);
  const doc = currentDoc();
  const ids = exportTargets(doc, selection);
  const what =
    ids.length === 0
      ? "Nothing to export yet."
      : ids.length === 1
        ? `"${doc.elements[ids[0]].name}"`
        : selection.length
          ? `${ids.length} selected things`
          : `All ${ids.length} screens`;
  return (
    <>
      <div className="x-title">Export {what}</div>
      <div className="seg2">
        {formats.map((f) => (
          <span key={f} className={chosen === f ? "on" : ""} onClick={() => setFormat(f)}>
            {f.toUpperCase()}
          </span>
        ))}
      </div>
      {chosen === "png" && (
        <div className="seg2">
          {[1, 2, 3].map((k) => (
            <span key={k} className={scale === k ? "on" : ""} onClick={() => setScale(k)}>
              {k}x
            </span>
          ))}
        </div>
      )}
      <button
        className="mini primary wide"
        disabled={ids.length === 0}
        onClick={async () => {
          const r = chosen === "psd" ? await savePhotoshopFile() : await exportDesign(chosen, scale);
          setNote(r);
          if (r.startsWith("Saved")) close();
        }}
      >
        {ids.length > 1 && chosen !== "pdf" && chosen !== "psd" ? `Export ${ids.length} files` : "Export"}
      </button>
      <div className="hint2">Select something to export just that. With nothing selected, every screen is exported.</div>
    </>
  );
}

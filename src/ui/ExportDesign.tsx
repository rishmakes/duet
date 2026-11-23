import { useState } from "react";
import { putFirst } from "../ai/jobs";
import { countFiles, queueDesign, standardEnding, takesSize } from "../project/designExport";
import type { DesignFile } from "../project/designExport";
import { exportTargets, screensOf } from "../project/exporter";
import { currentDoc, useStore } from "../state/store";
import { lastChoice, lastDesign, rememberDesign, shortFolder } from "../video/exportPrefs";
import { open as openDialog } from "./dialog";
import ExportPicture from "./ExportPicture";
import KindSelect from "./KindSelect";
import { useLayout } from "./layout";

/** Set up for Design and Photo: tick the screens, choose the kinds of file each one becomes, and where they go. */
export default function DesignSetUp({ onQueued }: { onQueued: () => void }) {
  const doc = useStore((s) => currentDoc(s));
  const selection = useStore((s) => s.selection);
  const projectFile = useStore((s) => s.project.file);
  const projectName = useStore((s) => s.project.name);
  const photo = useLayout((d) => d.mode) === "photo";
  // the screens on the page, and anything picked that is not one of them
  const [tiles] = useState(() => [...new Set([...screensOf(doc), ...exportTargets(doc, selection)])]);
  const [ticked, setTicked] = useState(() => new Set(exportTargets(doc, selection)));
  const [files, setFiles] = useState<DesignFile[]>(() => lastDesign(photo));
  const [dir, setDir] = useState(() => lastChoice(projectFile).dir);
  const [problem, setProblem] = useState("");
  const shown = tiles.filter((id) => doc.elements[id]);
  if (!shown.length) return <p className="export-empty">Nothing to export yet. Draw a frame first.</p>;

  const ids = shown.filter((id) => ticked.has(id));
  const made = countFiles(doc, ids, files);
  const tick = (id: string) => {
    const next = new Set(ticked);
    if (!next.delete(id)) next.add(id);
    setTicked(next);
  };
  // the ending follows the kind and size, until the designer writes their own
  const setFile = (i: number, change: Partial<DesignFile>) =>
    setFiles(
      files.map((f, k) => {
        if (k !== i) return f;
        const next = { ...f, ...change };
        return change.ending === undefined && f.ending === standardEnding(f) ? { ...next, ending: standardEnding(next) } : next;
      }),
    );

  const go = (now: boolean) => {
    setProblem("");
    const queued: number[] = [];
    for (const f of files) {
      const job = queueDesign(ids, f, { project: projectName }, dir, doc);
      if (!("n" in job)) {
        setProblem(job.error);
        break;
      }
      queued.push(job.n);
    }
    if (now) putFirst(queued);
    if (queued.length) {
      rememberDesign(projectFile, files, dir);
      onQueued();
    }
  };

  return (
    <div className="export-setup">
      <div className="export-left">
        <div className="export-choose">
          <span className="export-label">Choose what to export</span>
          <span>
            <button data-name="export-tick-all" onClick={() => setTicked(new Set(shown))}>
              Select all
            </button>
            {" · "}
            <button data-name="export-tick-none" onClick={() => setTicked(new Set())}>
              Clear
            </button>
          </span>
        </div>
        <div className="export-screens">
          {shown.map((id) => (
            <button key={id} className={`export-screen ${ticked.has(id) ? "on" : ""}`} data-name={`export-screen-${doc.elements[id].name}`} onClick={() => tick(id)}>
              <span className="export-thumb">
                <ExportPicture doc={doc} el={doc.elements[id]} />
              </span>
              <span className="export-tick" />
              <span className="export-screen-name">{doc.elements[id].name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="export-right">
        <span className="export-label">Save to</span>
        <div className="export-field">
          <span title={dir ?? "Documents, Duet, Exports"}>{dir ? shortFolder(dir) : "Documents, Duet, Exports"}</span>
          <button
            className="pill"
            data-name="export-folder"
            title="Choose the folder this project's files go into. Duet remembers it."
            onClick={async () => {
              const picked = await openDialog({ directory: true, title: "Where this project's files go", defaultPath: dir });
              if (typeof picked === "string" && picked) setDir(picked);
            }}
          >
            Change
          </button>
        </div>

        <span className="export-label">Files you get from each screen</span>
        {files.map((f, i) => (
          <div className="export-file" key={i} data-name="export-file">
            <KindSelect value={f.kind} photo={photo} onChange={(kind) => setFile(i, { kind })} />
            <select data-name="export-scale" value={f.scale} disabled={!takesSize(f.kind)} title={takesSize(f.kind) ? undefined : "This kind keeps its own size"} onChange={(e) => setFile(i, { scale: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((k) => (
                <option key={k} value={k}>
                  {k}x
                </option>
              ))}
            </select>
            <input className="export-ending" data-name="export-ending" value={f.ending} placeholder="Name ending" title="Goes after each screen's name, like Home@2x" onChange={(e) => setFile(i, { ending: e.target.value })} />
            {files.length > 1 && (
              <button className="export-x" data-name="export-file-remove" title="Do not make this file" onClick={() => setFiles(files.filter((_, k) => k !== i))}>
                ×
              </button>
            )}
          </div>
        ))}
        <button className="export-add" data-name="export-add-file" onClick={() => setFiles([...files, { kind: "jpg", scale: 1, ending: "" }])}>
          + Add a file type
        </button>

        <div className="export-tiles">
          <div>
            <b>{ids.length}</b>
            <span>{ids.length === 1 ? "screen" : "screens"}</span>
          </div>
          <div>
            <b>{files.length}</b>
            <span>{files.length === 1 ? "kind" : "kinds"}</span>
          </div>
          <div>
            <b>{made}</b>
            <span>{made === 1 ? "file" : "files"}</span>
          </div>
        </div>
        {problem && <p className="export-problem">{problem}</p>}
        <div className="export-go">
          <button className="pill primary" data-name="export-now" disabled={!made} onClick={() => go(true)} title="Make it next, before anything still waiting">
            Export now
          </button>
          <button className="pill" data-name="export-add-queue" disabled={!made} onClick={() => go(false)} title="Make it after everything already in the line">
            Add to queue
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { addPlanned, putFirst } from "../ai/jobs";
import {
  countFiles,
  queueDesign,
  standardEnding,
  takesSize,
} from "../project/designExport";
import type { DesignFile } from "../project/designExport";
import { pickedTargets, screensByBoard } from "../project/exporter";
import { currentDoc, select, useStore } from "../state/store";
import {
  lastChoice,
  lastDesign,
  rememberDesign,
  shortFolder,
} from "../video/exportPrefs";
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
  // screens on every board, board by board; anything picked on the canvas that is not a screen joins the open board
  const [boards] = useState(() => {
    const all = screensByBoard(doc);
    const extra = pickedTargets(doc, selection).filter(
      (id) => !all.some((b) => b.screens.includes(id)),
    );
    return all.map((b) =>
      b.open ? { ...b, screens: [...b.screens, ...extra] } : b,
    );
  });
  // only what is picked on the canvas starts ticked: nothing picked, nothing ticked
  const [ticked, setTicked] = useState(
    () => new Set(pickedTargets(doc, selection)),
  );
  const openIds = boards.find((b) => b.open)?.screens ?? [];
  // the canvas picks follow the ticks on the open board, and the ticks follow the canvas
  useEffect(() => {
    const picked = new Set(pickedTargets(doc, selection));
    setTicked(
      (t) =>
        new Set([
          ...[...t].filter((id) => !openIds.includes(id)),
          ...openIds.filter((id) => picked.has(id)),
        ]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);
  const tickAll = (next: Set<string>) => {
    setTicked(next);
    const pick = openIds.filter((id) => next.has(id));
    if (pick.join() !== pickedTargets(doc, selection).join()) select(pick);
  };
  const [files, setFiles] = useState<DesignFile[]>(() => lastDesign(photo));
  const [dir, setDir] = useState(() => lastChoice(projectFile).dir);
  const [problem, setProblem] = useState("");
  const shown = boards
    .flatMap((b) => b.screens)
    .filter((id) => doc.elements[id]);
  if (!shown.length)
    return (
      <p className="export-empty">Nothing to export yet. Draw a frame first.</p>
    );

  const ids = shown.filter((id) => ticked.has(id));
  const made = countFiles(doc, ids, files);
  const tick = (id: string) => {
    const next = new Set(ticked);
    if (!next.delete(id)) next.add(id);
    tickAll(next);
  };
  // the ending follows the kind and size, until the designer writes their own
  const setFile = (i: number, change: Partial<DesignFile>) =>
    setFiles(
      files.map((f, k) => {
        if (k !== i) return f;
        const next = { ...f, ...change };
        return change.ending === undefined && f.ending === standardEnding(f)
          ? { ...next, ending: standardEnding(next) }
          : next;
      }),
    );

  const go = (now: boolean) => {
    setProblem("");
    const queued: number[] = [];
    // Add to queue only plans: nothing starts until the designer presses Start
    const add = () => {
      for (const f of files) {
        const job = queueDesign(ids, f, { project: projectName }, dir, doc);
        if (!("n" in job)) {
          setProblem(job.error);
          break;
        }
        queued.push(job.n);
      }
    };
    if (now) add();
    else addPlanned(add);
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
            <button
              data-name="export-tick-all"
              onClick={() => tickAll(new Set(shown))}
            >
              Select all
            </button>
            {" · "}
            <button
              data-name="export-tick-none"
              onClick={() => tickAll(new Set())}
            >
              Clear
            </button>
          </span>
        </div>
        <div className="export-boards">
          {boards.map((b) => {
            const mine = b.screens.filter((id) => doc.elements[id]);
            if (!mine.length) return null;
            return (
              <div className="export-board" key={b.id || "canvas"}>
                {b.name && (
                  <div className="export-choose export-board-head">
                    <span className="export-board-name">{b.name}</span>
                    <button
                      data-name={`export-tick-board-${b.name}`}
                      onClick={() => tickAll(new Set([...ticked, ...mine]))}
                    >
                      Select all
                    </button>
                  </div>
                )}
                <div className="export-screens">
                  {mine.map((id) => (
                    <button
                      key={id}
                      className={`export-screen ${ticked.has(id) ? "on" : ""}`}
                      data-name={`export-screen-${doc.elements[id].name}`}
                      onClick={() => tick(id)}
                    >
                      <span className="export-thumb">
                        <ExportPicture doc={doc} el={doc.elements[id]} />
                      </span>
                      <span className="export-tick" />
                      <span className="export-screen-name">
                        {doc.elements[id].name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {!ids.length && (
          <p className="export-none">
            Tick the screens to export, or select them on the canvas.
          </p>
        )}
      </div>

      <div className="export-right">
        <span className="export-label">Save to</span>
        <div className="export-field">
          <span title={dir ?? "Documents, Duet, Exports"}>
            {dir ? shortFolder(dir) : "Documents, Duet, Exports"}
          </span>
          <button
            className="pill"
            data-name="export-folder"
            title="Choose the folder this project's files go into. Duet remembers it."
            onClick={async () => {
              const picked = await openDialog({
                directory: true,
                title: "Where this project's files go",
                defaultPath: dir,
              });
              if (typeof picked === "string" && picked) setDir(picked);
            }}
          >
            Change
          </button>
        </div>

        <span className="export-label">Files you get from each screen</span>
        {files.map((f, i) => (
          <div className="export-file" key={i} data-name="export-file">
            <KindSelect
              value={f.kind}
              photo={photo}
              onChange={(kind) => setFile(i, { kind })}
            />
            <select
              data-name="export-scale"
              value={f.scale}
              disabled={!takesSize(f.kind)}
              title={
                takesSize(f.kind) ? undefined : "This kind keeps its own size"
              }
              onChange={(e) => setFile(i, { scale: Number(e.target.value) })}
            >
              {[1, 2, 3, 4].map((k) => (
                <option key={k} value={k}>
                  {k}x
                </option>
              ))}
            </select>
            <input
              className="export-ending"
              data-name="export-ending"
              value={f.ending}
              placeholder="Name ending"
              title="Goes after each screen's name, like Home@2x"
              onChange={(e) => setFile(i, { ending: e.target.value })}
            />
            {files.length > 1 && (
              <button
                className="export-x"
                data-name="export-file-remove"
                title="Do not make this file"
                onClick={() => setFiles(files.filter((_, k) => k !== i))}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          className="export-add"
          data-name="export-add-file"
          onClick={() =>
            setFiles([...files, { kind: "jpg", scale: 1, ending: "" }])
          }
        >
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
          <button
            className="pill primary"
            data-name="export-now"
            disabled={!made}
            onClick={() => go(true)}
            title="Make it next, before anything still waiting"
          >
            Export now
          </button>
          <button
            className="pill"
            data-name="export-add-queue"
            disabled={!made}
            onClick={() => go(false)}
            title="Plan it in the line. It starts when you press Start in the Queue"
          >
            Add to queue
          </button>
        </div>
      </div>
    </div>
  );
}

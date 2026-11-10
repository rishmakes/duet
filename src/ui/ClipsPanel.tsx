import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import Icon from "./Icons";
import { lengthText } from "../canvas/render";
import { droppedPaths } from "../canvas/CanvasView";
import { newId } from "../commands";
import type { MediaItem } from "../document/types";
import { currentDoc, dispatch, getState, useStore } from "../state/store";
import { keepDropped } from "../video/scene";
import { CLIP_DRAG, lengthOf, mediaFrom, mediaKind, pickFolderIntoClips, pickIntoClips, placeFromClips } from "../video/media";
import { useDismiss } from "./useDismiss";

type Show = "all" | "video" | "sound" | "image";
const SHOWS: [Show, string][] = [
  ["all", "All"],
  ["video", "Video"],
  ["sound", "Sound"],
  ["image", "Pictures"],
];
const ICON: Record<MediaItem["kind"], "film" | "sound" | "image" | "folder"> = { video: "film", sound: "sound", image: "image", folder: "folder" };

/** The type an item being moved inside Clips carries. */
const MOVE = "application/x-duet-clips-move";

/** What shows: each thing that matches, and every folder on the way to one. Folders and order are never changed. */
export function shown(media: MediaItem[], show: Show, find: string): Set<string> {
  const words = find.trim().toLowerCase();
  const byId = new Map(media.map((m) => [m.id, m]));
  const out = new Set<string>();
  const filtering = show !== "all" || !!words;
  for (const m of media) {
    if (m.kind === "folder") {
      if (!filtering) out.add(m.id);
      else if (words && show === "all" && m.name.toLowerCase().includes(words)) out.add(m.id);
      continue;
    }
    if (show !== "all" && m.kind !== show) continue;
    if (words && !m.name.toLowerCase().includes(words)) continue;
    out.add(m.id);
    for (let f = m.folderId; f && !out.has(f); f = byId.get(f)?.folderId) out.add(f);
  }
  return out;
}

/** Clips, sounds and pictures for a video, in folders you keep. Drag one onto the timeline to use it. */
export default function ClipsPanel() {
  useStore((s) => s.timeline[s.cursor]);
  const media = currentDoc().media ?? [];
  const [show, setShow] = useState<Show>("all");
  const [find, setFind] = useState("");
  const [shut, setShut] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, redraw] = useState(0);
  useDismiss(!!menu, () => setMenu(null), ".ctx");

  const visible = useMemo(() => shown(media, show, find), [media, show, find]);
  const filtering = show !== "all" || !!find.trim();

  const bring = async (e: React.DragEvent, into?: string) => {
    const files = Array.from(e.dataTransfer.files);
    let paths = droppedPaths(e.dataTransfer);
    // the system did not say where the files are: keep a copy beside the projects, as the timeline does
    if (!paths.length && files.length) paths = await keepDropped(files.filter((f) => mediaKind(f.name)));
    const items = await mediaFrom(paths, into);
    if (items.length) dispatch("add_media", { items });
    else if (paths.length || files.length) setNote("Clips holds video, sound and pictures. Those files are none of these.");
  };

  const onDropHere = (e: React.DragEvent, into: string | null) => {
    setOver(null);
    const moving = e.dataTransfer.getData(MOVE);
    if (moving) {
      e.preventDefault();
      e.stopPropagation();
      dispatch("move_media", { ids: [moving], folderId: into });
      if (into) setShut((s) => (s.delete(into), new Set(s)));
      return;
    }
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    void bring(e, into ?? undefined);
  };

  const canTake = (e: React.DragEvent) => Array.from(e.dataTransfer.types).some((t) => t === "Files" || t === MOVE);

  // at the playhead of the scene that is open
  const toTimeline = async (m: MediaItem) => {
    const { scene, t } = getState().clock;
    if (!scene || !m.src) return setNote("Open a video first, then add clips to its timeline.");
    const problems = await placeFromClips(scene, { src: m.src, kind: m.kind, name: m.name }, t);
    if (problems.length) setNote(problems.join(" "));
  };

  const rename = (id: string, value: string) => {
    setRenaming(null);
    dispatch("rename_media", { id, name: value });
  };

  const rows: React.ReactNode[] = [];
  const walk = (folderId: string | undefined, depth: number) => {
    const here = media.filter((m) => m.folderId === folderId && visible.has(m.id));
    // folders first, then the rest, each in the order they came in
    for (const m of [...here.filter((x) => x.kind === "folder"), ...here.filter((x) => x.kind !== "folder")]) {
      const folder = m.kind === "folder";
      const open = folder && (filtering || !shut.has(m.id));
      const length = lengthOf(m, () => redraw((n) => n + 1));
      rows.push(
        <div
          key={m.id}
          className={`row clip-row ${folder ? "clip-folder" : ""} ${over === m.id ? "drop-inside" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={renaming !== m.id}
          data-name="clip"
          title={folder ? undefined : `${m.name}. Drag onto the timeline to use it.`}
          onDragStart={(e) => {
            e.dataTransfer.setData(MOVE, m.id);
            if (!folder && m.src) e.dataTransfer.setData(CLIP_DRAG, JSON.stringify({ src: m.src, kind: m.kind, name: m.name }));
            e.dataTransfer.effectAllowed = "copyMove";
          }}
          onDragOver={(e) => {
            if (!folder || !canTake(e)) return;
            e.preventDefault();
            e.stopPropagation();
            setOver(m.id);
          }}
          onDragLeave={() => setOver((o) => (o === m.id ? null : o))}
          onDrop={(e) => folder && onDropHere(e, m.id)}
          onClick={() => folder && setShut((s) => (s.has(m.id) ? s.delete(m.id) : s.add(m.id), new Set(s)))}
          onDoubleClick={() => setRenaming(m.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ id: m.id, x: e.clientX, y: e.clientY });
          }}
        >
          {folder ? <span className={`fold-arrow ${open ? "" : "folded"}`}><Icon name="arrow" size={10} /></span> : <span className="fold-arrow-gap" />}
          <Icon name={ICON[m.kind]} size={14} className="ico" />
          {renaming === m.id ? (
            <input
              className="rename"
              autoFocus
              defaultValue={m.name}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => rename(m.id, e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <span className="name">{m.name}</span>
          )}
          {length !== null && <span className="clip-length">{lengthText(length)}</span>}
        </div>,
      );
      if (open) walk(m.id, depth + 1);
    }
  };
  walk(undefined, 0);

  const picked = menu ? media.find((m) => m.id === menu.id) : undefined;

  return (
    <div
      className={`clips ${over === "top" ? "drop-top" : ""}`}
      data-name="clips-panel"
      onDragOver={(e) => {
        if (!canTake(e)) return;
        e.preventDefault();
        setOver("top");
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
      }}
      onDrop={(e) => onDropHere(e, null)}
    >
      {media.length === 0 ? (
        <div className="clips-welcome">
          <Icon name="film" size={26} />
          <button className="clips-add-big" data-name="clips-add" onClick={() => void pickIntoClips()}>
            Add clips, music, pictures
          </button>
          <div className="clips-welcome-sub">or drop files or a whole folder here</div>
          <button className="linkish" onClick={() => void pickFolderIntoClips()}>
            Add a folder
          </button>
        </div>
      ) : (
        <>
          <div className="clips-tools">
            <div className="clips-shows">
              {SHOWS.map(([k, label]) => (
                <button key={k} className={show === k ? "on" : ""} onClick={() => setShow(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="clips-actions">
              <label className="clips-find">
                <Icon name="search" size={12} />
                <input value={find} placeholder="Find clips" onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && setFind(""))} />
              </label>
              <button className="clips-btn" title="Add clips, music, pictures" onClick={() => void pickIntoClips()}>
                <Icon name="plus" size={13} />
              </button>
              <button className="clips-btn" title="New folder" onClick={() => {
                const id = newId("folder");
                dispatch("new_folder", { id });
                setRenaming(id);
              }}>
                <Icon name="folder" size={13} />
              </button>
            </div>
          </div>
          <div className="clips-list">
            {rows.length ? rows : <div className="empty pad">Nothing here matches.</div>}
          </div>
          <div className="tip-line">Drag a clip onto the timeline. Drop files or folders here; folders keep their insides.</div>
        </>
      )}
      {note && (
        <div className="clips-note" onClick={() => setNote(null)}>
          {note}
        </div>
      )}
      {menu &&
        picked &&
        createPortal(
          <div className="ctx" style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 200) }}>
            <div className="ctx-item" onClick={() => (setMenu(null), setRenaming(picked.id))}>
              <span>Rename</span>
            </div>
            {picked.src && (
              <div className="ctx-item" onClick={() => (setMenu(null), void toTimeline(picked))}>
                <span>Add to the timeline</span>
              </div>
            )}
            {picked.kind === "folder" && (
              <div className="ctx-item" onClick={() => (setMenu(null), void pickIntoClips(picked.id))}>
                <span>Add clips into this folder</span>
              </div>
            )}
            {picked.src && (
              <div className="ctx-item" onClick={() => (setMenu(null), void revealItemInDir(picked.src!))}>
                <span>Show in Finder</span>
              </div>
            )}
            {picked.folderId && (
              <div className="ctx-item" onClick={() => (setMenu(null), dispatch("move_media", { ids: [picked.id], folderId: null }))}>
                <span>Move to the top</span>
              </div>
            )}
            <div className="ctx-line" />
            <div className="ctx-item danger" onClick={() => (setMenu(null), dispatch("remove_media", { ids: [picked.id] }))}>
              <span>{picked.kind === "folder" ? "Remove folder from Clips" : "Remove from Clips"}</span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

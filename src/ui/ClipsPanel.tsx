import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import Icon from "./Icons";
import type { IconName } from "./Icons";
import { lengthText } from "../canvas/render";
import { droppedPaths } from "../canvas/CanvasView";
import { newId } from "../commands";
import type { Doc, MediaItem } from "../document/types";
import { currentDoc, dispatch, getState, select, useStore } from "../state/store";
import { openScene as openOnTimeline } from "../video/play";
import { keepDropped } from "../video/scene";
import { CLIP_DRAG, lengthOf, mediaFrom, mediaKind, pickFolderIntoClips, pickIntoClips, placeFromClips } from "../video/media";
import { useDismiss } from "./useDismiss";

/** One thing in Media: a scene of this video, a clip, a sound, a picture, or a folder. */
export type Entry = Omit<MediaItem, "kind"> & { kind: MediaItem["kind"] | "scene" };

type Show = "all" | "scene" | "video" | "sound" | "image";
const SHOWS: [Show, string, IconName][] = [
  ["all", "Everything", "list"],
  ["scene", "Scenes", "scene"],
  ["video", "Video", "film"],
  ["sound", "Sound", "sound"],
  ["image", "Pictures", "image"],
];
const ICON: Record<Entry["kind"], IconName> = { scene: "scene", video: "film", sound: "sound", image: "image", folder: "folder" };

/** The type an item being moved inside Media carries. */
const MOVE = "application/x-duet-clips-move";

const USED = "used:";
const SCENE = "scene:";
const isUsed = (m: Entry) => m.id.startsWith(USED);
const isScene = (m: Entry) => m.kind === "scene";
/** Kept in the file, so it can be renamed, moved and removed here. */
const isKept = (m: Entry) => !isUsed(m) && !isScene(m);

/** Clips and sounds the video already plays that are not in Media yet, one row per file, named as on the timeline. */
export function usedIn(doc: Doc, kept: MediaItem[]): MediaItem[] {
  const listed = new Set(kept.map((m) => m.src).filter(Boolean));
  const out = new Map<string, MediaItem>();
  for (const el of Object.values(doc.elements)) {
    if ((el.type !== "video" && el.type !== "sound") || !el.src || listed.has(el.src) || out.has(el.src)) continue;
    out.set(el.src, { id: USED + el.src, name: el.name || el.src.split(/[\\/]/).pop() || "Clip", kind: el.type, src: el.src });
  }
  return [...out.values()];
}

/** Everything Media lists: the scenes of this video first, then what is kept, then what the video plays. */
export function entriesOf(doc: Doc): Entry[] {
  const kept = doc.media ?? [];
  const scenes: Entry[] = doc.rootIds
    .map((id) => doc.elements[id])
    .filter((e) => e && e.type === "frame" && e.duration > 0)
    .map((e) => ({ id: SCENE + e.id, name: e.name, kind: "scene", length: e.duration }));
  return [...scenes, ...kept, ...usedIn(doc, kept)];
}

/** What shows: each thing that matches, and every folder on the way to one. Folders and order are never changed. */
export function shown(media: Entry[], show: Show, find: string): Set<string> {
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

type View = "list" | "grid";
const VIEW_KEY = "duet.media.view";
const savedView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
};

/**
 * Media: the scenes of this video, and the clips, sounds and pictures it is made from, in folders you keep.
 * As a list, folders open in place. As a grid, double-click a folder to go inside it, and Back to come out.
 */
export default function ClipsPanel() {
  useStore((s) => s.timeline[s.cursor]);
  const openScene = useStore((s) => s.clock.scene);
  const doc = currentDoc();
  const media = useMemo(() => entriesOf(doc), [doc]);
  const [show, setShow] = useState<Show>("all");
  const [find, setFind] = useState("");
  const [view, setViewState] = useState<View>(savedView);
  const [at, setAt] = useState<string | null>(null);
  const [shut, setShut] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  // what is picked in Media: its own selection, apart from the canvas
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [over, setOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [showMenu, setShowMenu] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, redraw] = useState(0);
  useDismiss(!!menu, () => setMenu(null), ".ctx");
  useDismiss(!!showMenu, () => setShowMenu(null), ".ctx");

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // only a convenience
    }
  };

  const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const visible = useMemo(() => shown(media, show, find), [media, show, find]);
  const filtering = show !== "all" || !!find.trim();
  // the folder the grid is inside; gone if the folder was removed
  const inside = at && byId.get(at)?.kind === "folder" ? at : null;

  const bring = async (e: React.DragEvent, into?: string) => {
    const files = Array.from(e.dataTransfer.files);
    let paths = droppedPaths(e.dataTransfer);
    // the system did not say where the files are: keep a copy beside the projects, as the timeline does
    if (!paths.length && files.length) paths = await keepDropped(files.filter((f) => mediaKind(f.name)));
    const items = await mediaFrom(paths, into);
    if (items.length) dispatch("add_media", { items });
    else if (paths.length || files.length) setNote("Media holds video, sound and pictures. Those files are none of these.");
  };

  const onDropHere = (e: React.DragEvent, into: string | null) => {
    setOver(null);
    const moving = e.dataTransfer.getData(MOVE);
    if (moving) {
      e.preventDefault();
      e.stopPropagation();
      const m = byId.get(moving);
      if (!m || isScene(m)) return;
      if (isUsed(m)) dispatch("add_media", { items: [{ ...(m as MediaItem), id: newId("clip"), ...(into ? { folderId: into } : {}) }] });
      else dispatch("move_media", { ids: [moving], folderId: into });
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
  const toTimeline = async (m: Entry) => {
    const { scene, t } = getState().clock;
    if (!scene || !m.src || isScene(m)) return setNote("Open a scene first, then add clips to its timeline.");
    const problems = await placeFromClips(scene, { src: m.src, kind: m.kind as MediaItem["kind"], name: m.name }, t);
    if (problems.length) setNote(problems.join(" "));
  };

  const rename = (m: Entry, value: string) => {
    setRenaming(null);
    if (isScene(m)) {
      const name = value.trim();
      if (name) dispatch("set_props", { ids: [m.id.slice(SCENE.length)], props: { name }, label: "Rename scene" });
    } else dispatch("rename_media", { id: m.id, name: value });
  };

  const openSceneOf = (m: Entry) => {
    const id = m.id.slice(SCENE.length);
    select([id]);
    openOnTimeline(id);
  };

  /** What a click, a double-click and a drag do on one thing. */
  const handlers = (m: Entry) => {
    const folder = m.kind === "folder";
    return {
      draggable: renaming !== m.id && !isScene(m),
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData(MOVE, m.id);
        if (!folder && m.src) e.dataTransfer.setData(CLIP_DRAG, JSON.stringify({ src: m.src, kind: m.kind, name: m.name }));
        e.dataTransfer.effectAllowed = "copyMove";
      },
      onDragOver: (e: React.DragEvent) => {
        if (!folder || !canTake(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(m.id);
      },
      onDragLeave: () => setOver((o) => (o === m.id ? null : o)),
      onDrop: (e: React.DragEvent) => folder && onDropHere(e, m.id),
      onClick: (e: React.MouseEvent) => {
        setPicked((p) => (e.metaKey || e.ctrlKey ? (p.has(m.id) ? (p.delete(m.id), new Set(p)) : new Set(p.add(m.id))) : new Set([m.id])));
        if (e.metaKey || e.ctrlKey) return;
        if (isScene(m)) openSceneOf(m);
        else if (folder && view === "list") setShut((s) => (s.has(m.id) ? s.delete(m.id) : s.add(m.id), new Set(s)));
      },
      onDoubleClick: () => {
        if (folder && view === "grid") return (setAt(m.id), setFind(""));
        if (!isUsed(m)) setRenaming(m.id);
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        setPicked((p) => (p.has(m.id) ? p : new Set([m.id])));
        setMenu({ id: m.id, x: e.clientX, y: e.clientY });
      },
      title: isScene(m) ? `${m.name}. Click to open it on the timeline.` : folder ? (view === "grid" ? `${m.name}. Double-click to go inside.` : undefined) : `${m.name}. Drag onto the timeline to use it.`,
    };
  };

  const nameOrBox = (m: Entry) =>
    renaming === m.id ? (
      <input
        className="rename"
        autoFocus
        defaultValue={m.name}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => rename(m, e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setRenaming(null);
        }}
      />
    ) : (
      <span className="name">{m.name}</span>
    );

  const lengthOfEntry = (m: Entry) => (isScene(m) ? (m.length ?? null) : lengthOf(m as MediaItem, () => redraw((n) => n + 1)));
  const order = (list: Entry[]) => [...list.filter((x) => x.kind === "scene"), ...list.filter((x) => x.kind === "folder"), ...list.filter((x) => x.kind !== "folder" && x.kind !== "scene")];

  // the list: folders open in place
  const rows: React.ReactNode[] = [];
  const walk = (folderId: string | undefined, depth: number) => {
    const here = order(media.filter((m) => m.folderId === folderId && visible.has(m.id)));
    for (const m of here) {
      const folder = m.kind === "folder";
      const open = folder && (filtering || !shut.has(m.id));
      const length = lengthOfEntry(m);
      rows.push(
        <div
          key={m.id}
          className={`row clip-row ${folder ? "clip-folder" : ""} ${over === m.id ? "drop-inside" : ""} ${picked.has(m.id) ? "sel" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          data-name={isScene(m) ? "media-scene" : "clip"}
          {...handlers(m)}
        >
          {folder ? (
            <span className={`fold-arrow ${open ? "" : "folded"}`}>
              <Icon name="arrow" size={10} />
            </span>
          ) : (
            <span className="fold-arrow-gap" />
          )}
          <Icon name={ICON[m.kind]} size={14} className="ico" />
          {nameOrBox(m)}
          {isScene(m) && m.id === SCENE + openScene && <i className="media-open" title="Open on the timeline">▶</i>}
          {length !== null && <span className="clip-length">{lengthText(length)}</span>}
        </div>,
      );
      if (open) walk(m.id, depth + 1);
    }
  };

  // the grid: one folder at a time; while finding, everything that matches
  const tiles = filtering ? order(media.filter((m) => m.kind !== "folder" && visible.has(m.id))) : order(media.filter((m) => (m.folderId ?? null) === inside));
  const trail: Entry[] = [];
  for (let f = inside ? byId.get(inside) : undefined; f; f = f.folderId ? byId.get(f.folderId) : undefined) trail.unshift(f);

  if (view === "list") walk(undefined, 0);
  const nothing = view === "list" ? !rows.length : !tiles.length;

  const removable = [...picked].filter((id) => byId.get(id) && isKept(byId.get(id)!));
  const menuOn = menu ? byId.get(menu.id) : undefined;
  const current = SHOWS.find(([k]) => k === show)!;

  return (
    <div
      className={`clips ${over === "top" ? "drop-top" : ""}`}
      data-name="media-panel"
      onDragOver={(e) => {
        if (!canTake(e)) return;
        e.preventDefault();
        setOver("top");
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
      }}
      onDrop={(e) => onDropHere(e, view === "grid" ? inside : null)}
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
          <div className="clips-actions">
            <label className="clips-find">
              <Icon name="search" size={12} />
              <input value={find} placeholder="Find" onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && setFind(""))} />
            </label>
            <button
              className={`clips-btn media-show ${show !== "all" ? "on" : ""}`}
              data-name="media-show"
              title={`Showing: ${current[1]}. Click to choose what to show.`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setShowMenu({ x: r.left, y: r.bottom + 4 });
              }}
            >
              {show === "all" ? "All" : current[1]}
              <Icon name="arrow" size={9} className="media-show-caret" />
            </button>
            <button className="clips-btn" title="Add clips, music, pictures" onClick={() => void pickIntoClips(view === "grid" ? (inside ?? undefined) : undefined)}>
              <Icon name="plus" size={13} />
            </button>
            <button
              className="clips-btn"
              title="New folder"
              onClick={() => {
                const id = newId("folder");
                dispatch("new_folder", { id, folderId: view === "grid" ? inside : null });
                setRenaming(id);
              }}
            >
              <Icon name="folder" size={13} />
            </button>
          </div>
          {view === "grid" && inside && !filtering && (
            <div
              className={`row clip-row media-back ${over === "back" ? "drop-inside" : ""}`}
              data-name="media-back"
              title="Back out of this folder. Drop here to move a thing out."
              onClick={() => setAt(byId.get(inside)?.folderId ?? null)}
              onDragOver={(e) => {
                if (!canTake(e)) return;
                e.preventDefault();
                e.stopPropagation();
                setOver("back");
              }}
              onDragLeave={() => setOver((o) => (o === "back" ? null : o))}
              onDrop={(e) => onDropHere(e, byId.get(inside)?.folderId ?? null)}
            >
              <span className="media-back-arrow">
                <Icon name="arrow" size={10} />
              </span>
              <span className="name">
                <span className="media-trail" onClick={(e) => (e.stopPropagation(), setAt(null))}>
                  Media
                </span>
                {trail.map((f) => (
                  <span key={f.id}>
                    {" / "}
                    <span className="media-trail" onClick={(e) => (e.stopPropagation(), setAt(f.id))}>
                      {f.name}
                    </span>
                  </span>
                ))}
              </span>
            </div>
          )}
          {view === "list" ? (
            <div className="clips-list">{rows}</div>
          ) : (
            <div className="media-grid">
              {tiles.map((m) => {
                const length = lengthOfEntry(m);
                return (
                  <div
                    key={m.id}
                    className={`media-tile ${over === m.id ? "drop-inside" : ""} ${picked.has(m.id) ? "sel" : ""}`}
                    data-name={isScene(m) ? "media-scene" : "clip"}
                    {...handlers(m)}
                  >
                    <div className={`media-tile-face kind-${m.kind}`}>
                      <Icon name={ICON[m.kind]} size={22} />
                      {isScene(m) && m.id === SCENE + openScene && <i className="media-open media-tile-open" title="Open on the timeline">▶</i>}
                      {length !== null && <span className="media-tile-length">{lengthText(length)}</span>}
                    </div>
                    {nameOrBox(m)}
                  </div>
                );
              })}
            </div>
          )}
          {nothing && <div className="empty pad">{filtering ? "Nothing here matches." : "This folder is empty. Drop clips here."}</div>}
          <div className="media-foot">
            <button
              className="clips-btn"
              data-name="media-remove"
              disabled={!removable.length}
              title={removable.length ? `Remove ${removable.length === 1 ? "it" : `these ${removable.length}`} from Media. The files stay on your computer.` : picked.size ? "Scenes and clips on the timeline stay in Media while the video uses them" : "Pick something to remove it from Media"}
              onClick={() => (dispatch("remove_media", { ids: removable }), setPicked(new Set()))}
            >
              <Icon name="trash" size={13} />
            </button>
            <span className="media-foot-tip">Drag a clip onto the timeline</span>
            <div className="media-views">
              <button className={`clips-btn ${view === "list" ? "on" : ""}`} data-name="media-view-list" title="List: folders open in place" onClick={() => setView("list")}>
                <Icon name="list" size={13} />
              </button>
              <button className={`clips-btn ${view === "grid" ? "on" : ""}`} data-name="media-view-grid" title="Grid: double-click a folder to go inside" onClick={() => setView("grid")}>
                <Icon name="grid" size={13} />
              </button>
            </div>
          </div>
        </>
      )}
      {note && (
        <div className="clips-note" onClick={() => setNote(null)}>
          {note}
        </div>
      )}
      {showMenu &&
        createPortal(
          <div className="ctx" style={{ left: Math.min(showMenu.x, window.innerWidth - 200), top: showMenu.y }}>
            {SHOWS.map(([k, label, icon]) => (
              <div key={k} className={`ctx-item ${show === k ? "on" : ""}`} onClick={() => (setShowMenu(null), setShow(k))}>
                <Icon name={icon} size={13} />
                <span>{label}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
      {menu &&
        menuOn &&
        createPortal(
          <div className="ctx" style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 200) }}>
            {isScene(menuOn) && (
              <div className="ctx-item" onClick={() => (setMenu(null), openSceneOf(menuOn))}>
                <span>Open on the timeline</span>
              </div>
            )}
            {!isUsed(menuOn) && (
              <div className="ctx-item" onClick={() => (setMenu(null), setRenaming(menuOn.id))}>
                <span>Rename</span>
              </div>
            )}
            {menuOn.src && (
              <div className="ctx-item" onClick={() => (setMenu(null), void toTimeline(menuOn))}>
                <span>Add to the timeline</span>
              </div>
            )}
            {menuOn.kind === "folder" && (
              <div className="ctx-item" onClick={() => (setMenu(null), void pickIntoClips(menuOn.id))}>
                <span>Add clips into this folder</span>
              </div>
            )}
            {menuOn.src && (
              <div className="ctx-item" onClick={() => (setMenu(null), void revealItemInDir(menuOn.src!))}>
                <span>Show in Finder</span>
              </div>
            )}
            {menuOn.folderId && isKept(menuOn) && (
              <div className="ctx-item" onClick={() => (setMenu(null), dispatch("move_media", { ids: [menuOn.id], folderId: null }))}>
                <span>Move to the top</span>
              </div>
            )}
            {isKept(menuOn) && (
              <>
                <div className="ctx-line" />
                <div className="ctx-item danger" onClick={() => (setMenu(null), dispatch("remove_media", { ids: [menuOn.id] }))}>
                  <span>{menuOn.kind === "folder" ? "Remove folder from Media" : "Remove from Media"}</span>
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

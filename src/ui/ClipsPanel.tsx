import { useEffect, useMemo, useRef, useState } from "react";
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

/** A copy with the id switched in or out. Never changes the set it is given. */
const toggled = (set: Set<string>, id: string) => (set.has(id) ? without(set, id) : new Set([...set, id]));
const without = (set: Set<string>, id: string) => new Set([...set].filter((x) => x !== id));

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
  // picking and ticking are one: two or more picked shows a box on every thing
  const ticked = picked;
  const setTicked = setPicked;
  const ticking = picked.size > 1;
  // where Shift-click picks from
  const anchor = useRef<string | null>(null);
  // the order things show in, for Shift-click and Cmd-A
  const order_ = useRef<string[]>([]);
  // the box answers the press itself: a row can be dragged, and a click that moves a hair would start a drag instead
  const tickPress = (id: string) => ({
    onPointerDown: (e: React.PointerEvent) => (e.stopPropagation(), e.preventDefault(), tick(id)),
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onMouseUp: (e: React.MouseEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
  });
  const tick = (id: string) => ((anchor.current = id), setTicked((t) => toggled(t, id)));
  const pickRange = (id: string) => {
    const list = order_.current;
    const a = list.indexOf(anchor.current ?? id);
    const b = list.indexOf(id);
    if (a < 0 || b < 0) return setPicked(new Set([id]));
    setPicked(new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1)));
  };
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
      if (into) setShut((s) => without(s, into));
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
      // picking happens on the press, so a press that moves a hair and turns into a drag still picks
      onMouseDown: (e: React.MouseEvent) => {
        if (e.button !== 0 || renaming === m.id) return;
        if (e.shiftKey) return pickRange(m.id);
        if (e.metaKey || e.ctrlKey) return tick(m.id);
        // pressing one of several picked keeps them all, so they can be dragged together; the click narrows it
        if (picked.has(m.id)) return;
        anchor.current = m.id;
        setPicked(new Set([m.id]));
      },
      // the release narrows to this one, so a hand that drifts a little still lands the click
      onMouseUp: (e: React.MouseEvent) => {
        if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || renaming === m.id) return;
        anchor.current = m.id;
        setPicked(new Set([m.id]));
      },
      onClick: (e: React.MouseEvent) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) return;
        if (isScene(m)) openSceneOf(m);
        else if (folder && view === "list") setShut((s) => toggled(s, m.id));
      },
      onDoubleClick: () => {
        if (folder && view === "grid") return (setAt(m.id), setFind(""));
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
      <span className="name" onDoubleClick={() => !isScene(m) && !isUsed(m) && setRenaming(m.id)}>
        {m.name}
      </span>
    );

  const lengthOfEntry = (m: Entry) => (isScene(m) ? (m.length ?? null) : lengthOf(m as MediaItem, () => redraw((n) => n + 1)));
  const order = (list: Entry[]) => [...list.filter((x) => x.kind === "scene"), ...list.filter((x) => x.kind === "folder"), ...list.filter((x) => x.kind !== "folder" && x.kind !== "scene")];

  // the list: folders open in place
  const rows: React.ReactNode[] = [];
  const walk = (folderId: string | undefined, depth: number) => {
    const here = order(media.filter((m) => m.folderId === folderId && visible.has(m.id)));
    for (const m of here) {
      listOrder.push(m.id);
      const folder = m.kind === "folder";
      const open = folder && (filtering || !shut.has(m.id));
      const length = lengthOfEntry(m);
      rows.push(
        <div
          key={m.id}
          className={`row clip-row ${ticking ? "ticking" : ""} ${folder ? "clip-folder" : ""} ${over === m.id ? "drop-inside" : ""} ${picked.has(m.id) ? "sel" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          data-name={isScene(m) ? "media-scene" : "clip"}
          {...handlers(m)}
        >
          <span className="media-tick" draggable={false} title="Tick to pick several" {...tickPress(m.id)}>
            <span className={`media-check ${ticked.has(m.id) ? "on" : ""}`} />
          </span>
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
          <span className="media-end">
            {length !== null && <span className="clip-length">{lengthText(length)}</span>}
            {!ticking && isKept(m) && (
              <button className="media-row-bin" title={folder ? "Remove this folder and what is in it from Media. The files stay on your computer." : "Remove from Media. The file stays on your computer."} onClick={(e) => (e.stopPropagation(), dispatch("remove_media", { ids: [m.id] }))}>
                <Icon name="trash" size={12} />
              </button>
            )}
          </span>
        </div>,
      );
      if (open) walk(m.id, depth + 1);
    }
  };

  // the grid: one folder at a time; while finding, everything that matches
  const tiles = filtering ? order(media.filter((m) => m.kind !== "folder" && visible.has(m.id))) : order(media.filter((m) => (m.folderId ?? null) === inside));
  const trail: Entry[] = [];
  for (let f = inside ? byId.get(inside) : undefined; f; f = f.folderId ? byId.get(f.folderId) : undefined) trail.unshift(f);

  const listOrder: string[] = [];
  if (view === "list") walk(undefined, 0);
  const nothing = view === "list" ? !rows.length : !tiles.length;
  order_.current = view === "list" ? listOrder : tiles.map((m) => m.id);

  // Cmd-A picks everything in Media, and Escape lets go, once you have clicked in Media; a click anywhere else hands the keys back
  const panel = useRef<HTMLDivElement | null>(null);
  const active = useRef(false);
  const menuOpen = useRef(false);
  menuOpen.current = !!menu || !!showMenu;
  useEffect(() => {
    const down = (e: PointerEvent) => (active.current = !!panel.current?.contains(e.target as Node));
    const key = (e: KeyboardEvent) => {
      if (!active.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPicked(new Set(order_.current));
      } else if (e.key === "Escape") {
        // an open menu closes first; the picks stay
        if (menuOpen.current) return;
        e.stopImmediatePropagation();
        setPicked(new Set());
      }
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => (window.removeEventListener("pointerdown", down, true), window.removeEventListener("keydown", key, true));
  }, []);

  const menuOn = menu ? byId.get(menu.id) : undefined;
  const removable = [...ticked].filter((id) => byId.get(id) && isKept(byId.get(id)!));
  const current = SHOWS.find(([k]) => k === show)!;

  return (
    <div
      ref={panel}
      className={`clips ${ticking ? "ticking-all" : ""} ${over === "top" ? "drop-top" : ""}`}
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
            <div className="clips-list" onMouseDown={(e) => e.target === e.currentTarget && setPicked(new Set())}>
              {rows}
            </div>
          ) : (
            <div className="media-grid" onMouseDown={(e) => e.target === e.currentTarget && setPicked(new Set())}>
              {tiles.map((m) => {
                const length = lengthOfEntry(m);
                return (
                  <div
                    key={m.id}
                    className={`media-tile ${ticking ? "ticking" : ""} ${over === m.id ? "drop-inside" : ""} ${picked.has(m.id) ? "sel" : ""}`}
                    data-name={isScene(m) ? "media-scene" : "clip"}
                    {...handlers(m)}
                  >
                    <div className={`media-tile-face kind-${m.kind}`}>
                      <span className={`media-check media-tile-check ${ticked.has(m.id) ? "on" : ""}`} draggable={false} title="Tick to pick several" {...tickPress(m.id)} />
                      {!ticking && isKept(m) && (
                        <button className="media-row-bin media-tile-bin" title="Remove from Media. The file stays on your computer." onClick={(e) => (e.stopPropagation(), dispatch("remove_media", { ids: [m.id] }))}>
                          <Icon name="trash" size={12} />
                        </button>
                      )}
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
          {!nothing && <div className="media-hint" onMouseDown={() => setPicked(new Set())}>Drag a clip onto the timeline to use it.</div>}
          {nothing && <div className="empty pad">{filtering ? "Nothing here matches." : "This folder is empty. Drop clips here."}</div>}
          <div className="media-foot">
            {ticking && (
              <>
                <button
                  className="media-remove"
                  data-name="media-remove"
                  disabled={!removable.length}
                  title={removable.length ? "Remove from Media. The files stay on your computer." : "Scenes, and clips the timeline plays, stay in Media while the video uses them"}
                  onClick={() => (dispatch("remove_media", { ids: removable }), setTicked(new Set()))}
                >
                  <Icon name="trash" size={12} />
                  Remove {removable.length || ""}
                </button>
                <button className="media-select" title="Let go of everything (Esc)" onClick={() => setTicked(new Set())}>
                  Cancel
                </button>
              </>
            )}
            <span className="media-foot-gap" />
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

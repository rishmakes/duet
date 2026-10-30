import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MARKER_COLORS, runCommand } from "../commands";
import { KEY_GROUPS, fileTimeAt, frameTimeAt, spanOf } from "../document/time";
import { MOVING, playsFile } from "../document/types";
import type { Doc, El, Marker, Moving, Track } from "../document/types";
import { currentDoc, dispatch, dragBase, dragCancel, dragCommit, dragPreview, dragPreviewDoc, getState, select, useStore } from "../state/store";
import { clipLength } from "../video/clips";
import { cutNow } from "../video/edit";
import { peaksOf } from "../video/faces";
import { SILENCE_DEFAULT, findSilences } from "../video/silence";
import type { SilenceChoice } from "../video/silence";
import { openScene, pause, seek, shuttle, togglePlay } from "../video/play";
import Icon from "./Icons";
import ClipFace from "./ClipFace";
import { setKeyFocus } from "./keyFocus";
import { QUALITIES, SIZES, addMedia, clipKind, defaultChoice, dropClips, exportScene, exportSize, keepDropped, stopExport } from "../video/scene";
import { droppedPaths } from "../canvas/CanvasView";
import type { ExportChoice } from "../video/scene";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { TIME_MIN_H, getLayout, isColorOpen, setLayout, useLayout } from "./layout";
import { useDismiss } from "./useDismiss";
import { trackKind, trackRows } from "../document/tracks";
import type { TrackKind, TrackRow } from "../document/tracks";
import { getPickedTrack, pickTrack, usePickedTrack } from "./pickedTrack";

/** Time under the canvas: a row for each thing in a frame that plays, when it shows, and where the clock is. */

const SHORTEST = 0.1;
/** The height inside a video or sound bar in Edit, where its frames or sound are drawn. */
const FOOTAGE_BAR = 38;
/** A video bar is taller: its frames on top and its sound in a strip of its own underneath. */
const VIDEO_BAR = 70;

/** A keyframe picked in the timeline: Delete takes it away. Without props it is every change at that moment. */
interface Picked {
  id: string;
  t: number;
  props?: Moving[];
}

const clockText = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

/** The frame on the page that holds this thing. */
function pageFrame(doc: Doc, id: string | undefined): El | null {
  let el = id ? doc.elements[id] : undefined;
  while (el?.parentId) el = doc.elements[el.parentId];
  return el?.type === "frame" ? el : null;
}

/** The last rows of a scene's tracks. While a video plays the clock moves on every frame but the design stays the same, so the rows are not worked out again each time. */
let rowsMade: { doc: Doc; id: string; out: Record<TrackKind, TrackRow[]> } | null = null;
function rowsOf(doc: Doc, frame: El): Record<TrackKind, TrackRow[]> {
  if (rowsMade?.doc !== doc || rowsMade.id !== frame.id)
    rowsMade = { doc, id: frame.id, out: { titles: trackRows(doc, frame, "titles"), clips: trackRows(doc, frame, "clips"), sound: trackRows(doc, frame, "sound") } };
  return rowsMade.out;
}

export default function TimeStrip() {
  const mode = useLayout((d) => d.mode);
  const colorOpen = useLayout(isColorOpen);
  const look = useLayout((d) => d.timeLook ?? "layers");
  const keysOpen = useLayout((d) => d.keysOpen);
  const gradeEvery = useLayout((d) => d.gradeEvery);
  const timeH = useLayout((d) => d.timeH ?? 170);
  // the names beside the rows can be pulled wider, to read long file names
  const NAMES = useLayout((d) => d.namesW ?? 150);
  const [growing, setGrowing] = useState<number | null>(null);
  const doc = useStore((s) => currentDoc(s));
  const selection = useStore((s) => s.selection);
  const clock = useStore((s) => s.clock);
  const lanes = useRef<HTMLDivElement>(null);
  // the rows as last drawn, for the keys that pick the clip before or after
  const rowsRef = useRef<{ items: El[]; track?: { kind: TrackKind; index: number } }[]>([]);
  const [wide, setWide] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [making, setMaking] = useState<number | null>(null);
  const [note, setNote] = useState("");
  // how the video is made, chosen before it is made, and where the last one went
  const [choosing, setChoosing] = useState(false);
  // Cut silences: open while its settings show, with each file's loudness once it has been read
  const [hushing, setHushing] = useState(false);
  const [hush, setHush] = useState<SilenceChoice>(SILENCE_DEFAULT);
  const [hushPeaks, setHushPeaks] = useState<Map<string, Uint8Array> | null>(null);
  const [choice, setChoice] = useState<ExportChoice>(defaultChoice);
  const [made, setMade] = useState<string | null>(null);
  // set while a keyframe mark is being dragged, so letting go is not taken for a click
  const draggedMark = useRef(false);
  const [snap, setSnap] = useState<number | null>(null);
  // the stretch tool (R): pulling the end of a clip changes its speed instead of cutting it shorter
  const [stretchTool, setStretchTool] = useState(false);
  const stretching = useRef(false);
  const [menu, setMenu] = useState<{ x: number; y: number; el: El; mark?: Picked } | null>(null);
  useDismiss(!!menu, () => setMenu(null), ".ctx");
  // the track picked by its name, which paste puts clips on, and the menu of a track's name
  const trackPick = usePickedTrack();
  const [trackMenu, setTrackMenu] = useState<{ x: number; y: number; kind: TrackKind; index: number; name: string; key: string } | null>(null);
  useDismiss(!!trackMenu, () => setTrackMenu(null), ".ctx");
  const [markerMenu, setMarkerMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  useDismiss(!!markerMenu, () => setMarkerMenu(null), ".ctx");
  useDismiss(hushing, () => setHushing(false), ".hush-anchor");
  const [markerEdit, setMarkerEdit] = useState<string | null>(null);
  const draggedMarker = useRef(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  // the box being drawn over empty room in Motion to pick keyframes, in screen pixels
  const [sweepBox, setSweepBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const anchor = useRef<string | null>(null);
  const pulled = useRef(false);
  const [rowDrop, setRowDrop] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // a layer opened or folded by its arrow; Option U opens or folds them all again
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  useEffect(() => setFolds({}), [keysOpen]);
  useEffect(() => {
    if (picked.some((p) => !selection.includes(p.id))) setPicked((ps) => ps.filter((p) => selection.includes(p.id)));
  }, [picked, selection]);

  // Delete takes away the keyframe picked, and not the thing it belongs to
  useEffect(() => {
    if (!picked.length) return;
    const key = (e: KeyboardEvent) => {
      const on = document.activeElement as HTMLElement | null;
      if (on && (on.tagName === "INPUT" || on.tagName === "TEXTAREA" || on.tagName === "SELECT" || on.isContentEditable)) return;
      if (e.key === "Escape") return setPicked([]);
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (picked.length === 1) dispatch("remove_key", { ids: [picked[0].id], props: picked[0].props, t: picked[0].t });
      else {
        // all of them in one step, so one undo brings them back
        let next = dragBase();
        for (const p of picked) next = runCommand(next, "remove_key", { ids: [p.id], props: p.props, t: p.t });
        dragPreviewDoc(next);
        dragCommit(`Remove ${picked.length} keyframes`);
      }
      setPicked([]);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [picked]);

  // what is selected decides which frame is open, and with nothing selected the open one stays
  const chosen = pageFrame(doc, selection[0]);
  const openOne = clock.scene ? (doc.elements[clock.scene] ?? null) : null;
  // Motion always has a scene open, and its timeline always shows: picking something outside one, even a frame that is not a scene yet, keeps the scene you were in
  const firstScene = () => doc.rootIds.map((id) => doc.elements[id]).find((e) => e?.type === "frame" && e.duration > 0) ?? null;
  const frame =
    mode === "motion" && !(chosen && chosen.duration > 0)
      ? (openOne && openOne.duration > 0 ? openOne : firstScene()) ?? chosen
      : chosen ?? openOne;
  const plays = !!frame && frame.duration > 0;
  const sceneId = mode === "motion" && plays ? frame.id : null;
  useEffect(() => openScene(sceneId), [sceneId]);

  // Cut silences listens to the picked clips, or to every clip with sound when none is picked
  const heard = sceneId && doc.elements[sceneId] ? doc.elements[sceneId].childIds.map((id) => doc.elements[id]).filter((el) => el && playsFile(el)) : [];
  const pickedHeard = heard.filter((el) => selection.includes(el.id)).map((el) => el.id);
  const hushIds = pickedHeard.length ? pickedHeard : undefined;
  const heardKey = heard.map((el) => el.src).join("|");
  useEffect(() => {
    if (!hushing) return;
    let live = true;
    setHushPeaks(null);
    const srcs = [...new Set(heardKey.split("|").filter(Boolean))];
    void Promise.all(srcs.map((src) => peaksOf(src).then((p) => [src, p] as const))).then((all) => {
      if (live) setHushPeaks(new Map(all.filter((a): a is readonly [string, Uint8Array] => !!a[1]).map(([k, v]) => [k, v])));
    });
    return () => {
      live = false;
    };
  }, [hushing, heardKey]);
  const silences = hushing && hushPeaks && sceneId ? findSilences(doc, sceneId, hushPeaks, hush, hushIds) : [];

  // the room the timeline has is the panel's own width, measured on the panel so it never depends on what is inside it
  useEffect(() => {
    const el = lanes.current?.parentElement;
    if (!el) return;
    const measure = () => setWide(Math.max(100, el.clientWidth - NAMES - 16));
    measure();
    const see = new ResizeObserver(measure);
    see.observe(el);
    return () => see.disconnect();
  }, [plays, mode, sceneId, NAMES]);

  // Cmd or Ctrl with the left and right arrows step the playhead one frame at a time; with Shift, ten frames.
  // With up and down, the clip before or after is picked: the one beside the picked clip on its row, or with
  // nothing picked, the one that ends at the playhead or starts there. So S, Cmd up and D cut away what was before.
  useEffect(() => {
    if (!sceneId) return;
    const key = (e: KeyboardEvent) => {
      const on = document.activeElement as HTMLElement | null;
      if (!(e.metaKey || e.ctrlKey) || e.altKey || (on && (on.tagName === "INPUT" || on.tagName === "TEXTAREA" || on.tagName === "SELECT" || on.isContentEditable))) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const s = getState();
        const d = currentDoc(s);
        const scene = d.elements[sceneId];
        if (!scene) return;
        const back = e.key === "ArrowUp";
        const rows = rowsRef.current.map((r) => r.items.map((el) => ({ id: el.id, ...spanOf(el, scene) })).sort((a, b) => a.start - b.start));
        const picked = s.selection.find((id) => rows.some((r) => r.some((c) => c.id === id)));
        let next: string | undefined;
        if (picked) {
          const row = rows.find((r) => r.some((c) => c.id === picked))!;
          next = row[row.findIndex((c) => c.id === picked) + (back ? -1 : 1)]?.id;
        } else {
          const t = s.clock.t;
          const all = rows.flat();
          const near = back ? all.filter((c) => c.end <= t + 0.01).sort((a, b) => b.end - a.end) : all.filter((c) => c.start >= t - 0.01).sort((a, b) => a.start - b.start);
          next = near[0]?.id;
        }
        if (next) select([next]);
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const FPS = 30;
      const frames = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1);
      pause();
      seek((Math.round(getState().clock.t * FPS) + frames) / FPS);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [sceneId]);

  // In Layers, as in After Effects: [ slides the picked layers so they start at the playhead, ] so they end there.
  // With Option, the layer is trimmed instead: its start or end is brought to the playhead and the rest stays where it is.
  useEffect(() => {
    if (!sceneId || look !== "layers") return;
    const key = (e: KeyboardEvent) => {
      const on = document.activeElement as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.shiftKey || (on && (on.tagName === "INPUT" || on.tagName === "TEXTAREA" || on.tagName === "SELECT" || on.isContentEditable))) return;
      if (e.code !== "BracketLeft" && e.code !== "BracketRight") return;
      const s = getState();
      // as it looks at the playhead, so no animated layer is read as edited there
      const d = dragBase();
      const scene = d.elements[sceneId];
      const ids = s.selection.filter((id) => d.elements[id] && d.elements[id].parentId === sceneId);
      if (!scene || !ids.length) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const t = Math.round(s.clock.t * 1000) / 1000;
      const left = e.code === "BracketLeft";
      let next = d;
      for (const id of ids) {
        const el = next.elements[id];
        const span = spanOf(el, scene);
        const len = span.end - span.start;
        if (e.altKey) {
          if (t <= span.start + 0.01 || t >= span.end - 0.01) continue;
          next = left
            ? runCommand(next, "set_timing", { ids: [id], start: t, keepKeys: true, ...(playsFile(el) ? { clipFrom: fileTimeAt(el, span.start, t) } : {}) })
            : runCommand(next, "set_timing", { ids: [id], end: t });
        } else {
          const start = Math.max(0, Math.min(scene.duration - 0.1, left ? t : t - len));
          next = runCommand(next, "set_timing", { ids: [id], start, end: Math.min(scene.duration, start + len) });
        }
      }
      if (next === d) return;
      dragPreviewDoc(next);
      dragCommit(e.altKey ? (left ? "Trim the start to the playhead" : "Trim the end to the playhead") : left ? "Start at the playhead" : "End at the playhead");
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [sceneId, look]);

  // the tilde key, or the one beside 1, makes the timeline fill the window and brings it back; Escape too
  useEffect(() => {
    if (mode !== "motion") return;
    const key = (e: KeyboardEvent) => {
      const on = document.activeElement as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (on && (on.tagName === "INPUT" || on.tagName === "TEXTAREA" || on.tagName === "SELECT" || on.isContentEditable))) return;
      if (e.key === "`" || e.key === "~") {
        e.preventDefault();
        e.stopPropagation();
        setLayout({ timeMax: !getLayout().timeMax });
      } else if (e.key === "Escape" && getLayout().timeMax) {
        setLayout({ timeMax: false });
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [mode]);

  // cutting keys, the ones video editors already have in their hands
  useEffect(() => {
    if (!sceneId) return;
    let kDown = false;
    const key = (e: KeyboardEvent) => {
      const on = document.activeElement as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (on && (on.tagName === "INPUT" || on.tagName === "TEXTAREA" || on.tagName === "SELECT" || on.isContentEditable))) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        e.stopPropagation();
        setZoom((z) => z * 1.5);
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        e.stopPropagation();
        setZoom((z) => Math.max(1, z / 1.5));
        return;
      }
      if (e.key === "\\") {
        e.preventDefault();
        e.stopPropagation();
        setZoom(1);
        if (lanes.current) lanes.current.scrollLeft = 0;
        return;
      }
      const k = e.key.toLowerCase();
      // M puts a marker at the playhead, as in other video editors. On a marker, it takes it away.
      if (k === "m" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const now = getState().clock.t;
        const here = (currentDoc().elements[sceneId]?.markers ?? []).find((m) => Math.abs(m.t - now) < 0.05);
        if (here) dispatch("remove_marker", { id: sceneId, markerId: here.id });
        else dispatch("add_marker", { id: sceneId, t: now });
        return;
      }
      // B begins the work area at the playhead and N ends it there, as in After Effects
      if ((k === "b" || k === "n") && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const now = Math.round(getState().clock.t * 1000) / 1000;
        dispatch("set_work_area", k === "b" ? { id: sceneId, start: now } : { id: sceneId, end: now });
        return;
      }
      // R is the stretch tool, as in Premiere; R or Esc puts it down. Only in Edit: elsewhere R is the rectangle.
      if (k === "r" && !e.shiftKey && getLayout().timeLook === "cut") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        stretching.current = !stretching.current;
        setStretchTool(stretching.current);
        return;
      }
      if (k === "escape" && stretching.current) {
        stretching.current = false;
        setStretchTool(false);
      }
      if (!["s", "c", "d", "j", "k", "l", " "].includes(k)) return;
      e.preventDefault();
      e.stopPropagation();
      // the canvas listens on the window too, and must not take the spacebar for the hand tool
      e.stopImmediatePropagation();
      // the spacebar plays and stops, as in every video editor. The hand tool still moves the canvas.
      if (k === " ") return e.repeat ? undefined : togglePlay();
      // J, K and L as in Premiere: back, stop, forward; with K held, J and L step one frame
      if (k === "k") {
        kDown = true;
        return pause();
      }
      if (k === "j" || k === "l") {
        if (kDown) {
          pause();
          return seek((Math.round(getState().clock.t * 30) + (k === "j" ? -1 : 1)) / 30);
        }
        return shuttle(k === "j" ? -1 : 1);
      }
      // S or C splits at the playhead, as the razor does in other video editors; D takes the clip away and closes the gap
      cutNow(k === "d" ? "remove" : "split");
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k") kDown = false;
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [sceneId]);

  const length = frame?.duration ?? 0;
  const laneWidth = wide * zoom;
  const pps = length > 0 ? laneWidth / length : 1;

  useEffect(() => {
    if (!clock.playing || zoom <= 1) return;
    const el = lanes.current;
    if (!el) return;
    const headX = NAMES + clock.t * pps;
    const leftVisible = el.scrollLeft + NAMES;
    const rightVisible = el.scrollLeft + el.clientWidth;
    if (headX > rightVisible - 20) {
      el.scrollLeft = headX - el.clientWidth + 40;
    } else if (headX < leftVisible) {
      el.scrollLeft = Math.max(0, headX - NAMES);
    }
  }, [clock.playing, clock.t, pps, zoom]);

  useEffect(() => {
    if (zoom === 1 && lanes.current) {
      lanes.current.scrollLeft = 0;
    }
  }, [zoom]);

  // Pinch (or Cmd and scroll) zooms the time under the fingers; two fingers scroll along it.
  // The time under the pointer is kept in place while the length of the lanes changes.
  const hold = useRef<{ t: number; at: number } | null>(null);
  const zoomNow = useRef({ zoom, pps });
  zoomNow.current = { zoom, pps };
  const zoomTo = (clientX: number, factor: number) => {
    const box = lanes.current;
    if (!box) return;
    const { zoom: z, pps: per } = zoomNow.current;
    const next = Math.max(1, Math.min(200, z * factor));
    if (next === z) return;
    const left = box.getBoundingClientRect().left;
    hold.current = { t: (clientX - left + box.scrollLeft - NAMES) / per, at: clientX - left };
    zoomNow.current = { zoom: next, pps: (per * next) / z };
    setZoom(next);
  };
  useLayoutEffect(() => {
    const h = hold.current;
    hold.current = null;
    if (h && lanes.current && zoom > 1) lanes.current.scrollLeft = Math.max(0, h.t * zoomNow.current.pps + NAMES - h.at);
  }, [zoom]);
  useEffect(() => {
    const box = lanes.current;
    if (!box) return;
    // a pinch on a Mac trackpad arrives as gesture events; while one runs, the wheel's zoom is ignored
    let pinching: { zoom: number } | null = null;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (pinching) return;
        zoomTo(e.clientX, Math.exp(-Math.max(-40, Math.min(40, e.deltaY)) * 0.01));
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        box.scrollLeft += e.deltaX;
      }
    };
    type Pinch = Event & { scale: number; clientX: number };
    const onStart = (e: Event) => {
      e.preventDefault();
      pinching = { zoom: zoomNow.current.zoom };
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      if (!pinching) return;
      const g = e as Pinch;
      zoomTo(g.clientX, (pinching.zoom * g.scale) / zoomNow.current.zoom);
    };
    const onEnd = (e: Event) => {
      e.preventDefault();
      pinching = null;
    };
    // the middle button drags the timeline along, as it drags the canvas
    const onMiddle = (e: PointerEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const x = e.clientX;
      const y = e.clientY;
      const left = box.scrollLeft;
      const top = box.scrollTop;
      box.setPointerCapture(e.pointerId);
      box.style.cursor = "grabbing";
      const move = (ev: PointerEvent) => {
        box.scrollLeft = left - (ev.clientX - x);
        box.scrollTop = top - (ev.clientY - y);
      };
      const up = () => {
        box.releasePointerCapture(e.pointerId);
        box.style.cursor = "";
        box.removeEventListener("pointermove", move);
        box.removeEventListener("pointerup", up);
      };
      box.addEventListener("pointermove", move);
      box.addEventListener("pointerup", up);
    };
    box.addEventListener("pointerdown", onMiddle);
    box.addEventListener("wheel", onWheel, { passive: false });
    box.addEventListener("gesturestart", onStart);
    box.addEventListener("gesturechange", onChange);
    box.addEventListener("gestureend", onEnd);
    return () => {
      box.removeEventListener("pointerdown", onMiddle);
      box.removeEventListener("wheel", onWheel);
      box.removeEventListener("gesturestart", onStart);
      box.removeEventListener("gesturechange", onChange);
      box.removeEventListener("gestureend", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, plays]);

  if (mode !== "motion") return null;
  if (!plays) {
    // the timeline is what Motion is, so it is always there: blank, with a way to make a scene
    const target = frame && !(frame.duration > 0) && selection.length === 1 && selection[0] === frame.id ? frame : doc.rootIds.map((id) => doc.elements[id]).find((e) => e?.type === "frame") ?? null;
    return (
      <section className="time still" data-name="time-strip" onContextMenu={(e) => e.preventDefault()}>
        <div className="time-bar">
          <button className="pill" disabled>
            Play
          </button>
          <span className="time-now">0:00.0 / 0:00.0</span>
        </div>
        <div className="time-blank" style={{ height: timeH }}>
          <span className="time-quiet">{target ? `${target.name} is not a scene yet. A scene is a frame that plays.` : "Draw a frame, then make it a scene to animate it."}</span>
          {target && (
            <button className="pill" data-name="make-video" title="Give this frame a length, so what is in it can appear, move and leave" onClick={() => dispatch("set_duration", { id: target.id, seconds: 10 })}>
              {`Make ${target.name} a scene`}
            </button>
          )}
        </div>
      </section>
    );
  }

  const things = frame.childIds.map((id) => doc.elements[id]).filter(Boolean).reverse();
  interface DisplayRow {
    key: string;
    name: string;
    items: El[];
    onClick?: (e: React.MouseEvent) => void;
    /** A row of clips or sounds in Edit: a track, by its place among the tracks of its kind. */
    track?: { kind: TrackKind; index: number };
    /** The saved track behind a row in Edit, for its switches. */
    saved?: Track | null;
  }

  const trackRow = (kind: TrackKind) =>
    rowsOf(doc, frame)[kind].map((r) => ({
      key: `${kind}-${r.index}`,
      name: r.name,
      items: r.items,
      track: { kind, index: r.index },
      saved: r.track,
      onClick: () => {
        // picking a track picks its scene too, so what is pasted next goes into it
        const on = trackPick?.frameId === frame.id && trackPick.kind === kind && trackPick.index === r.index;
        pickTrack(on ? null : { frameId: frame.id, kind, index: r.index });
        select([frame.id]);
      },
    }));

  const displayRows: DisplayRow[] =
    look === "layers"
      ? things.map((el) => ({
          key: el.id,
          name: el.name,
          items: [el],
          onClick: (e: React.MouseEvent) => pick(e, el.id),
        }))
      : [
          ...trackRow("titles"),
          ...trackRow("clips"),
          ...trackRow("sound"),
        ];
  rowsRef.current = displayRows;
  const allHidden = (row: DisplayRow) => (row.track ? !!row.saved?.hidden : row.items.length > 0 && row.items.every((el) => el.hidden));
  // in Edit the switches belong to the track; in Motion they belong to each layer
  const quiet = (row: DisplayRow) => (row.track ? !!row.saved?.silent : row.items.filter(playsFile).every((el) => el.volume <= 0));
  const trackPicked = (row: DisplayRow) => !!row.track && trackPick?.frameId === frame.id && trackPick.kind === row.track.kind && trackPick.index === row.track.index;


  const scrub = (e: React.PointerEvent) => {
    // only the left button moves the playhead: the middle one drags the timeline and the right one opens the menu
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    // the playhead snaps to clip edges and markers; Cmd or Ctrl turns that off
    const targets = getSnapTargets().filter((t) => t !== getState().clock.t);
    const at = (clientX: number, noSnap: boolean) => {
      let t = (clientX - box.left) / pps;
      let snapTime: number | null = null;
      if (!noSnap) {
        const s = findSnap(t, targets);
        if (s) {
          t = s.time;
          snapTime = s.time;
        }
      }
      setSnap(snapTime);
      seek(t);
    };
    pause();
    at(e.clientX, e.metaKey || e.ctrlKey);
    const move = (ev: PointerEvent) => at(ev.clientX, ev.metaKey || ev.ctrlKey);
    const up = () => {
      setSnap(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const getSnapTargets = (excludeId?: string) => {
    if (!frame) return [];
    const ts = [0, length, clock.t, ...(frame.markers ?? []).map((m) => m.t)];
    for (const id of frame.childIds) {
      if (id === excludeId) continue;
      const other = doc.elements[id];
      if (other) {
        const s = spanOf(other, frame);
        ts.push(s.start, s.end);
      }
    }
    return [...new Set(ts)];
  };

  const findSnap = (cand: number, targets: number[]) => {
    let bestTarget: number | null = null;
    let bestDist = Infinity;
    for (const t of targets) {
      const dist = Math.abs((cand - t) * pps);
      if (dist <= 8 && dist < bestDist) {
        bestDist = dist;
        bestTarget = t;
      }
    }
    return bestTarget !== null ? { time: bestTarget, dist: bestDist } : null;
  };

  /** The moment under the pointer, on the timeline. */
  const dropTime = (clientX: number) => {
    const box = lanes.current?.getBoundingClientRect();
    if (!box || !lanes.current) return 0;
    return Math.max(0, Math.min(length, (clientX - box.left + lanes.current.scrollLeft - NAMES) / pps));
  };

  /** Ctrl or Cmd adds one or takes it away; Shift picks every row from the last one clicked to this one. */
  const pick = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, id: string) => {
    const now = getState().selection;
    if (e.shiftKey && anchor.current) {
      const order = displayRows.flatMap((r) => r.items.map((el) => el.id));
      const a = order.indexOf(anchor.current);
      const b = order.indexOf(id);
      if (a >= 0 && b >= 0) return select(order.slice(Math.min(a, b), Math.max(a, b) + 1));
    }
    anchor.current = id;
    if (e.shiftKey || e.metaKey || e.ctrlKey) select(now.includes(id) ? now.filter((i) => i !== id) : [...now, id]);
    else select([id]);
  };

  /** Pull a layer's name up or down to put it in front of or behind the others. Picked layers go together. */
  const pullRow = (e: React.PointerEvent, el: El) => {
    if (e.button !== 0 || look !== "layers") return;
    const startY = e.clientY;
    const rows = () => Array.from(lanes.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []);
    const slot = (y: number) => {
      const all = rows();
      const i = all.findIndex((r) => {
        const b = r.getBoundingClientRect();
        return y < b.top + b.height / 2;
      });
      return i < 0 ? all.length : i;
    };
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - startY) < 4) return;
      moved = true;
      setRowDrop(slot(ev.clientY));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setRowDrop(null);
      if (!moved) return;
      // the click that ends a pull does not pick
      pulled.current = true;
      setTimeout(() => (pulled.current = false), 0);
      const now = getState().selection;
      const ids = now.includes(el.id) ? things.filter((t) => now.includes(t.id)).map((t) => t.id).reverse() : [el.id];
      const at = slot(ev.clientY);
      // the list shows the front first, so a place in it counts from the back in the frame
      const index = at >= things.length ? 0 : frame.childIds.indexOf(things[at].id) + 1;
      dispatch("reparent_elements", { ids, parentId: frame.id, index, label: ids.length > 1 ? `Reorder ${ids.length} layers` : "Reorder layer" });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const drag = (e: React.PointerEvent, el: El, part: "all" | "start" | "end") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Shift or Cmd adds a clip to the picked ones, or takes it away
    if (part === "all" && (e.shiftKey || e.metaKey || e.ctrlKey)) return pick(e, el.id);
    const now = getState().selection;
    // a picked clip moves with every other picked clip in this scene
    const group = part === "all" && now.includes(el.id) ? now.filter((id) => doc.elements[id]?.parentId === frame.id) : [el.id];
    if (!now.includes(el.id) || part !== "all") select([el.id]);
    const others = group.filter((id) => id !== el.id).map((id) => ({ id, span: spanOf(doc.elements[id], frame) }));
    const from = e.clientX;
    const fromY = e.clientY;
    const span = spanOf(el, frame);
    const long = span.end - span.start;
    // a clip cannot show more than its file holds
    const file = playsFile(el) ? clipLength(el.src) : 0;
    const targets = getSnapTargets(el.id);
    // holding Option on a clip's end, or having the stretch tool, changes its speed instead of cutting it
    const stretch = part !== "all" && playsFile(el) && (e.altKey || stretching.current);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const by = (ev.clientX - from) / pps;
      if (Math.abs(ev.clientX - from) < 2 && (part !== "all" || Math.abs(ev.clientY - fromY) < 6) && !moved) return;
      moved = true;
      const noSnap = ev.metaKey || ev.ctrlKey;
      if (part === "all") {
        const rawStart = span.start + by;
        const rawEnd = rawStart + long;
        let start = rawStart;
        let snapTime: number | null = null;
        if (!noSnap) {
          const snapS = findSnap(rawStart, targets);
          const snapE = findSnap(rawEnd, targets);
          if (snapS && snapE) {
            if (snapS.dist <= snapE.dist) {
              start = snapS.time;
              snapTime = snapS.time;
            } else {
              start = snapE.time - long;
              snapTime = snapE.time;
            }
          } else if (snapS) {
            start = snapS.time;
            snapTime = snapS.time;
          } else if (snapE) {
            start = snapE.time - long;
            snapTime = snapE.time;
          }
        }
        // none of the clips moving together goes before the start
        start = Math.max(0, start, ...others.map((o) => span.start - o.span.start));
        if (snapTime !== null) {
          const edgeHolding = Math.abs((start - snapTime) * pps) <= 0.5 || Math.abs((start + long - snapTime) * pps) <= 0.5;
          if (!edgeHolding) snapTime = null;
        }
        setSnap(snapTime);
        // dragged past the end, the frame grows to hold it
        const shift = start - span.start;
        const last = Math.max(start + long, ...others.map((o) => o.span.end + shift));
        let next = last > length ? runCommand(dragBase(), "set_duration", { id: frame.id, seconds: last }) : dragBase();
        next = runCommand(next, "set_timing", { ids: [el.id], start, end: start + long });
        for (const o of others) next = runCommand(next, "set_timing", { ids: [o.id], start: o.span.start + shift, end: o.span.end + shift });
        // over another track of its kind, it goes on that track, with the clips moving with it
        const kind = trackKind(el);
        const over = Array.from(lanes.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []).find((r) => {
          const b = r.getBoundingClientRect();
          return ev.clientY >= b.top && ev.clientY < b.bottom;
        });
        const row = over ? rowsRef.current[Number(over.dataset.row)] : undefined;
        if (kind && look === "cut" && row?.track?.kind === kind) next = runCommand(next, "set_track", { ids: [el.id, ...others.map((o) => o.id)], track: row.track });
        dragPreviewDoc(next);
      } else if (stretch) {
        const raw = (part === "start" ? span.start : span.end) + by;
        let to = raw;
        let snapTime: number | null = null;
        if (!noSnap) {
          const s = findSnap(raw, targets);
          if (s) {
            to = s.time;
            snapTime = s.time;
          }
        }
        to = part === "start" ? Math.max(0, Math.min(span.end - SHORTEST, to)) : Math.max(span.start + SHORTEST, Math.min(length, to));
        if (snapTime !== null && Math.abs((to - snapTime) * pps) > 0.5) snapTime = null;
        setSnap(snapTime);
        dragPreview("stretch_clip", { id: el.id, edge: part, to });
      } else if (part === "start") {
        const least = playsFile(el) ? frameTimeAt(el, span.start, 0) : 0;
        const rawStart = span.start + by;
        let start = rawStart;
        let snapTime: number | null = null;
        if (!noSnap) {
          const s = findSnap(rawStart, targets);
          if (s) {
            start = s.time;
            snapTime = s.time;
          }
        }
        start = Math.max(0, least, Math.min(span.end - SHORTEST, start));
        if (snapTime !== null && Math.abs((start - snapTime) * pps) > 0.5) snapTime = null;
        setSnap(snapTime);
        dragPreview("set_timing", { ids: [el.id], start, end: span.end, ...(playsFile(el) ? { clipFrom: fileTimeAt(el, span.start, start) } : {}) });
      } else {
        const most = file ? frameTimeAt(el, span.start, file) : length;
        const rawEnd = span.end + by;
        let end = rawEnd;
        let snapTime: number | null = null;
        if (!noSnap) {
          const s = findSnap(rawEnd, targets);
          if (s) {
            end = s.time;
            snapTime = s.time;
          }
        }
        end = Math.max(span.start + SHORTEST, Math.min(length, most, end));
        if (snapTime !== null && Math.abs((end - snapTime) * pps) > 0.5) snapTime = null;
        setSnap(snapTime);
        dragPreview("set_timing", { ids: [el.id], start: span.start, end });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSnap(null);
      if (moved) dragCommit(stretch ? "Stretch to change speed" : others.length ? `Move ${others.length + 1} clips in time` : "Change when it shows");
      // a click without a drag picks just this one
      else if (others.length) select([el.id]);
      if (!moved) anchor.current = el.id;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const make = async () => {
    setNote("");
    setMaking(0);
    try {
      setChoosing(false);
      setMade(null);
      const file = await exportScene(frame.id, setMaking, choice);
      if (file) {
        setMade(file);
        setNote(choice.ask ? `Saved ${file.split(/[\\/]/).pop()}` : "Saved in Documents, Duet, Exports");
      }
    } catch (e) {
      setNote(String(e instanceof Error ? e.message : e));
    } finally {
      setMaking(null);
    }
  };

  const bring = async () => {
    setNote("");
    const problems = await addMedia(frame.id).catch((e) => [String(e)]);
    if (problems.length) setNote(problems.join(" "));
  };

  const marks: number[] = [];
  // marks far enough apart to read, whatever the length and the zoom
  const every = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].find((n) => n * pps >= 64) ?? 3600;
  for (let t = 0; t <= length + 0.001; t += every) marks.push(t);


  const dragMark = (e: React.PointerEvent, el: El, t: number, props?: Moving[]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // a keyframe that is one of several picked moves with all of them
    const together = picked.length > 1 && picked.some((p) => p.id === el.id && p.t === t && p.props === props) ? picked : null;
    if (!together) select([el.id]);
    const adding = e.shiftKey || e.metaKey || e.ctrlKey;
    let shifted = 0;
    const from = e.clientX;
    const targets = getSnapTargets(el.id);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const by = (ev.clientX - from) / pps;
      if (Math.abs(ev.clientX - from) < 2 && !moved) return;
      moved = true;
      draggedMark.current = true;
      const noSnap = ev.metaKey || ev.ctrlKey;
      const rawT = t + by;
      let to = rawT;
      let snapTime: number | null = null;
      if (!noSnap) {
        const s = findSnap(rawT, targets);
        if (s) {
          to = s.time;
          snapTime = s.time;
        }
      }
      setSnap(snapTime);
      if (together) {
        shifted = Math.max(-Math.min(...together.map((p) => p.t)), to - t);
        // the ones ahead go first, so none lands on another that has not moved yet
        const order = [...together].sort((a, b) => (shifted > 0 ? b.t - a.t : a.t - b.t));
        let next = dragBase();
        for (const p of order) next = runCommand(next, "move_key", { id: p.id, from: p.t, to: Math.max(0, p.t + shifted), props: p.props });
        dragPreviewDoc(next);
      } else dragPreview("move_key", { id: el.id, from: t, to, props });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSnap(null);
      if (moved) {
        dragCommit(together ? `Move ${together.length} keyframes` : "Move a moment");
        setPicked(together ? together.map((p) => ({ ...p, t: Math.max(0, Math.round((p.t + shifted) * 1000) / 1000) })) : []);
      } else {
        setKeyFocus({ id: el.id, t });
        const mine = { id: el.id, t, props };
        const has = picked.some((p) => p.id === el.id && p.t === t && p.props === props);
        // Shift or Cmd adds a keyframe to the picked ones, or takes it away
        setPicked(adding ? (has ? picked.filter((p) => !(p.id === el.id && p.t === t && p.props === props)) : [...picked, mine]) : [mine]);
        seek(t);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Pull either end of the work area along the ruler. */
  const dragWork = (e: React.PointerEvent, which: "start" | "end") => {
    if (e.button !== 0 || !frame?.workArea) return;
    e.preventDefault();
    e.stopPropagation();
    const from = e.clientX;
    const base = frame.workArea[which];
    const targets = getSnapTargets();
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      let to = Math.max(0, Math.min(length, base + (ev.clientX - from) / pps));
      if (!(ev.metaKey || ev.ctrlKey)) {
        const s = findSnap(to, targets);
        if (s) to = s.time;
      }
      dragPreview("set_work_area", { id: frame.id, [which]: to });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) dragCommit("Change the work area");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Drag a marker along the ruler. A click on it takes the playhead there. */
  const dragMarker = (e: React.PointerEvent, m: Marker) => {
    if (e.button !== 0 || markerEdit === m.id) return;
    e.stopPropagation();
    const from = e.clientX;
    const targets = getSnapTargets().filter((t) => t !== m.t);
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - from) < 3 && !moved) return;
      moved = true;
      draggedMarker.current = true;
      let to = Math.max(0, Math.min(length, m.t + (ev.clientX - from) / pps));
      let snapTime: number | null = null;
      if (!(ev.metaKey || ev.ctrlKey)) {
        const s = findSnap(to, targets);
        if (s) {
          to = s.time;
          snapTime = s.time;
        }
      }
      setSnap(snapTime);
      dragPreview("update_marker", { id: frame!.id, markerId: m.id, t: to });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSnap(null);
      if (moved) dragCommit("Move a marker");
      else {
        pause();
        seek(m.t);
      }
      draggedMarker.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const moves = (el: El) => MOVING.some((p) => (el.keys[p]?.length ?? 0) > 0);
  // Option U opens everything that moves; the arrow opens any layer, moving or not
  const opened = (el: El) => folds[el.id] ?? (keysOpen && moves(el));
  const isPicked = (el: El, t: number, props?: Moving[]) => picked.some((p) => p.id === el.id && p.t === t && p.props === props);

  /**
   * As in After Effects: pulling across empty room in Motion draws a box and picks the keyframes it
   * touches, and a plain click there lets go of them. The playhead moves only from the ruler.
   */
  const sweep = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const keep = e.shiftKey || e.metaKey || e.ctrlKey ? picked : [];
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return;
      moved = true;
      const box = { x: Math.min(x0, ev.clientX), y: Math.min(y0, ev.clientY), w: Math.abs(ev.clientX - x0), h: Math.abs(ev.clientY - y0) };
      setSweepBox(box);
      const hits: Picked[] = [...keep];
      lanes.current?.querySelectorAll<HTMLElement>("[data-key-id]").forEach((n) => {
        const r = n.getBoundingClientRect();
        if (r.right < box.x || r.left > box.x + box.w || r.bottom < box.y || r.top > box.y + box.h) return;
        const id = n.dataset.keyId!;
        const t = Number(n.dataset.keyT);
        const props = KEY_GROUPS.find((g) => g.name === n.dataset.keyGroup)?.props;
        if (!hits.some((p) => p.id === id && p.t === t && p.props === props)) hits.push({ id, t, props });
      });
      setPicked(hits);
      select([...new Set(hits.map((p) => p.id))]);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSweepBox(null);
      if (!moved && !keep.length) setPicked([]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const markMenu = (e: React.MouseEvent, el: El, t: number, props?: Moving[]) => {
    e.preventDefault();
    e.stopPropagation();
    select([el.id]);
    setPicked([{ id: el.id, t, props }]);
    setMenu({ x: e.clientX, y: e.clientY, el, mark: { id: el.id, t, props } });
  };

  /** Pull the right edge of the names to read more of them, or give the lanes more room. */
  const pullNames = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const from = e.clientX;
    const start = NAMES;
    const move = (ev: PointerEvent) => setLayout({ namesW: Math.round(Math.max(110, Math.min(480, start + ev.clientX - from))) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Pull the top edge of the timeline to give its rows more room or less. */
  const grow = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = e.clientY;
    const start = timeH;
    const at = (y: number) => Math.round(Math.max(TIME_MIN_H, Math.min(window.innerHeight * 0.7, start + from - y)));
    const move = (ev: PointerEvent) => setGrowing(at(ev.clientY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGrowing(null);
      setLayout({ timeH: at(ev.clientY) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const renderBar = (el: El) => {
    const span = spanOf(el, frame);
    // in Cut the bars stay clean: a thing's marks are listed in the panel on the right
    const keyTimes = look === "cut" ? [] : [...new Set(MOVING.flatMap((p) => (el.keys[p] ?? []).map((k) => k.t)))];
    const isSelected = selection.includes(el.id);
    return (
      <div
        key={el.id}
        className={`time-span ${el.type} ${isSelected ? "on" : ""}`}
        data-name={`span-${el.name}`}
        style={{ left: span.start * pps, width: Math.max(4, (span.end - span.start) * pps) }}
        onPointerDown={(e) => drag(e, el, "all")}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          select([el.id]);
          setMenu({ x: e.clientX, y: e.clientY, el });
        }}
      >
        {look === "cut" && playsFile(el) && <ClipFace el={el} from={span.start} pps={pps} width={Math.max(4, (span.end - span.start) * pps) - 2} height={el.type === "video" ? VIDEO_BAR : FOOTAGE_BAR} on={isSelected} />}
        {look === "cut" && (
          <span className="time-span-name">
            {el.name}
            {playsFile(el) && el.speed && el.speed !== 1 ? ` · ${Math.round(el.speed * 100)}%` : ""}
          </span>
        )}
        <b className="l" onPointerDown={(e) => drag(e, el, "start")} />
        {keyTimes.map((t) => (
          <u
            key={t}
            className={isPicked(el, t) ? "picked" : ""}
            data-name="mark"
            data-key-id={el.id}
            data-key-t={t}
            title={`${clockText(t)}. Click to pick, Delete to remove`}
            onContextMenu={(e) => markMenu(e, el, t)}
            style={{ left: (t - span.start) * pps, cursor: "ew-resize" }}
            onPointerDown={(e) => dragMark(e, el, t)}
            onClick={(e) => {
              e.stopPropagation();
              if (draggedMark.current) {
                draggedMark.current = false;
                return;
              }
              seek(t);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              dispatch("remove_key", { ids: [el.id], t });
            }}
          />
        ))}
        <b className="r" onPointerDown={(e) => drag(e, el, "end")} />
      </div>
    );
  };

  /** One row for each kind of change a thing has marks for: where its marks are, and nothing else. */
  const renderKindRows = (el: El) =>
    KEY_GROUPS.map((g) => {
      const times = [...new Set(g.props.flatMap((p) => (el.keys[p] ?? []).map((k) => k.t)))].sort((a, b) => a - b);
      const first = times[0] ?? 0;
      const last = times[times.length - 1] ?? 0;
      const now = Math.round(clock.t * 1000) / 1000;
      const here = times.some((k) => Math.abs(k - now) < 0.004);
      return (
        <div key={`${el.id}-${g.name}`} className={`time-row kind ${selection.includes(el.id) ? "on" : ""}`} data-name={`kind-${g.name}`}>
          <span className="time-name" onClick={() => select([el.id])} title={`${el.name}, ${g.name}`}>
            <button
              className={`time-key ${here ? "on" : ""}`}
              data-name={`key-${g.name}`}
              title={here ? `Take away the ${g.name.toLowerCase()} keyframe at the playhead` : `Add ${/^[aeiou]/i.test(g.name) ? "an" : "a"} ${g.name.toLowerCase()} keyframe at the playhead`}
              onClick={(e) => {
                e.stopPropagation();
                select([el.id]);
                dispatch(here ? "remove_key" : "key_now", { ids: [el.id], props: g.props, t: now });
              }}
            >
              <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M6 1 11 6 6 11 1 6Z" fill={here ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
            </button>
            {g.name}
          </span>
          <div className="time-lane" style={{ width: laneWidth }} onPointerDown={sweep}>
            <div className="time-kindspan" style={{ left: first * pps, width: Math.max(0, (last - first) * pps) }} />
            {times.map((t) => (
              <u
                key={t}
                className={`kind-mark ${isPicked(el, t, g.props) ? "picked" : ""}`}
                data-name="mark"
                data-key-id={el.id}
                data-key-t={t}
                data-key-group={g.name}
                title={`${g.name}, ${clockText(t)}. Click to pick, Delete to remove`}
                onContextMenu={(e) => markMenu(e, el, t, g.props)}
                style={{ left: t * pps, cursor: "ew-resize" }}
                onPointerDown={(e) => dragMark(e, el, t, g.props)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (draggedMark.current) {
                    draggedMark.current = false;
                    return;
                  }
                  seek(t);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  dispatch("remove_key", { ids: [el.id], props: g.props, t });
                }}
              />
            ))}
          </div>
        </div>
      );
    });

  return (
    <section className={`time ${look === "cut" ? "cut" : ""} ${stretchTool ? "stretching" : ""}`} style={{ "--names": `${NAMES}px` } as React.CSSProperties} data-name="time-strip" onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
      <div className="time-bar">
        <button className="pill" data-name="play" onClick={togglePlay} title={clock.playing ? "Pause" : "Play"}>
          {clock.playing ? "Pause" : "Play"}
        </button>
        <span className="time-now" data-name="time-now">
          {clockText(clock.t)} / {clockText(length)}
        </span>
        <label title="How long this frame plays, in seconds">
          <span
            className="time-label"
            onPointerDown={(e) => {
              if (e.button !== 0 || !frame) return;
              e.preventDefault();
              const target = e.currentTarget;
              target.setPointerCapture(e.pointerId);
              const startX = e.clientX;
              const startVal = length;
              let hasDragged = false;
              let currentVal = startVal;

              const onMove = (ev: PointerEvent) => {
                if (ev.pointerId !== e.pointerId) return;
                const dx = ev.clientX - startX;
                if (!hasDragged) {
                  if (Math.abs(dx) < 3) return;
                  hasDragged = true;
                }
                ev.preventDefault();
                const mult = ev.shiftKey ? 1.0 : 0.1;
                const next = Math.max(0, Math.round((startVal + dx * mult) * 10) / 10);
                currentVal = next;
                dragPreview("set_duration", { id: frame.id, seconds: next });
              };

              const onUp = (ev: PointerEvent) => {
                if (ev.pointerId !== e.pointerId) return;
                target.removeEventListener("pointermove", onMove);
                target.removeEventListener("pointerup", onUp);
                target.removeEventListener("pointercancel", onCancel);
                try {
                  target.releasePointerCapture(ev.pointerId);
                } catch {}
                if (hasDragged) {
                  dragCancel();
                  if (currentVal !== startVal) {
                    dispatch("set_duration", { id: frame.id, seconds: currentVal });
                  }
                }
              };

              const onCancel = (ev: PointerEvent) => {
                if (ev.pointerId !== e.pointerId) return;
                target.removeEventListener("pointermove", onMove);
                target.removeEventListener("pointerup", onUp);
                target.removeEventListener("pointercancel", onCancel);
                try {
                  target.releasePointerCapture(ev.pointerId);
                } catch {}
                if (hasDragged) {
                  dragCancel();
                }
              };

              target.addEventListener("pointermove", onMove);
              target.addEventListener("pointerup", onUp);
              target.addEventListener("pointercancel", onCancel);
            }}
          >
            Length
          </span>
          <input
            key={length}
            data-name="length"
            type="number"
            min={0}
            step={0.5}
            defaultValue={Math.round(length * 10) / 10}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => {
              const n = Number(e.currentTarget.value);
              if (Number.isFinite(n) && n !== Math.round(length * 10) / 10) dispatch("set_duration", { id: frame.id, seconds: n });
            }}
          />
          <span className="time-unit">s</span>
        </label>
        <div className="pill time-look">
          <button
            className={look === "layers" ? "active" : ""}
            data-name="look-layers"
            onClick={() => setLayout({ timeLook: "layers" })}
          >
            Motion
          </button>
          <button
            className={look === "cut" ? "active" : ""}
            data-name="look-cut"
            onClick={() => setLayout({ timeLook: "cut" })}
          >
            Edit
          </button>
        </div>
        <button className="pill" data-name="add-media" onClick={() => void bring()} title="Bring in video, music or a voice, at the moment the clock is on">
          Add
        </button>
        {look === "cut" && (
          <div className="hush-anchor">
            <button className={`pill ${hushing ? "active" : ""}`} data-name="cut-silences" onClick={() => setHushing(!hushing)} title="Find the pauses where nobody speaks and cut them away">
              Cut silences
            </button>
            {hushing && (
              <div className="export-pop hush-pop" data-name="silence-settings">
                <label>
                  Quieter than
                  <input type="range" min={5} max={120} value={hush.quiet} onChange={(e) => setHush({ ...hush, quiet: Number(e.target.value) })} />
                </label>
                <label>
                  Pauses longer than
                  <select value={hush.shortest} onChange={(e) => setHush({ ...hush, shortest: Number(e.target.value) })}>
                    {[0.3, 0.5, 0.75, 1, 1.5, 2].map((n) => (
                      <option key={n} value={n}>
                        {n} s
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Keep around words
                  <select value={hush.keep} onChange={(e) => setHush({ ...hush, keep: Number(e.target.value) })}>
                    {[0, 0.05, 0.1, 0.2, 0.3].map((n) => (
                      <option key={n} value={n}>
                        {n} s
                      </option>
                    ))}
                  </select>
                </label>
                <div className="time-quiet">
                  {!hushPeaks
                    ? "Listening…"
                    : !silences.length
                      ? "No pauses found. Try a higher quiet level."
                      : `${silences.length} ${silences.length === 1 ? "pause" : "pauses"}, ${Math.round(silences.reduce((t, r) => t + r.end - r.start, 0) * 10) / 10} s, marked on the timeline.${hushIds ? " Only the picked clips are listened to." : ""}`}
                </div>
                <button
                  className="pill primary"
                  data-name="cut-silences-go"
                  disabled={!silences.length}
                  onClick={() => {
                    dispatch("cut_ranges", { sceneId: frame.id, ranges: silences });
                    setHushing(false);
                  }}
                >
                  Cut them
                </button>
              </div>
            )}
          </div>
        )}
        {colorOpen && (
          <div className="pill time-look grade-every" title="Where a colour change goes">
            <button className={gradeEvery ? "" : "active"} data-name="grade-this" onClick={() => setLayout({ gradeEvery: false })} title="Change only the picked clips">
              This clip
            </button>
            <button className={gradeEvery ? "active" : ""} data-name="grade-every" onClick={() => setLayout({ gradeEvery: true })} title="Change every clip in this scene at once">
              Every clip
            </button>
          </div>
        )}
        <span className="spacer" />
        <div className="time-zoom">
          <button
            className="time-quiet-btn"
            data-name="zoom-out"
            onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
            title="Zoom out (-)"
          >
            -
          </button>
          <button
            className="time-quiet-btn"
            data-name="zoom-fit"
            onClick={() => {
              setZoom(1);
              if (lanes.current) lanes.current.scrollLeft = 0;
            }}
            title="Fit to window (\)"
          >
            Fit
          </button>
          <button
            className="time-quiet-btn"
            data-name="zoom-in"
            onClick={() => setZoom((z) => z * 1.5)}
            title="Zoom in (=)"
          >
            +
          </button>
        </div>
        {note && <span className="time-note">{note}</span>}
        {made && making === null && (
          <button className="pill" data-name="show-video" onClick={() => void revealItemInDir(made)} title="Show the video in Finder">
            Show
          </button>
        )}
        {making === null ? (
          <div className="export-anchor">
            <button className="pill primary" data-name="export-video" onClick={() => setChoosing(!choosing)} title="Make one video file out of this scene">
              Export video
            </button>
            {choosing && (
              <div className="export-pop" data-name="export-settings">
                <label>
                  Size
                  <select data-name="export-size" value={choice.longSide} onChange={(e) => setChoice({ ...choice, longSide: Number(e.target.value) })}>
                    {SIZES.map((z) => {
                      const [w, h] = exportSize(frame, z.longSide);
                      return (
                        <option key={z.longSide} value={z.longSide}>
                          {z.name}, {w} by {h}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label>
                  Frames a second
                  <select data-name="export-fps" value={choice.fps} onChange={(e) => setChoice({ ...choice, fps: Number(e.target.value) })}>
                    {[24, 25, 30, 60].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Kind
                  <select data-name="export-kind" value={choice.master ? "master" : "share"} onChange={(e) => setChoice({ ...choice, master: e.target.value === "master" })}>
                    <option value="share">MP4, to share</option>
                    <option value="master">ProRes, to keep editing</option>
                  </select>
                </label>
                {!choice.master && (
                  <label>
                    Quality
                    <select data-name="export-quality" value={choice.quality} onChange={(e) => setChoice({ ...choice, quality: Number(e.target.value) })}>
                      {QUALITIES.map((q) => (
                        <option key={q.quality} value={q.quality}>
                          {q.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="export-where">
                  <input type="checkbox" checked={choice.ask} onChange={(e) => setChoice({ ...choice, ask: e.target.checked })} />
                  Ask me where to save
                </label>
                {!choice.ask && <div className="time-quiet">It goes to Documents, Duet, Exports.</div>}
                <button className="pill primary" data-name="export-go" onClick={make}>
                  Export
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className="pill" data-name="stop-export" onClick={stopExport} title="Stop making the video">
            Making your video, {Math.round(making * 100)}%. Stop
          </button>
        )}
      </div>

      {sweepBox && <div className="time-sweep" style={{ left: sweepBox.x, top: sweepBox.y, width: sweepBox.w, height: sweepBox.h }} />}
      <div className="time-grip" data-name="timeline-height" onPointerDown={grow} title="Pull to make the timeline taller or shorter" />
      <div
        className="time-lanes"
        ref={lanes}
        style={{ height: growing ?? timeH, maxHeight: "none" }}
        // a click on empty room in the timeline lets go of what is picked
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const t = e.target as HTMLElement;
          const empty = t === e.currentTarget || t.classList.contains("time-inner") || (t.classList.contains("time-lane") && !t.closest(".ruler"));
          if (empty && getState().selection.length) select([]);
        }}
        // video and sound dropped from the computer land at the moment under the pointer
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault();
          setSnap(dropTime(e.clientX));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setSnap(null);
        }}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer.files).filter((f) => clipKind(f.name));
          if (!files.length) return;
          e.preventDefault();
          e.stopPropagation();
          setSnap(null);
          const known = droppedPaths(e.dataTransfer).filter((p) => clipKind(p));
          const at = dropTime(e.clientX);
          seek(at);
          void (async () => {
            try {
              const paths = known.length ? known : await keepDropped(files);
              const problems = await dropClips(frame.id, paths, at);
              if (problems.length) setNote(problems.join(" "));
            } catch (err) {
              setNote(String(err instanceof Error ? err.message : err));
            }
          })();
        }}
      >
        <div className="time-inner">
        <div className="time-row ruler">
          <span className="time-name">
            <i className="names-grip" onPointerDown={pullNames} title="Pull to make the names wider or narrower" />
          </span>
          <div className="time-lane" onPointerDown={scrub} style={{ width: laneWidth }}>
            {marks.map((t) => (
              <i key={t} style={{ left: t * pps }}>
                {clockText(t).replace(/\.0$/, "")}
              </i>
            ))}
            {frame.workArea && (
              <div
                className="time-work"
                data-name="work-area"
                style={{ left: frame.workArea.start * pps, width: Math.max(2, (frame.workArea.end - frame.workArea.start) * pps) }}
                title="The work area: playing starts and stops here. B and N set its ends at the playhead. Right-click to clear it."
                onPointerDown={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMarkerMenu({ x: e.clientX, y: e.clientY, id: "work" });
                }}
              >
                <em className="work-l" onPointerDown={(e) => dragWork(e, "start")} />
                <em className="work-r" onPointerDown={(e) => dragWork(e, "end")} />
              </div>
            )}
            {(frame.markers ?? []).map((m) => (
              <b
                key={m.id}
                className="time-marker"
                data-name="marker"
                style={{ left: m.t * pps, "--marker": m.color } as React.CSSProperties}
                title={`${m.name || "Marker"}, ${clockText(m.t)}. Click to go there, drag to move, double-click to rename, right-click for more`}
                onPointerDown={(e) => dragMarker(e, m)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setMarkerEdit(m.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMarkerMenu({ x: e.clientX, y: e.clientY, id: m.id });
                }}
              >
                {markerEdit === m.id ? (
                  <input
                    className="time-marker-name"
                    autoFocus
                    defaultValue={m.name}
                    placeholder="Name"
                    onFocus={(e) => e.currentTarget.select()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      setMarkerEdit(null);
                      if (e.currentTarget.value !== m.name) dispatch("update_marker", { id: frame.id, markerId: m.id, name: e.currentTarget.value.trim() });
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setMarkerEdit(null);
                    }}
                  />
                ) : (
                  m.name && <span>{m.name}</span>
                )}
              </b>
            ))}
          </div>
        </div>
        {displayRows.map((row, ri) => (
          <Fragment key={row.key}>
            <div
              data-row={ri}
              className={`time-row ${row.items.some((el) => selection.includes(el.id)) ? "on" : ""} ${look === "cut" && (row.track || row.items.some(playsFile)) ? "footage" : ""} ${look === "cut" && (row.track?.kind === "clips" || row.items.some((el) => el.type === "video")) ? "has-video" : ""} ${allHidden(row) ? "is-hidden" : ""} ${trackPicked(row) ? "picked" : ""} ${rowDrop === ri ? "drop-above" : ""} ${rowDrop === displayRows.length && ri === displayRows.length - 1 ? "drop-below" : ""}`}
            >
              <span
                className="time-name"
                onPointerDown={(e) => look === "layers" && renaming !== row.key && pullRow(e, row.items[0])}
                onClick={(e) => {
                  if (pulled.current) return void (pulled.current = false);
                  // the second click of a double click is the one that renames, so it picks nothing
                  if (renaming === row.key || (row.track && e.detail > 1)) return;
                  row.onClick?.(e);
                }}
                onDoubleClick={() => (look === "layers" || row.track) && setRenaming(row.key)}
                onContextMenu={(e) => {
                  if (!row.track) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu(null);
                  setTrackMenu({ x: e.clientX, y: e.clientY, ...row.track, name: row.name, key: row.key });
                }}
                title={look === "layers" ? `${row.name}. Double-click to rename, drag up or down to reorder` : row.track ? `${row.name}. Click to paste onto it, double-click to rename, right click for more` : row.name}
              >
                <button
                  className={`time-eye ${allHidden(row) ? "off" : ""}`}
                  data-name={`eye-${row.name}`}
                  disabled={!row.track && !row.items.length}
                  title={!row.track && !row.items.length ? "Nothing on it yet" : allHidden(row) ? "Show" : row.track ? "Hide this track, with everything on it now and later" : "Hide, so it is not drawn or exported"}
                  onClick={(e) => {
                    e.stopPropagation();
                    const show = allHidden(row);
                    if (row.track) dispatch("set_track_switch", { id: frame.id, track: row.track, hidden: !show });
                    else dispatch("set_props", { ids: row.items.map((el) => el.id), props: { hidden: !show }, label: show ? "Show" : "Hide" });
                  }}
                >
                  <Icon name={allHidden(row) ? "eye-off" : "eye"} size={12} />
                </button>
                {(row.track ? row.track.kind !== "titles" : row.items.some(playsFile)) && (
                  <button
                    className={`time-eye time-sound ${quiet(row) ? "off" : ""}`}
                    data-name={`sound-${row.name}`}
                    title={quiet(row) ? "Turn its sound on" : row.track ? "Turn this track's sound off, for everything on it now and later, in playing and in export" : "Turn its sound off, in playing and in the video you export"}
                    onClick={(e) => {
                      e.stopPropagation();
                      const on = quiet(row);
                      if (row.track) return dispatch("set_track_switch", { id: frame.id, track: row.track, silent: !on });
                      const ids = row.items.filter(playsFile).map((el) => el.id);
                      dispatch("set_props", { ids, props: { volume: on ? 1 : 0 }, label: on ? "Sound on" : "Sound off" });
                    }}
                  >
                    <Icon name={quiet(row) ? "sound-off" : "sound"} size={12} />
                  </button>
                )}
                {!(row.track ? row.track.kind !== "titles" : row.items.some(playsFile)) && (
                  <button className="time-eye time-sound" disabled title="Nothing here has sound">
                    <Icon name="sound-off" size={12} />
                  </button>
                )}
                {look === "layers" && (
                  <span className="time-fold-room">
                    {row.items.length === 1 && (
                      <button
                        className={`time-fold ${opened(row.items[0]) ? "open" : ""}`}
                        data-name={`keys-${row.name}`}
                        title={opened(row.items[0]) ? "Hide its keyframes" : "Show its keyframes"}
                        onClick={(e) => {
                          e.stopPropagation();
                          const el = row.items[0];
                          setFolds((f) => ({ ...f, [el.id]: !opened(el) }));
                        }}
                      >
                        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
                          <path d="M2.5 1.5 5.5 4 2.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                  </span>
                )}
                {renaming === row.key ? (
                  <input
                    className="rename time-rename"
                    autoFocus
                    defaultValue={row.name}
                    onFocus={(e) => e.currentTarget.select()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const name = e.currentTarget.value.trim();
                      setRenaming(null);
                      if (!name || name === row.name) return;
                      if (row.track) dispatch("rename_track", { id: frame.id, track: row.track, name });
                      else dispatch("set_props", { ids: [row.items[0].id], props: { name }, label: "Rename" });
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="time-name-text">
                    {row.name}
                    {trackPicked(row) && <small className="track-paste">Paste lands here</small>}
                  </span>
                )}
                <i className="names-grip" onPointerDown={pullNames} title="Pull to make the names wider or narrower" />
              </span>
              <div className="time-lane" style={{ width: laneWidth }} onPointerDown={look === "layers" ? sweep : scrub}>
                {row.items.map(renderBar)}
              </div>
            </div>
            {look === "layers" && row.items.filter(opened).map((el) => renderKindRows(el))}
          </Fragment>
        ))}
        {look === "cut" && (
          <div className="time-row track-add-row">
            <span className="time-name">
              <button
                className="pill track-add"
                data-name="new-track"
                title="A new track on top of the others, picked, so what you paste goes on it"
                onClick={() => {
                  dispatch("add_track", { id: frame.id, kind: "clips", index: 0 });
                  pickTrack({ frameId: frame.id, kind: "clips", index: 0 });
                  select([frame.id]);
                }}
              >
                + New track
              </button>
            </span>
          </div>
        )}
        {frame.workArea && (
          <>
            <div className="time-work-dim" style={{ left: NAMES, width: frame.workArea.start * pps }} />
            <div className="time-work-dim" style={{ left: NAMES + frame.workArea.end * pps, width: Math.max(0, (length - frame.workArea.end) * pps) }} />
          </>
        )}
        {hushing &&
          silences.map((r) => <div key={r.start} className="time-silence" style={{ left: NAMES + r.start * pps, width: Math.max(1, (r.end - r.start) * pps) }} />)}
        {(frame.markers ?? []).map((m) => (
          <div key={m.id} className="time-marker-line" style={{ left: NAMES + m.t * pps, "--marker": m.color } as React.CSSProperties} />
        ))}
        <div className="time-head" style={{ left: NAMES + clock.t * pps }} />
        {snap !== null && <div className="time-snap" style={{ left: NAMES + snap * pps }} />}
        </div>
      </div>
      {markerMenu && frame && (
        <div className="ctx" style={{ left: Math.max(10, Math.min(markerMenu.x, window.innerWidth - 230)), top: Math.max(10, Math.min(markerMenu.y, window.innerHeight - 200)) }}>
          {markerMenu.id === "work" ? (
            <div
              className="ctx-item"
              data-name="clear-work-area"
              onClick={() => {
                dispatch("set_work_area", { id: frame.id, clear: true });
                setMarkerMenu(null);
              }}
            >
              <span>Clear the work area</span>
            </div>
          ) : (
            <>
          <div
            className="ctx-item"
            data-name="rename-marker"
            onClick={() => {
              setMarkerEdit(markerMenu.id);
              setMarkerMenu(null);
            }}
          >
            <span>Rename</span>
          </div>
          <div className="ctx-colors">
            {MARKER_COLORS.map((c) => (
              <button
                key={c}
                className="marker-dot"
                data-name="marker-colour"
                style={{ background: c }}
                title="Colour"
                onClick={() => {
                  dispatch("update_marker", { id: frame.id, markerId: markerMenu.id, color: c });
                  setMarkerMenu(null);
                }}
              />
            ))}
          </div>
          <div className="ctx-line" />
          <div
            className="ctx-item"
            data-name="remove-marker"
            onClick={() => {
              dispatch("remove_marker", { id: frame.id, markerId: markerMenu.id });
              setMarkerMenu(null);
            }}
          >
            <span>Remove marker</span>
          </div>
            </>
          )}
        </div>
      )}
      {trackMenu && (
        <div className="ctx" data-name="track-menu" style={{ left: Math.max(10, Math.min(trackMenu.x, window.innerWidth - 230)), top: Math.max(10, Math.min(trackMenu.y, window.innerHeight - 200)) }}>
          <div
            className="ctx-item"
            onClick={() => {
              setRenaming(trackMenu.key);
              setTrackMenu(null);
            }}
          >
            <span>Rename</span>
          </div>
          {([["New track above", 0], ["New track below", 1]] as const).map(([label, by]) => (
            <div
              key={label}
              className="ctx-item"
              onClick={() => {
                const { kind, index } = trackMenu;
                setTrackMenu(null);
                dispatch("add_track", { id: frame.id, kind, index: index + by });
                pickTrack({ frameId: frame.id, kind, index: index + by });
                select([frame.id]);
              }}
            >
              <span>{label}</span>
            </div>
          ))}
          <div className="ctx-line" />
          <div
            className="ctx-item danger"
            onClick={() => {
              const { kind, index } = trackMenu;
              setTrackMenu(null);
              dispatch("delete_track", { id: frame.id, track: { kind, index } });
              // the picked track keeps pointing at the same one
              const was = getPickedTrack();
              if (was?.frameId === frame.id && was.kind === kind) pickTrack(was.index === index ? null : was.index > index ? { ...was, index: was.index - 1 } : was);
            }}
          >
            <span>Delete track</span>
          </div>
        </div>
      )}
      {menu && (
        <div
          className="ctx"
          style={{
            left: Math.max(10, Math.min(menu.x, window.innerWidth - 230)),
            top: Math.max(10, Math.min(menu.y, window.innerHeight - 420)),
          }}
        >
          {menu.mark && (
            <>
              <div
                className="ctx-item"
                data-name="remove-this-mark"
                onClick={() => {
                  const m = menu.mark!;
                  setMenu(null);
                  setPicked([]);
                  dispatch("remove_key", { ids: [m.id], props: m.props, t: m.t });
                }}
              >
                <span>Remove this keyframe</span>
                <kbd>Delete</kbd>
              </div>
              <div className="ctx-line" />
            </>
          )}
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              if (sceneId) dispatch("split_at", { sceneId, t: clock.t, ids: [el.id] });
            }}
          >
            <span>Cut here</span>
            <kbd>C</kbd>
          </div>
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              dispatch("ripple_delete", { ids: [el.id] });
            }}
          >
            <span>Delete and close the gap</span>
            <kbd>D</kbd>
          </div>
          <div className="ctx-line" />
          {(
            [
              ["up", "Bring forward", "Cmd ]"],
              ["top", "Bring to front", "Shift Cmd ]"],
              ["down", "Send backward", "Cmd ["],
              ["bottom", "Send to back", "Shift Cmd ["],
            ] as const
          ).map(([to, label, hint]) => (
            <div
              key={to}
              className="ctx-item"
              onClick={() => {
                const el = menu.el;
                setMenu(null);
                dispatch("arrange_elements", { ids: selection.includes(el.id) ? selection : [el.id], to });
              }}
            >
              <span>{label}</span>
              <kbd>{hint}</kbd>
            </div>
          ))}
          <div className="ctx-line" />
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              dispatch("key_now", { ids: [el.id], props: ["x", "y"], t: clock.t });
            }}
          >
            <span>Keyframe position</span>
            <kbd>Option P</kbd>
          </div>
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              dispatch("key_now", { ids: [el.id], props: ["width", "height"], t: clock.t });
            }}
          >
            <span>Keyframe size</span>
            <kbd>Option S</kbd>
          </div>
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              dispatch("key_now", { ids: [el.id], props: ["opacity"], t: clock.t });
            }}
          >
            <span>Keyframe opacity</span>
            <kbd>Option T</kbd>
          </div>
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              dispatch("key_now", { ids: [el.id], props: ["rotation"], t: clock.t });
            }}
          >
            <span>Keyframe rotation</span>
            <kbd>Option R</kbd>
          </div>
          <div className="ctx-line" />
          <div
            className="ctx-item"
            onClick={() => {
              const el = menu.el;
              setMenu(null);
              dispatch("remove_key", { ids: [el.id] });
            }}
          >
            <span>Remove all keyframes</span>
          </div>
        </div>
      )}
    </section>
  );
}

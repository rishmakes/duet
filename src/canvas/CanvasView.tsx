import { message } from "@tauri-apps/plugin-dialog";
import { clipKind, dropClips, keepDropped } from "../video/scene";
import { getLayout, setLayout, useLayout } from "../ui/layout";
import { RULER, gapsAround, snapEqualGaps, snapToGuides } from "./guides";
import type { Gap } from "./guides";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { setOpenComment, useOpenComment } from "../ui/commentFocus";
import { newId, runCommand } from "../commands";
import { extractPayload, payloadToText, textToPayload } from "../document/clipboard";
import type { ClipPayload } from "../document/clipboard";
import {
  canTurn,
  descendants,
  frameAt,
  hitTest as hitAnything,
  rectsIntersect,
  snapRect,
  tidyAngle,
  topLevelOnly,
  turnCentre,
  turnOf,
  turnPoint,
  pointInRect,
  unionRect,
  worldBounds,
  worldPos,
  worldRect,
} from "../document/geometry";
import { canBeComponent } from "../document/components";
import { docAt } from "../document/time";
import type { Doc, El, ElementType, Rect } from "../document/types";
import {
  clearOverlay,
  workDoc,
  dispatch,
  dragBase,
  dragCancel,
  dragCommit,
  dragPreview,
  dragPreviewDoc,
  getState,
  nudge,
  redo,
  select,
  setFocus,
  setEditing,
  setOverlay,
  setTool,
  setViewport,
  subscribe,
  undo,
  useStore,
} from "../state/store";
import type { Tool } from "../state/store";
import { HANDLES, TURN_CURSOR, TURN_REACH, handleCursor, resizeTurned } from "./handles";
import type { HandleKey } from "./handles";
import { pickImages, placeFiles } from "../project/imageImport";
import {
  deleteSelectedNode,
  doubleClickNode,
  dragNode,
  editing,
  enterNodeEdit,
  exitNodeEdit,
  hitNode,
  nodesOf,
  nudgeSelectedNodes,
  selectNodes,
  worldNodesOf,
} from "./nodes";
import type { NodeHit } from "./nodes";
import type { AbsNode } from "../document/path";
import { logError } from "../errorLog";
import { defaultLayout } from "../document/layout";
import { penActive, penBack, penCancel, penDown, penDrag, penFinish, penHover } from "./pen";
import { addPicture, pictureOf, pictureSize, setLivePicture } from "../project/assets";
import { PAINT_TILE } from "../document/types";
import {
  expandBox,
  dabSpacing,
  stepDabs,
  smoothPoint,
  pressureScale,
  renderDabCanvas,
  worldToFile,
  pictureCoverScale,
  touchedTiles,
  type Box,
  type Point,
} from "./brush";
import {
  getBrushSettings,
  stepBrushSize,
  useBrushSettings,
  type BrushSettings,
} from "./brushSettings";
import { draw, labelRect, screenRect, setQuietCanvas, setSceneOnly, shownOn } from "./render";
import { fontCss, layoutText, lineStep, textLift } from "./text";
import { getPickedTrack } from "../ui/pickedTrack";
import { maskSelection } from "../ui/actions";
import { isPhotoshopFile, openPhotoshopFile } from "../project/photoshop";

let atNow: { doc: Doc; scene: string; t: number; out: Doc } | null = null;
/** The design with only what plays at the moment the clock is on, so a click finds what is seen. */
function playingNow(doc: Doc): Doc {
  const { scene, t } = getState().clock;
  if (!scene) return doc;
  if (!atNow || atNow.doc !== doc || atNow.scene !== scene || atNow.t !== t) atNow = { doc, scene, t, out: docAt(doc, scene, t) };
  return atNow.out;
}

/** What is under the pointer, leaving out what is not on show while one frame is looked at alone, or not playing yet. */
function hitTest(doc: Doc, x: number, y: number, ignore?: Set<string>, deep?: boolean): string | null {
  const id = hitAnything(playingNow(doc), x, y, ignore, deep);
  return id && shownOn(doc, id) ? id : null;
}

type Drag =
  | { kind: "pen"; index: number | null }
  | { kind: "node"; hit: NodeHit; start: AbsNode[]; at: { x: number; y: number }; sx: number; sy: number; moved: boolean }
  | { kind: "node-marquee"; start: { x: number; y: number }; prev: number[]; additive: boolean; pathId: string; moved: boolean; sx: number; sy: number }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "guide"; axis: "x" | "y"; from: number | null; moved: boolean; sx: number; sy: number }
  | { kind: "create"; type: ElementType; start: { x: number; y: number }; parentId: string | null; sx: number; sy: number }
  | { kind: "move"; start: { x: number; y: number }; ids: string[]; base: Doc; moved: boolean; sx: number; sy: number; duplicate?: boolean }
  | { kind: "resize"; handle: HandleKey; id: string; orig: Rect; turn: number; sx: number; sy: number; start: { x: number; y: number }; many?: { id: string; r: Rect }[] }
  | { kind: "turn"; id: string; centre: { x: number; y: number }; from: number; base: number; sx: number; sy: number; moved: boolean; spun: number; free: boolean; many?: { id: string; r: Rect; rot: number }[] }
  | { kind: "zoom"; sx: number; sy: number; startZoom: number; vx: number; vy: number; moved: boolean; priorGlide: { zoom: number; zoomIn?: boolean } | null }
  | { kind: "marquee"; start: { x: number; y: number }; prev: string[]; additive: boolean; scope: string[] }
  | { kind: "deep"; hit: string; start: { x: number; y: number }; sx: number; sy: number; shift: boolean; prev: string[] };

interface StrokeState {
  elId: string;
  el: El;
  picSize: [number, number];
  isEraser: boolean;
  workingSheet: HTMLCanvasElement;
  workingCtx: CanvasRenderingContext2D;
  strokeSheet: HTMLCanvasElement;
  strokeCtx: CanvasRenderingContext2D;
  displaySheet: HTMLCanvasElement;
  displayCtx: CanvasRenderingContext2D;
  dabCanvas: HTMLCanvasElement;
  settings: BrushSettings;
  lastSmoothed: Point;
  carryDistance: number;
  totalDirtyBox: Box | null;
  queue: { pos: Point; pressure: number; pointerType: string }[];
  rafId: number;
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  if (canvas.toBlob) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) {
      const buffer = await blob.arrayBuffer();
      return new Uint8Array(buffer);
    }
  }
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];
  if (!base64) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Where files dragged in from the computer are, when the system says so. */
export function droppedPaths(data: DataTransfer): string[] {
  const out: string[] = [];
  for (const kind of ["text/uri-list", "public.file-url", "text/plain"]) {
    for (const line of data.getData(kind).split(/\r?\n/)) {
      if (!line.startsWith("file://")) continue;
      try {
        const path = decodeURIComponent(new URL(line.trim()).pathname);
        if (!out.includes(path)) out.push(path);
      } catch {
        // not a place on the computer
      }
    }
  }
  return out;
}

const CREATE_TOOLS: Tool[] = ["frame", "rect", "ellipse", "text"];
const DEFAULT_SIZE: Record<ElementType, { w: number; h: number }> = {
  frame: { w: 360, h: 640 },
  rect: { w: 120, h: 120 },
  ellipse: { w: 120, h: 120 },
  text: { w: 40, h: 21 },
  image: { w: 240, h: 160 },
  path: { w: 100, h: 100 },
  group: { w: 100, h: 100 },
  instance: { w: 100, h: 100 },
  video: { w: 320, h: 180 },
  sound: { w: 1, h: 1 },
};

/** Copy of what was last copied inside this window, in case the system clipboard is unavailable. */
let inMemoryClip: ClipPayload | null = null;

/** Paste a payload where it makes sense: inside a selected frame, otherwise next to the original. */
export function pastePayload(payload: ClipPayload, duplicate = false) {
  const s = getState();
  const doc = workDoc(s);
  const sel = s.selection.filter((i) => doc.elements[i]);
  let parentId: string | null = null;
  if (sel.length === 1) {
    const one = doc.elements[sel[0]];
    parentId = one.type === "frame" && !duplicate ? one.id : one.parentId;
  } else if (sel.length > 1) parentId = doc.elements[sel[0]].parentId;
  const idMap: Record<string, string> = {};
  for (const [oldId, el] of Object.entries(payload.elements)) idMap[oldId] = newId(el.type);
  const first = payload.elements[payload.rootIds[0]];
  const pageFrame = !first.parentId && first.type === "frame";
  // Pasting on top of the original would hide it. Nudge, or put a copied screen beside its original.
  const sameSpot = payload.rootIds.every((id) => doc.elements[id]?.parentId === parentId);
  const dx = pageFrame && sameSpot ? first.width + 40 : sameSpot || duplicate ? 16 : 0;
  const dy = pageFrame && sameSpot ? 0 : sameSpot || duplicate ? 16 : 0;
  // a track picked on the timeline of this frame: clips go on it, the first starting at the playhead
  const track = getPickedTrack();
  const onTrack = !duplicate && track && track.frameId === parentId && doc.elements[parentId]?.duration > 0 ? { track: { kind: track.kind, index: track.index }, at: s.clock.t } : {};
  dispatch("paste_elements", { payload, parentId, dx, dy, idMap, above: duplicate, ...onTrack, label: duplicate ? "Duplicate" : "Paste" });
  select(payload.rootIds.map((id) => idMap[id]));
}

/** Check whether an element can be picked up and moved. */
export function isMovable(doc: Doc, id: string | null): boolean {
  if (!id) return false;
  const el = doc.elements[id];
  if (!el || el.locked) return false;
  let p = el.parentId;
  while (p) {
    if (doc.elements[p]?.locked) return false;
    p = doc.elements[p]?.parentId;
  }
  return true;
}

/** Duplicate elements in place so their copies can be dragged while leaving originals behind. */
export function prepareDuplicate(doc: Doc, ids: string[]): { base: Doc; copyIds: string[] } | null {
  const payload = extractPayload(doc, ids);
  if (!payload || payload.rootIds.length === 0) return null;
  const idMap: Record<string, string> = {};
  for (const [oldId, el] of Object.entries(payload.elements)) idMap[oldId] = newId(el.type);
  const copyIds = payload.rootIds.map((id) => idMap[id]);
  const parentId = doc.elements[ids[0]]?.parentId ?? null;
  const base = runCommand(doc, "paste_elements", {
    payload,
    parentId,
    dx: 0,
    dy: 0,
    idMap,
    label: "Duplicate",
  });
  return { base, copyIds };
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

const ZOOM_LEVELS = [0.02, 0.03125, 0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];

export function nextZoomLevel(current: number, zoomIn: boolean): number {
  if (zoomIn) {
    for (const z of ZOOM_LEVELS) {
      if (z > current * 1.01) return z;
    }
    return MAX_ZOOM;
  }
  for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
    if (ZOOM_LEVELS[i] < current * 0.99) return ZOOM_LEVELS[i];
  }
  return MIN_ZOOM;
}

const GLIDE_MS = 200;

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const animFrame = (cb: FrameRequestCallback): number => {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(cb);
  return setTimeout(() => cb(Date.now()), 16) as unknown as number;
};

const cancelAnimFrame = (id: number) => {
  if (typeof cancelAnimationFrame === "function") return cancelAnimationFrame(id);
  clearTimeout(id);
};

let glideRaf = 0;
let activeGlideTarget: { x: number; y: number; zoom: number; zoomIn?: boolean } | null = null;

export function stopGlide() {
  if (glideRaf) {
    cancelAnimFrame(glideRaf);
    glideRaf = 0;
  }
  activeGlideTarget = null;
}

/** Glide the viewport to a new place and zoom level. */
export function glideTo(target: { x: number; y: number; zoom: number; zoomIn?: boolean }) {
  stopGlide();
  const start = getState().viewport;
  if (start.x === target.x && start.y === target.y && start.zoom === target.zoom) return;
  activeGlideTarget = target;
  const nowFn = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
  const startTime = nowFn();

  const tick = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / GLIDE_MS);
    const t = easeOut(progress);

    if (progress >= 1) {
      glideRaf = 0;
      activeGlideTarget = null;
      setViewport({ x: target.x, y: target.y, zoom: target.zoom });
      return;
    }

    setViewport({
      zoom: start.zoom + (target.zoom - start.zoom) * t,
      x: start.x + (target.x - start.x) * t,
      y: start.y + (target.y - start.y) * t,
    });

    glideRaf = animFrame(tick);
  };

  glideRaf = animFrame(tick);
}

function fitBox(box: Rect, width: number, height: number, maxZoom: number, pad = 120) {
  const zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, (width - pad * 2) / box.width, (height - pad * 2) / box.height));
  glideTo({
    zoom,
    x: width / 2 - (box.x + box.width / 2) * zoom,
    y: height / 2 - (box.y + box.height / 2) * zoom,
  });
}

/** Show everything on the page. */
export function zoomToFit(width: number, height: number) {
  const doc = workDoc();
  const box = unionRect(doc.rootIds.map((id) => worldBounds(doc, id)));
  if (!box) return glideTo({ x: 160, y: 100, zoom: 1 });
  fitBox(box, width, height, 2);
}

/** Jump to whatever is selected, or to the given elements. */
export function zoomToElements(ids: string[], width: number, height: number) {
  const doc = workDoc();
  const box = unionRect(ids.filter((i) => doc.elements[i]).map((id) => worldBounds(doc, id)));
  if (!box) return;
  fitBox(box, width, height, 4);
}

/** Bring things into view only if they are off screen, keeping the zoom when they fit. */
export function revealElements(ids: string[], width: number, height: number) {
  const doc = workDoc();
  const box = unionRect(ids.filter((i) => doc.elements[i]).map((id) => worldBounds(doc, id)));
  if (!box) return;
  const vp = getState().viewport;
  const left = box.x * vp.zoom + vp.x;
  const top = box.y * vp.zoom + vp.y;
  const right = left + box.width * vp.zoom;
  const bottom = top + box.height * vp.zoom;
  const visible = left >= 0 && top >= 0 && right <= width && bottom <= height;
  if (visible) return;
  if (box.width * vp.zoom <= width * 0.9 && box.height * vp.zoom <= height * 0.9) {
    glideTo({ zoom: vp.zoom, x: width / 2 - (box.x + box.width / 2) * vp.zoom, y: height / 2 - (box.y + box.height / 2) * vp.zoom });
  } else {
    fitBox(box, width, height, 4);
  }
}

/** Set the zoom level, keeping the middle of the screen where it is. */
export function zoomTo(level: number, width: number, height: number) {
  const vp = getState().viewport;
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
  const wx = (width / 2 - vp.x) / vp.zoom;
  const wy = (height / 2 - vp.y) / vp.zoom;
  glideTo({ zoom, x: width / 2 - wx * zoom, y: height / 2 - wy * zoom });
}

/** `viewOnly` shows the design and ignores every click and key, as beside the chat. */
/** The box around several picked things, when more than one is picked. */
function manyBox(doc: Doc, ids: string[]): Rect | null {
  const top = topLevelOnly(doc, ids.filter((i) => doc.elements[i]));
  return top.length > 1 ? unionRect(top.map((i) => worldBounds(doc, i))) : null;
}

export default function CanvasView({ viewOnly = false }: { viewOnly?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setQuietCanvas(viewOnly);
    return () => setQuietCanvas(false);
  }, [viewOnly]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const rafRef = useRef(0);
  // Motion works on one scene: the board goes there, and comes back to where it was when you return to Design or Photo
  const designing = useLayout((d) => d.mode === "design" || d.mode === "photo");
  const motion = useLayout((d) => d.mode === "motion");
  const scene = useStore((s) => s.clock.scene);
  // in Motion the scene sits still in the middle: no scrolling, panning or zooming away from it
  const lockedRef = useRef(false);
  lockedRef.current = motion && !!scene && !viewOnly;
  useEffect(() => {
    setSceneOnly(motion ? scene : null);
    window.dispatchEvent(new Event("duet:repaint"));
    return () => setSceneOnly(null);
  }, [motion, scene]);
  const before = useRef<{ x: number; y: number; zoom: number } | null>(null);
  useEffect(() => {
    if (scene) {
      before.current ??= getState().viewport;
      zoomToElements([scene], sizeRef.current.w, sizeRef.current.h);
    } else if (designing && before.current) {
      glideTo(before.current);
      before.current = null;
    }
  }, [scene, designing]);
  const editingId = useStore((s) => s.editingId);
  const viewport = useStore((s) => s.viewport);
  // a comment being written: where its pin goes, and the thing under it
  const [draft, setDraft] = useState<{ x: number; y: number; on: string | null } | null>(null);
  // a comment picked in the list comes to the middle of the canvas, its pins shown
  useEffect(() => {
    const go = (e: Event) => {
      const c = workDoc().comments?.find((x) => x.id === (e as CustomEvent<string>).detail);
      if (!c || viewOnly) return;
      if (getLayout().commentsHidden) setLayout({ commentsHidden: false });
      const { zoom } = getState().viewport;
      glideTo({ zoom, x: sizeRef.current.w / 2 - c.x * zoom, y: sizeRef.current.h / 2 - c.y * zoom });
    };
    window.addEventListener("duet:show-comment", go);
    return () => window.removeEventListener("duet:show-comment", go);
  }, [viewOnly]);

  // Choosing something else ends point editing.
  const selNow = useStore((st) => st.selection);
  useEffect(() => {
    const ne = editing();
    if (ne && !(selNow.length === 1 && selNow[0] === ne.id)) exitNodeEdit();
  }, [selNow]);

  // Switching to another tool ends the line you were drawing.
  const toolNow = useStore((st) => st.tool);
  const strokeRef = useRef<StrokeState | null>(null);
  const [cursorPos, setCursorPos] = useState<{ sx: number; sy: number } | null>(null);
  const brushSettings = useBrushSettings();

  const cancelStroke = (stroke: StrokeState) => {
    if (stroke.rafId) {
      cancelAnimationFrame(stroke.rafId);
      stroke.rafId = 0;
    }
    setLivePicture(stroke.elId, null);
    window.dispatchEvent(new Event("duet:repaint"));
  };

  const flushStrokePoints = (stroke: StrokeState, points: { pos: Point; pressure: number; pointerType: string }[]) => {
    if (points.length === 0) return;
    let frameDirty: Box | null = null;

    for (const pt of points) {
      const smoothed = smoothPoint(stroke.lastSmoothed, pt.pos, 0.5);
      const pScale = pressureScale(pt.pressure, pt.pointerType);
      const effectiveDiameter = Math.max(1, stroke.settings.size * pScale);
      const effectiveRadius = effectiveDiameter / 2;
      const spacing = dabSpacing(effectiveDiameter);

      const { dabs, carry } = stepDabs(stroke.lastSmoothed, smoothed, stroke.carryDistance, spacing);
      stroke.carryDistance = carry;
      stroke.lastSmoothed = smoothed;

      for (const dab of dabs) {
        stroke.strokeCtx.drawImage(
          stroke.dabCanvas,
          dab.x - effectiveRadius,
          dab.y - effectiveRadius,
          effectiveDiameter,
          effectiveDiameter,
        );
        const dabBox: Box = {
          x: Math.floor(dab.x - effectiveRadius),
          y: Math.floor(dab.y - effectiveRadius),
          width: Math.ceil(effectiveDiameter),
          height: Math.ceil(effectiveDiameter),
        };
        frameDirty = expandBox(frameDirty, dabBox);
        stroke.totalDirtyBox = expandBox(stroke.totalDirtyBox, dabBox);
      }
    }

    if (frameDirty) {
      const [pw, ph] = stroke.picSize;
      const bx = Math.max(0, Math.floor(frameDirty.x));
      const by = Math.max(0, Math.floor(frameDirty.y));
      const bw = Math.min(pw - bx, Math.ceil(frameDirty.width));
      const bh = Math.min(ph - by, Math.ceil(frameDirty.height));

      if (bw > 0 && bh > 0) {
        stroke.displayCtx.save();
        stroke.displayCtx.beginPath();
        stroke.displayCtx.rect(bx, by, bw, bh);
        stroke.displayCtx.clip();
        stroke.displayCtx.clearRect(bx, by, bw, bh);
        stroke.displayCtx.drawImage(stroke.workingSheet, 0, 0);
        stroke.displayCtx.globalAlpha = stroke.settings.opacity;
        stroke.displayCtx.globalCompositeOperation = stroke.isEraser ? "destination-out" : "source-over";
        stroke.displayCtx.drawImage(stroke.strokeSheet, 0, 0);
        stroke.displayCtx.restore();

        window.dispatchEvent(new Event("duet:repaint"));
      }
    }
  };

  const flushStrokeFrame = () => {
    const stroke = strokeRef.current;
    if (!stroke) return;
    stroke.rafId = 0;
    if (stroke.queue.length === 0) return;
    const points = stroke.queue.splice(0);
    flushStrokePoints(stroke, points);
  };

  const handleStrokeMove = (e: React.PointerEvent) => {
    const stroke = strokeRef.current;
    if (!stroke) return;
    const currentDoc = workDoc();
    const native = e.nativeEvent as PointerEvent;
    const events = typeof native?.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [e];
    for (const ev of events) {
      const evPoint = point(ev);
      const filePos = worldToFile({ x: evPoint.x, y: evPoint.y }, stroke.el, currentDoc, stroke.picSize);
      stroke.queue.push({ pos: filePos, pressure: ev.pressure, pointerType: ev.pointerType });
    }
    if (!stroke.rafId) {
      stroke.rafId = requestAnimationFrame(flushStrokeFrame);
    }
  };

  const finishStroke = async (stroke: StrokeState) => {
    if (stroke.rafId) {
      cancelAnimationFrame(stroke.rafId);
      stroke.rafId = 0;
    }
    if (stroke.queue.length > 0) {
      flushStrokePoints(stroke, stroke.queue.splice(0));
    }

    stroke.workingCtx.save();
    stroke.workingCtx.globalAlpha = stroke.settings.opacity;
    stroke.workingCtx.globalCompositeOperation = stroke.isEraser ? "destination-out" : "source-over";
    stroke.workingCtx.drawImage(stroke.strokeSheet, 0, 0);
    stroke.workingCtx.restore();

    if (!stroke.totalDirtyBox) {
      setLivePicture(stroke.elId, null);
      window.dispatchEvent(new Event("duet:repaint"));
      return;
    }

    const pad = stroke.settings.size;
    const paddedBox: Box = {
      x: stroke.totalDirtyBox.x - pad,
      y: stroke.totalDirtyBox.y - pad,
      width: stroke.totalDirtyBox.width + pad * 2,
      height: stroke.totalDirtyBox.height + pad * 2,
    };
    const tiles = touchedTiles(paddedBox, stroke.picSize[0], stroke.picSize[1], PAINT_TILE);

    const newTiles: Record<string, string> = {};
    for (const t of tiles) {
      const tileCanvas = document.createElement("canvas");
      tileCanvas.width = t.width;
      tileCanvas.height = t.height;
      const tctx = tileCanvas.getContext("2d");
      if (!tctx) continue;
      tctx.drawImage(stroke.workingSheet, t.x, t.y, t.width, t.height, 0, 0, t.width, t.height);
      const bytes = await canvasToPngBytes(tileCanvas);
      if (!bytes) continue;
      const { src } = await addPicture(`patch-${t.col}-${t.row}.png`, bytes, "image/png");
      newTiles[t.key] = src;
    }

    if (Object.keys(newTiles).length > 0) {
      dispatch(
        "paint_picture",
        {
          id: stroke.elId,
          tiles: newTiles,
          label: stroke.isEraser ? "Rub out" : "Paint",
        },
        "you",
      );
    }
    setLivePicture(stroke.elId, null);
    window.dispatchEvent(new Event("duet:repaint"));
  };

  const startBrushStroke = (
    e: React.PointerEvent,
    p: { sx: number; sy: number; x: number; y: number },
    s: ReturnType<typeof getState>,
  ) => {
    const doc = workDoc(s);
    let targetEl: El | null = null;
    if (s.selection.length === 1 && doc.elements[s.selection[0]]?.type === "image") {
      targetEl = doc.elements[s.selection[0]];
    } else {
      const hit = hitTest(doc, p.x, p.y, new Set(), false);
      if (hit && doc.elements[hit]?.type === "image") {
        targetEl = doc.elements[hit];
        select([hit]);
      }
    }
    if (!targetEl) return;

    const basePic = pictureOf(targetEl);
    if (!basePic) return;
    const picSize = pictureSize(basePic);
    if (picSize[0] <= 0 || picSize[1] <= 0) return;
    const [pw, ph] = picSize;

    const workingSheet = document.createElement("canvas");
    workingSheet.width = pw;
    workingSheet.height = ph;
    const workingCtx = workingSheet.getContext("2d");
    if (!workingCtx) return;
    workingCtx.drawImage(basePic, 0, 0);

    const strokeSheet = document.createElement("canvas");
    strokeSheet.width = pw;
    strokeSheet.height = ph;
    const strokeCtx = strokeSheet.getContext("2d");
    if (!strokeCtx) return;

    const displaySheet = document.createElement("canvas");
    displaySheet.width = pw;
    displaySheet.height = ph;
    const displayCtx = displaySheet.getContext("2d");
    if (!displayCtx) return;
    displayCtx.drawImage(workingSheet, 0, 0);

    setLivePicture(targetEl.id, displaySheet);

    const settings = getBrushSettings();
    const isEraser = s.tool === "eraser";
    const dabColour = isEraser ? "#000000" : settings.colour;
    const dabCanvas = renderDabCanvas(settings.size, settings.softness, dabColour);

    const filePos = worldToFile({ x: p.x, y: p.y }, targetEl, doc, picSize);
    const pScale = pressureScale(e.pressure, e.pointerType);
    const effectiveDiameter = Math.max(1, settings.size * pScale);
    const effectiveRadius = effectiveDiameter / 2;

    strokeCtx.drawImage(
      dabCanvas,
      filePos.x - effectiveRadius,
      filePos.y - effectiveRadius,
      effectiveDiameter,
      effectiveDiameter,
    );

    const initialDirty: Box = {
      x: Math.floor(filePos.x - effectiveRadius),
      y: Math.floor(filePos.y - effectiveRadius),
      width: Math.ceil(effectiveDiameter),
      height: Math.ceil(effectiveDiameter),
    };

    displayCtx.save();
    displayCtx.beginPath();
    displayCtx.rect(initialDirty.x, initialDirty.y, initialDirty.width, initialDirty.height);
    displayCtx.clip();
    displayCtx.clearRect(initialDirty.x, initialDirty.y, initialDirty.width, initialDirty.height);
    displayCtx.drawImage(workingSheet, 0, 0);
    displayCtx.globalAlpha = settings.opacity;
    displayCtx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
    displayCtx.drawImage(strokeSheet, 0, 0);
    displayCtx.restore();

    window.dispatchEvent(new Event("duet:repaint"));
    canvasRef.current?.setPointerCapture(e.pointerId);

    strokeRef.current = {
      elId: targetEl.id,
      el: targetEl,
      picSize,
      isEraser,
      workingSheet,
      workingCtx,
      strokeSheet,
      strokeCtx,
      displaySheet,
      displayCtx,
      dabCanvas,
      settings,
      lastSmoothed: filePos,
      carryDistance: 0,
      totalDirtyBox: initialDirty,
      queue: [],
      rafId: 0,
    };
  };

  useEffect(() => {
    if (toolNow !== "pen" && penActive()) penFinish(false, false);
    if (toolNow !== "brush" && toolNow !== "eraser" && strokeRef.current) {
      cancelStroke(strokeRef.current);
      strokeRef.current = null;
    }
    if (toolNow === "brush" || toolNow === "eraser") {
      setCursor("none");
    }
  }, [toolNow]);

  useEffect(() => {
    return () => {
      if (strokeRef.current) {
        cancelStroke(strokeRef.current);
        strokeRef.current = null;
      }
    };
  }, []);

  // ---------- drawing ----------
  const schedule = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const { w, h, dpr } = sizeRef.current;
      try {
        draw(ctx, getState(), w, h, dpr);
        // the light running round an AI's working area keeps moving, at an easy pace
        if (getState().aiWork) setTimeout(schedule, 33);
      } catch (e) {
        // A drawing error must never leave the canvas stuck. Starting the canvas afresh clears any
        // half-finished clipping, and the error is kept so it can be found.
        c.width = c.width;
        logError("canvas draw", e);
      }
    });
  };

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      sizeRef.current = { w, h, dpr };
      const open = getState().clock.scene;
      if (lockedRef.current && open) zoomToElements([open], w, h);
      schedule();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const unsub = subscribe(schedule);
    window.addEventListener("duet:repaint", schedule);
    return () => {
      ro.disconnect();
      unsub();
      window.removeEventListener("duet:repaint", schedule);
      stopGlide();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rulers are drawn on the canvas, so switching them redraws it at once, not at the next click
  const rulersOn = useLayout((d) => d.rulers);
  useEffect(() => schedule(), [rulersOn]);

  // ---------- helpers ----------
  const point = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const vp = getState().viewport;
    return { sx, sy, x: (sx - vp.x) / vp.zoom, y: (sy - vp.y) / vp.zoom };
  };

  const zoomAt = (sx: number, sy: number, factor: number) => {
    const vp = getState().viewport;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, vp.zoom * factor));
    const wx = (sx - vp.x) / vp.zoom;
    const wy = (sy - vp.y) / vp.zoom;
    setViewport({ zoom, x: sx - wx * zoom, y: sy - wy * zoom });
  };

  const handleAt = (sx: number, sy: number): HandleKey | null => {
    const s = getState();
    const doc = workDoc(s);
    const box = manyBox(doc, s.selection);
    if (editing() || (s.selection.length !== 1 && !box) || !doc.elements[s.selection[0]]) return null;
    const r = screenRect(s, box ?? worldRect(doc, s.selection[0]));
    // the handles of a turned shape are turned with it, so turn the pointer back to meet them
    const p = box ? { x: sx, y: sy } : turnPoint(sx, sy, r.x + r.width / 2, r.y + r.height / 2, -turnOf(doc.elements[s.selection[0]]));
    for (const hd of HANDLES) {
      const hx = r.x + r.width * hd.fx;
      const hy = r.y + r.height * hd.fy;
      if (Math.abs(p.x - hx) <= 6 && Math.abs(p.y - hy) <= 6) return hd.key;
    }
    return null;
  };

  /** Just outside a corner of the selected thing, dragging turns it. */
  const turnAt = (sx: number, sy: number): string | null => {
    const s = getState();
    const doc = workDoc(s);
    const id = s.selection[0];
    const box = manyBox(doc, s.selection);
    if (box && !s.selection.every((i) => canTurn(doc, i))) return null;
    if (editing() || (s.selection.length !== 1 && !box) || !doc.elements[id] || !canTurn(doc, id)) return null;
    const r = screenRect(s, box ?? worldRect(doc, id));
    const p = box ? { x: sx, y: sy } : turnPoint(sx, sy, r.x + r.width / 2, r.y + r.height / 2, -turnOf(doc.elements[id]));
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) return null;
    for (const [cx, cy] of [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]]) {
      if (Math.hypot(p.x - cx, p.y - cy) <= TURN_REACH) return id;
    }
    return null;
  };

  const labelAt = (sx: number, sy: number): string | null => {
    const s = getState();
    const doc = workDoc(s);
    for (let i = doc.rootIds.length - 1; i >= 0; i--) {
      const id = doc.rootIds[i];
      if (doc.elements[id]?.type !== "frame" && doc.elements[id]?.type !== "instance") continue;
      if (!shownOn(doc, id)) continue;
      const r = labelRect(s, doc, id);
      if (sx >= r.x && sx <= r.x + r.width && sy >= r.y && sy <= r.y + r.height) return id;
    }
    return null;
  };

  const setCursor = (c: string) => {
    if (canvasRef.current) canvasRef.current.style.cursor = c;
  };

  /** The ruler guide under a point on the screen, if one is within a few pixels. */
  const guideNear = (sx: number, sy: number): { axis: "x" | "y"; at: number } | null => {
    if (!getLayout().rulers || sx < RULER || sy < RULER) return null;
    const s = getState();
    const g = workDoc(s).guides;
    if (!g) return null;
    for (const at of g.x) if (Math.abs(at * s.viewport.zoom + s.viewport.x - sx) <= 4) return { axis: "x", at };
    for (const at of g.y) if (Math.abs(at * s.viewport.zoom + s.viewport.y - sy) <= 4) return { axis: "y", at };
    return null;
  };

  // ---------- pointer ----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (getState().editingId) return;
    const p = point(e);
    const s = getState();
    canvasRef.current!.setPointerCapture(e.pointerId);

    // beside the chat the canvas only looks: any drag moves the view
    if (viewOnly || e.button === 1 || spaceRef.current || s.tool === "hand") {
      // the middle button drags the view in every tool and in Motion too, as in other video and design tools
      if (e.button === 1) e.preventDefault();
      stopGlide();
      dragRef.current = { kind: "pan", sx: p.sx, sy: p.sy, vx: s.viewport.x, vy: s.viewport.y };
      setCursor("grabbing");
      return;
    }

    // with rulers on, a drag from a ruler pulls out a guide, and a guide can be picked up and moved
    if (getLayout().rulers && s.tool === "move" && e.button === 0) {
      const top = p.sy < RULER && p.sx >= RULER;
      const left = p.sx < RULER && p.sy >= RULER;
      if (top || left) {
        dragRef.current = { kind: "guide", axis: top ? "y" : "x", from: null, moved: false, sx: p.sx, sy: p.sy };
        return;
      }
      const near = guideNear(p.sx, p.sy);
      if (near) {
        dragRef.current = { kind: "guide", axis: near.axis, from: near.at, moved: false, sx: p.sx, sy: p.sy };
        return;
      }
    }

    if (s.tool === "pen") {
      stopGlide();
      dragRef.current = { kind: "pen", index: penDown(p, s.viewport.zoom) };
      return;
    }

    if (s.tool === "zoom") {
      const priorGlide = activeGlideTarget;
      stopGlide();
      dragRef.current = {
        kind: "zoom",
        sx: p.sx,
        sy: p.sy,
        startZoom: s.viewport.zoom,
        vx: s.viewport.x,
        vy: s.viewport.y,
        moved: false,
        priorGlide,
      };
      return;
    }

    if (s.tool === "brush" || s.tool === "eraser") {
      stopGlide();
      if (e.button === 0) {
        startBrushStroke(e, p, s);
      }
      return;
    }

    stopGlide();

    // the comment tool pins a note where you click, on whatever is there
    if (s.tool === "comment") {
      if (getLayout().commentsHidden) setLayout({ commentsHidden: false });
      setDraft({ x: p.x, y: p.y, on: hitTest(workDoc(s), p.x, p.y, new Set(), true) });
      return;
    }

    if (CREATE_TOOLS.includes(s.tool)) {
      const type = s.tool as ElementType;
      const parentId = frameAt(workDoc(s), p.x, p.y);
      dragRef.current = { kind: "create", type, start: { x: p.x, y: p.y }, parentId, sx: p.sx, sy: p.sy };
      return;
    }

    // move tool
    const doc = workDoc(s);
    const ne = editing();
    if (ne) {
      const nh = hitNode(p.sx, p.sy);
      if (nh) {
        if (nh.part === "anchor") {
          if (e.shiftKey) {
            if (ne.selected.includes(nh.index)) {
              selectNodes(ne.selected.filter((i) => i !== nh.index));
              return;
            } else {
              selectNodes([...ne.selected, nh.index]);
            }
          } else if (!ne.selected.includes(nh.index)) {
            selectNodes([nh.index]);
          }
        }
        dragRef.current = { kind: "node", hit: nh, start: nodesOf(doc, ne.id), at: { x: p.x, y: p.y }, sx: p.sx, sy: p.sy, moved: false };
        return;
      }
      const hit = labelAt(p.sx, p.sy) ?? hitTest(doc, p.x, p.y);
      const isSelfOrAncestor = (id: string | null): boolean => {
        let cur: string | null = ne.id;
        while (cur) {
          if (cur === id) return true;
          cur = doc.elements[cur]?.parentId ?? null;
        }
        return false;
      };
      if (hit && !isSelfOrAncestor(hit)) {
        exitNodeEdit();
      } else {
        if (!e.shiftKey) {
          selectNodes([]);
        }
        dragRef.current = {
          kind: "node-marquee",
          start: { x: p.x, y: p.y },
          prev: e.shiftKey ? ne.selected : [],
          additive: e.shiftKey,
          pathId: ne.id,
          moved: false,
          sx: p.sx,
          sy: p.sy,
        };
        return;
      }
    }
    const handle = handleAt(p.sx, p.sy);
    if (handle) {
      const id = s.selection[0];
      const box = manyBox(doc, s.selection);
      // several picked things grow and shrink together, inside the box around them all
      if (box) {
        const many = topLevelOnly(doc, s.selection).map((i) => ({ id: i, r: worldRect(doc, i) }));
        dragRef.current = { kind: "resize", handle, id, orig: box, turn: 0, sx: p.sx, sy: p.sy, start: { x: p.x, y: p.y }, many };
        return;
      }
      dragRef.current = { kind: "resize", handle, id, orig: worldRect(doc, id), turn: turnOf(doc.elements[id]), sx: p.sx, sy: p.sy, start: { x: p.x, y: p.y } };
      return;
    }
    const turning = turnAt(p.sx, p.sy);
    const box = turning ? manyBox(doc, s.selection) : null;
    if (turning && box) {
      // several picked things turn together, around the middle of the box around them all
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const from = (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI;
      const many = topLevelOnly(doc, s.selection).map((i) => ({ id: i, r: worldRect(doc, i), rot: doc.elements[i].rotation || 0 }));
      dragRef.current = { kind: "turn", id: turning, centre, from, base: 0, sx: p.sx, sy: p.sy, moved: false, spun: 0, free: true, many };
      return;
    }
    if (turning) {
      const centre = turnCentre(doc, turning);
      const from = (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI;
      // a thing whose rotation changes over time keeps whole turns, so it can spin past 180 and around more than once
      const free = !!doc.elements[turning].keys.rotation?.length;
      dragRef.current = { kind: "turn", id: turning, centre, from, base: doc.elements[turning].rotation || 0, sx: p.sx, sy: p.sy, moved: false, spun: 0, free };
      return;
    }

    // Cmd or Ctrl click digs into groups and frames, and adds to what is picked, so several things inside one can be picked
    const deep = e.metaKey || e.ctrlKey;
    const label = labelAt(p.sx, p.sy);
    const hit = label ?? hitTest(doc, p.x, p.y, new Set(), deep);
    // A drag on the empty part of a page frame that holds things draws a box around those things, as
    // in other design apps. A click still picks the frame; its name label, or picking it first, moves it.
    const hitEl = hit ? doc.elements[hit] : undefined;
    const roomy = !label && !e.shiftKey && !e.altKey && hitEl?.type === "frame" && !hitEl.parentId && hitEl.childIds.length > 0;
    // Cmd or Ctrl on something not yet picked waits: a drag draws a box inside the frame under the pointer, a click picks the thing
    if ((deep || roomy) && hit && !s.selection.includes(hit)) {
      // a plain click on the frame picks it alone; Cmd or Ctrl adds it to what is picked
      dragRef.current = { kind: "deep", hit, start: { x: p.x, y: p.y }, sx: p.sx, sy: p.sy, shift: e.shiftKey, prev: deep ? s.selection : [] };
      return;
    }
    if (hit) {
      if (!isMovable(doc, hit)) return;
      const within = (inner: string, outer: string) => {
        for (let at = doc.elements[inner]?.parentId; at; at = doc.elements[at]?.parentId) if (at === outer) return true;
        return false;
      };
      // a thing and what holds it are never picked together: digging in from the frame picks just the thing
      const adds = deep && s.selection.length > 0 && !s.selection.some((id) => within(hit, id) || within(id, hit));
      if (e.shiftKey || adds) {
        const has = s.selection.includes(hit);
        select(has ? s.selection.filter((i) => i !== hit) : [...s.selection, hit]);
        if (has) return;
      } else if (!s.selection.includes(hit)) {
        select([hit]);
      }
      const ids = topLevelOnly(doc, getState().selection);
      if (e.altKey) {
        const dup = prepareDuplicate(dragBase(), ids);
        if (dup) {
          dragRef.current = { kind: "move", start: { x: p.x, y: p.y }, ids: dup.copyIds, base: dup.base, moved: false, sx: p.sx, sy: p.sy, duplicate: true };
          return;
        }
      }
      dragRef.current = { kind: "move", start: { x: p.x, y: p.y }, ids, base: dragBase(), moved: false, sx: p.sx, sy: p.sy };
      return;
    }

    if (!e.shiftKey) select([]);
    // A marquee that starts inside a frame picks that frame's contents, not the frame itself.
    const home = frameAt(doc, p.x, p.y);
    const scope = (home ? doc.elements[home].childIds : doc.rootIds).filter((id) => shownOn(doc, id));
    dragRef.current = { kind: "marquee", start: { x: p.x, y: p.y }, prev: e.shiftKey ? s.selection : [], additive: e.shiftKey, scope };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = point(e);
    const d = dragRef.current;
    const s = getState();

    if (s.tool === "brush" || s.tool === "eraser") {
      setCursorPos({ sx: p.sx, sy: p.sy });
    }

    if (strokeRef.current) {
      handleStrokeMove(e);
      return;
    }

    if (!d) {
      if (s.editingId) return;
      if (spaceRef.current || s.tool === "hand") return setCursor("grab");
      if (s.tool === "brush" || s.tool === "eraser") return setCursor("none");
      if (s.tool === "pen") {
        penHover(p);
        return setCursor("crosshair");
      }
      if (CREATE_TOOLS.includes(s.tool) || s.tool === "comment") return setCursor(s.tool === "text" ? "text" : "crosshair");
      if (s.tool === "zoom") return setCursor(e.altKey ? "zoom-out" : "zoom-in");
      if (getLayout().rulers) {
        const near = guideNear(p.sx, p.sy);
        if (near) return setCursor(near.axis === "x" ? "col-resize" : "row-resize");
        if (p.sy < RULER || p.sx < RULER) return setCursor("default");
      }
      const h = handleAt(p.sx, p.sy);
      if (h) {
        if (s.overlay.hoverId) setOverlay({ hoverId: null });
        return setCursor(handleCursor(h, s.selection.length > 1 ? 0 : turnOf(workDoc(s).elements[s.selection[0]])));
      }
      if (turnAt(p.sx, p.sy)) {
        if (s.overlay.hoverId) setOverlay({ hoverId: null });
        return setCursor(TURN_CURSOR);
      }
      const doc = workDoc(s);
      const hover = labelAt(p.sx, p.sy) ?? hitTest(doc, p.x, p.y);
      if (hover !== s.overlay.hoverId) setOverlay({ hoverId: hover });
      if (e.altKey && isMovable(doc, hover)) return setCursor("copy");
      setCursor("default");
      return;
    }

    if (d.kind === "node") {
      if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) < 3) return;
      d.moved = true;
      dragNode(d.hit, d.start, p.x - d.at.x, p.y - d.at.y, e.altKey);
      return;
    }

    if (d.kind === "node-marquee") {
      if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) < 3) return;
      d.moved = true;
      const rect = normalize(d.start.x, d.start.y, p.x, p.y);
      const doc = workDoc(s);
      const pts = worldNodesOf(doc, d.pathId);
      const inside: number[] = [];
      pts.forEach((pt, idx) => {
        if (pointInRect(pt.x, pt.y, rect)) inside.push(idx);
      });
      const selected = d.additive ? Array.from(new Set([...d.prev, ...inside])) : inside;
      setOverlay({ marquee: rect, nodeEdit: { id: d.pathId, selected } });
      return;
    }

    if (d.kind === "pen") {
      if (d.index !== null) penDrag(d.index, p, s.viewport.zoom);
      return;
    }

    if (d.kind === "pan") {
      setViewport({ ...s.viewport, x: d.vx + (p.sx - d.sx), y: d.vy + (p.sy - d.sy) });
      return;
    }

    if (d.kind === "guide") {
      if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) < 3) return;
      d.moved = true;
      const at = Math.round(d.axis === "x" ? p.x : p.y);
      if (d.from === null) dragPreview("add_guide", { axis: d.axis, at });
      else dragPreview("move_guide", { axis: d.axis, from: d.from, at });
      setOverlay({ guideNow: { axis: d.axis, at } });
      return;
    }

    if (d.kind === "zoom") {
      if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) < 3) return;
      d.moved = true;
      const factor = Math.exp((p.sx - d.sx) * 0.006);
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, d.startZoom * factor));
      const wx = (d.sx - d.vx) / d.startZoom;
      const wy = (d.sy - d.vy) / d.startZoom;
      setViewport({ zoom, x: d.sx - wx * zoom, y: d.sy - wy * zoom });
      return;
    }

    if (d.kind === "create") {
      const rect = drawnBox(d.start, p, e.shiftKey, e.altKey);
      setOverlay({ draft: { type: d.type, rect } });
      return;
    }

    if (d.kind === "move") {
      if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) < 3) return;
      if (!d.moved) {
        d.moved = true;
        if (d.duplicate) select(d.ids);
      }
      if (d.duplicate) setCursor("copy");
      let dx = p.x - d.start.x;
      let dy = p.y - d.start.y;
      let guidesX: number[] = [];
      let guidesY: number[] = [];
      let gaps: Gap[] = [];
      if (!(e.metaKey || e.ctrlKey)) {
        const skip = new Set<string>();
        for (const id of d.ids) {
          skip.add(id);
          descendants(d.base, id).forEach((x) => skip.add(x));
        }
        const others = Object.keys(d.base.elements)
          .filter((id) => !skip.has(id))
          .map((id) => worldBounds(d.base, id));
        const box = unionRect(d.ids.map((id) => worldBounds(d.base, id)));
        if (box) {
          const near = 6 / s.viewport.zoom;
          // ruler guides first, then the edges and middles of neighbours on the way that is still free, then equal gaps
          const moved = { ...box, x: box.x + dx, y: box.y + dy };
          const onGuide = snapToGuides(moved, d.base.guides, near);
          dx += onGuide.dx;
          dy += onGuide.dy;
          if (onGuide.x !== null) guidesX = [onGuide.x];
          if (onGuide.y !== null) guidesY = [onGuide.y];
          const snap = snapRect({ ...box, x: box.x + dx, y: box.y + dy }, others, near);
          if (onGuide.x === null) {
            dx += snap.dx;
            guidesX = snap.guidesX;
          }
          if (onGuide.y === null) {
            dy += snap.dy;
            guidesY = snap.guidesY;
          }
          const equal = snapEqualGaps({ ...box, x: box.x + dx, y: box.y + dy }, others, near, 400 / s.viewport.zoom);
          if (onGuide.x === null && snap.guidesX.length === 0) dx += equal.dx;
          if (onGuide.y === null && snap.guidesY.length === 0) dy += equal.dy;
          gaps = gapsAround({ ...box, x: box.x + dx, y: box.y + dy }, others, 160 / s.viewport.zoom);
        }
      }
      if (d.duplicate) {
        dragPreviewDoc(runCommand(d.base, "move_elements", { ids: d.ids, dx, dy }));
      } else {
        dragPreview("move_elements", { ids: d.ids, dx, dy });
      }
      setOverlay({ guidesX, guidesY, gaps });
      return;
    }

    if (d.kind === "resize" && d.many) {
      const rect = resizeTurned(d.orig, 0, d.handle, p.x - d.start.x, p.y - d.start.y, { keepRatio: e.shiftKey, fromCenter: e.altKey });
      const fx = rect.width / Math.max(1, d.orig.width);
      const fy = rect.height / Math.max(1, d.orig.height);
      let doc = dragBase();
      for (const m of d.many) {
        const el = doc.elements[m.id];
        if (!el) continue;
        const parent = el.parentId ? worldPos(doc, el.parentId) : { x: 0, y: 0 };
        const x = rect.x + (m.r.x - d.orig.x) * fx;
        const y = rect.y + (m.r.y - d.orig.y) * fy;
        doc = runCommand(doc, "resize_element", { id: m.id, x: x - parent.x, y: y - parent.y, width: Math.max(1, m.r.width * fx), height: Math.max(1, m.r.height * fy) });
      }
      dragPreviewDoc(doc);
      return;
    }
    if (d.kind === "resize") {
      const rect = resizeTurned(d.orig, d.turn, d.handle, p.x - d.start.x, p.y - d.start.y, { keepRatio: e.shiftKey, fromCenter: e.altKey });
      const doc = dragBase();
      const el = doc.elements[d.id];
      const parent = el.parentId ? worldPos(doc, el.parentId) : { x: 0, y: 0 };
      dragPreview("resize_element", { id: d.id, x: rect.x - parent.x, y: rect.y - parent.y, width: rect.width, height: rect.height });
      return;
    }

    if (d.kind === "turn") {
      if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) < 3) return;
      d.moved = true;
      const now = (Math.atan2(p.y - d.centre.y, p.x - d.centre.x) * 180) / Math.PI;
      // add up the small steps the pointer makes, so going past half a turn does not jump back
      d.spun += tidyAngle(now - d.from);
      d.from = now;
      // whole degrees, or steps of 15 with Shift
      const step = e.shiftKey ? 15 : 1;
      const turned = Math.round((d.base + d.spun) / step) * step;
      const rotation = d.free ? turned : tidyAngle(turned);
      if (d.many) {
        // each thing turns by the same amount and swings round the middle of them all
        const rad = (turned * Math.PI) / 180;
        let doc = dragBase();
        for (const m of d.many) {
          const el = doc.elements[m.id];
          if (!el) continue;
          const cx = m.r.x + m.r.width / 2 - d.centre.x;
          const cy = m.r.y + m.r.height / 2 - d.centre.y;
          const nx = d.centre.x + cx * Math.cos(rad) - cy * Math.sin(rad);
          const ny = d.centre.y + cx * Math.sin(rad) + cy * Math.cos(rad);
          const parent = el.parentId ? worldPos(doc, el.parentId) : { x: 0, y: 0 };
          doc = runCommand(doc, "set_props", { ids: [m.id], props: { rotation: tidyAngle(m.rot + turned), x: nx - m.r.width / 2 - parent.x, y: ny - m.r.height / 2 - parent.y } });
        }
        dragPreviewDoc(doc);
        setOverlay({ turning: tidyAngle(turned) });
        return;
      }
      dragPreview("set_props", { ids: [d.id], props: { rotation } });
      setOverlay({ turning: rotation });
      return;
    }

    if (d.kind === "deep") {
      if (Math.hypot(p.sx - d.sx, p.sy - d.sy) < 3) return;
      const doc = workDoc(s);
      const home = frameAt(doc, d.start.x, d.start.y);
      const scope = (home ? doc.elements[home].childIds : doc.rootIds).filter((id) => shownOn(doc, id));
      if (!d.shift) select([]);
      dragRef.current = { kind: "marquee", start: d.start, prev: d.shift ? d.prev : [], additive: d.shift, scope };
      return;
    }

    if (d.kind === "marquee") {
      const rect = normalize(d.start.x, d.start.y, p.x, p.y);
      const doc = workDoc(s);
      const inside = d.scope.filter((id) => doc.elements[id] && !doc.elements[id].locked && !doc.elements[id].hidden && rectsIntersect(rect, worldBounds(doc, id)));
      setOverlay({ marquee: rect });
      select(d.additive ? Array.from(new Set([...d.prev, ...inside])) : inside);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (strokeRef.current) {
      canvasRef.current?.releasePointerCapture(e.pointerId);
      const stroke = strokeRef.current;
      strokeRef.current = null;
      void finishStroke(stroke);
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    if (!d) return;
    const p = point(e);

    if (d.kind === "node") {
      if (d.moved) {
        dragCommit("Edit points");
      } else {
        dragCancel();
        if (d.hit.part === "anchor" && !e.shiftKey) {
          selectNodes([d.hit.index]);
        }
      }
      return;
    }

    if (d.kind === "pen") return;

    if (d.kind === "deep") {
      const doc = workDoc();
      if (!isMovable(doc, d.hit)) return;
      const within = (inner: string, outer: string) => {
        for (let at = doc.elements[inner]?.parentId; at; at = doc.elements[at]?.parentId) if (at === outer) return true;
        return false;
      };
      // a thing and what holds it are never picked together: digging in from the frame picks just the thing
      const adds = d.shift || (d.prev.length > 0 && !d.prev.some((id) => within(d.hit, id) || within(id, d.hit)));
      select(adds ? [...d.prev, d.hit] : [d.hit]);
      return;
    }

    if (d.kind === "guide") {
      setOverlay({ guideNow: null });
      if (!d.moved) return;
      // let go back on the ruler it came from, and the guide goes away
      const onRuler = d.axis === "y" ? p.sy < RULER : p.sx < RULER;
      if (onRuler) {
        dragCancel();
        if (d.from !== null) dispatch("remove_guide", { axis: d.axis, at: d.from });
      } else dragCommit(d.from === null ? "Add a guide" : "Move a guide");
      return;
    }

    if (d.kind === "pan") {
      setCursor(spaceRef.current ? "grab" : "default");
      return;
    }

    if (d.kind === "zoom") {
      if (!d.moved) {
        const zoomIn = !e.altKey;
        const vp = getState().viewport;
        const baseZoom = d.priorGlide && d.priorGlide.zoomIn === zoomIn ? d.priorGlide.zoom : vp.zoom;
        const targetZoom = nextZoomLevel(baseZoom, zoomIn);
        const wx = (d.sx - vp.x) / vp.zoom;
        const wy = (d.sy - vp.y) / vp.zoom;
        glideTo({
          zoom: targetZoom,
          x: d.sx - wx * targetZoom,
          y: d.sy - wy * targetZoom,
          zoomIn,
        });
      }
      return;
    }

    if (d.kind === "create") {
      const dragged = Math.hypot(p.sx - d.sx, p.sy - d.sy) >= 4;
      const size = DEFAULT_SIZE[d.type];
      const world = dragged
        ? drawnBox(d.start, p, e.shiftKey, e.altKey)
        : { x: d.start.x, y: d.start.y, width: size.w, height: size.h };
      const doc = workDoc();
      const parent = d.parentId ? worldPos(doc, d.parentId) : { x: 0, y: 0 };
      const id = newId(d.type);
      dispatch("create_element", {
        id,
        type: d.type,
        x: world.x - parent.x,
        y: world.y - parent.y,
        width: world.width,
        height: world.height,
        parentId: d.parentId,
      });
      select([id]);
      setTool("move");
      clearOverlay();
      if (d.type === "text") setEditing(id);
      return;
    }

    if (d.kind === "move") {
      if (d.moved) {
        let label = d.duplicate ? "Duplicate" : d.ids.length > 1 ? `Move ${d.ids.length} elements` : "Move element";
        const doc = d.base;
        // Dropped over a different frame (or off every frame)? Change parent, like Figma.
        if (d.ids.every((id) => doc.elements[id]?.type !== "frame")) {
          const target = frameAt(doc, p.x, p.y);
          const changing = d.ids.filter((id) => (doc.elements[id].parentId ?? null) !== target);
          if (changing.length > 0) {
            const name = target ? doc.elements[target].name : null;
            if (!d.duplicate) label = name ? `Move into ${name}` : "Move out of frame";
            dragPreviewDoc(runCommand(workDoc(), "reparent_elements", { ids: changing, parentId: target, label: d.duplicate ? "Duplicate" : label }));
          }
        }
        dragCommit(label);
      } else dragCancel();
      setOverlay({ guidesX: [], guidesY: [], gaps: [] });
      if (e.altKey) {
        setCursor(isMovable(workDoc(), labelAt(p.sx, p.sy) ?? hitTest(workDoc(), p.x, p.y)) ? "copy" : "default");
      } else {
        setCursor("default");
      }
      return;
    }

    if (d.kind === "resize") {
      dragCommit("Resize element");
      return;
    }

    if (d.kind === "turn") {
      if (d.moved) dragCommit("Rotate");
      else dragCancel();
      setOverlay({ turning: null });
      return;
    }

    if (d.kind === "marquee" || d.kind === "node-marquee") setOverlay({ marquee: null });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (getState().tool === "zoom") return; // each click already zoomed
    if (getState().tool === "pen") {
      if (penActive()) penFinish(false);
      return;
    }
    const p = point(e);
    const doc = workDoc();
    if (editing()) {
      if (doubleClickNode(p.x, p.y, hitNode(p.sx, p.sy))) return;
      if (!hitTest(doc, p.x, p.y)) {
        exitNodeEdit();
        return;
      }
    }
    const hit = hitTest(doc, p.x, p.y);
    if (hit && doc.elements[hit].type === "path") {
      enterNodeEdit(hit);
      return;
    }
    // double-click a group or a copy of a component to pick what is under the pointer inside it
    if (hit && (doc.elements[hit].type === "group" || doc.elements[hit].type === "instance")) {
      const inner = hitTest(doc, p.x, p.y, new Set(), true);
      if (inner && inner !== hit) select([inner]);
      return;
    }
    // double-click a frame to pick everything inside it
    if (hit && doc.elements[hit].type === "frame" && doc.elements[hit].childIds.length) {
      select(doc.elements[hit].childIds.filter((c) => !doc.elements[c].locked));
      return;
    }
    if (hit && doc.elements[hit].type === "text") {
      select([hit]);
      setEditing(hit);
    }
  };

  // ---------- wheel, pinch ----------
  useEffect(() => {
    const canvas = canvasRef.current!;
    // A pinch on a Mac trackpad arrives as gesture events. While one is running, ignore wheel zoom,
    // so the same pinch is never counted twice.
    let pinch: { zoom: number; wx: number; wy: number } | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (getState().editingId) return;
      stopGlide();
      const p = point(e);
      // A mouse wheel turns in whole notches of 120 (or by lines); a trackpad slides in small steps.
      const notched = e.deltaMode !== 0 || (e.deltaX === 0 && (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY !== 0 && ((e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 1) % 120 === 0);
      const mouseZoom = notched && !e.shiftKey && getLayout().wheelZooms;
      if (e.ctrlKey || e.metaKey || mouseZoom) {
        if (pinch) return;
        // one notch of a mouse wheel is about a fifth more or less
        const step = mouseZoom && !(e.ctrlKey || e.metaKey) ? Math.sign(e.deltaY) * 20 : Math.max(-40, Math.min(40, e.deltaY));
        zoomAt(p.sx, p.sy, Math.exp(-step * 0.01));
      } else {
        const vp = getState().viewport;
        // Shift with a mouse wheel slides sideways
        const dx = notched && e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = notched && e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setViewport({ ...vp, x: vp.x - dx, y: vp.y - dy });
      }
    };
    type GestureEvent = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      stopGlide();
      const vp = getState().viewport;
      const p = point(e as GestureEvent);
      // remember which point of the design sits under the fingers, and keep it there
      pinch = { zoom: vp.zoom, wx: (p.sx - vp.x) / vp.zoom, wy: (p.sy - vp.y) / vp.zoom };
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (!pinch) return;
      const g = e as GestureEvent;
      const p = point(g);
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinch.zoom * g.scale));
      setViewport({ zoom, x: p.sx - pinch.wx * zoom, y: p.sy - pinch.wy * zoom });
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      pinch = null;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("gesturestart", onGestureStart);
    canvas.addEventListener("gesturechange", onGestureChange);
    canvas.addEventListener("gestureend", onGestureEnd);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("gesturestart", onGestureStart);
      canvas.removeEventListener("gesturechange", onGestureChange);
      canvas.removeEventListener("gestureend", onGestureEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- copy, cut, paste ----------
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (viewOnly || typing(e.target)) return;
      const s = getState();
      const payload = extractPayload(workDoc(s), s.selection);
      if (!payload) return;
      e.preventDefault();
      inMemoryClip = payload;
      e.clipboardData?.setData("text/plain", payloadToText(payload));
      if (cut) {
        dispatch("delete_elements", { ids: payload.rootIds });
        select([]);
      }
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    const paste = (e: ClipboardEvent) => {
      if (viewOnly || typing(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void placeFiles(files);
        return;
      }
      const fromSystem = textToPayload(e.clipboardData?.getData("text/plain") ?? "");
      const payload = fromSystem ?? inMemoryClip;
      if (!payload) return;
      e.preventDefault();
      pastePayload(payload);
    };
    window.addEventListener("copy", copy);
    window.addEventListener("cut", cut);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("copy", copy);
      window.removeEventListener("cut", cut);
      window.removeEventListener("paste", paste);
    };
  }, []);

  // ---------- keyboard ----------
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (viewOnly || typing(e.target)) return;
      const s = getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (e.key === "Alt" && s.tool === "zoom") setCursor("zoom-out");
      if (e.key === "Alt" && s.tool === "move" && isMovable(workDoc(s), s.overlay.hoverId)) setCursor("copy");

      if (editing()) {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          exitNodeEdit();
          return;
        }
        if ((e.key === "Backspace" || e.key === "Delete") && deleteSelectedNode()) {
          e.preventDefault();
          return;
        }
        const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (arrows[e.key]) {
          const step = e.shiftKey ? 10 : 1;
          const [ax, ay] = arrows[e.key];
          if (nudgeSelectedNodes(ax * step, ay * step)) {
            e.preventDefault();
            return;
          }
        }
      }

      if (s.tool === "pen" && penActive()) {
        if (e.key === "Enter") {
          e.preventDefault();
          penFinish(false);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          penCancel();
          setTool("move");
          return;
        }
        if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault();
          penBack();
          return;
        }
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (!spaceRef.current) {
          spaceRef.current = true;
          setCursor("grab");
        }
        return;
      }
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        const doc = workDoc(s);
        const only = s.selection.length === 1 ? doc.elements[s.selection[0]] : undefined;
        const parents = new Set(s.selection.map((i) => doc.elements[i]?.parentId ?? null));
        let pool: string[];
        if (only && (only.type === "frame" || only.type === "group") && only.childIds.length) pool = only.childIds;
        else if (s.selection.length && parents.size === 1 && [...parents][0]) pool = doc.elements[[...parents][0]!].childIds;
        else pool = doc.rootIds;
        select(pool.filter((i) => doc.elements[i] && !doc.elements[i].locked && !doc.elements[i].hidden));
        return;
      }
      if (mod && e.altKey && e.code === "KeyK") {
        e.preventDefault();
        const doc = workDoc(s);
        const ids = s.selection.filter((i) => canBeComponent(doc.elements[i]));
        for (const id of ids) dispatch("create_component", { id });
        return;
      }
      // On a Mac the menu bar catches Cmd Option M. Windows menus miss Ctrl Alt M, so the canvas takes it there.
      if (mod && e.altKey && e.code === "KeyM" && !/Mac/.test(navigator.platform)) {
        e.preventDefault();
        maskSelection();
        return;
      }
      if (mod && e.altKey && e.code === "KeyB") {
        e.preventDefault();
        const doc = workDoc(s);
        for (const id of s.selection.filter((i) => doc.elements[i]?.type === "instance")) dispatch("detach_instance", { id });
        return;
      }
      // Cmd ] one step to the front, Cmd [ one step back, with Shift all the way
      if (mod && !e.altKey && (e.code === "BracketRight" || e.code === "BracketLeft")) {
        e.preventDefault();
        if (s.selection.length) {
          const front = e.code === "BracketRight";
          dispatch("arrange_elements", { ids: s.selection, to: e.shiftKey ? (front ? "top" : "bottom") : front ? "up" : "down" });
        }
        return;
      }
      if (mod && key === "g") {
        e.preventDefault();
        const doc = workDoc(s);
        if (e.shiftKey) {
          const kids = s.selection.flatMap((i) => (doc.elements[i]?.type === "group" ? doc.elements[i].childIds : []));
          dispatch("ungroup", { ids: s.selection });
          if (kids.length) select(kids);
        } else if (s.selection.length) {
          const id = newId("group");
          dispatch("group_elements", { ids: s.selection, groupId: id });
          if (workDoc().elements[id]) select([id]);
        }
        return;
      }
      if (mod && e.shiftKey && key === "l") {
        e.preventDefault();
        const doc = workDoc(s);
        const els = s.selection.map((i) => doc.elements[i]).filter(Boolean);
        if (els.length) {
          const lock = !els.every((x) => x.locked);
          dispatch("set_props", { ids: els.map((x) => x.id), props: { locked: lock }, label: lock ? "Lock" : "Unlock" });
        }
        return;
      }
      if (e.shiftKey && !mod && key === "a") {
        e.preventDefault();
        const sel = s.selection.filter((id) => workDoc(s).elements[id]);
        const doc = workDoc(s);
        if (sel.length === 1 && doc.elements[sel[0]].type === "frame") {
          const f = doc.elements[sel[0]];
          dispatch("set_layout", { id: f.id, layout: f.layout ? null : defaultLayout() });
        } else if (sel.length >= 1) {
          const id = newId("frame");
          dispatch("wrap_in_layout", { ids: sel, frameId: id });
          if (workDoc().elements[id]) select([id]);
        }
        return;
      }
      if (mod && e.shiftKey && key === "k") {
        e.preventDefault();
        void pickImages();
        return;
      }
      if (mod && key === "d") {
        e.preventDefault();
        const payload = extractPayload(workDoc(s), s.selection);
        if (payload) pastePayload(payload, true);
        return;
      }
      if (mod) return;

      if (e.shiftKey && e.key === "!") {
        zoomToFit(sizeRef.current.w, sizeRef.current.h);
        return;
      }
      if (e.shiftKey && e.key === "@") {
        zoomToElements(getState().selection, sizeRef.current.w, sizeRef.current.h);
        return;
      }
      // Shift and C puts the comment pins away, and brings them back
      if (e.shiftKey && !e.altKey && !mod && key === "c") {
        e.preventDefault();
        setLayout({ commentsHidden: !getLayout().commentsHidden });
        return;
      }
      if (e.shiftKey && !e.altKey && key === "r") {
        e.preventDefault();
        setLayout({ rulers: !getLayout().rulers });
        return;
      }
      const tools: Record<string, Tool> = { v: "move", f: "frame", r: "rect", o: "ellipse", t: "text", h: "hand", p: "pen", z: "zoom", c: "comment" };
      if (getLayout().mode === "photo") {
        tools.b = "brush";
        tools.e = "eraser";
      }
      if (tools[key]) {
        e.preventDefault();
        setTool(tools[key]);
        setCursor(tools[key] === "hand" ? "grab" : tools[key] === "zoom" ? "zoom-in" : tools[key] === "brush" || tools[key] === "eraser" ? "none" : tools[key] === "move" ? "default" : "crosshair");
        return;
      }
      if (!mod && !e.altKey && !e.shiftKey && (s.tool === "brush" || s.tool === "eraser") && (e.code === "BracketLeft" || e.code === "BracketRight" || e.key === "[" || e.key === "]")) {
        e.preventDefault();
        stepBrushSize(e.code === "BracketRight" || e.key === "]" ? 1 : -1);
        return;
      }
      // Tab points the AI at what is selected, and again takes it off. Only when no panel or field has the keys.
      if (e.key === "Tab" && !mod && !e.shiftKey && !e.altKey && (e.target === document.body || (e.target as HTMLElement | null)?.tagName === "CANVAS")) {
        e.preventDefault();
        const same = s.selection.length === s.focus.length && s.selection.every((i) => s.focus.includes(i));
        setFocus(!s.selection.length || same ? [] : s.selection);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (s.selection.length) {
          e.preventDefault();
          dispatch("delete_elements", { ids: topLevelOnly(workDoc(s), s.selection) });
          select([]);
        }
        return;
      }
      if (e.key === "Escape") {
        if (strokeRef.current) {
          cancelStroke(strokeRef.current);
          strokeRef.current = null;
          return;
        }
        select([]);
        setTool("move");
        return;
      }
      if (e.key === "Enter" && s.selection.length === 1 && ["frame", "group"].includes(workDoc(s).elements[s.selection[0]]?.type ?? "") && !e.shiftKey) {
        const doc = workDoc(s);
        const kids = doc.elements[s.selection[0]].childIds.filter((c) => !doc.elements[c].locked);
        if (kids.length) {
          e.preventDefault();
          select(kids);
          return;
        }
      }
      if (e.key === "Enter" && e.shiftKey && s.selection.length) {
        const doc = workDoc(s);
        const parent = doc.elements[s.selection[0]]?.parentId;
        if (parent) {
          e.preventDefault();
          select([parent]);
          return;
        }
      }
      if (e.key === "Enter" && s.selection.length === 1 && workDoc(s).elements[s.selection[0]]?.type === "text") {
        e.preventDefault();
        setEditing(s.selection[0]);
        return;
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key] && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [ax, ay] = arrows[e.key];
        nudge(topLevelOnly(workDoc(s), s.selection), ax * step, ay * step);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        setCursor("default");
      }
      if (e.key === "Alt" && getState().tool === "zoom") setCursor("zoom-in");
      if (e.key === "Alt" && getState().tool === "move" && !dragRef.current) setCursor("default");
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // the top bar and the layers panel can ask the canvas to move
  useEffect(() => {
    const fit = () => zoomToFit(sizeRef.current.w, sizeRef.current.h);
    const fitSelection = (e: Event) => {
      const ids = (e as CustomEvent<string[] | undefined>).detail ?? getState().selection;
      zoomToElements(ids, sizeRef.current.w, sizeRef.current.h);
    };
    const reveal = (e: Event) => revealElements((e as CustomEvent<string[]>).detail ?? [], sizeRef.current.w, sizeRef.current.h);
    const level = (e: Event) => zoomTo((e as CustomEvent<number>).detail, sizeRef.current.w, sizeRef.current.h);
    window.addEventListener("duet:fit", fit);
    window.addEventListener("duet:fit-selection", fitSelection);
    window.addEventListener("duet:zoom", level);
    window.addEventListener("duet:reveal", reveal);
    return () => {
      window.removeEventListener("duet:fit", fit);
      window.removeEventListener("duet:fit-selection", fitSelection);
      window.removeEventListener("duet:zoom", level);
      window.removeEventListener("duet:reveal", reveal);
    };
  }, []);

  // If the design has scrolled completely out of view, offer a way back.
  const docNow = useStore((s) => s.timeline[s.cursor].doc);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const { w, h } = sizeRef.current;
    if (docNow.rootIds.length === 0 || w === 0) return setLost(false);
    const view = { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom, width: w / viewport.zoom, height: h / viewport.zoom };
    setLost(!docNow.rootIds.some((id) => rectsIntersect(view, worldBounds(docNow, id))));
  }, [viewport, docNow]);

  // something just brought in, like a Photoshop file, is shown whole
  useEffect(() => {
    const show = () => zoomToElements(getState().selection, sizeRef.current.w, sizeRef.current.h);
    window.addEventListener("duet:show-selection", show);
    return () => window.removeEventListener("duet:show-selection", show);
  }, []);

  return (
    <div
      className="canvas-wrap"
      ref={wrapRef}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        const rect = wrapRef.current?.getBoundingClientRect();
        const vp = getState().viewport;
        const at = rect ? { x: (e.clientX - rect.left - vp.x) / vp.zoom, y: (e.clientY - rect.top - vp.y) / vp.zoom } : undefined;
        const all = Array.from(e.dataTransfer.files);
        // a Photoshop file comes in as a frame with its layers, and Duet moves to Photo
        for (const f of all.filter((f) => isPhotoshopFile(f.name))) void openPhotoshopFile(f, at);
        const files = all.filter((f) => !isPhotoshopFile(f.name));
        // a video or a sound is not read into Duet: it is played from where it is, so its place on the computer is needed
        if (files.some((f) => clipKind(f.name))) {
          const known = droppedPaths(e.dataTransfer).filter((p) => clipKind(p));
          const clips = files.filter((f) => clipKind(f.name));
          const frame = at ? frameAt(workDoc(), at.x, at.y) : null;
          void (async () => {
            let paths = known;
            let problems: string[] = [];
            try {
              if (!frame) problems = ["Drop a clip onto a frame."];
              else {
                // when the system does not say where the file is, Duet keeps its own copy beside the projects
                if (!paths.length) paths = await keepDropped(clips);
                problems = await dropClips(frame, paths);
              }
            } catch (err) {
              problems = [String(err instanceof Error ? err.message : err)];
            }
            if (paths.length && frame && !problems.length) {
              setLayout({ mode: "motion" });
              select([frame]);
            }
            if (problems.length) void message(problems.join(" "), { title: "Duet", kind: "info" });
          })();
        }
        void placeFiles(files, at);
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={viewOnly ? undefined : onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          if (viewOnly) return;
          const p = point(e);
          const doc = workDoc();
          const hit = hitTest(doc, p.x, p.y, new Set(), e.metaKey || e.ctrlKey);
          const sel = getState().selection;
          if (hit && !sel.includes(hit)) select([hit]);
          else if (!hit) select([]);
          window.dispatchEvent(new CustomEvent("duet:context", { detail: { x: e.clientX, y: e.clientY } }));
        }}
        onPointerLeave={() => {
          setCursorPos(null);
          if (!dragRef.current && getState().overlay.hoverId) setOverlay({ hoverId: null });
        }}
      />
      {cursorPos && !spaceRef.current && (toolNow === "brush" || toolNow === "eraser") && (() => {
        const s = getState();
        const doc = workDoc(s);
        let targetEl: El | null = null;
        if (s.selection.length === 1 && doc.elements[s.selection[0]]?.type === "image") {
          targetEl = doc.elements[s.selection[0]];
        } else if (s.overlay.hoverId && doc.elements[s.overlay.hoverId]?.type === "image") {
          targetEl = doc.elements[s.overlay.hoverId];
        }
        let scale = 1;
        if (targetEl) {
          const pic = pictureOf(targetEl);
          if (pic) {
            const sz = pictureSize(pic);
            scale = pictureCoverScale(targetEl, sz);
          }
        }
        const screenRadius = (brushSettings.size / 2) * scale * viewport.zoom;
        return (
          <div
            className="brush-cursor"
            style={{
              position: "absolute",
              left: Math.round(cursorPos.sx - screenRadius),
              top: Math.round(cursorPos.sy - screenRadius),
              width: Math.round(screenRadius * 2),
              height: Math.round(screenRadius * 2),
              borderRadius: "50%",
              border: "1px solid rgba(255, 255, 255, 0.9)",
              boxShadow: "0 0 1px 1px rgba(0, 0, 0, 0.75)",
              pointerEvents: "none",
              zIndex: 10,
            }}
          />
        );
      })()}
      {lost && (
        <button className="find" onClick={() => zoomToFit(sizeRef.current.w, sizeRef.current.h)}>
          Find your design
        </button>
      )}
      {editingId && <TextEditor key={editingId} id={editingId} zoom={viewport.zoom} vx={viewport.x} vy={viewport.y} />}
      {!viewOnly && <Comments zoom={viewport.zoom} vx={viewport.x} vy={viewport.y} draft={draft} onDraftDone={() => setDraft(null)} />}
    </div>
  );
}

/** The box a new shape is drawn in. Shift keeps it as wide as it is tall, for a circle or a square; Option or Alt draws it out from where the drag started. */
export function drawnBox(start: { x: number; y: number }, p: { x: number; y: number }, even: boolean, fromMiddle: boolean): Rect {
  let dx = p.x - start.x;
  let dy = p.y - start.y;
  if (even) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  return fromMiddle ? normalize(start.x - dx, start.y - dy, start.x + dx, start.y + dy) : normalize(start.x, start.y, start.x + dx, start.y + dy);
}

function normalize(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/** The comments pinned on the canvas, and the box a new one is written in. Resolved ones are gone from view. */
function Comments({ zoom, vx, vy, draft, onDraftDone }: { zoom: number; vx: number; vy: number; draft: { x: number; y: number; on: string | null } | null; onDraftDone: () => void }) {
  const list = useStore((s) => workDoc(s).comments);
  const hidden = useLayout((d) => d.commentsHidden);
  const open = useOpenComment();
  const [editing, setEditing] = useState<string | null>(null);
  const setOpen = (id: string | null) => (setEditing(null), setOpenComment(id));
  const shown = hidden ? [] : (list ?? []).filter((c) => !c.resolved);
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();
  return (
    <>
      {shown.map((c, i) => (
        <div key={c.id} className="comment" style={{ left: c.x * zoom + vx, top: c.y * zoom + vy }} onPointerDown={stop} onDoubleClick={stop}>
          <button className={`comment-pin${c.by === "ai" ? " ai" : ""}${open === c.id ? " open" : ""}`} title={c.text} onClick={() => setOpen(open === c.id ? null : c.id)}>
            {i + 1}
          </button>
          {open === c.id && (
            <div className="comment-card">
              <button className="comment-close" title="Close" aria-label="Close" onClick={() => setOpen(null)}>
                ×
              </button>
              {editing === c.id ? (
                <CommentText
                  start={c.text}
                  onDone={(text) => {
                    if (text) dispatch("edit_comment", { id: c.id, text });
                    setEditing(null);
                  }}
                />
              ) : (
                <p>{c.text}</p>
              )}
              <div className="comment-actions">
                {c.by === "you" && editing !== c.id && <button onClick={() => setEditing(c.id)}>Edit</button>}
                <button onClick={() => (dispatch("delete_comment", { id: c.id }), setOpen(null))}>Delete</button>
                <button className="primary" onClick={() => (dispatch("resolve_comment", { id: c.id }), setOpen(null))}>
                  Resolve
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
      {draft && <CommentDraft key={`${draft.x},${draft.y}`} at={draft} left={draft.x * zoom + vx} top={draft.y * zoom + vy} onDone={onDraftDone} />}
    </>
  );
}

function CommentDraft({ at, left, top, onDone }: { at: { x: number; y: number; on: string | null }; left: number; top: number; onDone: () => void }) {
  return (
    <div className="comment" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      <span className="comment-pin open" />
      <div className="comment-card">
        <CommentText
          start=""
          onDone={(text) => {
            if (text) dispatch("add_comment", { x: at.x, y: at.y, text, on: at.on });
            onDone();
          }}
        />
      </div>
    </div>
  );
}

/** The box a comment is written or changed in. Enter keeps it, Shift and Enter starts a new line, Esc leaves it as it was. */
function CommentText({ start, onDone }: { start: string; onDone: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    // after the click that placed it, so the click does not take the keys back
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(keep ? (ref.current?.value.trim() ?? "") : "");
  };
  return (
    <textarea
      ref={ref}
      rows={2}
      defaultValue={start}
      placeholder="Say what to change here"
      spellCheck={false}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") finish(false);
        else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        }
      }}
    />
  );
}

/** Space between the edge of the typing box and its words: its padding and its border. */
const EDIT_EDGE = 3.5;

function TextEditor({ id, zoom, vx, vy }: { id: string; zoom: number; vx: number; vy: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const doc = workDoc();
  const el = doc.elements[id];
  const [value, setValue] = useState(el?.text ?? "");

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (!el) return null;
  const pos = worldPos(doc, id);

  const finish = () => {
    const text = ref.current?.value ?? el.text;
    setEditing(null);
    if (cancelled.current) {
      if (el.text === "") dispatch("delete_elements", { ids: [id] });
      return;
    }
    if (text.trim() === "") {
      dispatch("delete_elements", { ids: [id] });
      select([]);
      return;
    }
    dispatch("set_props", { ids: [id], props: { text }, label: "Edit text" });
  };

  // The words on the canvas are hidden while you type, and this box stands exactly where they were:
  // the same lines, the same size, and the same height above the line, so nothing jumps or doubles.
  const box = layoutText({ ...el, text: value || " " });
  const width = (el.textFixed ? el.width : box.width) * zoom;
  const height = box.height * zoom;
  const lift = textLift(el) * zoom;

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={value}
      spellCheck={false}
      wrap={el.textFixed ? "soft" : "off"}
      style={{
        left: pos.x * zoom + vx - EDIT_EDGE,
        top: pos.y * zoom + vy - EDIT_EDGE + lift,
        // a hair wider than the words need, so a line that only just fits is not pushed down
        width: width + (el.textFixed ? 0.5 : 4),
        height: height + Math.max(0, -lift),
        font: fontCss(el, el.fontSize * zoom),
        lineHeight: `${lineStep(el) * zoom}px`,
        letterSpacing: el.letterSpacing * zoom,
        textAlign: el.textAlign,
        color: el.fill,
        whiteSpace: el.textFixed ? "pre-wrap" : "pre",
        // turned text is typed at the angle it sits at
        transform: turnOf(el) ? `rotate(${turnOf(el)}deg)` : undefined,
        transformOrigin: `${EDIT_EDGE + (el.width * zoom) / 2}px ${EDIT_EDGE - lift + (el.height * zoom) / 2}px`,
      }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          cancelled.current = true;
          ref.current?.blur();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          // Enter starts a new line, as in any text; Cmd or Ctrl with Enter finishes
          e.preventDefault();
          ref.current?.blur();
        }
      }}
    />
  );
}

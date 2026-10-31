import { invoke } from "@tauri-apps/api/core";
import { open } from "../ui/dialog";
import { drawElement } from "../canvas/render";
import { docAt, fileTimeAt, spanOf } from "../document/time";
import { playsFile } from "../document/types";
import type { Doc } from "../document/types";
import { currentDoc, dispatch, getState, select } from "../state/store";
import { clipsIn, drawingMade, fileLength, holdClips, setMadePicture } from "./clips";
import { pause } from "./play";
import { hiddenHere, loudness } from "../document/tracks";

/** A frame that plays: bringing clips into it, and making one video file out of it. */

const KINDS = ["mp4", "mov", "m4v", "webm", "mkv", "avi"];
const SOUNDS = ["mp3", "wav", "m4a", "aac", "aiff", "aif", "ogg", "flac"];
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

interface Info {
  duration: number;
  width: number;
  height: number;
  sound: boolean;
}

/** Ask for video files and put them in the frame, starting at the moment the clock is on. Returns what could not be read. */
export async function addClips(sceneId: string): Promise<string[]> {
  const picked = await open({ multiple: true, title: "Bring in clips", filters: [{ name: "Video", extensions: KINDS }] });
  return placeClips(sceneId, picked === null ? [] : Array.isArray(picked) ? picked : [picked]);
}

/** A small line at the bottom of the window while something slow is going on. */
function busy(text: string | null) {
  let el = document.getElementById("busy-note");
  if (!text) return el?.remove();
  if (!el) {
    el = document.createElement("div");
    el.id = "busy-note";
    document.body.appendChild(el);
  }
  el.textContent = text;
}

/**
 * Keep dropped files in the Clips folder beside the projects, and say where each one now is. The
 * window is handed what is in a dropped file but not where it is, and a clip is played from a file.
 */
export async function keepDropped(files: File[]): Promise<string[]> {
  const paths: string[] = [];
  const PART = 8 * 1024 * 1024;
  try {
    for (const file of files) {
      const kept = await invoke<{ path: string; already: boolean }>("clip_keep_begin", { name: file.name, size: file.size });
      if (!kept.already) {
        for (let from = 0; from < file.size; from += PART) {
          busy(`Bringing in ${file.name}, ${Math.round((from / file.size) * 100)}%`);
          await invoke("clip_keep_part", new Uint8Array(await file.slice(from, from + PART).arrayBuffer()));
        }
        await invoke("clip_keep_end");
      }
      paths.push(kept.path);
    }
  } finally {
    busy(null);
  }
  return paths;
}

/** Whether a file is a video or a sound Duet can bring into a scene, going by its name. */
export const clipKind = (path: string): "video" | "sound" | null => {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  return KINDS.includes(ext) ? "video" : SOUNDS.includes(ext) ? "sound" : null;
};

/**
 * Files dropped onto a frame. The frame becomes a scene if it was not one, as long as the first clip.
 * Returns what could not be read.
 */
export async function dropClips(frameId: string, paths: string[], from?: number): Promise<string[]> {
  const videos = paths.filter((p) => clipKind(p) === "video");
  const sounds = paths.filter((p) => clipKind(p) === "sound");
  const frame = currentDoc().elements[frameId];
  if (!frame || frame.type !== "frame" || frame.parentId) return ["Drop a clip onto a frame on the page."];
  const problems: string[] = [];
  try {
    if (!(frame.duration > 0)) {
      const length = videos.length ? (await invoke<Info>("video_info", { path: videos[0] })).duration : await fileLength(sounds[0]);
      dispatch("set_duration", { id: frameId, seconds: Math.max(1, Math.round(length * 1000) / 1000) });
    }
  } catch (e) {
    return [String(e instanceof Error ? e.message : e)];
  }
  problems.push(...(await placeClips(frameId, videos, from)));
  problems.push(...(await placeSounds(frameId, sounds)));
  return problems;
}

/** Put video files in a scene, one after another, starting at the moment the clock is on or the one given. Returns what could not be read. */
export async function placeClips(sceneId: string, paths: string[], from?: number): Promise<string[]> {
  const problems: string[] = [];
  let at = from ?? (getState().clock.scene === sceneId ? getState().clock.t : 0);
  for (const path of paths) {
    try {
      const info = await invoke<Info>("video_info", { path });
      const scene = currentDoc().elements[sceneId];
      if (!scene) break;
      // the clock left at the end starts again from the beginning; a drop at the end adds the clip after it
      if (from === undefined && at >= scene.duration - 0.05) at = 0;
      const end = Math.round((at + info.duration) * 1000) / 1000;
      // the frame grows to hold a clip that runs past its end
      if (end > scene.duration) dispatch("set_duration", { id: sceneId, seconds: end });
      const k = Math.min(scene.width / info.width, scene.height / info.height);
      const width = Math.round(info.width * k);
      const height = Math.round(info.height * k);
      const id = `video-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      dispatch("create_element", {
        type: "video",
        id,
        parentId: sceneId,
        x: Math.round((scene.width - width) / 2),
        y: Math.round((scene.height - height) / 2),
        width,
        height,
        props: { src: path, name: fileName(path), start: at, end },
      });
      select([id]);
      at = end;
    } catch (e) {
      problems.push(`${fileName(path)}: ${String(e)}`);
    }
  }
  return problems;
}

/** Ask for sound files, such as music or a voice, and put them in the frame from the moment the clock is on. They are only heard. */
/** Bring in video and sound with one choice of files. Each goes where its kind belongs. Returns what could not be read. */
export async function addMedia(sceneId: string): Promise<string[]> {
  const picked = await open({ multiple: true, title: "Add to this scene", filters: [{ name: "Video and sound", extensions: [...KINDS, ...SOUNDS] }] });
  const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
  const isSound = (p: string) => SOUNDS.includes(p.split(".").pop()?.toLowerCase() ?? "");
  const clips = await placeClips(sceneId, paths.filter((p) => !isSound(p)));
  return clips.concat(await placeSounds(sceneId, paths.filter(isSound)));
}

export async function addSounds(sceneId: string): Promise<string[]> {
  const picked = await open({ multiple: true, title: "Bring in sound", filters: [{ name: "Sound", extensions: SOUNDS }] });
  return placeSounds(sceneId, picked === null ? [] : Array.isArray(picked) ? picked : [picked]);
}

/** Put sound files in a scene, from the moment the clock is on. Returns what could not be read. */
export async function placeSounds(sceneId: string, paths: string[]): Promise<string[]> {
  const problems: string[] = [];
  for (const path of paths) {
    try {
      const length = await fileLength(path);
      const scene = currentDoc().elements[sceneId];
      if (!scene) break;
      let at = getState().clock.scene === sceneId ? getState().clock.t : 0;
      if (at >= scene.duration - 0.05) at = 0;
      // music is usually longer than the video: it stops where the video stops, and does not make it longer
      const end = Math.min(scene.duration, Math.round((at + length) * 1000) / 1000);
      const id = `sound-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      dispatch("create_element", { type: "sound", id, parentId: sceneId, x: 0, y: 0, width: 1, height: 1, props: { src: path, name: fileName(path), start: at, end } });
      select([id]);
    } catch (e) {
      problems.push(`${fileName(path)}: ${String(e instanceof Error ? e.message : e)}`);
    }
  }
  return problems;
}


/** Sounds cut to a part of the scene, timed from its start. */
export function soundsBetween(list: ReturnType<typeof soundsOf>, from: number, to: number) {
  return list.flatMap((s) => {
    const start = Math.max(s.at, from);
    const end = Math.min(s.at + s.length, to);
    if (end <= start) return [];
    return [{ ...s, from: s.from + (start - s.at) * s.speed, at: start - from, length: end - start }];
  });
}

/** The sound of every clip in a frame: which file, from where in it, when it is heard, and how loud. */
export function soundsOf(doc: Doc, sceneId: string) {
  const scene = doc.elements[sceneId];
  const out: { path: string; from: number; at: number; length: number; volume: number; speed: number }[] = [];
  const walk = (id: string, from: number, to: number) => {
    for (const c of doc.elements[id]?.childIds ?? []) {
      const el = doc.elements[c];
      if (!el || hiddenHere(doc, el)) continue;
      const span = spanOf(el, scene);
      // a clip inside a group is heard only while the group shows
      const start = Math.max(span.start, from);
      const end = Math.min(span.end, to);
      if (end <= start) continue;
      if (playsFile(el) && el.src && loudness(doc, el) > 0) out.push({ path: el.src, from: fileTimeAt(el, span.start, start), at: start, length: end - start, volume: loudness(doc, el), speed: el.speed || 1 });
      walk(c, start, end);
    }
  };
  if (scene) walk(sceneId, 0, scene.duration);
  return out;
}

let stop = false;
/** Give up on the video being made. */
export const stopExport = () => {
  stop = true;
};

/** How a video is made: how big, how smooth, how fine, and where it goes. */
export interface ExportChoice {
  /** The longer side of the video in pixels, or 0 to keep the size of the scene. */
  longSide: number;
  fps: number;
  /** ffmpeg's own scale: lower is finer and makes a bigger file. */
  quality: number;
  /** The folder it goes into. Left out, it goes to Documents, Duet, Exports. */
  dir?: string;
  /** A full path, used by the builder tools in place of everything above about where. */
  to?: string;
  /** A ProRes .mov at 10-bit, to keep editing or grading elsewhere, instead of an MP4 to share. */
  master?: boolean;
}

export const SIZES: { name: string; longSide: number }[] = [
  { name: "Same as the scene", longSide: 0 },
  { name: "4K", longSide: 3840 },
  { name: "1080p", longSide: 1920 },
  { name: "720p", longSide: 1280 },
];
export const QUALITIES: { name: string; quality: number }[] = [
  { name: "Best", quality: 15 },
  { name: "Good", quality: 20 },
  { name: "Small file", quality: 27 },
];
export const defaultChoice = (): ExportChoice => ({ longSide: 0, fps: 30, quality: 20 });

/** Where videos go when no folder was chosen: Documents, Duet, Exports. */
export const exportsDir = async () => `${await invoke<string>("default_projects_dir")}/Exports`;

/** The size a scene comes out at for a choice, in even numbers of pixels, as video needs. */
export function exportSize(scene: { width: number; height: number }, longSide: number): [number, number] {
  const k = longSide > 0 ? longSide / Math.max(scene.width, scene.height) : 1;
  const even = (n: number) => Math.max(2, Math.round(n) - (Math.round(n) % 2));
  return [even(scene.width * k), even(scene.height * k)];
}

/**
 * The clip at the bottom of a picture of the video, when it fills the whole picture. That clip is then
 * read from its own file at full quality and graded by the export engine, and only what lies over it
 * is drawn here. Returns null when the picture has to be drawn whole, as the canvas draws it.
 */
async function baseClip(doc: Doc, now: Doc, sceneId: string, t: number, sizes: Map<string, Info>) {
  const scene = now.elements[sceneId];
  const shown = scene.childIds.map((id) => now.elements[id]).filter((e) => e && !hiddenHere(now, e) && e.type !== "sound");
  const el = shown[0];
  if (!el || el.type !== "video" || el.rotation || el.opacity < 0.999 || (el.blend ?? "normal") !== "normal" || el.radius || el.mask) return null;
  if (el.x > 0.01 || el.y > 0.01 || el.x + el.width < scene.width - 0.01 || el.y + el.height < scene.height - 0.01) return null;
  let info = sizes.get(el.src);
  if (!info) {
    info = await invoke<Info>("video_info", { path: el.src }).catch(() => undefined);
    if (!info) return null;
    sizes.set(el.src, info);
  }
  // the clip fills its box and what does not fit is cut off, just as drawClip lays it
  const k = Math.max(el.width / info.width, el.height / info.height);
  const left = el.x + (el.width - info.width * k) / 2;
  const top = el.y + (el.height - info.height * k) / 2;
  const even = (n: number) => Math.max(0, Math.round(n / 2) * 2);
  const cw = Math.min(info.width, even(scene.width / k));
  const ch = Math.min(info.height, even(scene.height / k));
  const cx = Math.min(info.width - cw, even(-left / k));
  const cy = Math.min(info.height - ch, even(-top / k));
  const { start } = spanOf(doc.elements[el.id], doc.elements[sceneId]);
  const without = { ...now, elements: { ...now.elements, [el.id]: { ...el, hidden: true }, [sceneId]: { ...scene, fill: "#00000000", gradient: null } } };
  return {
    base: { id: el.id, path: el.src, speed: el.speed || 1, at: Math.max(0, fileTimeAt(el, start, t)), crop: [cx, cy, cw, ch], matrix: info.height <= 576 ? "bt601" : "bt709", grade: el.grade },
    over: shown.length > 1,
    without,
  };
}

/**
 * Have the export engine read every clip drawn at this moment from its own file, at the size it is drawn.
 * The web view is not asked: it can give a black picture for a large file without saying so. `skip` is
 * the clip at the bottom, which the engine reads and lays down itself.
 */
async function readClips(doc: Doc, now: Doc, sceneId: string, t: number, sx: number, sy: number, sizes: Map<string, Info>, skip?: string) {
  const scene = doc.elements[sceneId];
  for (const id of clipsIn(now, sceneId)) {
    const el = now.elements[id];
    const { start, end } = spanOf(doc.elements[id], scene);
    if (el.type !== "video" || id === skip || t < start || t >= end) {
      setMadePicture(id, 0, 0, null);
      continue;
    }
    let info = sizes.get(el.src);
    if (!info) {
      info = await invoke<Info>("video_info", { path: el.src }).catch(() => undefined);
      if (!info) throw new Error(`The clip "${el.name}" could not be read, so the video was not made.`);
      sizes.set(el.src, info);
    }
    // the whole picture, at the size that fills the clip's box in the video, as drawClip lays it
    const k = Math.max((el.width * sx) / info.width, (el.height * sy) / info.height);
    const w = Math.max(1, Math.min(8192, Math.round(info.width * k)));
    const h = Math.max(1, Math.min(8192, Math.round(info.height * k)));
    const at = Math.max(0, fileTimeAt(doc.elements[id], start, t));
    const bytes = await invoke<ArrayBuffer>("scene_export_clip", { ask: { id, path: el.src, at, speed: el.speed || 1, width: w, height: h, matrix: info.height <= 576 ? "bt601" : "bt709" } });
    // an empty answer means the file ended before the clip did, and the clip shows black, as on the canvas
    const got = bytes instanceof ArrayBuffer ? bytes.byteLength : -1;
    if (got !== w * h * 4 && got !== 0) throw new Error(`The clip "${el.name}" could not be read at ${Math.round(t * 100) / 100}s (${got} of ${w * h * 4}), so the video was not made.`);
    setMadePicture(id, w, h, got ? new Uint8ClampedArray(bytes) : null);
  }
}

/**
 * Make one video file out of a frame that plays. Every picture of it is drawn here, exactly as the
 * canvas draws it, and handed over one by one. Returns the file, or null if the designer backed out.
 */
export async function exportScene(sceneId: string, progress: (done: number) => void, choice: ExportChoice = defaultChoice(), doc: Doc = currentDoc()): Promise<string | null> {
  const scene = doc.elements[sceneId];
  if (!scene?.duration) throw new Error("This frame has no length yet.");
  let out: string | null;
  const ext = choice.master ? "mov" : "mp4";
  if (choice.to) out = choice.to;
  else {
    // no question asked: it goes in the chosen folder, or beside the projects, named by the scene and the time
    const dir = choice.dir || (await exportsDir());
    await invoke("make_dir", { path: dir });
    const d = new Date();
    const two = (n: number) => String(n).padStart(2, "0");
    const safe = scene.name.replace(/[\\/:*?"<>|]/g, " ").trim() || "Video";
    out = `${dir}/${safe} ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}.${ext}`;
  }
  if (!out) return null;
  const file = out.toLowerCase().endsWith(`.${ext}`) ? out : `${out}.${ext}`;
  const FPS = Math.max(1, Math.min(120, Math.round(choice.fps) || 30));
  const [width, height] = exportSize(scene, choice.longSide);
  const scale = width / scene.width;
  const sheet = document.createElement("canvas");
  sheet.width = width;
  sheet.height = height;
  const ctx = sheet.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("The video could not be drawn.");
  // with a work area marked, only that part is made
  const from = scene.workArea?.start ?? 0;
  const to = scene.workArea?.end ?? scene.duration;
  const total = Math.max(1, Math.round((to - from) * FPS));
  stop = false;
  pause();
  holdClips(true);
  let begun = false;
  try {
    await invoke("scene_export_begin", { out: file, fps: FPS, seconds: total / FPS, quality: choice.quality, sounds: soundsBetween(soundsOf(doc, sceneId), from, to), width, height, master: !!choice.master });
    begun = true;
    const sizes = new Map<string, Info>();
    for (let i = 0; i < total; i++) {
      if (stop) throw new Error("Stopped.");
      const t = from + i / FPS;
      let now = docAt(doc, sceneId, t);
      const base = await baseClip(doc, now, sceneId, t, sizes);
      if (base) now = base.without;
      const drawn = !base || base.over;
      let body = new Uint8Array(0);
      if (drawn) {
        await readClips(doc, now, sceneId, t, scale, height / scene.height, sizes, base?.base.id);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (base) ctx.clearRect(0, 0, width, height);
        else {
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, width, height);
        }
        // the scene is drawn at the size asked for, sharp at any size because it is drawn, not stretched
        ctx.setTransform(scale, 0, 0, height / scene.height, 0, 0);
        const el = now.elements[sceneId];
        drawingMade(() => drawElement(ctx, now, el, -el.x, -el.y));
        body = new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
      }
      await invoke("scene_export_frame", body, { headers: { "x-duet-frame": JSON.stringify({ base: base?.base ?? null, drawn }) } });
      progress((i + 1) / total);
    }
    await invoke("scene_export_end");
    return file;
  } catch (e) {
    if (begun) await invoke("scene_export_stop").catch(() => {});
    if (stop) return null;
    throw e;
  } finally {
    holdClips(false);
  }
}

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { fileTimeAt, frameTimeAt, spanOf } from "../document/time";
import { playsFile } from "../document/types";
import type { Doc } from "../document/types";
import { logError } from "../errorLog";

/**
 * The players behind video clips on the canvas. Each clip has its own hidden player, so the clip coming
 * next can wait on its first picture while the one before it plays, and a cut never stalls. The canvas
 * draws whatever picture a clip's player is on, so a clip is kept in step with the clock from here.
 *
 * On the canvas a player plays a light copy of the file once Duet has made one: smaller, and quick to
 * jump around in. Making a video uses players on the original file, so nothing is lost in the result.
 */

/** One player for each file, only for questions about the file itself, such as how long it is. */
const players = new Map<string, HTMLMediaElement>();
/** One player for each clip on the canvas. */
const clipPlayers = new Map<string, HTMLMediaElement>();
/** Which file each canvas player plays, so it can be moved over to the file's light copy. */
const fileOf = new Map<HTMLMediaElement, string>();
/** The light copy of each file, once Duet has made it. */
const copies = new Map<string, string>();
/** When each clip's player was last needed, so the ones long out of sight can be let go. */
const lastUsed = new Map<string, number>();
/** How many clip players are kept at most: the ones playing and the one coming next, as editors do. Each holds some of the computer's video decoding. */
const MAX_CLIP_PLAYERS = 3;
/** Players on the original files, used only while a video is being made. One for each clip, so two clips of one file can be at different moments. */
const fullPlayers = new Map<string, HTMLMediaElement>();
/** Files whose light copy has been asked for, so it is asked for once. */
const previewAsked = new Set<string>();
let changed: () => void = () => {};
/** While a video is being made, the players are moved frame by frame and the clock leaves them alone. */
let held = false;

/** Called when a player has a new picture to show, so the canvas can draw again. */
export const onClipPicture = (fn: () => void) => {
  changed = fn;
};

export const holdClips = (on: boolean) => {
  held = on;
  madePictures.clear();
  if (!on) letGoOfOriginals();
};

/** The players on original files can be large and hold the computer's video decoding: let them go when done. */
export function letGoOfOriginals() {
  for (const v of fullPlayers.values()) {
    v.removeAttribute("src");
    v.load();
  }
  fullPlayers.clear();
}

/** A sound file gets a sound player: the system will not play a file with nothing to see in a video player. */
const SOUND_FILE = /\.(mp3|wav|m4a|aac|aiff?|ogg|flac)$/i;

function makePlayer(src: string, into: Map<string, HTMLMediaElement>, key = src): HTMLMediaElement {
  const sound = SOUND_FILE.test(src);
  const v = document.createElement(sound ? "audio" : "video");
  v.crossOrigin = "anonymous";
  v.preload = "auto";
  if (v instanceof HTMLVideoElement) v.playsInline = true;
  v.src = convertFileSrc(src);
  for (const ev of ["loadeddata", "seeked"]) v.addEventListener(ev, () => changed());
  v.addEventListener("seeked", () => seekedNext(v));
  // the light copy may be what failed, so the address it was really playing is named
  v.addEventListener("error", () => logError("clip", new Error(`This clip could not be played (${v.error?.code ?? "?"} ${v.error?.message ?? ""}): ${v.currentSrc || src}`)));
  into.set(key, v);
  return v;
}

/** A player on the light copy of a file, once there is one. */
function lightPlayer(src: string, into: Map<string, HTMLMediaElement>, key: string): HTMLMediaElement {
  const known = into.get(key);
  if (known) return known;
  const v = makePlayer(src, into, key);
  fileOf.set(v, src);
  const copy = copies.get(src);
  if (copy) v.src = convertFileSrc(copy);
  else askPreview(src);
  return v;
}

const player = (src: string) => lightPlayer(src, players, src);

function clipPlayer(el: { id: string; src: string }): HTMLMediaElement {
  lastUsed.set(el.id, performance.now());
  return lightPlayer(el.src, clipPlayers, el.id);
}

/** Let go of the clip players needed longest ago, keeping the ones in use now. */
function letGoOfOldClips(keep: Set<string>) {
  if (clipPlayers.size <= MAX_CLIP_PLAYERS) return;
  const old = [...clipPlayers.keys()].filter((id) => !keep.has(id)).sort((a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0));
  for (const id of old.slice(0, clipPlayers.size - MAX_CLIP_PLAYERS)) {
    const v = clipPlayers.get(id)!;
    v.removeAttribute("src");
    v.load();
    clipPlayers.delete(id);
    lastUsed.delete(id);
    fileOf.delete(v);
    wanted.delete(v);
    heading.delete(v);
    rolling.delete(v);
    clearTimeout(settleTimers.get(v));
    settleTimers.delete(v);
  }
}

const fullPlayer = (id: string, src: string) => fullPlayers.get(id) ?? makePlayer(src, fullPlayers, id);

/** Have Duet make the light copy in the background, then move every player of the file over to it where it was. */
function askPreview(src: string) {
  // a sound is already light, and has no picture to make smaller
  if (SOUND_FILE.test(src) || previewAsked.has(src) || !("__TAURI_INTERNALS__" in window)) return;
  previewAsked.add(src);
  invoke<string>("clip_preview", { path: src })
    .then((copy) => {
      copies.set(src, copy);
      for (const v of [...players.values(), ...clipPlayers.values()]) {
        if (fileOf.get(v) !== src) continue;
        const at = v.currentTime;
        const wasPlaying = !v.paused;
        v.addEventListener(
          "loadedmetadata",
          () => {
            v.currentTime = at;
            if (wasPlaying) void v.play().catch(() => undefined);
          },
          { once: true },
        );
        v.src = convertFileSrc(copy);
      }
    })
    // without a copy the original keeps playing, as before
    .catch((e) => logError("clip preview", e));
}

/**
 * The picture a clip is on right now, or null while it is not ready. With an id, the clip's player on its
 * original file, once seekClips has moved it. While a video is made, the canvas on screen keeps showing
 * its own light players where they were.
 */
export function clipPicture(src: string, id?: string): HTMLVideoElement | null {
  if (!src) return null;
  const v = id ? fullPlayers.get(id) : player(src);
  return v instanceof HTMLVideoElement && v.readyState >= 2 ? v : null;
}

/** The picture a clip on the canvas is on right now, from its own player, or null while it is not ready. */
export function clipPictureOf(el: { id: string; src: string }): HTMLVideoElement | null {
  if (!el.src) return null;
  const v = clipPlayer(el);
  return v instanceof HTMLVideoElement && v.readyState >= 2 ? v : null;
}

// ---- scrubbing: one jump at a time, and only to where the playhead is now ----

/** Where each player should be, and where its jump in flight is heading. */
const wanted = new Map<HTMLMediaElement, number>();
const heading = new Map<HTMLMediaElement, number>();
const settleTimers = new Map<HTMLMediaElement, ReturnType<typeof setTimeout>>();

function jump(v: HTMLMediaElement, at: number, quick: boolean) {
  heading.set(v, at);
  // a quick jump lands on the nearest picture that is fast to show; the exact one follows when the hand stops
  if (quick && typeof v.fastSeek === "function") v.fastSeek(at);
  else v.currentTime = at;
}

function seekedNext(v: HTMLMediaElement) {
  const want = wanted.get(v);
  if (want === undefined || want === heading.get(v)) return;
  jump(v, want, true);
}

/** Move a paused player to a moment. Called on every move of the playhead while scrubbing. */
function seekTo(v: HTMLMediaElement, at: number) {
  wanted.set(v, at);
  if (!v.seeking) jump(v, at, true);
  clearTimeout(settleTimers.get(v));
  settleTimers.set(
    v,
    setTimeout(() => {
      if (Math.abs(v.currentTime - at) <= 0.01 || wanted.get(v) !== at) return;
      if (v.seeking) v.addEventListener("seeked", () => wanted.get(v) === at && jump(v, at, false), { once: true });
      else jump(v, at, false);
    }, 150),
  );
}

/** How long a sound or video file is, in seconds. Waits until the file has said so. */
export function fileLength(src: string): Promise<number> {
  const v = player(src);
  if (v.duration > 0 && Number.isFinite(v.duration)) return Promise.resolve(v.duration);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(false), 8000);
    function done(ok: boolean) {
      clearTimeout(timer);
      v.removeEventListener("loadedmetadata", yes);
      v.removeEventListener("error", no);
      if (ok && v.duration > 0 && Number.isFinite(v.duration)) resolve(v.duration);
      else {
        players.delete(src);
        reject(new Error("That file could not be played."));
      }
    }
    const yes = () => done(true);
    const no = () => done(false);
    v.addEventListener("loadedmetadata", yes);
    v.addEventListener("error", no);
  });
}

/** What a clip's player is doing, in words. For checking Duet itself. */
export function clipState(src: string, id?: string): string {
  const v = (id && clipPlayers.get(id)) || players.get(src);
  if (!v) return "no player";
  if (v.error) return `failed (${v.error.code})`;
  return `${v.paused ? "paused" : "playing"} at ${Math.round(v.currentTime * 100) / 100}s, ready ${v.readyState}`;
}

/** How long a clip's file is, in seconds, or 0 while that is not known yet. */
export const clipLength = (src: string) => (src ? player(src).duration || 0 : 0);

export const clipsIn = (doc: Doc, sceneId: string) => {
  const out: string[] = [];
  const walk = (id: string) => {
    for (const c of doc.elements[id]?.childIds ?? []) {
      const el = doc.elements[c];
      if (!el || el.hidden) continue;
      if (playsFile(el)) out.push(c);
      walk(c);
    }
  };
  walk(sceneId);
  return out;
};

/** How far ahead of the playhead a clip coming next is put on its first picture, in seconds. */
const LOOK_AHEAD = 2;
/**
 * How long before its cut a clip coming next starts playing, silent and out of sight, so it is already
 * moving when the playhead reaches it. A player takes a moment to get going, and the clock never waits.
 */
const ROLL_IN = 0.3;
/** Players of clips coming next that are already rolling silently towards their cut. */
const rolling = new Set<HTMLMediaElement>();

/** Put every clip of a frame on the picture that belongs to this moment, and play or hold it. */
export function syncClips(doc: Doc, sceneId: string | null, t: number, playing: boolean) {
  if (held) return;
  const live = new Set<string>();
  const scene = sceneId ? doc.elements[sceneId] : null;
  if (scene?.duration) {
    for (const id of clipsIn(doc, scene.id)) {
      const el = doc.elements[id];
      const { start, end } = spanOf(el, scene);
      if (t < start || t >= end) continue;
      live.add(id);
      const v = clipPlayer(el);
      const at = fileTimeAt(el, start, t);
      v.volume = Math.max(0, Math.min(1, el.volume));
      v.playbackRate = el.speed || 1;
      if (playing) {
        // while playing, the clip leads the clock (see clockFromClip); only a big gap means a jump.
        // A player already on its picture is not moved again, or it would stall to find the same spot.
        rolling.delete(v);
        const gap = Math.abs(v.currentTime - at);
        if (gap > 1 || (v.paused && gap > 0.05)) {
          wanted.delete(v);
          clearTimeout(settleTimers.get(v));
          v.currentTime = at;
        }
        if (v.paused) void v.play().catch((e) => logError("clip", e));
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - at) > 0.02) seekTo(v, at);
      }
    }
    // a clip coming up next waits on its first picture, so it starts the moment the playhead reaches it
    if (playing) {
      for (const id of clipsIn(doc, scene.id)) {
        const el = doc.elements[id];
        const { start } = spanOf(el, scene);
        if (start <= t || start > t + LOOK_AHEAD || live.has(id)) continue;
        live.add(id);
        const v = clipPlayer(el);
        const rate = el.speed || 1;
        const lead = start - t;
        // close to the cut, it starts playing early from just before its first picture, when the file has that much
        const from = el.clipFrom - lead * rate;
        if (lead <= ROLL_IN && from >= 0 && v.paused && !v.seeking && v.readyState >= 2) {
          v.volume = 0;
          v.playbackRate = rate;
          v.currentTime = from;
          rolling.add(v);
          void v.play().catch((e) => logError("clip", e));
          continue;
        }
        if (rolling.has(v)) continue;
        const at = fileTimeAt(el, start, start);
        if (v.paused && !v.seeking && v.readyState >= 1 && Math.abs(v.currentTime - at) > 0.05) {
          wanted.set(v, at);
          jump(v, at, false);
        }
      }
    }
  }
  // a clip waiting to come next is held on its first picture, not played
  for (const [id, v] of clipPlayers) {
    const el = doc.elements[id];
    if (live.has(id) && el && scene && (t >= spanOf(el, scene).start || (playing && rolling.has(v)))) continue;
    rolling.delete(v);
    if (!v.paused) v.pause();
  }
  for (const v of players.values()) if (!v.paused) v.pause();
  letGoOfOldClips(live);
}

/**
 * While a frame plays, the clock follows the clip that is playing, so the clip never has to jump to
 * catch the clock. Returns the frame time the clip is at, or null when no clip is playing.
 */
export function clockFromClip(doc: Doc, sceneId: string, t: number): number | null {
  const scene = doc.elements[sceneId];
  if (!scene?.duration) return null;
  for (const id of clipsIn(doc, sceneId)) {
    const el = doc.elements[id];
    const { start, end } = spanOf(el, scene);
    if (t < start || t >= end) continue;
    const v = clipPlayers.get(id);
    if (!v) continue;
    // a clip that is late does not hold the clock: the clock runs on, as in any editor
    if (v.paused || v.seeking || v.readyState < 3) continue;
    const at = frameTimeAt(el, start, v.currentTime);
    // a clip that has not started yet, or has run out, does not lead
    if (at < t - 1 || at > t + 1) continue;
    return Math.max(t, at);
  }
  return null;
}

/** Move every clip of a frame to one moment and wait until its picture is there. */
export async function seekClips(doc: Doc, sceneId: string, t: number) {
  const scene = doc.elements[sceneId];
  const waits: Promise<void>[] = [];
  for (const id of clipsIn(doc, sceneId)) {
    const el = doc.elements[id];
    const { start, end } = spanOf(el, scene);
    if (el.type !== "video" || t < start || t >= end) continue;
    const v = fullPlayer(id, el.src);
    v.pause();
    const at = Math.min(fileTimeAt(el, start, t), (v.duration || Infinity) - 0.001);
    waits.push(
      new Promise<void>((resolve) => {
        const ready = () => v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - at) < 0.001;
        if (ready()) return resolve();
        const timer = setTimeout(finish, 4000);
        function finish() {
          clearTimeout(timer);
          v.removeEventListener("seeked", finish);
          v.removeEventListener("loadeddata", onLoad);
          resolve();
        }
        function onLoad() {
          v.currentTime = at;
        }
        v.addEventListener("seeked", finish);
        if (v.readyState >= 1) v.currentTime = at;
        else v.addEventListener("loadeddata", onLoad);
      }),
    );
  }
  await Promise.all(waits);
}

/** While a video is made: each clip's picture for the moment being made, read from its file by the export engine. */
const madePictures = new Map<string, HTMLCanvasElement>();

/** True only while a picture of the video is being drawn, so the canvas on screen keeps its own players. */
let drawingVideo = false;

/** Draw one picture of the video with the clips' pictures from the export engine. */
export function drawingMade(draw: () => void) {
  drawingVideo = true;
  try {
    draw();
  } finally {
    drawingVideo = false;
  }
}

/** Whether a picture of the video is being drawn right now. */
export const drawingVideoNow = () => drawingVideo;

/** The picture the export engine read for this clip, while a picture of the video is drawn. */
export const madePicture = (id: string): HTMLCanvasElement | null => (drawingVideo ? (madePictures.get(id) ?? null) : null);

/** Keep the picture the export engine read for a clip, or forget it when the clip has none at this moment. */
export function setMadePicture(id: string, w: number, h: number, rgba: Uint8ClampedArray<ArrayBuffer> | null) {
  if (!rgba) return void madePictures.delete(id);
  let c = madePictures.get(id);
  if (!c) madePictures.set(id, (c = document.createElement("canvas")));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  c.getContext("2d")?.putImageData(new ImageData(rgba, w, h), 0, 0);
}

import { convertFileSrc } from "@tauri-apps/api/core";
import { fileTimeAt, spanOf } from "../document/time";
import { gainAt } from "../document/sound";
import type { Doc, El } from "../document/types";
import { logError } from "../errorLog";

/**
 * One audio clock for the preview (#439). While playing, every sound is scheduled on one AudioContext to
 * start at an exact moment of its file, and the playhead reads the time from that same clock. So a cut
 * lands where it should, whatever the file: no player has to start late or seek inexactly.
 * The pictures follow this clock. Making a video does not use it.
 */

/** Files longer than this are not held in memory yet: they keep the old way (long files in pieces come next). */
const MAX_SECONDS = 600;
const MAX_BYTES = 300e6;
/** How often a changing volume is sampled, in seconds. */
const STEP = 0.03;

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer | null>();
const loading = new Map<string, Promise<void>>();
let onReady: () => void = () => {};

/** Called when a file's sound is ready, so a clip that was waiting can join the clock. */
export const onSoundReady = (fn: () => void) => {
  onReady = fn;
};

/** Turn the audio clock off with `localStorage.setItem("duet.oldSound", "1")`: the clips' own players are heard again. */
const allowed = () => {
  try {
    return localStorage.getItem("duet.oldSound") !== "1";
  } catch {
    return true;
  }
};

function context(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof AudioContext === "undefined") return null;
  ctx = new AudioContext({ latencyHint: "interactive" });
  return ctx;
}

/** Start reading a file's sound into memory, once. */
export function loadSound(src: string) {
  if (!src || buffers.has(src) || loading.has(src) || !allowed()) return;
  const c = context();
  if (!c) return;
  const job = (async () => {
    const res = await fetch(convertFileSrc(src));
    const size = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || size > MAX_BYTES) return void buffers.set(src, null);
    const data = await res.arrayBuffer();
    const buf = await c.decodeAudioData(data);
    buffers.set(src, buf.duration > MAX_SECONDS ? null : buf);
  })()
    // a file with no sound in it, or one that cannot be read, keeps the old way
    .catch((e) => {
      buffers.set(src, null);
      logError("audio clock", e);
    })
    .finally(() => {
      loading.delete(src);
      onReady();
    });
  loading.set(src, job);
}

/** Whether a clip is heard through the audio clock: its sound is in memory and it plays at normal pace. */
export const viaClock = (el: El) => allowed() && !!buffers.get(el.src) && (el.speed || 1) === 1;

export type Planned = {
  id: string;
  src: string;
  /** Seconds after the moment planned from that it begins: 0 or more. */
  after: number;
  /** Where in the file it begins. */
  offset: number;
  /** How long it plays, in seconds. */
  length: number;
  /** Volume at moments after it begins: [seconds, gain]. */
  gains: [number, number][];
};

/** What has to sound from moment `t` of a frame onwards, for the clips that can use the clock. Pure, so it can be checked. */
export function planSounds(doc: Doc, scene: El, t: number, ids: string[], ready: (el: El) => boolean, fileLength: (src: string) => number): Planned[] {
  const out: Planned[] = [];
  for (const id of ids) {
    const el = doc.elements[id];
    if (!el || !ready(el)) continue;
    const { start, end } = spanOf(el, scene);
    if (end <= t) continue;
    const from = Math.max(start, t);
    const offset = fileTimeAt(el, start, from);
    const length = Math.min(end - from, fileLength(el.src) - offset);
    if (length <= 0.001) continue;
    const gains: [number, number][] = [];
    const moving = el.keys.volume?.length || el.fadeIn || el.fadeOut;
    if (!moving) gains.push([0, gainAt(doc, el, scene, from)]);
    else for (let s = 0; s < length + STEP; s += STEP) gains.push([s, gainAt(doc, el, scene, from + Math.min(s, length))]);
    out.push({ id: el.id, src: el.src, after: from - t, offset, length, gains });
  }
  return out;
}

// ---- playing ----

type Running = { source: AudioBufferSourceNode; gain: GainNode };
let running: Running[] = [];
/** The frame moment that was at context time `c0`. While playing, frame time = t0 + (context time - c0). */
let t0 = 0;
let c0 = 0;
let on = false;
let scheduledFor: Doc | null = null;
let scheduledScene: string | null = null;
/** How many files had their sound ready when it was last sounded, so a file that finishes loading joins in. */
let scheduledReady = 0;
const readyCount = () => [...buffers.values()].filter(Boolean).length;
/** Seconds between the clock reaching the speakers and the sound being heard, so the picture is not ahead of it. */
const lag = () => (ctx ? (ctx.outputLatency || 0) + ctx.baseLatency : 0);

/** Whether the audio clock is running the playhead right now. */
export const clockRunning = () => on;

/** The moment of the frame it is now, from the audio clock, or null when it is not running. */
export function clockNow(): number | null {
  if (!on || !ctx) return null;
  return t0 + (ctx.currentTime - c0) - lag();
}

function stopAll() {
  for (const r of running) {
    try {
      r.source.stop();
    } catch {
      /* already ended */
    }
    r.source.disconnect();
    r.gain.disconnect();
  }
  running = [];
}

function schedule(doc: Doc, scene: El, t: number, ids: string[]) {
  const c = ctx!;
  stopAll();
  const plan = planSounds(doc, scene, t, ids, viaClock, (src) => buffers.get(src)?.duration ?? 0);
  // t is the moment now; sounds that begin later wait on the clock, sounds already begun start at their place in the file
  const now = c.currentTime;
  for (const p of plan) {
    const buf = buffers.get(p.src);
    if (!buf) continue;
    const source = c.createBufferSource();
    const gain = c.createGain();
    source.buffer = buf;
    source.connect(gain).connect(c.destination);
    gain.gain.setValueAtTime(p.gains[0]?.[1] ?? 1, now);
    const when = now + p.after;
    for (const [s, g] of p.gains) gain.gain.setValueAtTime(g, when + s);
    source.start(when, p.offset, p.length);
    running.push({ source, gain });
  }
}

/** Start the clock at a moment of a frame and sound everything from there. */
function begin(doc: Doc, scene: El, t: number, ids: string[]) {
  const c = context();
  if (!c) return;
  if (c.state !== "running") void c.resume();
  c0 = c.currentTime;
  t0 = t;
  on = true;
  scheduledFor = doc;
  scheduledScene = scene.id;
  scheduledReady = readyCount();
  schedule(doc, scene, t, ids);
}

/**
 * Keep the sound in step with the playhead. Called whenever the clock or the document changes. Playing
 * normally forwards starts it, a change to the design or a jump of the playhead sounds everything again
 * from the new place, and anything else stops it.
 */
export function syncSound(doc: Doc, sceneId: string | null, t: number, playing: boolean, ids: string[]) {
  const scene = sceneId ? doc.elements[sceneId] : null;
  for (const id of ids) {
    const src = doc.elements[id]?.src;
    if (src) loadSound(src);
  }
  if (!playing || !scene?.duration || !allowed() || !context()) {
    if (on) {
      on = false;
      stopAll();
    }
    return;
  }
  const mine = clockNow();
  if (!on) return begin(doc, scene, t, ids);
  // the design changed, or the playhead was moved by hand: sound it all again from here
  if (doc !== scheduledFor || sceneId !== scheduledScene || readyCount() !== scheduledReady || Math.abs((mine ?? t) - t) > 0.1) begin(doc, scene, t, ids);
}

/** Stop everything now. */
export function stopSound() {
  on = false;
  stopAll();
}

/** The audio clock in words. For checking Duet itself. */
export const soundState = () => `audio ${ctx?.state ?? "none"}, ${running.length} sounds scheduled, ${readyCount()} files ready, ${loading.size} loading, clock ${on ? (clockNow() ?? 0).toFixed(3) : "off"}, lag ${lag().toFixed(3)}`;

import { currentDoc, getState, setClock, subscribe } from "../state/store";
import { clockFromClip, onClipPicture, syncClips } from "./clips";

/** Playing a frame that has a length: the clock runs, the canvas follows, and clips keep in step. */

let raf = 0;
let last = 0;
/** How fast the clock runs: 1 is play, 2 to 8 faster, negative backwards. Clips only lead the clock at 1. */
let rate = 1;
/** Playing started inside the work area, so it keeps to it. Started outside, it plays the whole scene from there. */
let inWork = true;

function tick(now: number) {
  const s = getState();
  const scene = s.clock.scene ? currentDoc(s).elements[s.clock.scene] : null;
  if (!s.clock.playing || !scene?.duration) {
    raf = 0;
    if (s.clock.playing) setClock({ playing: false });
    return;
  }
  // a playing clip sets the pace; with none, the clock runs on its own
  const own = s.clock.t + (rate * (now - last)) / 1000;
  const t = rate === 1 ? clockFromClip(currentDoc(s), scene.id, s.clock.t) ?? own : own;
  last = now;
  // running backwards, it stops at the start of the work area, or of the frame
  if (rate < 0) {
    const from = inWork ? scene.workArea?.start ?? 0 : 0;
    if (t <= from) {
      raf = 0;
      rate = 1;
      setClock({ t: from, playing: false });
      return;
    }
    setClock({ t });
    raf = requestAnimationFrame(tick);
    return;
  }
  // with a work area, playing stops at its end, unless it started outside it
  const stop = scene.workArea && inWork ? Math.min(scene.workArea.end, scene.duration) : scene.duration;
  if (t >= stop) {
    raf = 0;
    rate = 1;
    setClock({ t: stop, playing: false });
    return;
  }
  setClock({ t });
  raf = requestAnimationFrame(tick);
}

export function play() {
  const s = getState();
  const scene = s.clock.scene ? currentDoc(s).elements[s.clock.scene] : null;
  if (!scene?.duration || s.clock.playing) return;
  // pressing play at the end of the work area, or of the scene, starts again from the work area's beginning.
  // With the playhead put outside the work area on purpose, it plays from there to the end of the scene.
  const from = scene.workArea?.start ?? 0;
  const to = scene.workArea ? Math.min(scene.workArea.end, scene.duration) : scene.duration;
  const t = s.clock.t;
  const atEnd = Math.abs(t - to) <= 0.01 || t >= scene.duration - 0.01;
  inWork = atEnd || (t >= from - 0.01 && t < to);
  rate = 1;
  setClock({ playing: true, t: atEnd ? from : t });
  last = performance.now();
  if (!raf) raf = requestAnimationFrame(tick);
}

export const pause = () => {
  rate = 1;
  setClock({ playing: false });
};

/** Whether playing is running at normal speed forwards, which is the only time the clips play on their own. */
export const clipsLead = () => rate === 1;

/**
 * J and L, as in Premiere: each press runs backwards or forwards, and pressing again in the same direction
 * doubles the speed, up to eight times. Pressing the other way goes back to normal speed in that direction.
 */
export function shuttle(dir: 1 | -1) {
  const s = getState();
  const scene = s.clock.scene ? currentDoc(s).elements[s.clock.scene] : null;
  if (!scene?.duration) return;
  if (s.clock.playing && Math.sign(rate) === dir) {
    rate = dir * Math.min(8, Math.abs(rate) * 2);
    setClock({});
    return;
  }
  if (dir === 1) {
    if (s.clock.playing) {
      rate = 1;
      setClock({});
    } else play();
    return;
  }
  const from = scene.workArea?.start ?? 0;
  const to = scene.workArea ? Math.min(scene.workArea.end, scene.duration) : scene.duration;
  inWork = s.clock.t >= from - 0.01 && s.clock.t <= to + 0.01;
  if (s.clock.t <= (inWork ? from : 0) + 0.01) return;
  rate = -1;
  last = performance.now();
  setClock({ playing: true });
  if (!raf) raf = requestAnimationFrame(tick);
}
export const togglePlay = () => (getState().clock.playing ? pause() : play());

/** Jump to a moment. */
export function seek(t: number) {
  const s = getState();
  const scene = s.clock.scene ? currentDoc(s).elements[s.clock.scene] : null;
  if (!scene) return;
  setClock({ t: Math.max(0, Math.min(scene.duration, t)) });
}

/** Open a frame that plays on the clock, or close the clock with null. */
export function openScene(id: string | null) {
  const s = getState();
  if (s.clock.scene === id) return;
  setClock({ scene: id, t: 0, playing: false });
}

let wired = false;
/** Keep the clips in step with the clock from now on. Called once when the app starts. */
export function wireClips() {
  if (wired) return;
  wired = true;
  let was = "";
  subscribe(() => {
    const s = getState();
    const doc = currentDoc(s);
    const lead = s.clock.playing && clipsLead();
    const now = `${s.clock.scene}|${s.clock.t}|${lead}`;
    if (now === was && doc === lastDoc) return;
    was = now;
    lastDoc = doc;
    syncClips(doc, s.clock.scene, s.clock.t, lead);
  });
  // a new picture from a clip means the canvas has to draw again
  onClipPicture(() => setClock({}));
}
let lastDoc: unknown = null;

import { spanOf } from "./time";
import type { Doc, El, Track } from "./types";

/** What a thing is on the timeline: a video clip, a sound, or a title (text and shapes). Any track holds any of them; it sets how tall a row starts. */
export type TrackKind = "clips" | "sound" | "titles";

/** What kind of thing this is on the timeline. */
export const trackKind = (el: El | undefined): TrackKind | null => (!el ? null : el.type === "video" ? "clips" : el.type === "sound" ? "sound" : "titles");

/** The saved track a thing sits on, if its frame has one for it. */
export function trackOf(doc: Doc, el: El): Track | null {
  if (!el.track || !el.parentId) return null;
  return doc.elements[el.parentId]?.tracks?.find((t) => t.id === el.track) ?? null;
}

/** Whether a thing is hidden, by itself or by its track. */
export const hiddenHere = (doc: Doc, el: El) => !!el.hidden || !!trackOf(doc, el)?.hidden;

/** How loud a clip or sound is heard, from 0 to 1: nothing when its track is silent. */
export const loudness = (doc: Doc, el: El) => (trackOf(doc, el)?.silent ? 0 : el.volume);

/** Whether two things show at the same time in the frame. */
const overlap = (a: El, b: El, frame: El) => {
  const x = spanOf(a, frame);
  const y = spanOf(b, frame);
  return x.start < y.end - 0.001 && y.start < x.end - 0.001;
};

/** Sort things into as few rows as they fit in, front first, so none in a row show at the same time. */
export function packRows(list: El[], frame: El): El[][] {
  const rows: El[][] = [];
  for (const el of list) {
    const row = rows.find((r) => !r.some((other) => overlap(el, other, frame)));
    if (row) row.push(el);
    else rows.push([el]);
  }
  return rows;
}

/** One row on a frame's timeline in Edit. A row with no track is one Duet made by itself and has not saved. */
export interface TrackRow {
  /** Its place among the rows, top first. */
  index: number;
  name: string;
  track: Track | null;
  items: El[];
}

export const baseName = (kind: TrackKind) => (kind === "clips" ? "Clips" : kind === "sound" ? "Sound" : "Titles");

/** What a row mostly holds, for how tall it starts: a row with a video clip is a clip row, one with only sound a sound row. An empty row is a clip row. */
export function rowLook(items: El[]): TrackKind {
  if (!items.length || items.some((el) => el.type === "video")) return "clips";
  return items.some((el) => el.type === "sound") ? "sound" : "titles";
}

/** A track as files from before 31 Oct 2026 saved it: each held one kind of thing. */
type KindTrack = Track & { kind?: TrackKind };

/**
 * The rows as Duet showed them when each track held one kind of thing: titles on top, then clips, then sound.
 * A thing with no track yet goes on the first row of its kind it fits on, or a new one under them. Used for a
 * scene with no saved tracks, and once, to open a file saved that way.
 */
function rowsByKind(doc: Doc, frame: El): TrackRow[] {
  const out: TrackRow[] = [];
  for (const kind of ["titles", "clips", "sound"] as const) {
    // front first, the way the timeline lists things
    const items = frame.childIds.map((id) => doc.elements[id]).filter((el): el is El => !!el && trackKind(el) === kind).reverse();
    const saved = ((frame.tracks ?? []) as KindTrack[]).filter((t) => (t.kind ?? "clips") === kind);
    const rows: TrackRow[] = saved.map((track, index) => ({ index, name: track.name, track, items: items.filter((el) => el.track === track.id) }));
    const loose = items.filter((el) => !saved.some((t) => t.id === el.track));
    const extra: El[][] = [];
    for (const el of loose) {
      const fits = (list: El[]) => !list.some((other) => overlap(el, other, frame));
      const row = rows.find((r) => fits(r.items));
      if (row) row.items.push(el);
      else {
        const more = extra.find(fits);
        if (more) more.push(el);
        else extra.push([el]);
      }
    }
    for (const list of extra) rows.push({ index: rows.length, name: `${baseName(kind)} ${rows.length + 1}`, track: null, items: list });
    out.push(...rows);
  }
  return out.map((r, index) => ({ ...r, index }));
}

/** Whether a scene's tracks were saved when each held one kind of thing. */
export const oldTracks = (frame: El) => ((frame.tracks ?? []) as KindTrack[]).some((t) => t.kind);

/** A name for a new track that no other track of the frame has. */
export function freshName(tracks: Track[]) {
  let n = tracks.length + 1;
  while (tracks.some((t) => t.name === `Track ${n}`)) n++;
  return `Track ${n}`;
}

/**
 * The rows on a frame's timeline in Edit, top first. Any track holds clips, sounds, text and shapes alike.
 * A frame with saved tracks shows those, and a thing that has none yet goes on the highest one it fits on
 * without covering another, or a new row on top. A frame without saved tracks sorts its things into title,
 * clip and sound rows by itself.
 */
export function trackRows(doc: Doc, frame: El): TrackRow[] {
  if (!frame.tracks?.length || oldTracks(frame)) return rowsByKind(doc, frame);
  // front first, the way the timeline lists things
  const items = frame.childIds.map((id) => doc.elements[id]).filter((el): el is El => !!el).reverse();
  const rows: TrackRow[] = frame.tracks.map((track, index) => ({ index, name: track.name, track, items: items.filter((el) => el.track === track.id) }));
  const ids = new Set(frame.tracks.map((t) => t.id));
  const extra: El[][] = [];
  // the oldest first, so a thing put in later never pushes an earlier one off its row
  for (const el of items.filter((el) => !ids.has(el.track ?? "")).reverse()) {
    const fits = (list: El[]) => !list.some((other) => overlap(el, other, frame));
    const row = rows.find((r) => fits(r.items));
    if (row) row.items.push(el);
    else {
      const more = extra.find(fits);
      if (more) more.push(el);
      else extra.push([el]);
    }
  }
  const names = [...frame.tracks];
  const made = extra.map((list) => {
    const name = freshName(names);
    names.push({ id: "", name });
    return { index: 0, name, track: null, items: list };
  });
  return [...made.reverse(), ...rows].map((r, index) => ({ ...r, index }));
}

/** A new track id. */
let made = 0;
export const newTrackId = () => `track-${Date.now().toString(36)}${(made++).toString(36)}`;

/**
 * Save the rows a frame shows as its own tracks, so they stay put from now on. It changes nothing that can be
 * seen: every thing stays on the row it was on, in the same order. Works on a copy of the document that is being changed.
 */
export function keepTracks(doc: Doc, frameId: string): Track[] {
  const frame = doc.elements[frameId];
  const tracks: Track[] = [];
  for (const row of trackRows(doc, frame)) {
    const { kind: _, ...track }: KindTrack = row.track ?? { id: newTrackId(), name: row.name };
    tracks.push(track);
    for (const el of row.items) doc.elements[el.id].track = track.id;
  }
  frame.tracks = tracks;
  return tracks;
}

/**
 * Put the things moved to another track in front of or behind the rest the way their tracks are: a higher
 * track is in front. Only the moved things change places, and each one moves as little as it can, so nothing
 * else in the picture changes.
 */
export function stackByTrack(doc: Doc, frameId: string, moved: string[]) {
  const frame = doc.elements[frameId];
  const order = (frame.tracks ?? []).map((t) => t.id);
  const depth = (id: string) => {
    const i = order.indexOf(doc.elements[id]?.track ?? "");
    return i < 0 ? order.length : i;
  };
  for (const id of moved) {
    const from = frame.childIds.indexOf(id);
    if (from < 0) continue;
    const list = frame.childIds.filter((c) => c !== id);
    const d = depth(id);
    // the list goes back to front: it goes in front of everything on a lower track and behind everything on a higher one
    let lo = 0;
    let hi = list.length;
    list.forEach((c, i) => {
      if (depth(c) > d) lo = i + 1;
    });
    for (let i = list.length - 1; i >= 0; i--) if (depth(list[i]) < d) hi = i;
    const at = Math.max(lo, Math.min(hi, from));
    list.splice(at, 0, id);
    frame.childIds = list;
  }
}

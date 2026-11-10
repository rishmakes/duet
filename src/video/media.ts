import { invoke } from "@tauri-apps/api/core";
import { open } from "../ui/dialog";
import { newId } from "../commands";
import type { PlaceItem } from "../commands";
import type { MediaItem } from "../document/types";
import { currentDoc, dispatch, select } from "../state/store";
import { addPicture } from "../project/assets";
import { fileLength } from "./clips";

/** Bringing clips, sounds, pictures and whole folders into Clips, and from Clips onto the timeline. */

const VIDEO = ["mp4", "mov", "m4v", "webm", "mkv", "avi"];
const SOUND = ["mp3", "wav", "m4a", "aac", "aiff", "aif", "ogg", "flac"];
const PICTURE = ["png", "jpg", "jpeg", "gif", "webp", "heic", "bmp", "tif"];

/** What a file is, going by its name. */
export function mediaKind(path: string): MediaItem["kind"] | null {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  return VIDEO.includes(ext) ? "video" : SOUND.includes(ext) ? "sound" : PICTURE.includes(ext) ? "image" : null;
}

const nameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** The type a clip dragged out of Clips carries. */
export const CLIP_DRAG = "application/x-duet-clip";

interface Found {
  path: string;
  name: string;
  folder: string;
  dir: boolean;
}

/**
 * Files and folders from the computer, as things for Clips. A folder comes in whole, every subfolder kept as
 * it is, and its files stay where they are. They go into the folder given, or at the top.
 */
export async function mediaFrom(paths: string[], into?: string): Promise<MediaItem[]> {
  const out: MediaItem[] = [];
  for (const path of paths) {
    const kind = mediaKind(path);
    if (kind) {
      out.push({ id: newId("clip"), name: nameOf(path), kind, src: path, ...(into ? { folderId: into } : {}) });
      continue;
    }
    let found: Found[];
    try {
      found = await invoke<Found[]>("media_scan", { path });
    } catch {
      continue; // not a folder, and not a kind Clips holds
    }
    const top: MediaItem = { id: newId("folder"), name: nameOf(path), kind: "folder", ...(into ? { folderId: into } : {}) };
    out.push(top);
    const folders = new Map<string, string>([["", top.id]]);
    for (const f of found) {
      const parent = folders.get(f.folder) ?? top.id;
      if (f.dir) {
        const id = newId("folder");
        folders.set(f.folder ? `${f.folder}/${f.name}` : f.name, id);
        out.push({ id, name: f.name, kind: "folder", folderId: parent });
      } else {
        const k = mediaKind(f.path);
        if (k) out.push({ id: newId("clip"), name: f.name, kind: k, src: f.path, folderId: parent });
      }
    }
  }
  return out;
}

/** Ask for clips, music and pictures, and put them in Clips. */
export async function pickIntoClips(into?: string) {
  const picked = await open({ multiple: true, title: "Add clips, music, pictures", filters: [{ name: "Clips, music and pictures", extensions: [...VIDEO, ...SOUND, ...PICTURE] }] });
  const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
  const items = await mediaFrom(paths, into);
  if (items.length) dispatch("add_media", { items });
}

/** Ask for a folder, and bring it into Clips whole. */
export async function pickFolderIntoClips(into?: string) {
  const picked = await open({ directory: true, multiple: false, title: "Add a folder of clips" });
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (!path) return;
  const items = await mediaFrom([path], into);
  if (items.length) dispatch("add_media", { items });
}

// how long each clip plays, found once and kept while Duet is open
const lengths = new Map<string, number | "busy" | "failed">();
const waiting = new Set<() => void>();

/** How long a clip or sound plays, once found. Asks in the background, and calls back when it knows. */
export function lengthOf(item: MediaItem, then: () => void): number | null {
  if (item.kind === "folder" || item.kind === "image" || !item.src) return null;
  if (typeof item.length === "number") return item.length;
  const known = lengths.get(item.src);
  if (typeof known === "number") return known;
  waiting.add(then);
  if (!known) {
    const src = item.src;
    lengths.set(src, "busy");
    const ask = item.kind === "video" ? invoke<{ duration: number }>("video_info", { path: src }).then((i) => i.duration) : fileLength(src);
    void ask
      .then((d) => lengths.set(src, d))
      .catch(() => lengths.set(src, "failed"))
      .finally(() => {
        const calls = [...waiting];
        waiting.clear();
        calls.forEach((c) => c());
      });
  }
  return null;
}

/** How long a picture stays on the timeline when it is dropped there. */
export const PICTURE_SECONDS = 3;

/** Where footage from Media goes: a track in Edit (with Cmd, a new one above it), or above a layer in Motion. */
export interface PlaceWhere {
  track?: { index: number };
  aside?: boolean;
  above?: string | null;
  layers?: boolean;
}

/** One thing from Media on its way to the timeline. */
export interface ToPlace {
  src: string;
  kind: MediaItem["kind"];
  name: string;
  /** How long it runs, when Media knows: for the ghost on the timeline while it is dragged. */
  seconds?: number;
}

/** What is being dragged from Media right now, so the timeline can show where it will land before it is let go. */
let dragging: ToPlace[] = [];
export const draggedFootage = () => dragging;
export const setDraggedFootage = (list: ToPlace[]) => (dragging = list);

/**
 * Clips, sounds and pictures from Media put in a scene from a moment, one after another, in one step that one
 * undo takes back. Each file is read first for its length and size. Returns what could not be read.
 */
export async function placeFromClips(sceneId: string, list: ToPlace | ToPlace[], at: number, where: PlaceWhere = {}): Promise<string[]> {
  const problems: string[] = [];
  const items: PlaceItem[] = [];
  for (const item of Array.isArray(list) ? list : [list]) {
    try {
      if (item.kind === "video") {
        const info = await invoke<{ duration: number; width: number; height: number }>("video_info", { path: item.src });
        items.push({ id: newId("video"), type: "video", src: item.src, name: item.name, seconds: info.duration, width: info.width, height: info.height });
      } else if (item.kind === "sound") {
        items.push({ id: newId("sound"), type: "sound", src: item.src, name: item.name, seconds: await fileLength(item.src), width: 1, height: 1 });
      } else if (item.kind === "image") {
        const bin = atob(await invoke<string>("read_binary_file", { path: item.src }));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const pic = await addPicture(item.name, bytes);
        items.push({ id: newId("image"), type: "image", src: pic.src, name: item.name, seconds: PICTURE_SECONDS, width: pic.width, height: pic.height });
      }
    } catch (e) {
      problems.push(`${item.name}: ${String(e instanceof Error ? e.message : e)}`);
    }
  }
  if (!items.length || !currentDoc().elements[sceneId]) return problems;
  dispatch("place_media", { id: sceneId, items, at, ...where });
  const placed = items.map((it) => it.id).filter((id) => currentDoc().elements[id]);
  if (placed.length) select(placed);
  return problems;
}

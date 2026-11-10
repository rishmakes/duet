import { invoke } from "@tauri-apps/api/core";
import { open } from "../ui/dialog";
import { newId } from "../commands";
import type { MediaItem } from "../document/types";
import { currentDoc, dispatch, select } from "../state/store";
import { addPicture } from "../project/assets";
import { dropClips } from "./scene";
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
const PICTURE_SECONDS = 3;

/** A clip, sound or picture from Clips, dropped on the timeline of a scene at a moment. Returns what went wrong. */
export async function placeFromClips(sceneId: string, item: { src: string; kind: MediaItem["kind"]; name: string }, at: number): Promise<string[]> {
  if (item.kind === "video" || item.kind === "sound") return dropClips(sceneId, [item.src], at);
  if (item.kind !== "image") return [];
  try {
    const bin = atob(await invoke<string>("read_binary_file", { path: item.src }));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const pic = await addPicture(item.name, bytes);
    const scene = currentDoc().elements[sceneId];
    if (!scene) return [];
    const k = Math.min(scene.width / pic.width, scene.height / pic.height);
    const width = Math.round(pic.width * k);
    const height = Math.round(pic.height * k);
    const end = Math.round((at + PICTURE_SECONDS) * 1000) / 1000;
    if (end > scene.duration) dispatch("set_duration", { id: sceneId, seconds: end });
    const id = newId("image");
    dispatch("create_element", {
      type: "image",
      id,
      parentId: sceneId,
      x: Math.round((scene.width - width) / 2),
      y: Math.round((scene.height - height) / 2),
      width,
      height,
      props: { src: pic.src, name: item.name.replace(/\.[^.]+$/, ""), start: at, end },
    });
    select([id]);
    return [];
  } catch (e) {
    return [`${item.name}: ${String(e instanceof Error ? e.message : e)}`];
  }
}

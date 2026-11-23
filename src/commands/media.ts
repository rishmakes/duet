import { isDerived } from "../document/components";
import type { Doc, MediaItem } from "../document/types";

/** The Media panel: clips, sounds, pictures and folders. Folders keep the order and nesting they were made with. */

export interface AddMediaArgs {
  items: MediaItem[];
}

export interface RemoveMediaArgs {
  ids: string[];
  /** Also take every clip that plays these files off the timeline. Without it, footage in use stays in Media. */
  fromVideo?: boolean;
}

export interface NewFolderArgs {
  id: string;
  name?: string;
  folderId?: string | null;
}

export interface RenameMediaArgs {
  id: string;
  name: string;
}

export interface MoveMediaArgs {
  ids: string[];
  /** The folder they go into, or null for the top. */
  folderId: string | null;
}

const keep = (doc: Doc, media: MediaItem[]): Doc => {
  if (media.length) return { ...doc, media };
  const { media: _m, ...rest } = doc;
  return rest;
};

/** Everything inside a folder, however deep. */
export function inside(media: MediaItem[], id: string): Set<string> {
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of media) if (m.folderId && (m.folderId === id || out.has(m.folderId)) && !out.has(m.id)) (out.add(m.id), (grew = true));
  }
  return out;
}

/** Put clips, sounds, pictures and folders into Media, after what is there. A file already in Media in the same folder is not added twice. Never mutates. */
export function addMedia(doc: Doc, args: AddMediaArgs): Doc {
  const media = doc.media ?? [];
  const ids = new Set(media.map((m) => m.id));
  const folders = new Set(media.filter((m) => m.kind === "folder").map((m) => m.id));
  const added: MediaItem[] = [];
  for (const item of args.items) {
    if (!item.id || ids.has(item.id) || !item.name) continue;
    if (item.kind !== "folder" && !item.src) continue;
    if (item.kind === "folder") folders.add(item.id);
    const folderId = item.folderId && folders.has(item.folderId) ? item.folderId : undefined;
    if (item.kind !== "folder" && [...media, ...added].some((m) => m.src === item.src && m.folderId === folderId)) continue;
    const m: MediaItem = { id: item.id, name: item.name, kind: item.kind };
    if (item.src) m.src = item.src;
    if (typeof item.length === "number" && Number.isFinite(item.length)) m.length = item.length;
    if (folderId) m.folderId = folderId;
    ids.add(m.id);
    added.push(m);
  }
  return added.length ? keep(doc, [...media, ...added]) : doc;
}

/** How many clips in the design play each file, by where the file is. The inside of a copy is not counted again. */
export function usedFiles(doc: Doc): Map<string, number> {
  const used = new Map<string, number>();
  for (const [id, el] of Object.entries(doc.elements)) {
    if ((el.type !== "video" && el.type !== "sound") || !el.src || isDerived(id)) continue;
    used.set(el.src, (used.get(el.src) ?? 0) + 1);
  }
  return used;
}

/** A short id that is the same each time for the same file, so keeping footage gives the same result every time. */
function idFor(src: string, taken: Set<string>): string {
  let h = 0;
  for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
  const base = `clip-${(h >>> 0).toString(36)}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Media keeps all the footage: every video and sound the design plays is listed, named as on the timeline (#378).
 *  Runs after every change and when a file opens, so every way in lands in Media. Never mutates. */
export function keepFootage(doc: Doc): Doc {
  const media = doc.media ?? [];
  const listed = new Set(media.map((m) => m.src).filter(Boolean));
  const taken = new Set(media.map((m) => m.id));
  const added: MediaItem[] = [];
  for (const [id, el] of Object.entries(doc.elements)) {
    if ((el.type !== "video" && el.type !== "sound") || !el.src || listed.has(el.src) || isDerived(id)) continue;
    listed.add(el.src);
    const m: MediaItem = { id: idFor(el.src, taken), name: el.name || el.src.split(/[\\/]/).pop() || "Clip", kind: el.type, src: el.src };
    taken.add(m.id);
    added.push(m);
  }
  return added.length ? keep(doc, [...media, ...added]) : doc;
}

/** Take things out of Media. A folder goes with everything in it. The files stay on the computer.
 *  Footage the video still plays stays (take it off the timeline first, or use remove_media's fromVideo);
 *  if its folder goes, it moves to the top. Never mutates. */
export function removeMedia(doc: Doc, args: RemoveMediaArgs): Doc {
  const media = doc.media ?? [];
  const used = usedFiles(doc);
  const gone = new Set(args.ids);
  for (const id of args.ids) for (const i of inside(media, id)) gone.add(i);
  const stays = (m: MediaItem) => !gone.has(m.id) || (m.kind !== "folder" && !!m.src && used.has(m.src));
  const kept = media.filter(stays);
  const folders = new Set(kept.filter((m) => m.kind === "folder").map((m) => m.id));
  const left = kept.map((m) => {
    if (!m.folderId || folders.has(m.folderId)) return m;
    const { folderId: _f, ...rest } = m;
    return rest;
  });
  return left.length === media.length && left.every((m, i) => m === media[i]) ? doc : keep(doc, left);
}

/** A new empty folder. Never mutates. */
export function newFolder(doc: Doc, args: NewFolderArgs): Doc {
  const media = doc.media ?? [];
  if (media.some((m) => m.id === args.id)) return doc;
  const names = new Set(media.filter((m) => m.kind === "folder").map((m) => m.name));
  let name = args.name?.trim();
  if (!name) {
    let n = 1;
    while (names.has(`Folder ${n}`)) n++;
    name = `Folder ${n}`;
  }
  const parent = args.folderId && media.some((m) => m.id === args.folderId && m.kind === "folder") ? args.folderId : undefined;
  return keep(doc, [...media, { id: args.id, name, kind: "folder", ...(parent ? { folderId: parent } : {}) }]);
}

/** A new name in Media. Only the name Duet shows changes; the file keeps its own. Never mutates. */
export function renameMedia(doc: Doc, args: RenameMediaArgs): Doc {
  const name = args.name.trim();
  const media = doc.media ?? [];
  if (!name || !media.some((m) => m.id === args.id && m.name !== name)) return doc;
  return keep(doc, media.map((m) => (m.id === args.id ? { ...m, name } : m)));
}

/** Move things into a folder, or to the top. A folder never goes inside itself. Never mutates. */
export function moveMedia(doc: Doc, args: MoveMediaArgs): Doc {
  const media = doc.media ?? [];
  const to = args.folderId;
  if (to && !media.some((m) => m.id === to && m.kind === "folder")) return doc;
  const moving = new Set(args.ids.filter((id) => id !== to && !(to && inside(media, id).has(to))));
  if (!moving.size) return doc;
  const out = media.map((m) => {
    if (!moving.has(m.id) || (m.folderId ?? null) === to) return m;
    const { folderId: _f, ...rest } = m;
    return to ? { ...rest, folderId: to } : rest;
  });
  return out.every((m, i) => m === media[i]) ? doc : keep(doc, out);
}

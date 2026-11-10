import type { Doc, MediaItem } from "../document/types";

/** The Clips panel: clips, sounds, pictures and folders. Folders keep the order and nesting they were made with. */

export interface AddMediaArgs {
  items: MediaItem[];
}

export interface RemoveMediaArgs {
  ids: string[];
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

/** Put clips, sounds, pictures and folders into Clips, after what is there. A file already in Clips in the same folder is not added twice. Never mutates. */
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

/** Take things out of Clips. A folder goes with everything in it. The files stay on the computer. Never mutates. */
export function removeMedia(doc: Doc, args: RemoveMediaArgs): Doc {
  const media = doc.media ?? [];
  const gone = new Set(args.ids);
  for (const id of args.ids) for (const i of inside(media, id)) gone.add(i);
  const left = media.filter((m) => !gone.has(m.id));
  return left.length === media.length ? doc : keep(doc, left);
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

/** A new name in Clips. Only the name Duet shows changes; the file keeps its own. Never mutates. */
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

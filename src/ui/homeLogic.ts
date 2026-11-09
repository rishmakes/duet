/** Pure helpers, format tile definitions, and presets for the Home screen. */

export interface CreateTile {
  id: string;
  title: string;
  dims: string;
  kind: "sized" | "screens" | "canvas" | "custom" | "file" | "video" | "photo";
  /** Which row of Home it sits in: one row for each thing Duet makes. */
  group: TileGroup;
  width?: number;
  height?: number;
  shape: "square" | "story" | "video" | "slide" | "a4" | "screens" | "canvas" | "custom" | "file" | "reel" | "film" | "photo";
}

export type TileGroup = "design" | "video" | "photo" | "more";

/** Home's rows, in order, with the words above each. */
export const TILE_GROUPS: { id: TileGroup; label: string }[] = [
  { id: "design", label: "Design" },
  { id: "video", label: "Video" },
  { id: "photo", label: "Photo" },
  { id: "more", label: "More ways to start" },
];

export const CREATE_TILES: CreateTile[] = [
  { id: "ig-post", group: "design", title: "Instagram post", dims: "1080 × 1080", kind: "sized", width: 1080, height: 1080, shape: "square" },
  { id: "story", group: "design", title: "Story", dims: "1080 × 1920", kind: "sized", width: 1080, height: 1920, shape: "story" },
  { id: "yt-thumb", group: "design", title: "YouTube thumbnail", dims: "1280 × 720", kind: "sized", width: 1280, height: 720, shape: "video" },
  { id: "presentation", group: "design", title: "Presentation", dims: "1920 × 1080", kind: "sized", width: 1920, height: 1080, shape: "slide" },
  { id: "a4", group: "design", title: "A4 print", dims: "A4", kind: "sized", width: 2480, height: 3508, shape: "a4" },
  { id: "screens", group: "design", title: "App screens", dims: "Mobile & desktop", kind: "screens", shape: "screens" },
  { id: "reel", group: "video", title: "Reel or Short", dims: "1080 × 1920, add clips", kind: "video", width: 1080, height: 1920, shape: "reel" },
  { id: "yt-video", group: "video", title: "YouTube video", dims: "1920 × 1080, add clips", kind: "video", width: 1920, height: 1080, shape: "film" },
  { id: "photo", group: "photo", title: "Edit a photo", dims: "Colour, masks, paint", kind: "photo", shape: "photo" },
  { id: "canvas", group: "more", title: "Open canvas", dims: "Blank", kind: "canvas", shape: "canvas" },
  { id: "custom", group: "more", title: "Custom size", dims: "Width & height", kind: "custom", shape: "custom" },
  { id: "file", group: "more", title: "Open a file", dims: ".duet, image", kind: "file", shape: "file" },
];

export interface CustomPreset {
  label: string;
  width: number;
  height: number;
}

export const CUSTOM_PRESETS: CustomPreset[] = [
  { label: "1080 × 1080 Square", width: 1080, height: 1080 },
  { label: "1080 × 1350 Portrait", width: 1080, height: 1350 },
  { label: "1080 × 1920 Story", width: 1080, height: 1920 },
  { label: "1280 × 720 Video", width: 1280, height: 720 },
  { label: "1920 × 1080 Slide", width: 1920, height: 1080 },
];

/** How long ago, in plain words. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} minutes ago`;
  if (s < 86400) return `${Math.max(1, Math.round(s / 3600))} hours ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Formatted text for recent project cards. */
export function editedAgo(ms: number, now = Date.now()): string {
  const words = ago(ms, now);
  return words === "yesterday" ? "Edited yesterday" : `Edited ${words}`;
}

/** Clamps a dimension value to positive integer limits. */
export function clampDim(val: number | string, fallback = 1080, min = 10, max = 20000): number {
  const num = typeof val === "number" ? val : parseInt(String(val).trim(), 10);
  if (!Number.isFinite(num) || isNaN(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

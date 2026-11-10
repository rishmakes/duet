/** Pure helpers, format tile definitions, and presets for the Home screen. */

export interface CreateTile {
  id: string;
  title: string;
  dims: string;
  kind: "sized" | "screens" | "canvas" | "video" | "photo";
  /** Which kind of work it belongs to: Home shows one kind's sizes at a time. */
  group: HomeKind;
  width?: number;
  height?: number;
  shape: "square" | "portrait" | "story" | "video" | "banner" | "slide" | "a4" | "screens" | "phone" | "canvas" | "photo";
}

export type HomeKind = "social" | "video" | "print" | "photo" | "screens";

/** The kinds of work on Home, in order. Each one opens its sizes below. */
export const HOME_KINDS: { id: HomeKind; label: string; icon: "heart" | "film" | "printer" | "image" | "screens" }[] = [
  { id: "social", label: "Social media", icon: "heart" },
  { id: "video", label: "Video", icon: "film" },
  { id: "print", label: "Print", icon: "printer" },
  { id: "photo", label: "Photo", icon: "image" },
  { id: "screens", label: "UI screens", icon: "screens" },
];

export const CREATE_TILES: CreateTile[] = [
  { id: "ig-post", group: "social", title: "Post", dims: "1080 × 1080", kind: "sized", width: 1080, height: 1080, shape: "square" },
  { id: "portrait-post", group: "social", title: "Portrait post", dims: "1080 × 1350", kind: "sized", width: 1080, height: 1350, shape: "portrait" },
  { id: "story", group: "social", title: "Story", dims: "1080 × 1920", kind: "sized", width: 1080, height: 1920, shape: "story" },
  { id: "social-reel", group: "social", title: "Reel", dims: "1080 × 1920", kind: "video", width: 1080, height: 1920, shape: "story" },
  { id: "yt-thumb", group: "social", title: "YouTube thumbnail", dims: "1280 × 720", kind: "sized", width: 1280, height: 720, shape: "video" },
  { id: "linkedin-banner", group: "social", title: "LinkedIn banner", dims: "1584 × 396", kind: "sized", width: 1584, height: 396, shape: "banner" },
  { id: "reel", group: "video", title: "Reel or Short", dims: "1080 × 1920", kind: "video", width: 1080, height: 1920, shape: "story" },
  { id: "yt-video", group: "video", title: "YouTube video", dims: "1920 × 1080", kind: "video", width: 1920, height: 1080, shape: "video" },
  { id: "square-video", group: "video", title: "Square video", dims: "1080 × 1080", kind: "video", width: 1080, height: 1080, shape: "square" },
  { id: "a4", group: "print", title: "A4 page", dims: "A4", kind: "sized", width: 2480, height: 3508, shape: "a4" },
  { id: "a3", group: "print", title: "A3 poster", dims: "A3", kind: "sized", width: 3508, height: 4961, shape: "a4" },
  { id: "presentation", group: "print", title: "Presentation", dims: "1920 × 1080", kind: "sized", width: 1920, height: 1080, shape: "slide" },
  { id: "photo", group: "photo", title: "Edit a photo", dims: "Colour, masks, paint", kind: "photo", shape: "photo" },
  { id: "phone", group: "screens", title: "Phone screen", dims: "390 × 844", kind: "sized", width: 390, height: 844, shape: "phone" },
  { id: "desktop", group: "screens", title: "Desktop screen", dims: "1440 × 900", kind: "sized", width: 1440, height: 900, shape: "slide" },
  { id: "screens", group: "screens", title: "App screens", dims: "Phone & desktop", kind: "screens", shape: "screens" },
  { id: "canvas", group: "screens", title: "Open canvas", dims: "Blank", kind: "canvas", shape: "canvas" },
];

/** The shape of a size in small whole numbers, like 9:16. Empty when it has no simple one (A4, a phone screen). */
export function ratioOf(width?: number, height?: number): string {
  if (!width || !height) return "";
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(width, height);
  const w = width / g;
  const h = height / g;
  return w <= 21 && h <= 21 ? `${w}:${h}` : "";
}

/** True when a size starts a video: it opens the editor with a timeline. */
export const startsVideo = (t: CreateTile) => t.kind === "video";

/** The kinds Home shows: all of them, without the ones the person hid. */
export function shownKinds(hidden: string[]): HomeKind[] {
  return HOME_KINDS.map((k) => k.id).filter((id) => !hidden.includes(id));
}

/** The kind whose sizes are open: the last one picked, or the first one showing. Null when every kind is hidden. */
export function openKind(last: string | null, hidden: string[]): HomeKind | null {
  const shown = shownKinds(hidden);
  return shown.find((id) => id === last) ?? shown[0] ?? null;
}

/** Hide a kind. The last one showing cannot be hidden, so Home never goes empty. */
export function hideKind(hidden: string[], id: HomeKind): string[] {
  if (hidden.includes(id) || shownKinds(hidden).length <= 1) return hidden;
  return [...hidden, id];
}

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

import { isDerived, syncInstances } from "./components";
import { relayout } from "./layout";
import { playsFile } from "./types";
import type { Comment, Doc, El } from "./types";

/** Property order inside each element, so Git diffs stay small and stable. */
const EL_KEYS: (keyof El)[] = [
  "id",
  "type",
  "name",
  "parentId",
  "x",
  "y",
  "width",
  "height",
  "fill",
  "stroke",
  "strokeWidth",
  "radius",
  "opacity",
  "blend",
  "rotation",
  "text",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "textAlign",
  "lineHeight",
  "letterSpacing",
  "textFixed",
  "textStyleId",
  "shadow",
  "gradient",
  "grade",
  "effects",
  "link",
  "linkKind",
  "transition",
  "transitionMs",
  "scroll",
  "src",
  "component",
  "componentId",
  "overrides",
  "mask",
  "maskFeather",
  "maskInvert",
  "maskGrow",
  "locked",
  "hidden",
  "layout",
  "grow",
  "nodes",
  "closed",
  "duration",
  "start",
  "end",
  "keys",
  "shapeKeys",
  "markers",
  "workArea",
  "tracks",
  "track",
  "clipFrom",
  "volume",
  "speed",
  "childIds",
];

const TEXT_ONLY = new Set<keyof El>(["fontFamily", "fontWeight", "textAlign", "lineHeight", "letterSpacing", "textFixed", "textStyleId"]);

/** Written only when set, so a still design's file stays as it was. */
const TIME_ONLY = new Set<keyof El>(["duration", "start", "end", "clipFrom"]);

const PROTOTYPE_ONLY = new Set<keyof El>(["linkKind", "transition", "transitionMs", "scroll"]);

const FALLBACK: Omit<El, "id" | "type"> = {
  name: "Untitled",
  parentId: null,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  fill: "#d9d9de",
  stroke: null,
  strokeWidth: 1,
  radius: 0,
  opacity: 1,
  blend: "normal",
  rotation: 0,
  text: "",
  fontSize: 16,
  fontFamily: "",
  fontWeight: 400,
  textAlign: "left",
  lineHeight: 0,
  letterSpacing: 0,
  textFixed: false,
  textStyleId: "",
  shadow: null,
  gradient: null,
  grade: null,
  effects: [],
  link: null,
  linkKind: "",
  transition: "",
  transitionMs: 0,
  scroll: false,
  src: "",
  component: false,
  componentId: "",
  overrides: {},
  mask: false,
  maskFeather: 0,
  maskInvert: false,
  maskGrow: 0,
  locked: false,
  hidden: false,
  layout: null,
  grow: 0,
  nodes: [],
  closed: false,
  duration: 0,
  start: 0,
  end: 0,
  keys: {},
  shapeKeys: [],
  markers: [],
  clipFrom: 0,
  volume: 1,
  speed: 1,
  childIds: [],
};

/** Stable, human-readable JSON: elements sorted by id, properties in a fixed order. */
export function serializeDoc(doc: Doc): string {
  const elements: Record<string, unknown> = {};
  for (const id of Object.keys(doc.elements).sort()) {
    if (isDerived(id)) continue; // the inside of a copy is rebuilt from its component
    const el = doc.elements[id];
    const ordered: Record<string, unknown> = {};
    for (const k of EL_KEYS) if (TEXT_ONLY.has(k) && (el.type !== "text" || el[k] === (FALLBACK as Record<string, unknown>)[k])) continue;
    else if (k === "childIds" && el.type === "instance") ordered[k] = [];
    else if ((k !== "component" || el.component) && ((k !== "componentId" && k !== "overrides") || el.type === "instance") && (!PROTOTYPE_ONLY.has(k) || el[k] !== (FALLBACK as Record<string, unknown>)[k]) && (k !== "locked" || el.locked) && (k !== "hidden" || el.hidden) && (k !== "grade" || el.grade) && (k !== "effects" || (el.effects && el.effects.length > 0)) && (k !== "mask" || el.mask) && ((k !== "maskFeather" && k !== "maskInvert" && k !== "maskGrow") || el.mask && el[k]) && (k !== "layout" || el.layout) && (k !== "grow" || el.grow) && (k !== "blend" || el.blend !== "normal") && (k !== "rotation" || el.rotation) && (k !== "src" || el.type === "image" || playsFile(el)) && (!TIME_ONLY.has(k) || el[k]) && (k !== "keys" || Object.keys(el.keys).length) && (k !== "shapeKeys" || el.shapeKeys.length) && (k !== "markers" || el.markers?.length) && (k !== "workArea" || el.workArea) && (k !== "tracks" || el.tracks?.length) && (k !== "track" || (el.track && playsFile(el))) && (k !== "volume" || playsFile(el)) && (k !== "speed" || (playsFile(el) && el.speed !== 1)) && ((k !== "nodes" && k !== "closed") || el.type === "path")) ordered[k] = el[k];
    elements[id] = ordered;
  }
  const out: Record<string, unknown> = { version: doc.version, rootIds: doc.rootIds, elements };
  if (doc.background) out.background = doc.background;
  if (doc.styles && Object.keys(doc.styles).length) out.styles = doc.styles;
  if (doc.guides && (doc.guides.x.length || doc.guides.y.length)) out.guides = { x: [...doc.guides.x].sort((a, b) => a - b), y: [...doc.guides.y].sort((a, b) => a - b) };
  if (doc.comments?.length) out.comments = doc.comments;
  return JSON.stringify(out, null, 2) + "\n";
}

export class DesignFileError extends Error {}

const TYPES = new Set(["frame", "rect", "ellipse", "text", "image", "path", "group", "instance", "video", "sound"]);

/** Parse and check a design file. Fills in missing properties so older files still open. */
export function parseDoc(text: string): Doc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DesignFileError("This file is not valid JSON.");
  }
  const r = raw as Partial<Doc> | null;
  if (!r || typeof r !== "object" || r.version !== 1) throw new DesignFileError("This is not a Duet design file (version 1).");
  if (!Array.isArray(r.rootIds) || !r.elements || typeof r.elements !== "object") {
    throw new DesignFileError("The design file is missing its elements.");
  }
  const elements: Record<string, El> = {};
  for (const [id, value] of Object.entries(r.elements)) {
    const v = value as Partial<El>;
    if (!v || !TYPES.has(v.type as string)) throw new DesignFileError(`Element ${id} has an unknown type.`);
    // its own copy of the empty lists, so a change to one thing's keys or children never reaches another's
    elements[id] = { ...structuredClone(FALLBACK), ...v, id, type: v.type as El["type"] };
  }
  for (const id of r.rootIds) if (!elements[id]) throw new DesignFileError(`Page lists ${id}, but it does not exist.`);
  for (const el of Object.values(elements)) {
    for (const c of el.childIds) if (!elements[c]) throw new DesignFileError(`${el.name} lists a missing child ${c}.`);
  }
  const styles = r.styles && typeof r.styles === "object" ? (r.styles as Doc["styles"]) : undefined;
  const background = typeof r.background === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(r.background) ? r.background : undefined;
  const g = (r as { guides?: { x?: unknown; y?: unknown } }).guides;
  const nums = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : []);
  const guides = g && typeof g === "object" && (nums(g.x).length || nums(g.y).length) ? { x: nums(g.x), y: nums(g.y) } : undefined;
  const comments = Array.isArray(r.comments)
    ? r.comments.filter((c): c is Comment => !!c && typeof c.id === "string" && typeof c.text === "string" && Number.isFinite(c.x) && Number.isFinite(c.y)).map((c) => ({ ...c, by: c.by === "ai" ? "ai" : "you" }) as Comment)
    : [];
  return relayout(syncInstances({ version: 1, rootIds: r.rootIds as string[], elements, ...(background ? { background } : {}), ...(styles ? { styles } : {}), ...(guides ? { guides } : {}), ...(comments.length ? { comments } : {}) }));
}

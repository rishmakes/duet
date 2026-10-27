import type { Grade } from "./grade";
export type ElementType = "frame" | "rect" | "ellipse" | "text" | "image" | "path" | "group" | "instance" | "video" | "sound";

/** One point on a drawn line. All numbers are fractions of the element's box, so resizing just works. */
export interface PathNode {
  x: number;
  y: number;
  /** How far the handle on the way in reaches, from this point. 0 and 0 means none. */
  ix: number;
  iy: number;
  /** How far the handle on the way out reaches, from this point. */
  ox: number;
  oy: number;
}

/** Lines up a frame's children in a row or a column. */
export interface Layout {
  dir: "row" | "column";
  gap: number;
  padX: number;
  padY: number;
  /** Across the direction: start, centre, end, or stretch to fill the frame. */
  align: "start" | "center" | "end" | "stretch";
  /** Along the direction: where the children sit, or spread out with equal space between. */
  justify: "start" | "center" | "end" | "between";
  /** Shrink the frame to fit what is inside it. */
  hug: boolean;
}

export interface Shadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

export interface Gradient {
  from: string;
  to: string;
  /** Degrees. 0 runs left to right, 90 runs top to bottom. */
  angle: number;
}

/** One moment in a change over time: at this second, the property has this value. */
export interface Key {
  /** Seconds from the start of the frame it plays in. */
  t: number;
  v: number;
  /** How it arrives at this value from the one before: at a steady pace, or easing in, out, or both. */
  ease: "linear" | "in" | "out" | "in-out";
  /**
   * The shape of the speed, if the designer shaped it: a curve from 0,0 to 1,1 with two handles, x1 y1 x2 y2.
   * Up is how far along the move it is, across is time. A handle above 1 or below 0 overshoots. It replaces `ease`.
   */
  curve?: [number, number, number, number];
}

/** A note on the timeline of a frame that plays: a moment with a name and a colour, for the editor. It changes nothing in the picture. */
export interface Marker {
  id: string;
  /** Seconds from the start of the frame it plays in. */
  t: number;
  name: string;
  color: string;
}

/** A row on a frame's timeline that clips or sounds sit on. A higher one is in front. */
export interface Track {
  id: string;
  name: string;
  kind: "clips" | "sound";
}

/** One moment in the changing outline of a drawn shape: where every point and its handles are, in pixels inside the parent. */
export interface ShapeKey {
  /** Seconds from the start of the frame it plays in. */
  t: number;
  points: { x: number; y: number; ix: number; iy: number; ox: number; oy: number }[];
  /** How the outline arrives here from the key before, the same words as for any other key. */
  ease: Key["ease"];
  curve?: [number, number, number, number];
}

/** A thing that plays a file: a video clip, or a sound with nothing to see. */
export const playsFile = (el: { type: ElementType }) => el.type === "video" || el.type === "sound";

/** The properties that can change over time. */
export const BLENDS = ["normal", "multiply", "screen", "overlay", "soft-light", "darken", "lighten", "add"] as const;
export type Blend = (typeof BLENDS)[number];

export const MOVING = ["x", "y", "width", "height", "opacity", "rotation"] as const;
export type Moving = (typeof MOVING)[number];

export interface El {
  id: string;
  type: ElementType;
  name: string;
  parentId: string | null;
  /** Position relative to the parent frame, or to the page when parentId is null. */
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
  opacity: number;
  /** How it mixes with what is under it. Screen makes black clear, so a black and white mist clip can sit over a scene. */
  blend: Blend;
  /** How far it is turned, in degrees, clockwise, around its own centre. Frames and copies of components stay upright. A group turns what is inside it and only remembers the angle. */
  rotation: number;
  text: string;
  fontSize: number;
  /** Text only. Empty means the system font. Any font installed on the computer works. */
  fontFamily: string;
  /** Text only. 400 is regular, 700 is bold. */
  fontWeight: number;
  textAlign: "left" | "center" | "right";
  /** Text only. A multiple of the font size. 0 means the default. */
  lineHeight: number;
  /** Text only. Extra space between letters, in pixels. */
  letterSpacing: number;
  /** Text only. True when the box has a set width and words wrap inside it. */
  textFixed: boolean;
  /** Text only. A saved text style this text follows, or an empty string. */
  textStyleId: string;
  /** A drop shadow behind the shape, or null for none. */
  shadow: Shadow | null;
  /** A linear gradient used instead of the solid fill, or null. */
  gradient: Gradient | null;
  /** Pictures and video clips only: how their colour is changed, or null to leave it as it is. */
  grade: Grade | null;
  /** For images: where the picture file lives inside the project, like assets/3fa9c1.png. */
  src: string;
  /** A frame or group that other things are copied from. */
  component: boolean;
  /** For an instance: the component it is a live copy of. */
  componentId: string;
  /** For an instance: what was changed on this copy, by part of the component and then property. "$root" is the copy itself. */
  overrides: Record<string, Record<string, unknown>>;
  /** A group only: its bottom thing is a shape, and everything else in the group shows only inside that shape. The shape itself is not drawn. */
  mask: boolean;
  /** A mask only: how many pixels its edge is softened over. 0 is a hard edge. */
  maskFeather: number;
  /** A mask only: show what is outside the shape instead of what is inside. */
  maskInvert: boolean;
  /** A mask only: pixels the shape is made bigger by, or smaller when below 0. */
  maskGrow: number;
  /** Locked things cannot be picked on the canvas, so you can select what is behind or inside them. */
  locked: boolean;
  /** Hidden things are not drawn, not picked on the canvas and not exported. */
  hidden: boolean;
  /** For frames: auto layout, or null to place children by hand. */
  layout: Layout | null;
  /** Inside an auto layout frame: 1 to grow and fill the free space along the direction, 0 to keep its size. */
  grow: number;
  /** For drawn lines: the points, and whether the line joins back to its start. */
  nodes: PathNode[];
  closed: boolean;
  /** In Present mode, clicking this takes you to the frame with this id. */
  link: string | null;
  /** What a click does: go to the screen (empty), open it on top as an overlay, or go back. */
  linkKind: "" | "overlay" | "back";
  /** How the next screen arrives: empty for straight away, or dissolve, push-left, push-right, push-up, push-down. */
  transition: string;
  /** How long that takes, in milliseconds. 0 means the default of 300. */
  transitionMs: number;
  /** Screens only: in Present mode, what is below the bottom edge can be scrolled into view. */
  scroll: boolean;
  /** A frame only: how long it plays, in seconds. 0 means it is a still design, not a video. */
  duration: number;
  /** Inside a frame that plays: the second this appears, and the second it leaves. An end of 0 means it stays to the end. */
  start: number;
  end: number;
  /** Changes over time, by property. Each list is in order of time. Empty for something that stays as it is. */
  keys: Partial<Record<Moving, Key[]>>;
  /** A drawn shape only: its outline at moments in time. Between two with the same number of points it blends; empty when the outline stays as it is. */
  shapeKeys: ShapeKey[];
  /** A frame that plays only: the markers on its timeline, in order of time. */
  markers: Marker[];
  /** A frame that plays only: the part being worked on, from its start to its end. Playing begins and stops there; the rest is dimmed. Left out when the whole scene is the work area. */
  workArea?: { start: number; end: number };
  /** A frame that plays only: its tracks for clips and sounds, top first. Left out while Duet still sorts clips into rows by itself. */
  tracks?: Track[];
  /** A video clip or a sound only: the track it sits on, in its frame's tracks. */
  track?: string;
  /** A video clip or a sound only: the second in its file where playing starts, and how loud it is from 0 to 1. For these, src is where the file is on the computer. A sound has no place on the canvas: it is only heard. */
  clipFrom: number;
  volume: number;
  /** A video clip or a sound only: how fast its file plays. 1 is normal, 2 is twice as fast, 0.5 is half. The clip's bar is as long as it takes. */
  speed: number;
  childIds: string[];
}

/** Flat store: one record per element, keyed by id. Keeps Git diffs small. */
/** A saved look for text, shared by every text that uses it. */
export interface TextStyle {
  name: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

/** A note pinned to a spot on the canvas, for the AI or for later. Not part of the design: never drawn in an export. */
export interface Comment {
  id: string;
  /** Page pixels, where the pin points. */
  x: number;
  y: number;
  text: string;
  by: "you" | "ai";
  /** The thing under the pin when it was placed, if any. */
  on?: string;
  /** Dealt with: the pin goes away. */
  resolved?: boolean;
  /** What was done about it, said when it was resolved. */
  reply?: string;
}

export interface Doc {
  version: 1;
  /** The colour of the canvas behind the design, like #141417. Left out means the standard dark one. */
  background?: string;
  /** Saved text styles, by id. */
  styles?: Record<string, TextStyle>;
  /** Ruler guides pulled out from the rulers: the page pixel each runs through. Left out when there are none. */
  guides?: { x: number[]; y: number[] };
  /** Comments pinned on the canvas, oldest first. Left out when there are none. */
  comments?: Comment[];
  rootIds: string[];
  elements: Record<string, El>;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const emptyDoc = (): Doc => ({ version: 1, rootIds: [], elements: {} });

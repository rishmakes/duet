import { fromAbs, parsePathData } from "./path";
import type { AbsNode } from "./path";
import type { El, PathNode } from "./types";

/**
 * Read an SVG file (as text) into a plan of Duet layers. Pure: text in, plan out, nothing touches a document.
 * Our own small reader is used so it also runs in tests with no browser. Whatever cannot be kept is left out
 * and said in plain sentences in `notes`; nothing here throws for a file it cannot fully understand.
 */

// ---------------- the plan ----------------

export interface SvgItem {
  type: "rect" | "ellipse" | "path" | "text" | "image" | "group";
  id: string;
  name: string;
  /** From the top left of the frame, whatever group it sits in. */
  x: number;
  y: number;
  width: number;
  height: number;
  props: Partial<El>;
  /** A group: what is inside, bottom first. */
  children?: SvgItem[];
  /** A group only: its bottom child is a shape and the rest shows only inside it. */
  mask?: boolean;
  /** An image: the key of the picture in `pictures`. */
  picture?: string;
}

export interface SvgPicture {
  key: string;
  name: string;
  mime: string;
  base64: string;
}

export interface SvgPlan {
  name: string;
  width: number;
  height: number;
  items: SvgItem[];
  pictures: SvgPicture[];
  /** Every font family the text asks for. */
  fonts: string[];
  /** Plain sentences about what could not be kept. */
  notes: string[];
}

export interface TextFace {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

export interface SvgOptions {
  /** Makes an id for a layer. */
  makeId?: (type: string) => string;
  /** How big the words are when drawn. */
  measure?: (face: TextFace, text: string) => { width: number; height: number };
  /** How far a line's baseline sits below the top of its line in Duet. */
  baselineDrop?: (face: TextFace) => number;
}

// ---------------- reading the XML ----------------

interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** A name that was saved as UTF-8 bytes written one by one (â€“ for –) is turned back into the real letters. */
function fixName(s: string): string {
  if (!/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  } catch {
    return s;
  }
}

function readXml(src: string): XNode {
  const root: XNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack: XNode[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf("<", i);
    const end = lt === -1 ? n : lt;
    if (end > i) {
      const t = src.slice(i, end);
      if (t.trim() || stack[stack.length - 1].tag === "text" || stack[stack.length - 1].tag === "tspan") stack[stack.length - 1].children.push({ tag: "#text", attrs: {}, children: [], text: decode(t) });
    }
    if (lt === -1) break;
    if (src.startsWith("<!--", lt)) {
      const e = src.indexOf("-->", lt + 4);
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const e = src.indexOf("]]>", lt + 9);
      stack[stack.length - 1].children.push({ tag: "#text", attrs: {}, children: [], text: src.slice(lt + 9, e === -1 ? n : e) });
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (src.startsWith("<?", lt) || src.startsWith("<!", lt)) {
      const e = src.indexOf(">", lt + 2);
      i = e === -1 ? n : e + 1;
      continue;
    }
    // a tag: find its end, minding quotes
    let j = lt + 1;
    let quote = "";
    while (j < n) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j++;
    }
    const body = src.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === "/") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = body.endsWith("/");
    const inner = selfClosing ? body.slice(0, -1) : body;
    const m = /^([^\s/>]+)([\s\S]*)$/.exec(inner.trim());
    if (!m) continue;
    const attrs: Record<string, string> = {};
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    while ((a = re.exec(m[2]))) attrs[a[1]] = decode(a[3] ?? a[4] ?? "");
    const tag = m[1].replace(/^.*:/, "");
    const node: XNode = { tag, attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

// ---------------- numbers, colours, matrices ----------------

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (p: Matrix, q: Matrix): Matrix => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
];
const apply = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

function parseTransform(t: string | undefined): Matrix {
  let m = IDENTITY;
  if (!t) return m;
  const re = /(\w+)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(t))) {
    const v = r[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (v.some((x) => !Number.isFinite(x))) continue;
    let p: Matrix = IDENTITY;
    switch (r[1]) {
      case "translate":
        p = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
        break;
      case "scale":
        p = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const a = ((v[0] ?? 0) * Math.PI) / 180;
        const rot: Matrix = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        p = v.length >= 3 ? mul(mul([1, 0, 0, 1, v[1], v[2]], rot), [1, 0, 0, 1, -v[1], -v[2]]) : rot;
        break;
      }
      case "skewX":
        p = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        p = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      case "matrix":
        if (v.length === 6) p = v as Matrix;
        break;
    }
    m = mul(m, p);
  }
  return m;
}

const num = (s: string | undefined, fallback = 0): number => {
  if (s == null) return fallback;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : fallback;
};

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", gray: "#808080", grey: "#808080", orange: "#ffa500", purple: "#800080", currentcolor: "#000000" };
const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");

/** A colour as #rrggbb or #rrggbbaa, or null for none. */
function colour(value: string | undefined, alpha = 1): string | null {
  if (!value) return null;
  let v = value.trim().toLowerCase();
  if (!v || v === "none" || v === "transparent") return null;
  if (NAMED[v]) v = NAMED[v];
  let out: string | null = null;
  if (/^#[0-9a-f]{3}$/.test(v)) out = "#" + v.slice(1).split("").map((c) => c + c).join("");
  else if (/^#[0-9a-f]{6}$/.test(v)) out = v;
  else if (/^#[0-9a-f]{8}$/.test(v)) {
    out = v.slice(0, 7);
    alpha *= parseInt(v.slice(7), 16) / 255;
  } else {
    const m = /^rgba?\(([^)]*)\)$/.exec(v);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean);
      const ch = (s: string) => (s.endsWith("%") ? (parseFloat(s) * 255) / 100 : parseFloat(s));
      if (p.length >= 3) out = "#" + hex2(ch(p[0])) + hex2(ch(p[1])) + hex2(ch(p[2]));
      if (p[3] != null) alpha *= p[3].endsWith("%") ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
    }
  }
  if (!out) return null;
  return alpha >= 0.999 ? out : out + hex2(alpha * 255);
}

// ---------------- the walk ----------------

/** The look that comes down from a parent to what is inside it. */
interface Inherit {
  fill: string;
  stroke: string;
  strokeWidth: string;
  fillOpacity: string;
  strokeOpacity: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  letterSpacing: string;
  textAnchor: string;
}

const INHERITED: Inherit = { fill: "black", stroke: "none", strokeWidth: "1", fillOpacity: "1", strokeOpacity: "1", fontFamily: "", fontSize: "16", fontWeight: "400", fontStyle: "normal", letterSpacing: "0", textAnchor: "start" };

function styleOf(node: XNode): Record<string, string> {
  const out: Record<string, string> = { ...node.attrs };
  const style = node.attrs.style;
  if (style) {
    for (const part of style.split(";")) {
      const k = part.indexOf(":");
      if (k > 0) out[part.slice(0, k).trim()] = part.slice(k + 1).trim();
    }
  }
  return out;
}

const SKIPPED = new Set(["defs", "symbol", "clipPath", "mask", "pattern", "linearGradient", "radialGradient", "style", "title", "desc", "metadata", "filter", "marker", "script", "namedview"]);

export function readSvg(source: string, fileName = "SVG", options: SvgOptions = {}): SvgPlan {
  const notes: string[] = [];
  const noted = new Set<string>();
  const note = (s: string) => {
    if (!noted.has(s)) {
      noted.add(s);
      notes.push(s);
    }
  };
  let counter = 0;
  const makeId = options.makeId ?? ((t: string) => `${t}-svg${counter++}`);
  const measureDefault = (face: TextFace, text: string) => {
    const lines = text.split("\n");
    const step = face.fontSize * (face.lineHeight || 1.3);
    return { width: Math.max(...lines.map((l) => l.length * face.fontSize * 0.55 + l.length * face.letterSpacing)), height: lines.length * step };
  };
  const measure = options.measure ?? measureDefault;
  const drop = options.baselineDrop ?? ((f: TextFace) => f.fontSize * 0.2 + ((f.lineHeight || 1.3) - 1.2) * f.fontSize * 0.5);

  const empty = (): SvgPlan => ({ name: fileName, width: 0, height: 0, items: [], pictures: [], fonts: [], notes });
  let doc: XNode;
  try {
    doc = readXml(source);
  } catch {
    notes.push("This file could not be read as a picture made of shapes.");
    return empty();
  }
  const svg = doc.children.find((c) => c.tag === "svg");
  if (!svg) {
    notes.push("This file is not an SVG picture.");
    return empty();
  }

  // everything with an id, so fills and clips can point at it
  const byId = new Map<string, XNode>();
  const index = (n: XNode) => {
    if (n.attrs.id) byId.set(n.attrs.id, n);
    n.children.forEach(index);
  };
  index(svg);
  const refOf = (v: string | undefined): XNode | undefined => {
    const m = v && /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(v);
    return m ? byId.get(m[1]) : undefined;
  };
  const hrefOf = (n: XNode): XNode | undefined => {
    const h = n.attrs.href ?? n.attrs["xlink:href"];
    return h && h.startsWith("#") ? byId.get(h.slice(1)) : undefined;
  };

  // the size of the frame
  const vb = (svg.attrs.viewBox ?? "").split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  let width = num(svg.attrs.width, hasVb ? vb[2] : 0);
  let height = num(svg.attrs.height, hasVb ? vb[3] : 0);
  if (svg.attrs.width?.includes("%")) width = hasVb ? vb[2] : 0;
  if (svg.attrs.height?.includes("%")) height = hasVb ? vb[3] : 0;
  if (!(width > 0) || !(height > 0)) {
    notes.push("This picture has no size written in it, so a size of 800 by 600 was used.");
    width = 800;
    height = 600;
  }
  let base: Matrix = IDENTITY;
  if (hasVb) base = mul([width / vb[2], 0, 0, height / vb[3], 0, 0], [1, 0, 0, 1, -vb[0], -vb[1]]);

  const pictures: SvgPicture[] = [];
  const pictureKeys = new Map<string, string>();
  const fonts = new Set<string>();

  const pictureOf = (img: XNode): { key: string; w: number; h: number } | null => {
    const href = img.attrs.href ?? img.attrs["xlink:href"] ?? "";
    const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(href.trim());
    if (!m) {
      note("A picture inside the design is linked from somewhere else, so it was left out.");
      return null;
    }
    const mime = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
    const b64 = m[2].replace(/\s+/g, "");
    let key = pictureKeys.get(b64);
    if (!key) {
      key = `picture${pictures.length}`;
      pictureKeys.set(b64, key);
      pictures.push({ key, name: fixName(img.attrs["data-name"] ?? img.attrs.id ?? key), mime, base64: b64 });
    }
    return { key, w: num(img.attrs.width, 1), h: num(img.attrs.height, 1) };
  };

  /** A fill that points at a gradient: its two ends and an angle. */
  const gradientOf = (g: XNode): El["gradient"] => {
    let stops = g.children.filter((c) => c.tag === "stop");
    if (!stops.length) {
      const link = hrefOf(g);
      if (link) stops = link.children.filter((c) => c.tag === "stop");
    }
    if (g.tag === "radialGradient") note("A round gradient became a straight one.");
    if (stops.length < 1) return null;
    const stopColour = (s: XNode) => {
      const st = styleOf(s);
      return colour(st["stop-color"] ?? "black", num(st["stop-opacity"], 1)) ?? "#000000";
    };
    if (stops.length > 2) note("A gradient with more than two colours keeps only its first and last.");
    const x1 = num(g.attrs.x1, 0);
    const y1 = num(g.attrs.y1, 0);
    const x2 = num(g.attrs.x2, 1);
    const y2 = num(g.attrs.y2, 0);
    const angle = Math.round((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI);
    return { from: stopColour(stops[0]), to: stopColour(stops[stops.length - 1]), angle };
  };

  /** What a shape is filled with: a colour, a gradient, or a picture. */
  type Paint = { colour: string | null; gradient: El["gradient"]; pattern: XNode | null };
  const paintOf = (value: string, opacity: number): Paint => {
    const ref = refOf(value);
    if (ref?.tag === "linearGradient" || ref?.tag === "radialGradient") return { colour: null, gradient: gradientOf(ref), pattern: null };
    if (ref?.tag === "pattern") return { colour: null, gradient: null, pattern: ref };
    if (/^url\(/.test(value.trim())) {
      note("Something is filled in a way Duet cannot read, so it was left plain.");
      return { colour: null, gradient: null, pattern: null };
    }
    return { colour: colour(value, opacity), gradient: null, pattern: null };
  };

  /** Where a box lands after the transform: its own position, size and turn. Skew and mirroring cannot be kept. */
  const place = (m: Matrix, x: number, y: number, w: number, h: number) => {
    let [a, b, c, d] = m;
    const centre = apply(m, x + w / 2, y + h / 2);
    let mirrored = false;
    if (a * d - b * c < 0) {
      a = -a;
      b = -b;
      mirrored = true;
    }
    const sx = Math.hypot(a, b) || 1;
    const sy = (a * d - b * c) / sx || 1;
    const skew = Math.abs(a * c + b * d) / (sx * sx);
    if (skew > 0.02) note("Something was slanted in the design. Duet can turn it but not slant it, so it is turned only.");
    const W = Math.max(1, w * sx);
    const H = Math.max(1, h * sy);
    const rotation = Math.round(((Math.atan2(b, a) * 180) / Math.PI) * 1000) / 1000;
    return { x: centre.x - W / 2, y: centre.y - H / 2, width: W, height: H, rotation: Math.abs(rotation) < 0.001 ? 0 : rotation, mirrored, scale: (sx + sy) / 2 };
  };

  const nameOf = (n: XNode, fallback: string) => fixName(n.attrs.id ?? n.attrs["data-name"] ?? fallback);

  const shapeLook = (st: Record<string, string>, inh: Inherit, scale: number): Partial<El> => {
    const props: Partial<El> = {};
    const op = num(st.opacity, 1);
    if (op < 1) props.opacity = op;
    const stroke = colour(inh.stroke, num(inh.strokeOpacity, 1));
    if (stroke) {
      props.stroke = stroke;
      props.strokeWidth = Math.round(num(inh.strokeWidth, 1) * scale * 1000) / 1000;
    } else {
      props.stroke = null;
    }
    if (st.display === "none" || st.visibility === "hidden") props.hidden = true;
    return props;
  };

  /** Turns a fill into props, or returns a picture that has to be laid in. */
  const fillProps = (inh: Inherit, props: Partial<El>): XNode | null => {
    const p = paintOf(inh.fill, num(inh.fillOpacity, 1));
    if (p.gradient) {
      props.gradient = p.gradient;
      props.fill = p.gradient.from;
    } else props.fill = p.colour ?? "#00000000";
    return p.pattern;
  };

  const walk = (node: XNode, inh: Inherit, m: Matrix, out: SvgItem[]) => {
    for (const child of node.children) {
      if (child.tag === "#text" || SKIPPED.has(child.tag)) continue;
      const st = styleOf(child);
      if (st.display === "none") continue;
      const here: Inherit = {
        fill: st.fill ?? inh.fill,
        stroke: st.stroke ?? inh.stroke,
        strokeWidth: st["stroke-width"] ?? inh.strokeWidth,
        fillOpacity: st["fill-opacity"] ?? inh.fillOpacity,
        strokeOpacity: st["stroke-opacity"] ?? inh.strokeOpacity,
        fontFamily: st["font-family"] ?? inh.fontFamily,
        fontSize: st["font-size"] ?? inh.fontSize,
        fontWeight: st["font-weight"] ?? inh.fontWeight,
        fontStyle: st["font-style"] ?? inh.fontStyle,
        letterSpacing: st["letter-spacing"] ?? inh.letterSpacing,
        textAnchor: st["text-anchor"] ?? inh.textAnchor,
      };
      const cm = mul(m, parseTransform(st.transform));
      try {
        if (child.tag === "g" || child.tag === "a" || child.tag === "switch") {
          const kids: SvgItem[] = [];
          walk(child, here, cm, kids);
          if (!kids.length) continue;
          const clip = refOf(st["clip-path"]);
          const group = (items: SvgItem[], extra: Partial<SvgItem> = {}): SvgItem => {
            const op = num(st.opacity, 1);
            return { type: "group", id: makeId("group"), name: nameOf(child, "Group"), x: 0, y: 0, width: 1, height: 1, props: { ...(op < 1 ? { opacity: op } : {}), ...(st.visibility === "hidden" ? { hidden: true } : {}) }, children: items, ...extra };
          };
          if (clip) {
            const shapes: SvgItem[] = [];
            walk(clip, { ...INHERITED, fill: "black" }, cm, shapes);
            const covers = shapes.length === 1 && shapes[0].type === "rect" && shapes[0].x <= 0.5 && shapes[0].y <= 0.5 && shapes[0].x + shapes[0].width >= width - 0.5 && shapes[0].y + shapes[0].height >= height - 0.5;
            if (!covers && shapes.length) {
              const shape = shapes.length === 1 ? shapes[0] : null;
              if (shape) {
                shape.name = "Cut to this shape";
                shape.props = { ...shape.props, fill: "#000000" };
                out.push(group([shape, ...kids], { mask: true }));
                continue;
              }
              note("A group was cut to several shapes at once. The cut was left off.");
            }
          }
          out.push(group(kids));
          continue;
        }

        if (child.tag === "rect") {
          const x = num(child.attrs.x);
          const y = num(child.attrs.y);
          const w = num(child.attrs.width);
          const h = num(child.attrs.height);
          if (w <= 0 || h <= 0) continue;
          const box = place(cm, x, y, w, h);
          const props = shapeLook(st, here, box.scale);
          const rx = Math.min(num(child.attrs.rx, num(child.attrs.ry)), w / 2, h / 2);
          if (rx > 0) props.radius = Math.round(rx * box.scale * 1000) / 1000;
          if (box.rotation) props.rotation = box.rotation;
          const pattern = fillProps(here, props);
          if (pattern) {
            const img = pattern.children.map((c) => (c.tag === "use" ? hrefOf(c) : c)).find((c) => c?.tag === "image") as XNode | undefined;
            const useNode = pattern.children.find((c) => c.tag === "use");
            const pic = img ? pictureOf(img) : null;
            if (!pic) {
              note("A picture fill could not be read, so the shape was left empty.");
              props.fill = "#00000000";
            } else {
              // where the picture sits inside the shape: in fractions of the shape's box
              const pm = parseTransform(useNode?.attrs.transform);
              const units = pattern.attrs.patternContentUnits === "userSpaceOnUse" ? "user" : "box";
              const px = units === "box" ? pm[4] * w : pm[4];
              const py = units === "box" ? pm[5] * h : pm[5];
              const pw = units === "box" ? pic.w * pm[0] * w : pic.w * pm[0];
              const ph = units === "box" ? pic.h * pm[3] * h : pic.h * pm[3];
              const full = Math.abs(pw - w) < Math.max(1, w * 0.02) && Math.abs(ph - h) < Math.max(1, h * 0.02) && Math.abs(px) < 1 && Math.abs(py) < 1;
              if (box.mirrored) note("A picture that was mirrored in the design comes in the right way round. Duet cannot mirror pictures yet.");
              const lay = (ix: number, iy: number, iw: number, ih: number): SvgItem => {
                const where = place(cm, x + ix, y + iy, iw, ih);
                return { type: "image", id: makeId("image"), name: nameOf(child, "Picture"), x: where.x, y: where.y, width: where.width, height: where.height, props: { ...(where.rotation ? { rotation: where.rotation } : {}), ...(props.radius && full ? { radius: props.radius } : {}), ...(props.opacity != null ? { opacity: props.opacity } : {}), ...(props.hidden ? { hidden: true } : {}) }, picture: pic.key };
              };
              if (full) out.push(lay(0, 0, w, h));
              else {
                // the picture is bigger than the shape or shifted: lay it whole and cut it to the shape
                const shape: SvgItem = { type: "rect", id: makeId("rect"), name: "Cut to this shape", x: box.x, y: box.y, width: box.width, height: box.height, props: { fill: "#000000", ...(box.rotation ? { rotation: box.rotation } : {}), ...(props.radius ? { radius: props.radius } : {}) } };
                const img = lay(px, py, pw, ph);
                img.props = {};
                out.push({ type: "group", id: makeId("group"), name: nameOf(child, "Picture"), x: 0, y: 0, width: 1, height: 1, props: { ...(props.opacity != null ? { opacity: props.opacity } : {}) }, children: [shape, img], mask: true });
              }
              continue;
            }
          }
          out.push({ type: "rect", id: makeId("rect"), name: nameOf(child, "Rectangle"), x: box.x, y: box.y, width: box.width, height: box.height, props });
          continue;
        }

        if (child.tag === "circle" || child.tag === "ellipse") {
          const rx = child.tag === "circle" ? num(child.attrs.r) : num(child.attrs.rx);
          const ry = child.tag === "circle" ? num(child.attrs.r) : num(child.attrs.ry);
          if (rx <= 0 || ry <= 0) continue;
          const box = place(cm, num(child.attrs.cx) - rx, num(child.attrs.cy) - ry, rx * 2, ry * 2);
          const props = shapeLook(st, here, box.scale);
          if (box.rotation) props.rotation = box.rotation;
          if (fillProps(here, props)) {
            note("A picture fill on a round shape was left plain.");
            props.fill = "#00000000";
          }
          out.push({ type: "ellipse", id: makeId("ellipse"), name: nameOf(child, "Ellipse"), x: box.x, y: box.y, width: box.width, height: box.height, props });
          continue;
        }

        if (child.tag === "path" || child.tag === "line" || child.tag === "polyline" || child.tag === "polygon") {
          let d = child.attrs.d ?? "";
          const pts = (child.attrs.points ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
          if (child.tag === "line") d = `M${num(child.attrs.x1)} ${num(child.attrs.y1)}L${num(child.attrs.x2)} ${num(child.attrs.y2)}`;
          if ((child.tag === "polyline" || child.tag === "polygon") && pts.length >= 4) {
            const pairs: string[] = [];
            for (let k = 0; k + 1 < pts.length; k += 2) pairs.push(`${k ? "L" : "M"}${pts[k]} ${pts[k + 1]}`);
            d = pairs.join("") + (child.tag === "polygon" ? "Z" : "");
          }
          if (!d.trim()) continue;
          let pieces;
          try {
            pieces = parsePathData(d).filter((p) => p.nodes.length >= 2);
          } catch (e) {
            note(`A shape could not be read (${e instanceof Error ? e.message : "bad outline"}), so it was left out.`);
            continue;
          }
          if (!pieces.length) continue;
          const flat = pieces.map((p) => p.nodes.map<AbsNode>((nd) => {
            const at = apply(cm, nd.x, nd.y);
            // handles are directions, so only the turn and the size apply to them
            const i = { x: cm[0] * nd.ix + cm[2] * nd.iy, y: cm[1] * nd.ix + cm[3] * nd.iy };
            const o = { x: cm[0] * nd.ox + cm[2] * nd.oy, y: cm[1] * nd.ox + cm[3] * nd.oy };
            return { x: at.x, y: at.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y };
          }));
          const all = fromAbs(flat.flat());
          let at = 0;
          const parts: PathNode[][] = flat.map((p) => {
            const slice = all.nodes.slice(at, at + p.length);
            at += p.length;
            return slice;
          });
          const scale = Math.sqrt(Math.abs(cm[0] * cm[3] - cm[1] * cm[2])) || 1;
          const props = shapeLook(st, here, scale);
          const open = child.tag === "line" || child.tag === "polyline" || !pieces[0].closed;
          const pattern = fillProps(here, props);
          if (pattern) {
            note("A picture fill on a drawn shape was left plain.");
            props.fill = "#00000000";
          }
          const closed = !open;
          // an open line has no fill; a closed shape with no fill and no line would be invisible
          if (!closed) props.fill = "#00000000";
          if (closed && (props.fill === "#00000000" || props.fill == null) && !props.gradient && !props.stroke) props.stroke = null;
          // a closed shape with holes stays one layer; separate lines or shapes each become their own layer, kept together in a group
          if (parts.length > 1 && !(closed && pieces.slice(1).every((p) => p.closed))) {
            const base = nameOf(child, "Shape");
            const pieceItems: SvgItem[] = flat.map((nodes, k) => {
              const own = fromAbs(nodes);
              const pc = pieces[k].closed;
              const pp: Partial<El> = { ...props, nodes: own.nodes, closed: pc };
              if (!pc) pp.fill = "#00000000";
              if (!pc && !pp.stroke) {
                pp.stroke = colour(here.fill) ?? "#000000";
                pp.strokeWidth = 1;
              }
              return { type: "path", id: makeId("path"), name: `${base} ${k + 1}`, x: own.x, y: own.y, width: own.width, height: own.height, props: pp };
            });
            out.push({ type: "group", id: makeId("group"), name: base, x: 0, y: 0, width: 1, height: 1, props: {}, children: pieceItems });
            continue;
          }
          const item: SvgItem = {
            type: "path",
            id: makeId("path"),
            name: nameOf(child, child.tag === "line" ? "Line" : "Shape"),
            x: all.x,
            y: all.y,
            width: all.width,
            height: all.height,
            props: { ...props, nodes: parts[0], closed },
          };
          if (parts.length > 1) item.props.holes = parts.slice(1);
          if (!closed && !props.stroke) {
            // a line with nothing to show: keep it thin and grey so it can be found
            item.props.stroke = colour(here.fill) ?? "#000000";
            item.props.strokeWidth = 1;
          }
          out.push(item);
          continue;
        }

        if (child.tag === "text") {
          const item = readText(child, st, here, cm);
          if (item) out.push(item);
          continue;
        }

        if (child.tag === "image") {
          const pic = pictureOf(child);
          if (!pic) continue;
          const x = num(child.attrs.x);
          const y = num(child.attrs.y);
          const w = num(child.attrs.width, pic.w);
          const h = num(child.attrs.height, pic.h);
          const box = place(cm, x, y, w, h);
          const props: Partial<El> = { ...(box.rotation ? { rotation: box.rotation } : {}), ...(num(st.opacity, 1) < 1 ? { opacity: num(st.opacity, 1) } : {}) };
          out.push({ type: "image", id: makeId("image"), name: nameOf(child, "Picture"), x: box.x, y: box.y, width: box.width, height: box.height, props, picture: pic.key });
          continue;
        }

        if (child.tag === "use") {
          const target = hrefOf(child);
          if (target && !SKIPPED.has(target.tag)) {
            const shifted = mul(cm, [1, 0, 0, 1, num(child.attrs.x), num(child.attrs.y)]);
            const holder: XNode = { tag: "g", attrs: {}, children: [target], text: "" };
            walk(holder, here, shifted, out);
          } else note("A repeated piece of the design could not be copied in.");
          continue;
        }

        note(`A part called "${child.tag}" is not something Duet can show yet, so it was left out.`);
      } catch (e) {
        note(`One part of the picture could not be read (${e instanceof Error ? e.message : "unknown"}), so it was left out.`);
      }
    }
  };

  /** One text: its lines joined, with the right font, size, spacing and turn. */
  const readText = (node: XNode, st: Record<string, string>, inh: Inherit, m: Matrix): SvgItem | null => {
    interface Line {
      x: number;
      y: number;
      text: string;
      anchor: string;
    }
    const lines: Line[] = [];
    let cx = num(node.attrs.x);
    let cy = num(node.attrs.y);
    const gather = (n: XNode, anchor: string) => {
      for (const c of n.children) {
        if (c.tag === "#text") {
          const raw = c.text.replace(/\r/g, "");
          if (!raw.trim() && !lines.length) continue;
          const last = lines[lines.length - 1];
          if (last && !c.text.includes("\n") && last.y === cy && last.x === cx) last.text += raw;
          else lines.push({ x: cx, y: cy, text: raw, anchor });
        } else if (c.tag === "tspan") {
          const cs = styleOf(c);
          if (c.attrs.x != null) cx = num(c.attrs.x);
          if (c.attrs.y != null) cy = num(c.attrs.y);
          if (c.attrs.dy != null) cy += num(c.attrs.dy);
          if (c.attrs.dx != null) cx += num(c.attrs.dx);
          const a = cs["text-anchor"] ?? anchor;
          if (c.children.some((k) => k.tag === "tspan")) gather(c, a);
          else {
            const t = c.children.map((k) => k.text).join("");
            lines.push({ x: cx, y: cy, text: t, anchor: a });
          }
        }
      }
    };
    gather(node, inh.textAnchor);
    const cleaned = lines.map((l) => ({ ...l, text: l.text.replace(/[\n\r]+/g, " ").replace(/\s+$/, "") })).filter((l) => l.text.trim());
    if (!cleaned.length) return null;

    const size = num(inh.fontSize, 16);
    const family = inh.fontFamily.split(",")[0].replace(/["']/g, "").trim();
    const w = inh.fontWeight === "bold" || inh.fontWeight === "bolder" ? 700 : inh.fontWeight === "lighter" ? 300 : num(inh.fontWeight, 400);
    let spacing = 0;
    const ls = inh.letterSpacing.trim();
    if (ls.endsWith("em")) spacing = parseFloat(ls) * size;
    else if (ls !== "normal") spacing = num(ls, 0);
    if (!Number.isFinite(spacing)) spacing = 0;
    if (/italic|oblique/.test(inh.fontStyle)) note("Duet has no slanted text yet, so slanted words come in upright.");
    if (family) fonts.add(family);

    // lines that start at different places were centred or right-aligned
    const baseFace: TextFace = { fontFamily: family, fontWeight: w, fontSize: size, lineHeight: 0, letterSpacing: spacing };
    let step = 0;
    if (cleaned.length > 1) {
      const gaps = cleaned.slice(1).map((l, i) => l.y - cleaned[i].y).filter((g) => g > 0).sort((a, b) => a - b);
      if (gaps.length) step = gaps[Math.floor(gaps.length / 2)];
    }
    const lineHeight = step ? Math.round((step / size) * 1000) / 1000 : 0;
    const face: TextFace = { ...baseFace, lineHeight };
    const widths = cleaned.map((l) => measure(face, l.text).width);
    const anchors = cleaned.map((l, i) => (l.anchor === "middle" ? l.x - widths[i] / 2 : l.anchor === "end" ? l.x - widths[i] : l.x));
    let align: El["textAlign"] = "left";
    const maxW = Math.max(...widths);
    const left = Math.min(...anchors);
    if (cleaned.length > 1 && anchors.some((a) => Math.abs(a - left) > 1.5)) {
      const centres = cleaned.map((_l, i) => anchors[i] + widths[i] / 2);
      const rights = cleaned.map((_l, i) => anchors[i] + widths[i]);
      const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
      align = spread(centres) <= spread(rights) ? "center" : "right";
    }
    const box = measure(face, cleaned.map((l) => l.text).join("\n"));
    const boxW = Math.max(box.width, maxW);
    let boxX = left;
    if (align === "center") boxX = (Math.min(...cleaned.map((_l, i) => anchors[i] + widths[i] / 2)) + Math.max(...cleaned.map((_l, i) => anchors[i] + widths[i] / 2))) / 2 - boxW / 2;
    if (align === "right") boxX = Math.max(...cleaned.map((_l, i) => anchors[i] + widths[i])) - boxW;
    const top = cleaned[0].y - drop(face);
    const placed = place(m, boxX, top, boxW, box.height);
    const props: Partial<El> = {
      text: cleaned.map((l) => l.text).join("\n"),
      fontFamily: family,
      fontSize: Math.round(size * placed.scale * 1000) / 1000,
      fontWeight: w,
      textAlign: align,
      letterSpacing: Math.round(spacing * placed.scale * 1000) / 1000,
      lineHeight,
      textFixed: false,
    };
    const fill = colour(inh.fill, num(inh.fillOpacity, 1));
    props.fill = fill ?? "#000000";
    const op = num(st.opacity, 1);
    if (op < 1) props.opacity = op;
    if (placed.rotation) props.rotation = placed.rotation;
    if (st.display === "none" || st.visibility === "hidden") props.hidden = true;
    return { type: "text", id: makeId("text"), name: fixName(node.attrs.id ?? cleaned[0].text), x: placed.x, y: placed.y, width: placed.width, height: placed.height, props };
  };

  const items: SvgItem[] = [];
  walk(svg, { ...INHERITED, fill: svg.attrs.fill ?? "black" }, base, items);
  if (!items.length) notes.push("Nothing in this picture could be turned into layers.");

  // the single group that Figma wraps the whole page in is not needed: its pieces are the layers
  // Figma wraps the whole page in one or two groups: the page is already the frame, so they are opened
  let top = items;
  while (top.length === 1 && top[0].type === "group" && !top[0].mask && top[0].children?.length) top = top[0].children;
  const name = fileName.replace(/\.svg$/i, "");
  return { name, width: Math.round(width), height: Math.round(height), items: top, pictures, fonts: [...fonts], notes };
}

/** Every item in the plan, groups opened, for counting. */
export function countLayers(items: SvgItem[]): number {
  return items.reduce((n, i) => n + (i.children ? countLayers(i.children) : 1), 0);
}

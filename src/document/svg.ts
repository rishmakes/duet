import { paintedUrl } from "../project/assets";
import { layoutText, lineStep, lineWidth } from "../canvas/text";
import { isLooseCopy } from "./components";
import { maskOf, turnOf, turnedBox } from "./geometry";
import { pathData, toAbs } from "./path";
import type { Doc, El } from "./types";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif";

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** A colour like #00000040 (colour plus transparency) as SVG wants it. */
function colour(c: string): { color: string; opacity: number } {
  if (/^#[0-9a-f]{8}$/i.test(c)) return { color: c.slice(0, 7), opacity: parseInt(c.slice(7), 16) / 255 };
  return { color: c, opacity: 1 };
}

/** A colour as an SVG attribute, with its see-through part written separately so older vector tools keep it. */
function paint(kind: "fill" | "stroke", c: string): string {
  const { color, opacity } = colour(c);
  return `${kind}="${esc(color)}"${opacity < 1 ? ` ${kind}-opacity="${num(opacity)}"` : ""}`;
}

/** Turn one element, with everything inside it, into a standalone SVG picture. */
export function toSvg(doc: Doc, id: string): string {
  const root = doc.elements[id];
  if (!root) throw new Error("Nothing to export.");
  const defs: string[] = [];
  let n = 0;

  // a turned thing is drawn upright, then turned around its middle
  const draw = (el: El, dx: number, dy: number): string => {
    if (el.hidden) return "";
    const body = shape(el, dx, dy);
    const turn = turnOf(el);
    if (!turn || !body) return body;
    return `<g transform="rotate(${num(turn)} ${num(dx + el.x + el.width / 2)} ${num(dy + el.y + el.height / 2)})">${body}</g>`;
  };

  const shape = (el: El, dx: number, dy: number): string => {
    const x = dx + el.x;
    const y = dy + el.y;
    const op = (el.opacity < 1 ? ` opacity="${num(el.opacity)}"` : "") + (el.blend && el.blend !== "normal" ? ` style="mix-blend-mode:${el.blend === "add" ? "plus-lighter" : el.blend}"` : "");

    if (el.type === "text") {
      const { lines } = layoutText(el);
      const step = lineStep(el);
      const spans = lines
        .map((l, i) => {
          const w = lineWidth(l, el);
          const dx = el.textAlign === "center" ? (el.width - w) / 2 : el.textAlign === "right" ? el.width - w : 0;
          return `<tspan x="${num(x + dx)}" y="${num(y + i * step)}">${esc(l)}</tspan>`;
        })
        .join("");
      const family = el.fontFamily.trim() ? `"${el.fontFamily.replace(/"/g, "")}", ${FONT}` : FONT;
      const spacing = el.letterSpacing ? ` letter-spacing="${num(el.letterSpacing)}"` : "";
      return `<text font-family="${esc(family)}" font-weight="${el.fontWeight || 400}" font-size="${num(el.fontSize)}" ${paint("fill", el.fill)}${spacing} dominant-baseline="text-before-edge"${op}>${spans}</text>`;
    }

    if (el.type === "image") {
      const url = paintedUrl(el);
      const r0 = Math.max(0, Math.min(el.radius, el.width / 2, el.height / 2));
      const cid = `c${n++}`;
      defs.push(`<clipPath id="${cid}"><rect x="${num(x)}" y="${num(y)}" width="${num(el.width)}" height="${num(el.height)}"${r0 ? ` rx="${num(r0)}"` : ""}/></clipPath>`);
      if (!url) return "";
      return `<g${op}><image href="${esc(url)}" x="${num(x)}" y="${num(y)}" width="${num(el.width)}" height="${num(el.height)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cid})"/></g>`;
    }

    const mask = maskOf(doc, el);
    if (el.type === "group" || mask || isLooseCopy(doc, el)) {
      const kids = el.childIds
        .map((c) => doc.elements[c])
        .filter((c) => c && c !== mask)
        .map((c) => draw(c, x, y))
        .join("");
      if (!mask) return `<g${op}>${kids}</g>`;
      // a mask: everything else in the group is cut to the outline of its shape
      const mx = x + mask.x;
      const my = y + mask.y;
      const turn = turnOf(mask) ? ` transform="rotate(${num(turnOf(mask))} ${num(mx + mask.width / 2)} ${num(my + mask.height / 2)})"` : "";
      const mr = Math.max(0, Math.min(mask.radius, mask.width / 2, mask.height / 2));
      const outline =
        mask.type === "ellipse"
          ? `<ellipse cx="${num(mx + mask.width / 2)}" cy="${num(my + mask.height / 2)}" rx="${num(mask.width / 2)}" ry="${num(mask.height / 2)}"${turn}/>`
          : mask.type === "path"
            ? `<path d="${pathData(toAbs(mask, mx, my), true)}"${turn}/>`
            : `<rect x="${num(mx)}" y="${num(my)}" width="${num(mask.width)}" height="${num(mask.height)}"${mr ? ` rx="${num(mr)}"` : ""}${turn}/>`;
      const cid = `c${n++}`;
      defs.push(`<clipPath id="${cid}">${outline}</clipPath>`);
      return `<g${op} clip-path="url(#${cid})">${kids}</g>`;
    }

    if (el.type === "path") {
      const nodes = toAbs(el, x, y);
      if (nodes.length < 2) return "";
      const stroke = el.stroke && el.strokeWidth > 0 ? ` ${paint("stroke", el.stroke)} stroke-width="${num(el.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"` : "";
      let pfill = el.closed ? paint("fill", el.fill) : `fill="none"`;
      if (el.closed && el.gradient) {
        const g = el.gradient;
        const a = (g.angle * Math.PI) / 180;
        const cx = x + el.width / 2;
        const cy = y + el.height / 2;
        const half = (Math.abs(el.width * Math.cos(a)) + Math.abs(el.height * Math.sin(a))) / 2;
        const gid = `g${n++}`;
        defs.push(
          `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${num(cx - Math.cos(a) * half)}" y1="${num(cy - Math.sin(a) * half)}" x2="${num(cx + Math.cos(a) * half)}" y2="${num(cy + Math.sin(a) * half)}"><stop offset="0" stop-color="${esc(g.from)}"/><stop offset="1" stop-color="${esc(g.to)}"/></linearGradient>`,
        );
        pfill = `fill="url(#${gid})"`;
      }
      let pfilter = "";
      if (el.shadow) {
        const c = colour(el.shadow.color);
        const fid = `s${n++}`;
        defs.push(
          `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${num(el.shadow.x)}" dy="${num(el.shadow.y)}" stdDeviation="${num(el.shadow.blur / 2)}" flood-color="${esc(c.color)}" flood-opacity="${num(c.opacity)}"/></filter>`,
        );
        pfilter = ` filter="url(#${fid})"`;
      }
      return `<path d="${pathData(nodes, el.closed)}" ${pfill}${stroke}${pfilter}${op}/>`;
    }

    let fill = paint("fill", el.fill);
    if (el.gradient) {
      const g = el.gradient;
      const a = (g.angle * Math.PI) / 180;
      const cx = x + el.width / 2;
      const cy = y + el.height / 2;
      const half = (Math.abs(el.width * Math.cos(a)) + Math.abs(el.height * Math.sin(a))) / 2;
      const gid = `g${n++}`;
      defs.push(
        `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${num(cx - Math.cos(a) * half)}" y1="${num(cy - Math.sin(a) * half)}" x2="${num(cx + Math.cos(a) * half)}" y2="${num(cy + Math.sin(a) * half)}"><stop offset="0" stop-color="${esc(g.from)}"/><stop offset="1" stop-color="${esc(g.to)}"/></linearGradient>`,
      );
      fill = `fill="url(#${gid})"`;
    }
    let filter = "";
    if (el.shadow) {
      const c = colour(el.shadow.color);
      const fid = `s${n++}`;
      defs.push(
        `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${num(el.shadow.x)}" dy="${num(el.shadow.y)}" stdDeviation="${num(el.shadow.blur / 2)}" flood-color="${esc(c.color)}" flood-opacity="${num(c.opacity)}"/></filter>`,
      );
      filter = ` filter="url(#${fid})"`;
    }
    const stroke = el.stroke && el.strokeWidth > 0 ? ` ${paint("stroke", el.stroke)} stroke-width="${num(el.strokeWidth)}"` : "";
    const r = Math.max(0, Math.min(el.radius, el.width / 2, el.height / 2));
    const own =
      el.type === "ellipse"
        ? `<ellipse cx="${num(x + el.width / 2)}" cy="${num(y + el.height / 2)}" rx="${num(el.width / 2)}" ry="${num(el.height / 2)}" ${fill}${stroke}${filter}/>`
        : `<rect x="${num(x)}" y="${num(y)}" width="${num(el.width)}" height="${num(el.height)}"${r ? ` rx="${num(r)}"` : ""} ${fill}${stroke}${filter}/>`;

    if (!el.childIds.length) return op ? `<g${op}>${own}</g>` : own;

    const cid = `c${n++}`;
    defs.push(
      el.type === "ellipse"
        ? `<clipPath id="${cid}"><ellipse cx="${num(x + el.width / 2)}" cy="${num(y + el.height / 2)}" rx="${num(el.width / 2)}" ry="${num(el.height / 2)}"/></clipPath>`
        : `<clipPath id="${cid}"><rect x="${num(x)}" y="${num(y)}" width="${num(el.width)}" height="${num(el.height)}"${r ? ` rx="${num(r)}"` : ""}/></clipPath>`,
    );
    const kids = el.childIds
      .map((c) => doc.elements[c])
      .filter(Boolean)
      .map((c) => draw(c, x, y))
      .join("");
    return `<g${op}>${own}<g clip-path="url(#${cid})">${kids}</g></g>`;
  };

  // draw the element at the top-left corner of the picture, with room for all of it when it is turned
  const box = turnedBox({ x: 0, y: 0, width: root.width, height: root.height }, turnOf(root));
  const body = draw({ ...root, x: 0 - box.x, y: 0 - box.y }, 0, 0);
  const w = num(box.width);
  const h = num(box.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${body}</svg>\n`;
}

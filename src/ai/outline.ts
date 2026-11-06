import { onOpenBoard } from "../document/boards";
import { gradeChanges } from "../document/grade";
import { isDerived } from "../document/components";
import type { Doc, El } from "../document/types";

/**
 * A short, plain outline of a design for the AI. It lists only what matters on each thing, so
 * reading the whole page costs a fraction of the raw file.
 */

const q = (s: string) => `"${s.replace(/\n/g, " ").slice(0, 60)}"`;

function describe(doc: Doc, el: El): string {
  const bits: string[] = [`${el.type} ${q(el.name)} ${el.id}`, `${Math.round(el.x)},${Math.round(el.y)} ${Math.round(el.width)}x${Math.round(el.height)}`];
  if (el.type === "text") {
    bits.push(q(el.text));
    bits.push(`${el.fontSize}px${el.fontWeight !== 400 ? ` w${el.fontWeight}` : ""}${el.fontFamily ? ` ${el.fontFamily}` : ""}`);
    if (el.textAlign !== "left") bits.push(el.textAlign);
    bits.push(el.fill);
  } else if (el.type === "image") {
    bits.push(`picture ${el.src}`);
  } else if (el.type === "path") {
    bits.push(`${el.nodes.length} points${el.closed ? " closed" : ""}`);
    if (el.stroke) bits.push(`stroke ${el.stroke}`);
  } else if (el.type !== "group") {
    if (el.gradient) bits.push(`gradient ${el.gradient.from}>${el.gradient.to}`);
    else if (el.fill && el.fill !== "#00000000" && el.fill !== "#ffffff00") bits.push(`fill ${el.fill}`);
    if (el.stroke) bits.push(`stroke ${el.stroke} ${el.strokeWidth}`);
    if (el.radius) bits.push(`radius ${el.radius}`);
    if (el.shadow) bits.push("shadow");
  }
  if (el.type === "sound") bits.push(`sound ${el.src}${el.clipFrom ? ` from ${el.clipFrom}s of the file` : ""}${el.volume !== 1 ? ` volume ${el.volume}` : ""}${el.fadeIn ? ` fades in ${el.fadeIn}s` : ""}${el.fadeOut ? ` fades out ${el.fadeOut}s` : ""} (only heard, its position and size mean nothing)`);
  if (el.type === "video") bits.push(`clip ${el.src}${el.clipFrom ? ` from ${el.clipFrom}s of the file` : ""}${el.volume !== 1 ? ` volume ${el.volume}` : ""}${el.fadeIn ? ` fades in ${el.fadeIn}s` : ""}${el.fadeOut ? ` fades out ${el.fadeOut}s` : ""}${el.speed !== 1 ? ` speed ${el.speed}` : ""}`);
  if (el.grade) bits.push(`colour ${Object.entries(gradeChanges(el.grade)).map(([k, v]) => (k === "look" ? `look ${String(v).split(/[\\/]/).pop()}` : `${k} ${v}`)).join(", ")}`);
  if (el.duration > 0) bits.push(`PLAYS ${el.duration}s`);
  if (el.start || el.end) bits.push(`shows ${el.start}s to ${el.end ? `${el.end}s` : "the end"}`);
  for (const [prop, keys] of Object.entries(el.keys)) if (keys?.length) bits.push(`${prop} over time ${keys.map((k) => `${k.t}s:${Math.round(k.v * 100) / 100}`).join(" ")}`);
  if (el.opacity < 1) bits.push(`opacity ${el.opacity}`);
  if (el.rotation && el.type !== "frame" && el.type !== "instance") bits.push(`turned ${el.rotation}°`);
  if (el.layout) bits.push(`layout ${el.layout.dir} gap ${el.layout.gap} pad ${el.layout.padX}/${el.layout.padY} ${el.layout.align}/${el.layout.justify}${el.layout.hug ? " hug" : ""}`);
  if (el.grow) bits.push("fills space");
  if (el.mask && el.type === "group") bits.push("mask: the rest shows only inside its first thing, which is not drawn");
  if (el.component) bits.push("COMPONENT");
  if (el.type === "instance") bits.push(`copy of ${doc.elements[el.componentId]?.name ?? el.componentId}${Object.keys(el.overrides).length ? " (changed)" : ""}`);
  if (el.locked) bits.push("locked");
  if (el.hidden) bits.push("hidden");
  if (el.link) bits.push(`opens ${doc.elements[el.link]?.name ?? el.link}`);
  if (el.textStyleId) bits.push(`style ${doc.styles?.[el.textStyleId]?.name ?? el.textStyleId}`);
  return bits.join(" · ");
}

export function outline(doc: Doc, ids?: string[], maxDepth = 8): string {
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const el = doc.elements[id];
    if (!el) return;
    lines.push(`${"  ".repeat(depth)}${describe(doc, el)}`);
    // the inside of a copy comes from its component, so it is not listed again
    if (el.type === "instance") return;
    if (depth >= maxDepth) {
      if (el.childIds.length) lines.push(`${"  ".repeat(depth + 1)}... ${el.childIds.length} more inside`);
      return;
    }
    for (const c of el.childIds) if (!isDerived(c)) walk(c, depth + 1);
  };
  const roots = ids && ids.length ? ids.filter((i) => doc.elements[i]) : doc.rootIds;
  for (const id of roots) walk(id, 0);
  const head = `${[...onOpenBoard(doc)].filter((i) => !isDerived(i)).length} things. x,y are relative to the parent frame (the page for top-level things). Sizes in pixels.`;
  return `${head}\n${lines.join("\n") || "(empty page)"}`;
}

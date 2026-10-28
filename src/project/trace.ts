import { newId, runCommand } from "../commands";
import type { Actor } from "../commands";
import { turnOf, turnPoint } from "../document/geometry";
import { drawnBox } from "../document/path";
import type { AbsNode } from "../document/path";
import { TraceError, traceShapes } from "../document/trace";
import type { Doc, PathNode } from "../document/types";
import { liveRoom } from "../state/store";
import type { Room } from "../state/store";
import { pictureOf, pictureSize, preloadPictures } from "./assets";

/** The longest side, in pixels, a picture is looked at when it is traced. Enough for a clean outline, and quick. */
const LOOK = 480;

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Trace a picture on the canvas into flat drawn shapes, laid exactly over it. The picture stays.
 * One step in the history. Returns the ids of what was made, or a sentence saying why it could not be done.
 */
export async function tracePicture(id: string, actor: Actor = "you", by?: string, room: Room = liveRoom): Promise<{ ids: string[]; groupId: string | null } | { why: string }> {
  const before = room.currentDoc();
  const el = before.elements[id];
  if (!el || el.type !== "image" || !el.src) return { why: "Choose one picture to trace." };
  if (id.includes("::")) return { why: "This picture is inside a copy of a component. Trace it on the original instead." };
  await preloadPictures(before);
  const pic = pictureOf(el);
  const [pw, ph] = pic ? pictureSize(pic) : [0, 0];
  if (!pic || !pw || !ph) return { why: "The picture file could not be found. Save the project and try again." };

  const k = Math.min(1, LOOK / Math.max(pw, ph));
  const w = Math.max(1, Math.round(pw * k));
  const h = Math.max(1, Math.round(ph * k));
  const sheet = document.createElement("canvas");
  sheet.width = w;
  sheet.height = h;
  const ctx = sheet.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { why: "Could not read the picture." };
  ctx.drawImage(pic, 0, 0, w, h);
  let shapes;
  try {
    shapes = traceShapes(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch (e) {
    return { why: e instanceof TraceError ? e.message : "Could not read the picture." };
  }

  // The design may have moved on while the picture loaded: work from how it is now.
  let doc: Doc = room.currentDoc();
  const now = doc.elements[id];
  if (!now) return { why: "That picture is no longer there." };
  // A picture fills its box without stretching, so it may be drawn bigger than the box, centred.
  const scale = Math.max(now.width / w, now.height / h);
  const left = now.x + (now.width - w * scale) / 2;
  const top = now.y + (now.height - h * scale) / 2;
  const middle = { x: now.x + now.width / 2, y: now.y + now.height / 2 };
  const turn = turnOf(now);
  const made: string[] = [];
  shapes.forEach((s, i) => {
    const nodes: AbsNode[] = s.nodes.map((n) => ({ x: left + n.x * scale, y: top + n.y * scale, ix: n.ix * scale, iy: n.iy * scale, ox: n.ox * scale, oy: n.oy * scale }));
    const box = drawnBox(nodes, true);
    const fractions: PathNode[] = nodes.map((n) => ({
      x: r4((n.x - box.x) / box.width),
      y: r4((n.y - box.y) / box.height),
      ix: r4(n.ix / box.width),
      iy: r4(n.iy / box.height),
      ox: r4(n.ox / box.width),
      oy: r4(n.oy / box.height),
    }));
    // a turned picture gives turned shapes, each swung round the middle of the picture
    const c = turnPoint(box.x + box.width / 2, box.y + box.height / 2, middle.x, middle.y, turn);
    const pid = newId("path");
    doc = runCommand(doc, "create_element", {
      id: pid,
      type: "path",
      parentId: now.parentId,
      x: c.x - box.width / 2,
      y: c.y - box.height / 2,
      width: box.width,
      height: box.height,
      props: { nodes: fractions, closed: true, fill: s.color, stroke: null, rotation: turn, name: shapes.length > 1 ? `${now.name} shape ${i + 1}` : `${now.name} shape` },
    });
    if (doc.elements[pid]) made.push(pid);
  });
  if (made.length === 0) return { why: "The shapes could not be placed here." };

  // biggest at the back, so smaller parts are not hidden; then everything sits just in front of the picture
  let groupId: string | null = null;
  let top1 = made[0];
  if (made.length > 1) {
    groupId = newId("group");
    doc = runCommand(doc, "group_elements", { ids: made, groupId });
    if (doc.elements[groupId]) {
      doc = runCommand(doc, "set_props", { ids: [groupId], props: { name: `${now.name} traced` } });
      top1 = groupId;
    } else groupId = null;
  }
  const list = now.parentId ? doc.elements[now.parentId].childIds : doc.rootIds;
  doc = runCommand(doc, "reparent_elements", { ids: [top1], parentId: now.parentId, index: list.indexOf(id) + 1 });
  room.restoreDoc(doc, "Trace picture into shapes", actor, by);
  room.select([top1]);
  return { ids: made, groupId };
}

import { turnOf, turnedBox } from "../document/geometry";
import { liveRoom } from "../state/store";
import type { Room } from "../state/store";
import { pictureOf, pictureSize, preloadPictures } from "../project/assets";
import { renderPng } from "../project/exporter";
import { drawWithFootage } from "../video/scene";
import { logError } from "../errorLog";
import type { Doc } from "../document/types";
import type { ToolResult } from "./tools";

/**
 * Eyes for the AI. It only knows names and numbers until it asks to see something.
 * Pictures are shrunk first, so a look costs about a thousand tokens, not a whole photo.
 */

const DEFAULT_SIDE = 768;
const side = (v: unknown) => Math.max(128, Math.min(1536, typeof v === "number" && Number.isFinite(v) ? Math.round(v) : DEFAULT_SIDE));

/** One picture on the canvas, as the designer placed it. */
export async function lookAtImage(id: unknown, max: unknown, room: Room = liveRoom): Promise<ToolResult> {
  const doc = room.currentDoc();
  const el = typeof id === "string" ? doc.elements[id] : undefined;
  if (!el) return { text: `No element with id: ${String(id)}.`, isError: true };
  if (el.type !== "image" || !el.src) return { text: `${el.name} is not a picture. Use look_at_design to see a frame or shape.`, isError: true };
  await preloadPictures(doc);
  const pic = pictureOf(el);
  const [pw, ph] = pic ? pictureSize(pic) : [0, 0];
  if (!pic || !pw) return { text: `The picture file for ${el.name} could not be found. Ask the designer to save the project and try again.`, isError: true };
  const k = Math.min(1, side(max) / Math.max(pw, ph));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(pw * k));
  canvas.height = Math.max(1, Math.round(ph * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) return { text: "Could not prepare the picture.", isError: true };
  // A logo can have see-through parts, and may itself be white or black. Mid grey behind it shows either.
  const clear = !/\.jpe?g$/i.test(el.src);
  ctx.fillStyle = clear ? "#8a8a92" : "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(pic, 0, 0, canvas.width, canvas.height);
  return {
    text: `The picture "${el.name}", ${pw} by ${ph} pixels, shown at ${canvas.width} by ${canvas.height}. On the canvas it sits at ${Math.round(el.width)} by ${Math.round(el.height)}.${clear ? " If it has see-through parts, they show here as flat mid grey. On the canvas they are see-through." : ""}`,
    image: { data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1], mime: "image/jpeg" },
  };
}

/** The frame that plays which holds this element, or the element itself when it is one. */
function sceneOf(doc: Doc, id: string): string | null {
  for (let el: Doc["elements"][string] | undefined = doc.elements[id]; el; el = el.parentId ? doc.elements[el.parentId] : undefined) {
    if (el.type === "frame" && el.duration > 0) return el.id;
  }
  return null;
}

const secs = (t: number) => `${Math.round(t * 100) / 100}s`;

/**
 * What the design looks like right now: one frame or shape, drawn as the designer sees it. In a frame
 * that plays it is drawn at the moment the playhead is on, or at `at` seconds, with the real footage.
 */
export async function lookAtDesign(ids: unknown, max: unknown, room: Room = liveRoom, at?: unknown): Promise<ToolResult> {
  const doc = room.currentDoc();
  const sel = room.getState().selection;
  const list = Array.isArray(ids) && ids.length ? ids.map(String) : sel.length ? sel : doc.rootIds.filter((i) => doc.elements[i]?.type === "frame").slice(0, 1);
  const id = list.find((i) => doc.elements[i]);
  if (!id) return { text: "There is nothing to look at yet. Draw or ask for a frame first.", isError: true };
  const el = doc.elements[id];
  await preloadPictures(doc);
  const box = turnedBox({ x: 0, y: 0, width: el.width, height: el.height }, turnOf(el));
  const k = Math.min(1, side(max) / Math.max(box.width, box.height));
  const sceneId = sceneOf(doc, id);
  const scene = sceneId ? doc.elements[sceneId] : null;
  let data: string;
  let when = "";
  if (scene) {
    const clock = room.getState().clock;
    const asked = typeof at === "number" && Number.isFinite(at);
    const t = Math.max(0, Math.min(scene.duration, asked ? (at as number) : clock.scene === scene.id ? clock.t : 0));
    when = ` at ${secs(t)} of ${secs(scene.duration)}${asked ? "" : clock.scene === scene.id ? ", where the playhead is" : ""}`;
    try {
      data = await drawWithFootage(doc, scene.id, t, k, (now) => renderPng(now, id, k));
    } catch (e) {
      logError("look at footage", e);
      return { text: `The footage in "${el.name}" could not be read at ${secs(t)}. Check that its file is still there.`, isError: true };
    }
  } else data = renderPng(doc, id, k);
  return {
    text: `A picture of "${el.name}" (${Math.round(el.width)} by ${Math.round(el.height)} pixels${turnOf(el) ? `, turned ${turnOf(el)} degrees` : ""})${when}, shown at ${Math.round(box.width * k)} by ${Math.round(box.height * k)}.${list.length > 1 ? " Only the first one is shown. Ask again for the others." : ""}`,
    image: { data, mime: "image/png" },
  };
}

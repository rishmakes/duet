import { invoke } from "@tauri-apps/api/core";
import { message, open } from "../ui/dialog";
import { newId } from "../commands";
import { worldPos } from "../document/geometry";
import { currentDoc, dispatch, getState, select } from "../state/store";
import { IMAGE_EXTENSIONS, addPicture, mimeFor } from "./assets";

/** Bring pictures onto the canvas: from the file picker, a drop, or the clipboard. */

const MAX_SIDE = 640;

function viewCentre(): { x: number; y: number } {
  const c = document.querySelector(".canvas-wrap");
  const vp = getState().viewport;
  const w = c?.clientWidth ?? 800;
  const h = c?.clientHeight ?? 600;
  return { x: (w / 2 - vp.x) / vp.zoom, y: (h / 2 - vp.y) / vp.zoom };
}

/** Put one picture on the page, centred on a point, inside the selected frame if there is one. */
async function place(name: string, bytes: Uint8Array, at: { x: number; y: number }, offset: number, mime?: string) {
  const { src, width, height } = await addPicture(name, bytes, mime);
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(8, Math.round(width * k));
  const h = Math.max(8, Math.round(height * k));
  const doc = currentDoc();
  const sel = getState().selection;
  const parent = sel.length === 1 && doc.elements[sel[0]]?.type === "frame" ? sel[0] : null;
  const origin = parent ? worldPos(doc, parent) : { x: 0, y: 0 };
  const id = newId("image");
  dispatch("create_element", {
    type: "image",
    id,
    parentId: parent,
    x: Math.round(at.x - w / 2 - origin.x + offset),
    y: Math.round(at.y - h / 2 - origin.y + offset),
    width: w,
    height: h,
    props: { src, name: name.replace(/\.[^.]+$/, "") || "Image" },
  });
  select([id]);
}

async function fail(e: unknown) {
  await message(e instanceof Error ? e.message : String(e), { title: "Duet", kind: "error" });
}

/** Dropped or pasted files. Ignores anything that is not a picture. */
export async function placeFiles(files: File[], at?: { x: number; y: number }) {
  const pictures = files.filter((f) => f.type.startsWith("image/") || mimeFor(f.name));
  const centre = at ?? viewCentre();
  try {
    for (let i = 0; i < pictures.length; i++) {
      const f = pictures[i];
      const bytes = new Uint8Array(await f.arrayBuffer());
      await place(f.name || "Pasted image", bytes, centre, i * 24, f.type || undefined);
    }
  } catch (e) {
    await fail(e);
  }
  return pictures.length;
}

/** The "Image" button: pick pictures from the computer. */
export async function pickImages() {
  try {
    const picked = await open({
      multiple: true,
      title: "Choose pictures",
      filters: [{ name: "Pictures", extensions: IMAGE_EXTENSIONS }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    const centre = viewCentre();
    for (let i = 0; i < paths.length; i++) {
      const b64 = await invoke<string>("read_binary_file", { path: paths[i] });
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
      await place(paths[i].split(/[\\/]/).pop() ?? "Image", bytes, centre, i * 24);
    }
  } catch (e) {
    await fail(e);
  }
}

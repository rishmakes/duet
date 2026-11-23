import { invoke } from "@tauri-apps/api/core";
import { addJob } from "../ai/jobs";
import type { Job } from "../ai/jobs";
import { toSvg } from "../document/svg";
import type { Doc } from "../document/types";
import { exportsDir } from "../video/scene";
import { preloadPictures } from "./assets";
import { drawPicture, renderPdf, renderPng, safe, uniqueNames } from "./exporter";
import { writePhotoshop } from "./photoshop";

/**
 * Screens made into files, through the same line as videos. Each kind of file the designer asks for is one
 * job: it makes that kind from every chosen screen, or one PDF holding them all, into one folder.
 */

export type DesignKind = "png" | "jpg" | "svg" | "pdf" | "psd";

/** One kind of file made from each screen: its kind, how many times bigger, and what goes after the name. */
export interface DesignFile {
  kind: DesignKind;
  scale: number;
  ending: string;
}

export const KIND_NAMES: Record<DesignKind, string> = { png: "PNG", jpg: "JPG", svg: "SVG", pdf: "PDF", psd: "Photoshop" };

/** Only pictures made of pixels come in sizes. */
export const takesSize = (k: DesignKind) => k === "png" || k === "jpg";

/** What goes after a screen's name unless the designer writes their own, like "@2x". */
export const standardEnding = (f: Pick<DesignFile, "kind" | "scale">) => (takesSize(f.kind) && f.scale !== 1 ? `@${f.scale}x` : "");

/** A kind of file in a few words, like "PNG 2x". */
export const designFileName = (f: Pick<DesignFile, "kind" | "scale">) => (takesSize(f.kind) ? `${KIND_NAMES[f.kind]} ${f.scale}x` : KIND_NAMES[f.kind]);

/** The files one kind makes: one per screen, or one PDF holding them all. A Photoshop file is made only from a frame. */
export function plannedFiles(doc: Doc, ids: string[], f: DesignFile, dir: string, project: string): { ids: string[]; path: string }[] {
  const ending = f.ending.replace(/[\\/:*?"<>|]+/g, "-").trimEnd();
  if (f.kind === "pdf") return ids.length ? [{ ids, path: `${dir}/${safe(ids.length === 1 ? doc.elements[ids[0]].name : project)}${ending}.pdf` }] : [];
  const use = f.kind === "psd" ? ids.filter((i) => doc.elements[i]?.type === "frame") : ids;
  const names = uniqueNames(use.map((i) => doc.elements[i].name));
  return use.map((id, k) => ({ ids: [id], path: `${dir}/${names[k]}${ending}.${f.kind}` }));
}

/** How many files the kinds make from these screens. */
export const countFiles = (doc: Doc, ids: string[], files: DesignFile[]) => files.reduce((n, f) => n + plannedFiles(doc, ids, f, "", "").length, 0);

async function writeOne(doc: Doc, ids: string[], f: DesignFile, path: string) {
  switch (f.kind) {
    case "svg":
      return invoke("write_text_file", { path, contents: toSvg(doc, ids[0]) });
    case "pdf":
      return invoke("write_binary_file", { path, dataBase64: renderPdf(doc, ids) });
    case "psd":
      return writePhotoshop(doc, ids[0], path);
    case "jpg":
      return invoke("write_binary_file", { path, dataBase64: drawPicture(doc, ids[0], f.scale, "image/jpeg").data });
    case "png":
      return invoke("write_binary_file", { path, dataBase64: renderPng(doc, ids[0], f.scale) });
  }
}

/** Put one kind of file, from these screens, in the line. It goes into the folder given, or Duet's Exports. */
export function queueDesign(ids: string[], f: DesignFile, who: Pick<Job, "project" | "by">, dir: string | undefined, doc: Doc): Job | { error: string } {
  if (!ids.length) return { error: "Nothing to export yet. Draw a frame first." };
  if (!plannedFiles(doc, ids, f, "", who.project).length) return { error: "A Photoshop file is made from a frame. Tick a frame." };
  let held = false;
  let stop = false;
  return addJob(
    { what: ids.length === 1 ? doc.elements[ids[0]].name : `${ids.length} screens`, kind: designFileName(f), seconds: 0, ...who },
    async (progress) => {
      const folder = dir || (await exportsDir());
      await invoke("make_dir", { path: folder });
      await preloadPictures(doc);
      const files = plannedFiles(doc, ids, f, folder, who.project);
      for (let k = 0; k < files.length; k++) {
        while (held && !stop) await new Promise((ok) => setTimeout(ok, 200));
        if (stop) return null;
        await writeOne(doc, files[k].ids, f, files[k].path);
        progress((k + 1) / files.length);
      }
      return files[0].path;
    },
    { pause: (on) => void (held = on), stop: () => void (stop = true) },
  );
}

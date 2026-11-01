import type { Doc } from "../document/types";
import { newId, runCommand } from "./index";

export interface SetPagesArgs {
  on: boolean;
}

export interface AddPageArgs {
  id?: string;
  sourceId?: string;
  afterId?: string;
  width?: number;
  height?: number;
  name?: string;
}

export interface ReorderPagesArgs {
  id: string;
  toIndex: number;
  reflow?: boolean;
}

/**
 * Turns page view on or off in the design document.
 * Never mutates the input document.
 */
export function setPages(doc: Doc, args: SetPagesArgs): Doc {
  if (args.on) {
    if (doc.pages === true) return doc;
    return { ...doc, pages: true };
  }
  if (!doc.pages) return doc;
  const { pages: _discard, ...rest } = doc;
  return rest;
}

/**
 * Adds a new page frame to the design, inheriting dimensions and fill from the source frame.
 * Places the frame horizontally in a row with a standard 40px gap.
 * Never mutates the input document.
 */
export function addPage(doc: Doc, args: AddPageArgs = {}): Doc {
  const rootFrames = doc.rootIds.filter((id) => doc.elements[id]?.type === "frame");
  const source = args.sourceId
    ? doc.elements[args.sourceId]
    : rootFrames.length > 0
    ? doc.elements[rootFrames[rootFrames.length - 1]]
    : undefined;

  const width = args.width ?? (source ? source.width : 1080);
  const height = args.height ?? (source ? source.height : 1080);
  const fill = source?.fill ?? "#ffffff";
  const stroke = source?.stroke ?? null;
  const strokeWidth = source?.strokeWidth ?? 0;
  const radius = source?.radius ?? 0;

  let maxX = 0;
  for (const rid of doc.rootIds) {
    const el = doc.elements[rid];
    if (el) maxX = Math.max(maxX, el.x + el.width);
  }
  const x = doc.rootIds.length === 0 ? 0 : maxX + 40;
  const y = 0;

  const id = args.id ?? newId("frame");
  const name = args.name ?? `Page ${rootFrames.length + 1}`;

  let next = runCommand(doc, "create_element", {
    type: "frame",
    id,
    x,
    y,
    width,
    height,
    props: {
      name,
      fill,
      stroke,
      strokeWidth,
      radius,
    },
  });

  if (args.afterId && next.rootIds.includes(args.afterId)) {
    const rootIds = next.rootIds.filter((rid) => rid !== id);
    const idx = rootIds.indexOf(args.afterId);
    rootIds.splice(idx + 1, 0, id);
    next = { ...next, rootIds };
  }

  if (doc.pages && !next.pages) {
    next = { ...next, pages: true };
  }

  return next;
}

/**
 * Reorders a page frame to a new position among root frames.
 * When reflow is true (the default), re-sequences horizontal x coordinates.
 * Never mutates the input document.
 */
export function reorderPages(doc: Doc, args: ReorderPagesArgs): Doc {
  const rootFrames = doc.rootIds.filter((id) => doc.elements[id]?.type === "frame");
  if (!rootFrames.includes(args.id)) return doc;

  const fromIndex = rootFrames.indexOf(args.id);
  const toIndex = Math.max(0, Math.min(rootFrames.length - 1, args.toIndex));
  if (fromIndex === toIndex && args.reflow === false) return doc;

  const reordered = [...rootFrames];
  reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, args.id);

  let frameIdx = 0;
  const nextRootIds = doc.rootIds.map((rid) => {
    if (doc.elements[rid]?.type === "frame") {
      return reordered[frameIdx++];
    }
    return rid;
  });

  const nextElements = { ...doc.elements };

  if (args.reflow !== false) {
    let curX = 0;
    for (const fid of reordered) {
      const el = nextElements[fid];
      if (el) {
        if (el.x !== curX) {
          nextElements[fid] = { ...el, x: curX };
        }
        curX += el.width + 40;
      }
    }
  }

  return {
    ...doc,
    rootIds: nextRootIds,
    elements: nextElements,
  };
}

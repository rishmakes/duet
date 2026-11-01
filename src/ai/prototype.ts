import { onOpenBoard } from "../document/boards";
import { isDerived } from "../document/components";
import { descendants } from "../document/geometry";
import type { Doc, El } from "../document/types";

export interface PrototypeMap {
  /** Where clicking through starts: the first screen on the board. */
  start: string | null;
  screens: { id: string; name: string; width: number; height: number; scrolls: boolean }[];
  connections: {
    /** The thing that is clicked or hovered, its name, and its words when it is text or holds text. */
    from: string;
    name: string;
    text?: string;
    /** The screen it sits on. */
    on: string;
    when: "click" | "hover";
    does: "go" | "open on top" | "back";
    to?: string;
    toName?: string;
    moves?: string;
    ms?: number;
  }[];
  /** Screens no connection opens, apart from the start. */
  notReached: string[];
  /** Screens with nothing on them that leads anywhere. */
  deadEnds: string[];
}

/** The words on a thing: its own text, or the first text inside it, like a button's label. */
function wordsOf(doc: Doc, el: El): string | undefined {
  if (el.type === "text") return el.text.trim().slice(0, 60) || undefined;
  for (const d of descendants(doc, el.id)) {
    const t = doc.elements[d];
    if (t?.type === "text" && t.text.trim()) return t.text.trim().slice(0, 60);
  }
  return undefined;
}

/**
 * Every screen on the open board and every connection between them, small enough for an AI to read at once.
 * It is also the plan a developer's AI follows to build the real thing: which click or hover goes where, and how.
 */
export function prototypeMap(doc: Doc): PrototypeMap {
  const here = onOpenBoard(doc);
  const screens = doc.rootIds.map((id) => doc.elements[id]).filter((e): e is El => !!e && e.type === "frame" && !e.hidden);
  const screenIds = new Set(screens.map((s) => s.id));
  const connections: PrototypeMap["connections"] = [];
  for (const screen of screens) {
    for (const id of [screen.id, ...descendants(doc, screen.id)]) {
      const el = doc.elements[id];
      if (!el || el.hidden || (isDerived(id) && !el.link && el.linkKind !== "back")) continue;
      const back = el.linkKind === "back";
      const target = el.link && here.has(el.link) && doc.elements[el.link]?.type === "frame" ? el.link : null;
      if (!back && !target) continue;
      const text = wordsOf(doc, el);
      connections.push({
        from: id,
        name: el.name,
        ...(text ? { text } : {}),
        on: screen.id,
        when: el.trigger === "hover" ? "hover" : "click",
        does: back ? "back" : el.linkKind === "overlay" ? "open on top" : "go",
        ...(target ? { to: target, toName: doc.elements[target].name } : {}),
        ...(el.transition ? { moves: el.transition, ms: el.transitionMs || 300 } : {}),
      });
    }
  }
  const start = screens[0]?.id ?? null;
  const opened = new Set(connections.map((c) => c.to).filter(Boolean));
  const leaves = new Set(connections.map((c) => c.on));
  return {
    start,
    screens: screens.map((s) => ({ id: s.id, name: s.name, width: s.width, height: s.height, scrolls: s.scroll })),
    connections,
    notReached: screens.filter((s) => s.id !== start && !opened.has(s.id) && screenIds.has(s.id)).map((s) => s.name),
    deadEnds: screens.filter((s) => !leaves.has(s.id)).map((s) => s.name),
  };
}

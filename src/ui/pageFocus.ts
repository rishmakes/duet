import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Doc } from "../document/types";
import { getState, subscribe as subscribeStore, useStore } from "../state/store";

let activePageId: string | null = null;
let allPagesMode = false;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

export function openPage(id: string) {
  activePageId = id;
  allPagesMode = false;
  notify();
}

export function showAllPages() {
  activePageId = null;
  allPagesMode = true;
  notify();
}

export function resetPageFocus() {
  if (activePageId === null && !allPagesMode) return;
  activePageId = null;
  allPagesMode = false;
  notify();
}

/** Page view shows one page, so when the AI makes a new page the view follows it, or the designer would never see the work. */
export function newPageFromAi(before: Doc | undefined, after: Doc, actor: string): string | null {
  if (actor === "you" || !before || !after.pages) return null;
  const had = new Set(before.rootIds);
  const fresh = after.rootIds.filter((id) => !had.has(id) && after.elements[id]?.type === "frame");
  return fresh.length ? fresh[fresh.length - 1] : null;
}

// Reset page focus whenever tabs change or project changes
let lastTabId: string | null = null;
let lastDoc: Doc | undefined;
if (typeof window !== "undefined") {
  window.addEventListener("duet:tabs", resetPageFocus);
  subscribeStore(() => {
    const s = getState();
    const curId = s.project.file ?? s.project.path ?? (s.timeline[0]?.time ? String(s.timeline[0].time) : null);
    if (lastTabId !== null && curId !== lastTabId) {
      resetPageFocus();
    }
    lastTabId = curId;
    const now = s.timeline[s.cursor];
    const doc = now?.doc;
    const follow = doc && lastDoc && doc !== lastDoc ? newPageFromAi(lastDoc, doc, now.actor) : null;
    lastDoc = doc;
    if (follow && !allPagesMode) openPage(follow);
  });
}

export function getActivePage(doc: Doc): string | null {
  if (!doc.pages || allPagesMode) return null;
  const rootFrames = doc.rootIds.filter((id) => doc.elements[id]?.type === "frame");
  if (rootFrames.length === 0) return null;
  if (activePageId && rootFrames.includes(activePageId)) return activePageId;
  return rootFrames[0];
}

export function isAllPages(doc: Doc): boolean {
  return !!doc.pages && allPagesMode;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function usePageFocus(doc: Doc): { activePageId: string | null; isAllPages: boolean } {
  useSyncExternalStore(subscribe, () => `${activePageId}:${allPagesMode}`);

  const tabKey = useStore((s) => s.project.file ?? s.project.path ?? (s.timeline[0]?.time ? String(s.timeline[0].time) : "live"));
  const lastTab = useRef<string | null>(null);

  useEffect(() => {
    if (lastTab.current !== null && lastTab.current !== tabKey) {
      resetPageFocus();
    }
    lastTab.current = tabKey;
  }, [tabKey]);

  if (!doc.pages) {
    return { activePageId: null, isAllPages: false };
  }
  if (allPagesMode) {
    return { activePageId: null, isAllPages: true };
  }
  const rootFrames = doc.rootIds.filter((id) => doc.elements[id]?.type === "frame");
  if (rootFrames.length === 0) {
    return { activePageId: null, isAllPages: false };
  }
  const active = activePageId && rootFrames.includes(activePageId) ? activePageId : rootFrames[0];
  return { activePageId: active, isAllPages: false };
}

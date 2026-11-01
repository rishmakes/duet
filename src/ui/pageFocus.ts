import { useSyncExternalStore } from "react";
import type { Doc } from "../document/types";

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
  activePageId = null;
  allPagesMode = false;
  notify();
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

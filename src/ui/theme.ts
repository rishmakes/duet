import { useSyncExternalStore } from "react";
import { updateCanvasColors } from "../canvas/render";

export type Theme = "dark" | "light";

let currentTheme: Theme = "dark";
const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return currentTheme;
}

export function setTheme(theme: Theme) {
  if (theme === currentTheme) return;
  currentTheme = theme;
  try {
    localStorage.setItem("duet.theme", theme);
  } catch {
    /* localStorage disabled or restricted */
  }
  applyTheme(theme);
  for (const fn of listeners) fn();
}

export function toggleTheme() {
  setTheme(currentTheme === "light" ? "dark" : "light");
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  updateCanvasColors();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("duet:theme", { detail: theme }));
    window.dispatchEvent(new CustomEvent("duet:repaint"));
  }
}

export function initTheme() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("duet.theme");
  } catch {
    /* ignore */
  }
  currentTheme = saved === "light" ? "light" : "dark";
  applyTheme(currentTheme);
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore<Theme>(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => currentTheme,
    () => "dark"
  );
  return [theme, setTheme];
}

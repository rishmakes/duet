import { getLayout, setLayout } from "./layout";

/**
 * Tilde (or the key beside 1) fills the window with the part under the pointer: the chat, the timeline or the
 * picture. Pressed again, or Escape, everything comes back. Typing in a box keeps the key, except in an empty chat box.
 */
let under: Element | null = null;

function part(): "chat" | "time" | "canvas" | null {
  if (!under) return null;
  if (under.closest(".chat")) return "chat";
  if (under.closest("[data-name='time-strip']")) return "time";
  if (under.closest(".canvas, .kitchen-preview")) return "canvas";
  return null;
}

type Part = "chat" | "time" | "canvas" | null;
type Full = { chatFull: boolean; timeMax: boolean; canvasMax: boolean };
const NONE = { chatFull: false, timeMax: false, canvasMax: false };

/**
 * What a key does to the layout: the part to fill the window with, everything back, or nothing (null).
 * `typing` is a box with text in it that keeps the key; an empty chat box does not.
 */
export function tildeChange(d: Full, key: string, over: Part, typing: boolean): Partial<Full> | null {
  const anyFull = d.chatFull || d.timeMax || d.canvasMax;
  if (key === "Escape") return anyFull ? NONE : null;
  if ((key !== "`" && key !== "~") || typing) return null;
  if (anyFull) return NONE;
  if (over === "chat") return { chatFull: true };
  if (over === "time") return { timeMax: true };
  if (over === "canvas") return { canvasMax: true };
  return null;
}

export function installTilde(): () => void {
  const move = (e: PointerEvent) => (under = e.target as Element);
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape" && (e.metaKey || e.ctrlKey || e.altKey)) return;
    const on = document.activeElement as HTMLElement | null;
    const box = !!on && (on.tagName === "INPUT" || on.tagName === "TEXTAREA" || on.tagName === "SELECT" || on.isContentEditable);
    const emptyChat = box && !!on!.closest(".chat") && (on as HTMLTextAreaElement).value === "";
    const change = tildeChange(getLayout(), e.key, part() ?? (on?.closest(".chat") ? "chat" : null), box && !emptyChat);
    if (!change) return;
    if (e.key !== "Escape") {
      e.preventDefault();
      e.stopPropagation();
    }
    setLayout(change);
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("keydown", key, true);
  return () => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("keydown", key, true);
  };
}

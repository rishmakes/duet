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

export function installTilde(): () => void {
  const move = (e: PointerEvent) => (under = e.target as Element);
  const key = (e: KeyboardEvent) => {
    const d = getLayout();
    const anyFull = d.chatFull || d.timeMax || d.canvasMax;
    if (e.key === "Escape" && anyFull) {
      setLayout({ chatFull: false, timeMax: false, canvasMax: false });
      return;
    }
    if (e.key !== "`" && e.key !== "~") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const on = document.activeElement as HTMLElement | null;
    const typing = on && (on.tagName === "INPUT" || on.tagName === "TEXTAREA" || on.tagName === "SELECT" || on.isContentEditable);
    if (typing && !(on!.closest(".chat") && (on as HTMLTextAreaElement).value === "")) return;
    e.preventDefault();
    e.stopPropagation();
    if (anyFull) return setLayout({ chatFull: false, timeMax: false, canvasMax: false });
    const p = part() ?? (on?.closest(".chat") ? "chat" : null);
    if (p === "chat") setLayout({ chatFull: true });
    else if (p === "time") setLayout({ timeMax: true });
    else if (p === "canvas") setLayout({ canvasMax: true });
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("keydown", key, true);
  return () => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("keydown", key, true);
  };
}

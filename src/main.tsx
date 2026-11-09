import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { watchForFreezes } from "./freezeWatch";
import { initTheme } from "./ui/theme";

// Apply saved theme before first paint so there is no dark flash
try {
  const theme = localStorage.getItem("duet.theme");
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  }
} catch {
  /* localStorage not accessible */
}
initTheme();

// In development only: lets a developer look at the app's state from the console.
if (import.meta.env.DEV) void import("./state/store").then((m) => ((window as unknown as { __duet: unknown }).__duet = m));

// In the app people download, Duet is never a web page: the system's own right click menu, with
// Reload and Inspect, does not show, and the reload keys do nothing. Reload would throw away unsaved work.
if (import.meta.env.PROD) {
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "F5" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r")) e.preventDefault();
    },
    true,
  );
}

// A file dropped anywhere Duet does not take it must never be opened by the window itself: that would
// replace Duet with the file, and the window could then not even be closed.
watchForFreezes();

for (const ev of ["dragover", "drop"]) window.addEventListener(ev, (e) => e.preventDefault());

// Dragging over selected text (in the chat, say) or a picture must not lift a see-through copy of it
// that follows the pointer across the canvas (#313). Only things Duet made draggable may be dragged.
window.addEventListener(
  "dragstart",
  (e) => {
    const t = e.target;
    const el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
    if (!el?.closest('[draggable="true"]')) e.preventDefault();
  },
  true,
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

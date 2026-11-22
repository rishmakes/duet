import { agentIsDriving } from "../ui/dialog";
import { runCommand } from "../commands";
import { emptyDoc } from "../document/types";
import { inTestDesign, keepTestDesign, leaveTestDesign, openProjectAt, startTestDesign } from "../project/project";
import { homeDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { currentDoc, getState, seenDoc } from "../state/store";
import { clipPictureOf, clipState } from "../video/clips";
import { seek } from "../video/play";
import { getLayout, setLayout } from "../ui/layout";
import { spanOf } from "../document/time";
import { trackRows } from "../document/tracks";
import { CUT_MOVE_NAMES } from "../document/moves";
import { defaultChoice, exportScene } from "../video/scene";
import { addClip, getCut, emptyCut, setCut, sizeOf } from "../video/cut";
import type { Info } from "../video/cut";
import { busyOutside } from "./outside";
import { bindAi } from "./tools";
import type { ToolDef, ToolResult } from "./tools";

/**
 * Tools for the people and AIs who build Duet, not for designers. They let an AI check the interface
 * itself: start a clean test design, read what the panels show, press things, and read errors.
 * Only the build Duet is developed with loads this file (see `mcp.ts`). A downloaded app never has them.
 * They press the interface like a hand would, so the permission levels in `tools.ts` do not apply here.
 */

const str = { type: "string" };
const num = { type: "number" };
const bool = { type: "boolean" };
const held = { type: "array", items: str, description: "Keys held down: any of alt, shift, cmd, ctrl." };
const which = {
  n: { ...num, description: "The number of a line from the last dev_read_interface." },
  name: { ...str, description: "What the thing is called: its label, its hint, or the words on it. Not needed with n." },
  nth: { ...num, description: "When several things share the name: which one, counting from 1." },
};

export const GUIDE = `Builder tools check Duet's own interface. They exist only in the build Duet is developed with.

How to check a change:
1. dev_test_design puts the open project away and starts a clean design with no file. Nothing in it is ever saved. Pass sample true for a frame that holds a shape and a group, with a plain shape beside it.
2. Change the design with the ordinary tools (create_element, set_props and so on) if the check needs more on the canvas.
3. dev_read_interface says what the panels show, as numbered lines of words. Pass filter to see only lines with a word in them.
4. dev_press presses something by its name or by its line number. dev_type writes in a box. dev_key presses a key. dev_slide drags a slider and times it.
5. Read the interface again to see what changed. Line numbers are only good until the next read.
5b. dev_look_at_window gives a picture of the whole Duet window, drawn by Duet itself, without the DEV tag (so it looks like the real Duet; the tag stays on the real window). Use it to see how a change looks, and as the starting point of any mockup: start from what is really there, never from a guess.
6. dev_history lists the last steps and who made each one. dev_errors lists what went wrong since the last look.
7. After Duet's code changes, dev_reload loads the interface again. Wait three seconds after it: a call made while it loads is lost. The test design is lost too, so start a new one.
8. dev_leave_test_design throws the test design away and brings the project back. Always finish with it.
9. For mockups in a file: dev_keep_test_design saves a test design as a new file; dev_open_project opens a file that already exists, in its own tab.

A line reads: number, kind, "name", then its marks. The marks are the style names on it (sel is selected, on is switched on, folded is folded shut), its value if it is a box, and off if it cannot be pressed. Lines pushed in are inside the line above.
4b. dev_drag drags across the canvas through points given in design coordinates, as a hand would with the current tool: paint with the brush, draw a box, move something.
What these tools cannot do: drag a layer in a panel, or answer a window from the system such as Save.`;

export const BUILDER_TOOLS: ToolDef[] = [
  { name: "dev_guide", description: "Builder tool. How to check Duet's interface with the dev_ tools. Read it once.", inputSchema: { type: "object", properties: {} } },
  {
    name: "dev_test_design",
    description: "Builder tool. Put the open project away and start a clean test design that is never saved. Call it before any check, so a real project is never touched.",
    inputSchema: { type: "object", properties: { sample: { ...bool, description: "True to start with a frame that holds a shape and a group, and a plain shape beside it." } } },
  },
  {
    name: "dev_keep_test_design",
    description: "Builder tool. Save the test design as a project file, with no window to ask where. For mockups. Give the full path of a new file that ends in .duet.",
    inputSchema: { type: "object", properties: { path: str }, required: ["path"] },
  },
  { name: "dev_leave_test_design", description: "Builder tool. Throw the test design away and bring back the project that was open before it.", inputSchema: { type: "object", properties: {} } },
  {
    name: "dev_open_project",
    description: "Builder tool. Open a project file in its own tab, with no window to ask which, and work in it from then on. For mockups the designer asked for in a file. A test design on screen is thrown away first. Give the full path of a .duet file.",
    inputSchema: { type: "object", properties: { path: str }, required: ["path"] },
  },
  {
    name: "dev_read_interface",
    description: "Builder tool. What the interface shows right now, as numbered lines of words: buttons, boxes, rows and text, with their marks.",
    inputSchema: { type: "object", properties: { filter: { ...str, description: "Only lines with these words in them." }, max: { ...num, description: "The most lines to give back. 200 if left out." } } },
  },
  {
    name: "dev_press",
    description: "Builder tool. Press something in the interface, by line number or by name. With offset, press the bare spot that far from its middle instead, such as empty room beside a button.",
    inputSchema: {
      type: "object",
      properties: {
        ...which,
        keys: held,
        double: { ...bool, description: "True for a double click." },
        right: { ...bool, description: "True for a right click." },
        offset: { type: "array", items: num, description: "[dx, dy] in screen pixels from the middle of what is named; whatever is under that spot is pressed." },
      },
    },
  },
  {
    name: "dev_type",
    description: "Builder tool. Write in a box, replacing what is in it.",
    inputSchema: { type: "object", properties: { ...which, text: str, enter: { ...bool, description: "True to press Enter after." } }, required: ["text"] },
  },
  {
    name: "dev_slide",
    description: "Builder tool. Drag a slider as a hand would: from where it is to `to`, about 60 moves a second for `ms` milliseconds (600 if left out), then let go. Answers how long each move took to handle and to reach the screen, so a lag can be measured.",
    inputSchema: { type: "object", properties: { ...which, to: num, ms: num }, required: ["to"] },
  },
  {
    name: "dev_key",
    description: "Builder tool. Press a key, such as f, Escape, Delete or ArrowLeft, as if the canvas had the attention.",
    inputSchema: { type: "object", properties: { key: str, keys: held }, required: ["key"] },
  },
  {
    name: "dev_drag_clip",
    description:
      "Builder tool. Drag a clip on the timeline in Edit, the way a hand would: by its middle to move it, or by its start or end to trim it. by is how many seconds along (minus for earlier). track names another track to move it onto. keys are held the whole way (cmd pushes clips along instead of covering them); noSnap turns the timeline's magnet off for the drag so it does not snap. The answer says what the timeline said during the drag and where every clip is after it.",
    inputSchema: {
      type: "object",
      properties: {
        clip: { ...str, description: "The clip's name as the timeline shows it." },
        nth: { ...num, description: "When several clips share the name: which one, counting from the left, from 1." },
        part: { type: "string", enum: ["middle", "start", "end"], description: "Where to hold it. middle if left out." },
        by: { ...num, description: "Seconds to drag along: plus is later, minus is earlier." },
        track: { ...str, description: "The name of a track to drop it on. Left out, it stays on its own." },
        keys: held,
        noSnap: { ...bool, description: "True to turn snapping off (the magnet) for this drag, so it does not snap to edges." },
      },
      required: ["clip", "by"],
    },
  },
  {
    name: "dev_drop_transition",
    description:
      "Builder tool. Drag a transition tile from Assets onto a cut on the timeline in Edit, the way a hand would, and let go there. Open the Assets tab with the Transitions shelf open first, and the video in Edit. The cut is named by the clip that comes in after it. The answer says whether every cut showed its + during the drag, whether the cut lit up under the tile, and every clip after it with the transition it comes in with.",
    inputSchema: {
      type: "object",
      properties: {
        transition: { ...str, description: "The transition's name as its tile shows it, such as Dissolve." },
        clip: { ...str, description: "The clip that comes in at the cut, by its name on the timeline." },
        hold: { ...num, description: "Seconds to hold the tile over the cut before letting go, so a picture of the window can be taken meanwhile. 0 if left out." },
      },
      required: ["transition", "clip"],
    },
  },
  {
    name: "dev_drop_footage",
    description:
      "Builder tool. Drag footage from Media onto the timeline in Edit, the way a hand would, and let go on a track at a second. keys are held (cmd pushes clips along instead of covering them). top true drops on the top edge of the track, which makes a new track above. The answer says what the timeline said and where every clip is after it.",
    inputSchema: {
      type: "object",
      properties: {
        item: { ...str, description: "The footage's name as Media shows it." },
        track: { ...str, description: "The name of the track to drop it on." },
        at: { ...num, description: "The second on the timeline where it lands." },
        keys: held,
        top: { ...bool, description: "True to drop on the top edge of the track: a new track above it." },
      },
      required: ["item", "track", "at"],
    },
  },
  {
    name: "dev_drag",
    description: "Builder tool. Drag across the canvas with the current tool, through points in design coordinates (the same as x and y of elements on the page). Two points or more.",
    inputSchema: {
      type: "object",
      properties: {
        points: { type: "array", items: { type: "array", items: num }, description: "[[x, y], ...] in design coordinates." },
        keys: held,
        pen: { ...bool, description: "True to drag as a pen on a drawing tablet instead of a mouse." },
        pressure: { ...num, description: "With pen: how hard, from 0 to 1. 0.5 if left out." },
      },
      required: ["points"],
    },
  },
  {
    name: "dev_drag_export",
    description: "Builder tool. On the Export page, drag a waiting video by its grip the way a hand would, and let go before another waiting video, or at the end of the line. The answer says the order of the line after it.",
    inputSchema: {
      type: "object",
      properties: {
        video: { ...str, description: "The name of the waiting video to drag, as its row starts." },
        before: { ...str, description: "The name of the waiting video to let go before. Left out, it goes to the end of the line." },
      },
      required: ["video"],
    },
  },
  {
    name: "dev_history",
    description: "Builder tool. The last steps in the history: what each one is called, who made it, and where the design is now.",
    inputSchema: { type: "object", properties: { last: { ...num, description: "How many steps, counting back from the newest. 12 if left out." } } },
  },
  {
    name: "dev_video",
    description: "Builder tool. Stand in for the two system windows of the video screen. add: put a video file in the list by its full path. export: make the video at a full path. clear: empty the list. For a frame that plays: frame makes the video of the frame with id at a full path, and clock moves the clock to the second t and says what the canvas shows then.",
    inputSchema: { type: "object", properties: { do: { type: "string", enum: ["add", "export", "clear", "frame", "clock"] }, path: str, id: str, t: { type: "number" } }, required: ["do"] },
  },
  {
    name: "dev_look_at_window",
    description: "Builder tool. See the whole Duet window as it is right now, drawn by Duet itself like the picture Feedback attaches: only Duet, nothing else on the screen. Use it to check how a change looks, and to start a mockup from what is really there. maxSize is the longest side in pixels (default 1600). The picture leaves out the DEV tag and the folder name that mark Duet dev (they stay on the real window), so it looks like the real Duet and is fit for the website; set keepDevTag true to keep them.",
    inputSchema: { type: "object", properties: { maxSize: num, keepDevTag: bool } },
  },
  { name: "dev_reload", description: "Builder tool. Load the interface again, so a change to Duet's code is surely the one running. A test design does not survive it: the project that was open comes back.", inputSchema: { type: "object", properties: {} } },
  {
    name: "dev_errors",
    description: "Builder tool. Errors and warnings Duet has shown since the last look.",
    inputSchema: { type: "object", properties: { keep: { ...bool, description: "True to leave them in the list." } } },
  },
];

export const isBuilderTool = (name: string) => BUILDER_TOOLS.some((t) => t.name === name);

// ---- errors ----

const errors: string[] = [];
let watching = false;

function note(kind: string, parts: unknown[]) {
  const text = parts.map((p) => (p instanceof Error ? (p.stack ?? p.message) : typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  errors.push(`${kind}: ${text.slice(0, 600)}`);
  if (errors.length > 50) errors.shift();
}

/** Start keeping what goes wrong. Called once when the tools are switched on. */
export function watchErrors() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("error", (e) => note("error", [e.error ?? e.message]));
  window.addEventListener("unhandledrejection", (e) => note("error", [e.reason]));
  for (const kind of ["error", "warn"] as const) {
    const was = console[kind].bind(console);
    console[kind] = (...parts: unknown[]) => {
      note(kind === "warn" ? "warning" : "error", parts);
      was(...parts);
    };
  }
}

// ---- reading the interface ----

export interface Line {
  kind: string;
  name: string;
  marks: string[];
  depth: number;
}

/** One line the way an AI reads it. */
export function lineText(n: number, l: Line): string {
  return `${"  ".repeat(l.depth)}${n} ${l.kind} "${l.name}"${l.marks.length ? ` [${l.marks.join(", ")}]` : ""}`;
}

/**
 * Which line a name means. An exact name wins over one that only holds the words.
 * Returns the place in the list, or a message that says why none was picked.
 */
export function pick(lines: Pick<Line, "kind" | "name">[], name: string, nth?: number): number | string {
  const want = name.trim().toLowerCase();
  if (!want) return "Say which thing: give n or name.";
  const pressable = lines.map((l, i) => ({ l, i })).filter((x) => x.l.kind !== "text");
  const exact = pressable.filter((x) => x.l.name.toLowerCase() === want);
  const found = exact.length ? exact : pressable.filter((x) => x.l.name.toLowerCase().includes(want));
  if (!found.length) return `Nothing on the screen is called "${name}". Read the interface again.`;
  if (nth !== undefined) return found[nth - 1]?.i ?? `There are only ${found.length} things called "${name}".`;
  if (found.length > 1) return `${found.length} things are called "${name}": lines ${found.map((x) => x.i + 1).join(", ")}. Give n, or nth.`;
  return found[0].i;
}

const PRESSABLE = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [draggable="true"], [title], [contenteditable="true"]';
const SKIP = new Set(["SCRIPT", "STYLE", "SVG", "CANVAS", "NOSCRIPT", "OPTION"]);

let lastRead: { line: Line; el: HTMLElement }[] = [];

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Something made to be pressed that says so only by its pointer, such as a tab or an idea in the chat. */
function pointsAt(el: HTMLElement): boolean {
  if (getComputedStyle(el).cursor !== "pointer") return false;
  // the pointer is handed down to everything inside, so only the outermost one counts
  return !el.parentElement || getComputedStyle(el.parentElement).cursor !== "pointer";
}

const isBox = (el: HTMLElement) => el.matches("input, textarea, select");

/** The words beside a box that say what it is for. */
function labelOf(el: HTMLElement): string {
  const label = el.closest("label") ?? el.previousElementSibling;
  return label && label !== el ? squash(label.textContent ?? "") : "";
}

function nameOf(el: HTMLElement): string {
  const box = el as HTMLInputElement;
  const words = squash(el.textContent ?? "");
  // a holder with a hint, such as the top of the chat, is named by the hint, not by everything inside it
  const holder = !!el.title && el.children.length > 0 && !el.matches("button, a[href]") && !el.draggable;
  const own = el.getAttribute("aria-label") || (isBox(el) ? box.placeholder || box.title || labelOf(el) || box.name : holder ? el.title : words || el.title) || "";
  return squash(own).slice(0, 80);
}

function kindOf(el: HTMLElement): string {
  const role = el.getAttribute("role");
  if (role) return role;
  if (el.matches("button")) return "button";
  if (el.matches("a[href]")) return "link";
  if (el.matches("select")) return "choice";
  if (el.matches("input, textarea, [contenteditable='true']")) return "box";
  if (el.draggable) return "row";
  return "thing";
}

function marksOf(el: HTMLElement): string[] {
  const marks = [...el.classList];
  const box = el as HTMLInputElement;
  if (el.matches("input[type='checkbox'], input[type='radio']")) marks.push(box.checked ? "ticked" : "not ticked");
  else if (el.matches("input, textarea, select")) marks.push(`value ${JSON.stringify(box.value)}`);
  if (el.title && squash(el.title).slice(0, 80) !== nameOf(el)) marks.push(`hint ${JSON.stringify(squash(el.title).slice(0, 80))}`);
  if (box.disabled) marks.push("off");
  return marks;
}

function shown(el: HTMLElement): boolean {
  if (!el.getClientRects().length) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function walk(el: HTMLElement, depth: number, covered: boolean, out: { line: Line; el: HTMLElement }[]) {
  if (SKIP.has(el.tagName.toUpperCase()) || !shown(el)) return;
  let inside = depth;
  let under = covered;
  // a holder is named by its hint, so the words inside it are still listed
  const holder = el.matches(PRESSABLE) && !!el.title && nameOf(el) === squash(el.title).slice(0, 80) && el.children.length > 0;
  if (el.matches(PRESSABLE) || (!covered && pointsAt(el))) {
    out.push({ line: { kind: kindOf(el), name: nameOf(el), marks: marksOf(el), depth }, el });
    inside = depth + 1;
    under = !holder; // its words are its name, so they are not listed again
  } else if (!covered) {
    const words = squash([...el.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent ?? "").join(" "));
    if (words) out.push({ line: { kind: "text", name: words.slice(0, 160), marks: [], depth }, el });
  }
  for (const child of el.children) if (child instanceof HTMLElement) walk(child, inside, under, out);
}

function readInterface(filter: unknown, max: unknown): string {
  lastRead = [];
  walk(document.body, 0, false, lastRead);
  const want = typeof filter === "string" ? filter.trim().toLowerCase() : "";
  const all = lastRead.map((r, i) => lineText(i + 1, r.line));
  const lines = want ? all.filter((t) => t.toLowerCase().includes(want)) : all;
  const most = typeof max === "number" && max > 0 ? Math.floor(max) : 200;
  const more = lines.length > most ? `\n${lines.length - most} more lines. Use filter to see less at once.` : "";
  return lines.length ? lines.slice(0, most).join("\n") + more : want ? `No line has "${filter}" in it.` : "The interface is empty.";
}

// ---- pressing ----

type Args = Record<string, unknown>;

const fail = (text: string): ToolResult => ({ text, isError: true });

/** A PNG made no larger than `most` on its long side, as base64. */
async function shrinkPng(png: ArrayBuffer, most: number): Promise<string> {
  const picture = await createImageBitmap(new Blob([png], { type: "image/png" }));
  const k = Math.min(1, most / Math.max(picture.width, picture.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(picture.width * k);
  canvas.height = Math.round(picture.height * k);
  canvas.getContext("2d")!.drawImage(picture, 0, 0, canvas.width, canvas.height);
  picture.close();
  return canvas.toDataURL("image/png").split(",")[1];
}
/** Long enough for the interface to draw what the press changed. */
const settle = () => new Promise<void>((r) => setTimeout(r, 80));

function find(a: Args): HTMLElement | string {
  if (typeof a.n === "number") {
    const hit = lastRead[a.n - 1]?.el;
    if (!hit) return `There is no line ${a.n}. Read the interface again.`;
    if (!hit.isConnected) return `Line ${a.n} is no longer on the screen. Read the interface again.`;
    return hit;
  }
  // a name is looked up on the screen as it is now, not as it was at the last read
  const now: { line: Line; el: HTMLElement }[] = [];
  walk(document.body, 0, false, now);
  const at = pick(now.map((r) => r.line), String(a.name ?? ""), typeof a.nth === "number" ? a.nth : undefined);
  return typeof at === "string" ? at : now[at].el;
}

function heldKeys(list: unknown) {
  const keys = Array.isArray(list) ? list.map((k) => String(k).toLowerCase()) : [];
  return { altKey: keys.includes("alt"), shiftKey: keys.includes("shift"), metaKey: keys.includes("cmd"), ctrlKey: keys.includes("ctrl") };
}

async function press(a: Args): Promise<ToolResult> {
  const named = find(a);
  if (typeof named === "string") return fail(named);
  const r = named.getBoundingClientRect();
  const off = Array.isArray(a.offset) ? (a.offset as unknown[]).map(Number) : null;
  const x = r.left + r.width / 2 + (off?.[0] || 0);
  const y = r.top + r.height / 2 + (off?.[1] || 0);
  const spot = off ? document.elementFromPoint(x, y) : named;
  if (!(spot instanceof HTMLElement)) return fail(`Nothing in the window at ${Math.round(x)}, ${Math.round(y)}.`);
  const el = spot;
  if ((el as HTMLButtonElement).disabled) return fail(`"${nameOf(el)}" is switched off and cannot be pressed.`);
  const called = off ? `the spot ${off.join(", ")} from "${nameOf(named)}" (${el.className || el.tagName.toLowerCase()})` : nameOf(el); // a press can change what it is called, such as Fold to Unfold
  const at = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: a.right ? 2 : 0, ...heldKeys(a.keys) };
  el.dispatchEvent(new PointerEvent("pointerdown", at));
  el.dispatchEvent(new MouseEvent("mousedown", at));
  if (el.matches("input, textarea, select, [contenteditable='true']")) el.focus();
  el.dispatchEvent(new PointerEvent("pointerup", at));
  el.dispatchEvent(new MouseEvent("mouseup", at));
  if (a.right) el.dispatchEvent(new MouseEvent("contextmenu", at));
  else {
    el.dispatchEvent(new MouseEvent("click", at));
    if (a.double) {
      el.dispatchEvent(new MouseEvent("click", { ...at, detail: 2 }));
      el.dispatchEvent(new MouseEvent("dblclick", { ...at, detail: 2 }));
    }
  }
  await settle();
  return { text: `Pressed "${called}".${errors.length ? ` ${errors.length} errors or warnings are waiting in dev_errors.` : ""}` };
}

async function type(a: Args): Promise<ToolResult> {
  const el = find(a);
  if (typeof el === "string") return fail(el);
  if (!el.matches("input, textarea")) return fail(`"${nameOf(el)}" is not a box you can write in.`);
  const box = el as HTMLInputElement | HTMLTextAreaElement;
  box.focus();
  // the interface only hears a change that goes through the box's own setter
  const proto = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(box, String(a.text ?? ""));
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.dispatchEvent(new Event("change", { bubbles: true }));
  if (a.enter) {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    box.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
  }
  await settle();
  return { text: `Wrote in "${nameOf(el)}".` };
}

/** Drags a slider in steps, timing each one: the work it caused, and when the screen next drew. */
async function slide(a: Args): Promise<ToolResult> {
  const el = find(a);
  if (typeof el === "string") return fail(el);
  if (!(el instanceof HTMLInputElement) || el.type !== "range") return fail(`"${nameOf(el)}" is not a slider.`);
  const from = Number(el.value);
  const to = Number(a.to);
  if (!Number.isFinite(to)) return fail("Say where to slide to.");
  const steps = Math.max(2, Math.round((typeof a.ms === "number" && a.ms > 0 ? a.ms : 600) / 16));
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  const work: number[] = [];
  const paint: number[] = [];
  const layout: number[] = [];
  // a ticker that runs whenever the page is free: a long gap means the page itself was busy, not the screen
  let busy = 0;
  let last = performance.now();
  let ticking = true;
  const tick = () => {
    const now = performance.now();
    busy = Math.max(busy, now - last);
    last = now;
    if (ticking) setTimeout(tick, 4);
  };
  tick();
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  for (let i = 1; i <= steps; i++) {
    const sent = performance.now();
    setValue.call(el, String(from + ((to - from) * i) / steps));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    work.push(performance.now() - sent);
    const lay = performance.now();
    void document.body.offsetHeight; // style and layout, which the browser would otherwise do just before drawing
    layout.push(performance.now() - lay);
    // the next frame the screen draws; a hidden window may draw none, so never wait more than a second
    await new Promise<void>((done) => {
      const t = setTimeout(done, 1000);
      requestAnimationFrame(() => {
        clearTimeout(t);
        done();
      });
    });
    paint.push(performance.now() - sent);
    await new Promise((r) => setTimeout(r, Math.max(0, 16 - (performance.now() - sent))));
  }
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  ticking = false;
  await settle();
  const avg = (l: number[]) => Math.round(l.reduce((x, y) => x + y, 0) / l.length);
  const most = (l: number[]) => Math.round(Math.max(...l));
  const slow = paint.filter((p) => p > 50).length;
  return {
    text: `Slid "${nameOf(el)}" from ${from} to ${el.value} in ${steps} moves. Work per move: ${avg(work)} ms on average, ${most(work)} ms at most. Move to screen: ${avg(paint)} ms on average, ${most(paint)} ms at most; ${slow} of ${steps} took over 50 ms (smooth is under 17). Style and layout per move: ${avg(layout)} ms on average, ${most(layout)} ms at most. Longest the page was busy: ${Math.round(busy)} ms.`,
  };
}

async function key(a: Args): Promise<ToolResult> {
  const name = String(a.key ?? "");
  if (!name) return fail("Say which key.");
  // a box that still has the attention would swallow the key
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
  const code = name.length === 1 ? (/[a-z]/i.test(name) ? `Key${name.toUpperCase()}` : /\d/.test(name) ? `Digit${name}` : name) : name;
  const init = { key: name, code, bubbles: true, cancelable: true, ...heldKeys(a.keys) };
  document.body.dispatchEvent(new KeyboardEvent("keydown", init));
  document.body.dispatchEvent(new KeyboardEvent("keyup", init));
  await settle();
  return { text: `Pressed the ${name} key.` };
}

/** Drag across the canvas through points in design coordinates, with the tool that is picked. */
/** Every track on the open timeline and the clips on it, with their times, as words. */
function timelineNow(): string {
  const s = getState();
  const id = s.clock.scene;
  // the whole design, not only what shows at the playhead
  const doc = currentDoc(s);
  const frame = id ? doc.elements[id] : null;
  if (!frame) return "No timeline is open.";
  const t = (n: number) => Math.round(n * 1000) / 1000;
  return trackRows(doc, frame)
    .map((r) => `${r.name}: ${[...r.items].map((el) => ({ el, sp: spanOf(el, frame) })).sort((x, y) => x.sp.start - y.sp.start).map(({ el, sp }) => `${el.name} ${t(sp.start)}-${t(sp.end)}s${el.cutIn ? ` (comes in with ${CUT_MOVE_NAMES[el.cutIn.kind]})` : ""}`).join(", ") || "empty"}`)
    .join("\n");
}

async function dragClip(a: Args): Promise<ToolResult> {
  const bars = Array.from(document.querySelectorAll<HTMLElement>(`.time-span[data-name="span-${CSS.escape(String(a.clip ?? ""))}"]`)).sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left);
  const bar = bars[(typeof a.nth === "number" ? a.nth : 1) - 1];
  if (!bar) return fail(bars.length ? `There are only ${bars.length} clips called "${a.clip}".` : `No clip called "${a.clip}" is on the timeline. Open the video in Edit first.`);
  const by = Number(a.by);
  if (!Number.isFinite(by)) return fail("Say how many seconds to drag it, as by.");
  const doc = currentDoc();
  const el = doc.elements[bar.dataset.clipId ?? ""];
  const frame = el?.parentId ? doc.elements[el.parentId] : null;
  if (!el || !frame) return fail("That clip is not in a video.");
  const sp = spanOf(el, frame);
  // a clip off to the side is scrolled into sight first, the way a hand would
  bar.scrollIntoView({ block: "nearest", inline: "center" });
  await settle();
  const r = bar.getBoundingClientRect();
  const pps = r.width / Math.max(0.001, sp.end - sp.start);
  const part = a.part === "start" || a.part === "end" ? a.part : "middle";
  const x0 = part === "start" ? r.left + 2 : part === "end" ? r.right - 2 : r.left + r.width / 2;
  // held near its top: the volume line runs through its middle and would take the drag
  const y0 = r.top + Math.min(10, r.height / 4);
  let y1 = y0;
  if (a.track) {
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-row]")).find((row) => row.querySelector(".time-name")?.textContent?.trim().startsWith(String(a.track)));
    if (!row) return fail(`No track called "${a.track}".`);
    const rr = row.getBoundingClientRect();
    y1 = rr.top + rr.height / 2;
  }
  const spot = document.elementFromPoint(x0, y0);
  if (!(spot instanceof HTMLElement)) return fail("The clip is not in sight. Scroll the timeline to it first.");
  if (!bar.contains(spot)) return fail(`Something covers the clip: "${spot.className || spot.tagName.toLowerCase()}". Open Studio, or close what is on top.`);
  const base = { bubbles: true, cancelable: true, pointerId: 42, isPrimary: true, pointerType: "mouse", button: 0, ...heldKeys(a.keys) };
  // noSnap turns the magnet off for this drag, as a hand would, and back on after
  const snapWas = getLayout().snapping;
  if (a.noSnap) setLayout({ snapping: false });
  spot.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1, clientX: x0, clientY: y0 }));
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x = x0 + (by * pps * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    // sent to whatever is under that spot, as a hand's would be, and it rises to the window from there
    (document.elementFromPoint(x, y) ?? document.body).dispatchEvent(new PointerEvent("pointermove", { ...base, buttons: 1, clientX: x, clientY: y }));
    await new Promise((done) => setTimeout(done, 16));
  }
  await settle();
  const said = document.querySelector(".time-drag-hint")?.textContent?.trim();
  (document.elementFromPoint(x0 + by * pps, y1) ?? document.body).dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0, clientX: x0 + by * pps, clientY: y1 }));
  if (a.noSnap) setLayout({ snapping: snapWas });
  await settle();
  return { text: `Dragged "${a.clip}" by its ${part} ${by} s${a.track ? ` onto ${a.track}` : ""}. During the drag the timeline said: ${said ? `"${said}"` : "nothing"}.\nNow:\n${timelineNow()}` };
}

async function dropTransition(a: Args): Promise<ToolResult> {
  const kind = (Object.keys(CUT_MOVE_NAMES) as (keyof typeof CUT_MOVE_NAMES)[]).find((k) => CUT_MOVE_NAMES[k].toLowerCase() === String(a.transition ?? "").trim().toLowerCase());
  if (!kind) return fail(`No transition is called "${a.transition}". There are: ${Object.values(CUT_MOVE_NAMES).join(", ")}.`);
  const tile = document.querySelector<HTMLElement>(`.asset-tile[data-name="asset-transition-${kind}"]`);
  if (!tile) return fail("The transition tile is not in sight. Open the Assets tab and its Transitions shelf first.");
  const clip = CSS.escape(String(a.clip ?? ""));
  const cut = () => document.querySelector<HTMLElement>(`[data-name="cut-plus-${clip}"], [data-name="cut-badge-${clip}"]`);
  if (!cut()) return fail(`No cut comes before a clip called "${a.clip}". Open the video in Edit first.`);
  const data = new DataTransfer();
  const init = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { bubbles: true, cancelable: true, dataTransfer: data, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  };
  tile.dispatchEvent(new DragEvent("dragstart", init(tile)));
  await settle();
  // every "+" is seen when the drag starts, before the hand reaches one
  const pluses = Array.from(document.querySelectorAll<HTMLElement>(".cut-plus"));
  const shown = pluses.filter((p) => getComputedStyle(p).opacity === "1").length;
  const target = cut()!;
  const r = target.getBoundingClientRect();
  const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!under || !target.contains(under)) {
    tile.dispatchEvent(new DragEvent("dragend", init(tile)));
    return fail(`The cut before "${a.clip}" is not in sight, or something covers it. Scroll the timeline to it first.`);
  }
  target.dispatchEvent(new DragEvent("dragenter", init(target)));
  target.dispatchEvent(new DragEvent("dragover", init(target)));
  await settle();
  const lit = cut()!.classList.contains("drop");
  const hold = Math.min(10, Math.max(0, Number(a.hold) || 0));
  if (hold) await new Promise((done) => setTimeout(done, hold * 1000));
  cut()!.dispatchEvent(new DragEvent("drop", init(cut()!)));
  tile.dispatchEvent(new DragEvent("dragend", init(tile)));
  await settle();
  return { text: `Dropped ${CUT_MOVE_NAMES[kind]} on the cut before "${a.clip}". During the drag ${shown} of ${pluses.length} cuts without a transition showed their +, and the cut ${lit ? "lit up" : "did NOT light up"} under the tile.\nNow:\n${timelineNow()}` };
}

async function dragExport(a: Args): Promise<ToolResult> {
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>(".export-page [data-waiting]"));
  const named = (n: unknown) => rows().find((r) => r.querySelector("b")?.textContent?.trim().startsWith(String(n ?? "")));
  const row = named(a.video);
  const grip = row?.querySelector<HTMLElement>(".export-grip");
  if (!row || !grip) return fail(`No waiting video called "${a.video}" on the Export page. Open it first.`);
  const target = a.before ? named(a.before) : null;
  if (a.before && !target) return fail(`No waiting video called "${a.before}" to let go before.`);
  const g = grip.getBoundingClientRect();
  const x = g.left + g.width / 2;
  const last = rows()[rows().length - 1].getBoundingClientRect();
  const y = target ? target.getBoundingClientRect().top + 4 : last.bottom + 10;
  const at = (cy: number) => ({ bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: cy });
  grip.dispatchEvent(new PointerEvent("pointerdown", at(g.top + g.height / 2)));
  await settle();
  for (let i = 1; i <= 6; i++) window.dispatchEvent(new PointerEvent("pointermove", at(g.top + ((y - g.top) * i) / 6)));
  await settle();
  window.dispatchEvent(new PointerEvent("pointerup", at(y)));
  await settle();
  const order = Array.from(document.querySelectorAll<HTMLElement>(".export-page .export-rows")[0]?.querySelectorAll(".export-row b") ?? []).map((b) => b.textContent?.trim());
  return { text: `Dragged "${a.video}" ${target ? `before "${a.before}"` : "to the end"}.\nThe line now: ${order.join(" | ")}` };
}

async function dropFootage(a: Args): Promise<ToolResult> {
  // a row in Media, by the name it shows (its length shows beside it)
  const source = Array.from(document.querySelectorAll<HTMLElement>(".clip-row[draggable='true']")).find((r) => r.textContent?.trim().startsWith(String(a.item ?? "")));
  if (!source) return fail(`Nothing in Media is called "${a.item}".`);
  const row = Array.from(document.querySelectorAll<HTMLElement>("[data-row]")).find((r) => r.querySelector(".time-name")?.textContent?.trim().startsWith(String(a.track ?? "")));
  const lane = row?.querySelector<HTMLElement>(".time-lane");
  if (!row || !lane) return fail(`No track called "${a.track}" on the timeline. Open the video in Edit first.`);
  const s = getState();
  const frame = s.clock.scene ? currentDoc(s).elements[s.clock.scene] : null;
  if (!frame?.duration) return fail("No video is open on the timeline.");
  const at = Math.max(0, Number(a.at) || 0);
  // that second is scrolled into sight first, the way a hand would
  const lanes = row.closest<HTMLElement>(".time-lanes");
  if (lanes) {
    const lw = lane.getBoundingClientRect().width;
    lanes.scrollLeft = Math.max(0, (at * lw) / frame.duration - lanes.clientWidth / 2);
    await settle();
  }
  const lr = lane.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const x = lr.left + (at * lr.width) / frame.duration;
  const y = a.top ? rr.top + 3 : rr.top + rr.height * 0.6;
  const spot = document.elementFromPoint(x, y);
  if (!(spot instanceof HTMLElement) || !row.contains(spot)) return fail(`Second ${at} of "${a.track}" is not in sight. Scroll the timeline to it first.`);
  const data = new DataTransfer();
  const init = { bubbles: true, cancelable: true, dataTransfer: data, clientX: x, clientY: y, ...heldKeys(a.keys) };
  source.dispatchEvent(new DragEvent("dragstart", { ...init, clientX: 0, clientY: 0 }));
  if (!data.types.length) return fail(`"${a.item}" cannot be dragged to the timeline.`);
  spot.dispatchEvent(new DragEvent("dragenter", init));
  spot.dispatchEvent(new DragEvent("dragover", init));
  await settle();
  const said = row.querySelector(".time-ghost span")?.textContent?.trim();
  spot.dispatchEvent(new DragEvent("drop", init));
  source.dispatchEvent(new DragEvent("dragend", init));
  // the footage is read from the disk before it lands
  await new Promise((done) => setTimeout(done, 800));
  await settle();
  return { text: `Dropped "${a.item}" on ${a.track}${a.top ? " (top edge)" : ""} at ${at} s. While over it the ghost said: ${said ? `"${said}"` : "nothing"}.\nNow:\n${timelineNow()}` };
}

async function drag(a: Args): Promise<ToolResult> {
  const pts = Array.isArray(a.points) ? (a.points as unknown[]).filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [];
  if (pts.length < 2) return fail("Give two points or more, as [[x, y], ...].");
  const canvas = document.querySelector("canvas[data-canvas='design']") as HTMLCanvasElement | null;
  if (!canvas) return fail("The canvas is not on screen.");
  const r = canvas.getBoundingClientRect();
  const vp = getState().viewport;
  const pen = a.pen === true;
  const base = { bubbles: true, cancelable: true, pointerId: 41, isPrimary: true, pointerType: pen ? "pen" : "mouse", ...heldKeys(a.keys) };
  const at = ([x, y]: [number, number], buttons: number) => ({
    ...base,
    clientX: r.left + x * vp.zoom + vp.x,
    clientY: r.top + y * vp.zoom + vp.y,
    button: 0,
    buttons,
    pressure: buttons ? (pen ? Math.max(0, Math.min(1, typeof a.pressure === "number" ? a.pressure : 0.5)) : 0.5) : 0,
  });
  // a hidden window gets no animation frames, so a short wait stands in for one
  const frame = () => new Promise((done) => { requestAnimationFrame(() => done(null)); setTimeout(() => done(null), 50); });
  canvas.dispatchEvent(new PointerEvent("pointerdown", at(pts[0], 1)));
  await frame();
  for (let i = 1; i < pts.length; i++) {
    // a few steps between each pair, as a real hand sends them
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    for (let k = 1; k <= 4; k++) canvas.dispatchEvent(new PointerEvent("pointermove", at([x0 + ((x1 - x0) * k) / 4, y0 + ((y1 - y0) * k) / 4], 1)));
    await frame();
  }
  canvas.dispatchEvent(new PointerEvent("pointerup", at(pts[pts.length - 1], 0)));
  await settle();
  // painting is kept a moment after the button comes up
  await new Promise((done) => setTimeout(done, 400));
  return { text: `Dragged through ${pts.length} points.${errors.length ? ` ${errors.length} errors or warnings are waiting in dev_errors.` : ""}` };
}

/** A frame that holds a shape and a group, and a plain shape beside it. Enough to check most panels. */
export function sampleDoc() {
  let doc = emptyDoc();
  doc = runCommand(doc, "create_element", { id: "test-frame", type: "frame", x: 0, y: 0, width: 400, height: 300 });
  doc = runCommand(doc, "create_element", { id: "test-inner", type: "rect", parentId: "test-frame", x: 20, y: 20, width: 80, height: 60 });
  doc = runCommand(doc, "create_element", { id: "test-grouped", type: "ellipse", parentId: "test-frame", x: 140, y: 20, width: 60, height: 60 });
  doc = runCommand(doc, "group_elements", { ids: ["test-grouped"], groupId: "test-group" });
  doc = runCommand(doc, "create_element", { id: "test-plain", type: "rect", x: 480, y: 0, width: 120, height: 120 });
  return doc;
}

/** Run one builder tool. */
export async function callBuilderTool(name: string, raw: unknown, by?: string): Promise<ToolResult> {
  agentIsDriving();
  const a = (raw && typeof raw === "object" ? raw : {}) as Args;
  if (name === "dev_guide") return { text: GUIDE };
  if (name === "dev_test_design") {
    // the design on screen may be someone's real work in progress: never take it away from an AI that is using it
    const busy = inTestDesign() ? null : busyOutside();
    // the one asking is not in its own way
    if (busy && busy !== by) return fail(`${busy} changed this project less than two minutes ago and may still be working on it. A test design would take the project away from it. Wait, or check in another copy of Duet.`);
    const why = await startTestDesign(a.sample ? sampleDoc() : emptyDoc());
    if (why) return fail(why);
    // the one asking works in the test design from now on, not in the project it put away
    if (by) bindAi(by, getState().project.file);
    await settle();
    return { text: `A clean test design is open. Nothing in it is saved.${a.sample ? " It holds a frame (test-frame) with a shape (test-inner) and a group (test-group, holding test-grouped), and a plain shape (test-plain)." : ""} Finish with dev_leave_test_design.` };
  }
  if (name === "dev_keep_test_design") {
    const why = await keepTestDesign(String(a.path ?? ""));
    if (!why && by) bindAi(by, getState().project.file);
    return why ? fail(why) : { text: `Saved as ${String(a.path)}. Changes from here on are saved into it.` };
  }
  if (name === "dev_leave_test_design") {
    const why = await leaveTestDesign();
    if (!why && by) bindAi(by, getState().project.file);
    return why ? fail(why) : { text: "The test design is gone and the project is back." };
  }
  if (name === "dev_open_project") {
    const path = String(a.path ?? "").replace(/^~(?=\/)/, await homeDir());
    if (!path.endsWith(".duet")) return fail("Give the full path of a .duet file.");
    if (inTestDesign()) {
      const why = await leaveTestDesign();
      if (why) return fail(why);
    }
    if (!(await openProjectAt(path))) return fail(`${path} could not be opened. Is the path right?`);
    if (by) bindAi(by, getState().project.file);
    await settle();
    return { text: `"${getState().project.name}" is open, and you work in it from now on. Every change is saved into it.` };
  }
  if (name === "dev_read_interface") return { text: `${inTestDesign() ? "" : "This is a real project, not a test design.\n"}${readInterface(a.filter, a.max)}` };
  if (name === "dev_press") return press(a);
  if (name === "dev_look_at_window") {
    // Duet dev shows a DEV tag and "in Duet dev" so it is never mistaken for the real Duet. The picture leaves them out, so it looks like the real one; keepDevTag brings them back.
    const keep = a.keepDevTag === true;
    if (!keep) document.body.classList.add("picturing-dev");
    try {
      // a hidden window gets no animation frames, so never wait on them alone
      await new Promise((done) => {
        requestAnimationFrame(() => requestAnimationFrame(done));
        setTimeout(done, 150);
      });
      const most = typeof a.maxSize === "number" && a.maxSize > 0 ? a.maxSize : 1600;
      // the web view's own snapshot: a video on the canvas does not block it, as drawing the page from inside did (#339)
      const png = await invoke<ArrayBuffer>("window_picture_bytes");
      return { text: "The Duet window as it is now.", image: { data: await shrinkPng(png, most), mime: "image/png" } };
    } catch (e) {
      return fail(`The window could not be drawn: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      document.body.classList.remove("picturing-dev");
    }
  }
  if (name === "dev_type") return type(a);
  if (name === "dev_key") return key(a);
  if (name === "dev_slide") return slide(a);
  if (name === "dev_drag") return drag(a);
  if (name === "dev_drag_clip") return dragClip(a);
  if (name === "dev_drop_footage") return dropFootage(a);
  if (name === "dev_drop_transition") return dropTransition(a);
  if (name === "dev_drag_export") return dragExport(a);
  if (name === "dev_history") {
    const s = getState();
    const from = Math.max(0, s.timeline.length - (typeof a.last === "number" && a.last > 0 ? Math.floor(a.last) : 12));
    return { text: s.timeline.slice(from).map((e, i) => `${from + i + 1} ${e.actor === "ai" ? (e.by ?? "an AI") : "you"}: ${e.label}${from + i === s.cursor ? "  <- now" : ""}`).join("\n") };
  }
  if (name === "dev_video" && a.do === "frame") {
    try {
      const began = Date.now();
      const file = await exportScene(String(a.id), () => {}, { ...defaultChoice(), to: String(a.path) });
      return { text: `Made ${file} in ${Math.round((Date.now() - began) / 100) / 10} seconds.` };
    } catch (e) {
      return fail(String(e instanceof Error ? e.message : e));
    }
  }
  if (name === "dev_video" && a.do === "clock") {
    seek(Number(a.t) || 0);
    await settle();
    const s = getState();
    const scene = s.clock.scene;
    if (!scene) return fail("No frame that plays is open. Select one first.");
    const seen = seenDoc(s);
    const lines = seen.elements[scene].childIds.map((c) => {
      const el = seen.elements[c];
      return `${el.name}: at ${Math.round(el.x)},${Math.round(el.y)} size ${Math.round(el.width)}x${Math.round(el.height)} opacity ${Math.round(el.opacity * 100) / 100}${el.type === "video" ? ` clip ${clipPictureOf(el) ? `ready at ${Math.round((clipPictureOf(el)?.currentTime ?? 0) * 100) / 100}s` : "not ready"}` : ""}${el.type === "sound" ? ` sound ${clipState(el.src, el.id)}` : ""}`;
    });
    return { text: `At ${s.clock.t}s the canvas shows:\n${lines.join("\n") || "nothing"}` };
  }
  if (name === "dev_video") {
    try {
      if (a.do === "clear") setCut(emptyCut());
      else if (a.do === "add") setCut(addClip(getCut(), String(a.path), await invoke<Info>("video_info", { path: String(a.path) }), `clip-${Date.now().toString(36)}`));
      else if (a.do === "export") {
        const size = sizeOf(getCut());
        if (!size) return fail("Add a clip first.");
        await invoke("video_export", { clips: getCut().clips.map((c) => ({ path: c.path, start: c.start, end: c.end })), width: size[0], height: size[1], out: String(a.path) });
      } else return fail("do must be add, export or clear.");
    } catch (e) {
      return fail(String(e));
    }
    await settle();
    return { text: `Done. ${getCut().clips.length} clips in the list.` };
  }
  if (name === "dev_reload") {
    // answer first: the answer cannot be sent from an interface that is already gone
    setTimeout(() => window.location.reload(), 150);
    return { text: "Loading the interface again. Wait two seconds before the next call." };
  }
  if (name === "dev_errors") {
    const text = errors.length ? errors.join("\n") : "Nothing has gone wrong.";
    if (!a.keep) errors.length = 0;
    return { text };
  }
  return fail(`Unknown tool ${name}.`);
}

import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { getChat, messagesOf, subscribeChat } from "./chat";
import { sendToAgent } from "./agent";

/**
 * A recipe is the way a piece of work is made, step by step, like the storyboards and frozen
 * templates juniors follow in an agency. Duet hands the AI one step at a time and moves on itself,
 * so the AI never skips the wireframe or rushes ahead, and the designer is asked only at the right moments.
 */

/** What a step is: the AI does something, the designer answers, or the designer leaves comments on the design. */
export type StepKind = "ai" | "ask" | "review";

export interface Step {
  id: string;
  title: string;
  kind: StepKind;
  /** For the AI, what to do. For the designer, the question or what to look at. */
  does: string;
  /** Where the box sits on the Kitchen board. */
  x: number;
  y: number;
}

export interface Recipe {
  id: string;
  name: string;
  about: string;
  /** In the order they are cooked. Each step leads to the next. */
  steps: Step[];
  /** Shipped with Duet. Changing one keeps your own copy under the same name. */
  builtIn?: boolean;
}

export const KIND_NAMES: Record<StepKind, string> = { ai: "AI does", ask: "You answer", review: "You comment" };

const GAP = 260;
const ROW = 150;
const PER_ROW = 3;
/** Steps laid out in rows that turn back at each end, so a long recipe still reads at a glance. */
const place = (steps: Omit<Step, "x" | "y">[]): Step[] =>
  steps.map((s, i) => {
    const row = Math.floor(i / PER_ROW);
    const col = row % 2 ? PER_ROW - 1 - (i % PER_ROW) : i % PER_ROW;
    return { ...s, x: 60 + col * GAP, y: 80 + row * ROW };
  });

/** Recipe one: the steps that made the Mercury landing page good. */
export const LANDING_PAGE: Recipe = {
  id: "landing-page",
  name: "Landing page from a brief",
  about: "Brief, questions, wireframe, your comments, design, icons, a check, your comments again, polish.",
  builtIn: true,
  steps: place([
    { id: "brief", title: "Brief", kind: "ask", does: "What is the page for, who is it for, and what should a visitor do?" },
    {
      id: "questions",
      title: "Questions",
      kind: "ai",
      does: "Read the brief. Ask the designer the 3 questions whose answers change the design most: the main message, the look, and what must be on the page. Short, plain questions, numbered. Do not change the design in this step.",
    },
    { id: "answers", title: "Your answers", kind: "ask", does: "Answer the AI's questions." },
    {
      id: "wireframe",
      title: "Wireframe",
      kind: "ai",
      does: "Make a wireframe of the whole page in one desktop frame 1440 wide: grey boxes and real words only, no colour, no pictures, no icons. Sections from top to bottom with real headings and real button words. Use auto layout and one spacing scale. Every card has its words in it.",
    },
    { id: "wireframe-comments", title: "Your comments", kind: "review", does: "Pin comments on the wireframe where you want changes. Continue when you are done." },
    {
      id: "design",
      title: "Design",
      kind: "ai",
      does: "Make the real design from the wireframe, in a new frame beside it, keeping its sections and words. Use the brand kit if there is one: its colours, fonts and logo only. One type scale, one spacing scale, one corner radius. Use real pictures where the wireframe had picture boxes.",
    },
    {
      id: "icons",
      title: "Icons",
      kind: "ai",
      does: "Put icons where the design needs them. Use icons from a library, never ones drawn by hand. Same size and stroke everywhere, each centred with its label.",
    },
    {
      id: "check",
      title: "Check",
      kind: "ai",
      does: "Look at the design and fix the basic slips: gaps under text, labels off their icons, corners that do not match, mixed buttons, uneven edges, empty cards, text that runs out of its box. Say what you fixed.",
    },
    { id: "design-comments", title: "Your comments", kind: "review", does: "Pin comments on the design where you want changes. Continue when you are done." },
    {
      id: "polish",
      title: "Polish",
      kind: "ai",
      does: "Do what each open comment asks, then resolve it. Then a last pass: spacing, alignment and contrast. Change nothing else.",
    },
  ]),
};

export const BUILT_IN: Recipe[] = [LANDING_PAGE];

// ---- changing a recipe (pure: recipe in, recipe out) ----

const newId = () => Math.random().toString(36).slice(2, 9);

/** A new step after the one given, or at the end. It sits between its neighbours on the board. */
export function addStep(r: Recipe, after: string | null, kind: StepKind = "ai"): { recipe: Recipe; id: string } {
  const at = after === null ? r.steps.length : r.steps.findIndex((s) => s.id === after) + 1;
  const prev = r.steps[at - 1];
  const next = r.steps[at];
  const x = prev && next ? (prev.x + next.x) / 2 : prev ? prev.x + GAP : 60;
  const y = prev && next ? Math.max(prev.y, next.y) + 140 : prev ? prev.y : 120;
  const step: Step = { id: newId(), title: kind === "ai" ? "New step" : kind === "ask" ? "Question" : "Your comments", kind, does: "", x, y };
  return { recipe: { ...r, steps: [...r.steps.slice(0, at), step, ...r.steps.slice(at)] }, id: step.id };
}

export function changeStep(r: Recipe, id: string, patch: Partial<Omit<Step, "id">>): Recipe {
  return { ...r, steps: r.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function removeStep(r: Recipe, id: string): Recipe {
  return { ...r, steps: r.steps.filter((s) => s.id !== id) };
}

/** Move a step earlier (-1) or later (+1) in the order it is cooked. */
export function moveStep(r: Recipe, id: string, by: -1 | 1): Recipe {
  const i = r.steps.findIndex((s) => s.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= r.steps.length) return r;
  const steps = [...r.steps];
  [steps[i], steps[j]] = [steps[j], steps[i]];
  return { ...r, steps };
}

export function blankRecipe(name = "New recipe"): Recipe {
  return { id: newId(), name, about: "", steps: place([{ id: newId(), title: "Brief", kind: "ask", does: "What is this for?" }]) };
}

/** A recipe read from a file someone shared, or null if it is not one. */
export function readRecipe(text: string): Recipe | null {
  try {
    const r = JSON.parse(text);
    if (!r || typeof r.name !== "string" || !Array.isArray(r.steps)) return null;
    const steps: Step[] = r.steps
      .filter((s: unknown): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s: Record<string, unknown>, i: number) => ({
        id: typeof s.id === "string" ? s.id : newId(),
        title: typeof s.title === "string" ? s.title : `Step ${i + 1}`,
        kind: s.kind === "ask" || s.kind === "review" ? s.kind : "ai",
        does: typeof s.does === "string" ? s.does : "",
        x: typeof s.x === "number" ? s.x : 60 + (i % PER_ROW) * GAP,
        y: typeof s.y === "number" ? s.y : 80 + Math.floor(i / PER_ROW) * ROW,
      }));
    return { id: typeof r.id === "string" ? r.id : newId(), name: r.name, about: typeof r.about === "string" ? r.about : "", steps };
  } catch {
    return null;
  }
}

// ---- what the AI is told for one step ----

export interface Said {
  step: string;
  text: string;
}

/** The message for one AI step: only this step, with what the designer has said so far. */
export function stepPrompt(r: Recipe, at: number, said: Said[]): string {
  const step = r.steps[at];
  const ai = r.steps.filter((s) => s.kind === "ai");
  const n = ai.indexOf(step) + 1;
  const lines = [`Recipe "${r.name}", step ${n} of ${ai.length}: ${step.title}.`, step.does.trim()];
  const heard = said.filter((s) => s.text.trim());
  if (heard.length) lines.push("", "What the designer has said so far:", ...heard.map((s) => `- ${r.steps.find((x) => x.id === s.step)?.title ?? "Answer"}: ${s.text.trim()}`));
  // a comment step just before this one means the designer has left notes on the design
  if (r.steps[at - 1]?.kind === "review") lines.push("", "The designer has left comments on the design. Read the open comments with get_context, do what each asks, and resolve each one when it is done.");
  lines.push("", "Do only this step. Then stop and say in one or two lines what you did.");
  return lines.join("\n");
}

// ---- kept recipes: ~/.duet/recipes.json ----

let mine: Recipe[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

async function recipesFile(): Promise<string> {
  const home = await invoke<string>("duet_home");
  return `${home.replace(/[\\/]$/, "")}/recipes.json`;
}

export async function loadRecipes() {
  try {
    const all = JSON.parse(await invoke<string>("read_text_file", { path: await recipesFile() }));
    mine = Array.isArray(all) ? all.map((r) => readRecipe(JSON.stringify(r))).filter((r): r is Recipe => !!r) : [];
  } catch {
    mine = [];
  }
  changed();
}

async function keepAll() {
  try {
    await invoke("write_text_file", { path: await recipesFile(), contents: JSON.stringify(mine, null, 2) });
  } catch (e) {
    console.warn("Could not keep the recipes:", e);
  }
}

/** Your recipes, with a shipped one replaced by your copy of it. */
export function allRecipes(): Recipe[] {
  const own = new Map(mine.map((r) => [r.id, r]));
  return [...BUILT_IN.map((b) => (own.has(b.id) ? { ...own.get(b.id)!, builtIn: true } : b)), ...mine.filter((r) => !BUILT_IN.some((b) => b.id === r.id))];
}

export function useRecipes(): Recipe[] {
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => mine,
  );
  return allRecipes();
}

export function keepRecipe(r: Recipe) {
  const { builtIn: _, ...plain } = r;
  mine = mine.some((x) => x.id === r.id) ? mine.map((x) => (x.id === r.id ? plain : x)) : [...mine, plain];
  changed();
  void keepAll();
}

/** Throw a recipe away. A shipped one goes back to how it came. */
export function dropRecipe(id: string) {
  mine = mine.filter((r) => r.id !== id);
  changed();
  void keepAll();
}

// ---- cooking: one run at a time ----

export interface Cooking {
  recipe: Recipe;
  at: number;
  /** working: the AI is on this step. waiting: the designer's turn. done: every step is cooked. */
  status: "working" | "waiting" | "done" | "stopped";
  said: Said[];
  /** What the AI said at the end of each of its steps. */
  replies: Record<string, string>;
  /** Steps already cooked. */
  done: string[];
  error?: string;
}

let cooking: Cooking | null = null;
const cookListeners = new Set<() => void>();
const setCooking = (c: Cooking | null) => {
  cooking = c;
  cookListeners.forEach((l) => l());
};
export const getCooking = () => cooking;
export function useCooking(): Cooking | null {
  return useSyncExternalStore(
    (l) => (cookListeners.add(l), () => cookListeners.delete(l)),
    () => cooking,
  );
}

/** Start cooking a recipe on the open design, from its first step. */
export function startCooking(r: Recipe) {
  setCooking({ recipe: r, at: 0, status: "waiting", said: [], replies: {}, done: [] });
  void go();
}

export function stopCooking() {
  if (cooking) setCooking({ ...cooking, status: "stopped" });
}

/** The designer has answered, or finished their comments: on to the next step. */
export function answer(text: string) {
  const c = cooking;
  if (!c || c.status !== "waiting") return;
  const step = c.recipe.steps[c.at];
  setCooking({ ...c, said: step.kind === "ask" ? [...c.said, { step: step.id, text }] : c.said, done: [...c.done, step.id], at: c.at + 1, status: "working" });
  void go();
}

/** Do the step at hand again, after it went wrong or the designer wants another try. */
export function again() {
  if (!cooking) return;
  setCooking({ ...cooking, status: "working", error: undefined });
  void go();
}

/** Wait until the AI in the chat has finished. */
function finished(): Promise<void> {
  return new Promise((done) => {
    const look = () => {
      if (getChat().running) return;
      stop();
      done();
    };
    const stop = subscribeChat(look);
    look();
  });
}

async function go() {
  const c = cooking;
  if (!c || c.status === "stopped") return;
  if (c.at >= c.recipe.steps.length) return setCooking({ ...c, status: "done" });
  const step = c.recipe.steps[c.at];
  if (step.kind !== "ai") return setCooking({ ...c, status: "waiting" });
  if (getChat().running) return setCooking({ ...c, status: "waiting", error: "The AI is busy with something else. Try this step again once it is done." });
  setCooking({ ...c, status: "working", error: undefined });
  const before = messagesOf().reduce((n, m) => Math.max(n, m.id), 0);
  await sendToAgent(stepPrompt(c.recipe, c.at, c.said));
  await finished();
  const now = cooking;
  // stopped, or another recipe started, while the AI worked
  if (!now || now !== cooking || now.recipe.id !== c.recipe.id || now.at !== c.at || now.status === "stopped") return;
  const after = messagesOf().filter((m) => m.id > before);
  const reply = after.filter((m) => m.role === "duet").map((m) => m.text).join("\n").trim();
  const failed = after.find((m) => m.role === "error");
  if (!reply && failed) return setCooking({ ...now, status: "waiting", error: failed.text || "The AI could not do this step." });
  setCooking({ ...now, replies: { ...now.replies, [step.id]: reply }, done: [...now.done, step.id], at: now.at + 1 });
  void go();
}

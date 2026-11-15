import { invoke } from "@tauri-apps/api/core";

/**
 * The AI trail, in Duet dev only: every step an AI takes in Duet (which tool, what it asked, what it got back,
 * how long it took) is kept here and saved in ~/.duet-dev/traces, one folder per run of Duet dev, one file per
 * step. It shows how AIs really work with Duet, so their struggles can be seen and different AIs compared.
 * Nothing is sent anywhere.
 */

export interface TraceStep {
  /** Its place in this run, from 1. */
  n: number;
  /** When it started, as a time stamp. */
  at: number;
  /** How long Duet took to answer, in milliseconds. */
  ms: number;
  /** The AI that asked. */
  who: string;
  tool: string;
  args: unknown;
  /** What the AI got back, word for word. */
  text: string;
  /** The picture it got back, if any. */
  image?: { data: string; mime: string };
  error: boolean;
}

/** How many steps stay on screen; the files keep them all. */
const KEPT = 400;
const steps: TraceStep[] = [];
const listeners = new Set<() => void>();
let on = false;
let folder: Promise<string | null> | null = null;
const run = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/** Turned on by Duet dev when it starts. */
export function startTrace() {
  on = true;
}

export const traceOn = () => on;

/** The folder this run's steps are saved in. */
export function traceFolder(): Promise<string | null> {
  folder ??= invoke<string>("duet_home")
    .then((home) => `${home}/traces/${run}`)
    .catch(() => null);
  return folder;
}

export function recordStep(step: Omit<TraceStep, "n">) {
  if (!on) return;
  const full: TraceStep = { ...step, n: (steps[steps.length - 1]?.n ?? 0) + 1 };
  steps.push(full);
  if (steps.length > KEPT) steps.shift();
  for (const l of listeners) l();
  void save(full);
}

async function save(s: TraceStep) {
  const dir = await traceFolder();
  if (!dir) return;
  const name = `${String(s.n).padStart(4, "0")}-${s.tool}`;
  const { image, ...rest } = s;
  const picture = image ? `${name}.${image.mime.split("/")[1] ?? "png"}` : undefined;
  try {
    await invoke("write_text_file", { path: `${dir}/${name}.json`, contents: JSON.stringify({ ...rest, ...(picture ? { picture } : {}) }, null, 2) });
    if (image && picture) await invoke("write_binary_file", { path: `${dir}/${picture}`, dataBase64: image.data });
  } catch {
    // the trail is a help for building Duet; a step that cannot be saved still shows on screen
  }
}

export const traceSteps = (): readonly TraceStep[] => steps;

export function subscribeTrace(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function clearTrace() {
  steps.length = 0;
  for (const l of listeners) l();
}

/** Per tool: how often it was used, how many failed, and the time it took on average. Most used first. */
export function tally(list: readonly TraceStep[]) {
  const by = new Map<string, { tool: string; count: number; errors: number; ms: number; chars: number }>();
  for (const s of list) {
    const t = by.get(s.tool) ?? { tool: s.tool, count: 0, errors: 0, ms: 0, chars: 0 };
    t.count++;
    if (s.error) t.errors++;
    t.ms += s.ms;
    t.chars += s.text.length;
    by.set(s.tool, t);
  }
  return [...by.values()].map((t) => ({ ...t, ms: Math.round(t.ms / t.count), chars: Math.round(t.chars / t.count) })).sort((a, b) => b.count - a.count);
}

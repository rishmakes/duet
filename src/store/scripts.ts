import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { scriptStep } from "../ai/tools";
import { currentDoc, getState, liveRoom } from "../state/store";
import type { Doc } from "../document/types";

/**
 * A script: a small piece of JavaScript of the designer's own, kept in `~/.duet/scripts/<id>/`.
 * It runs on its own with no window and no internet. Its only door is `duet.call(tool, args)`,
 * the same tools the AI uses, so its changes are real design changes. They land in history as
 * one step under the script's name, so one Undo takes the whole run back.
 */
export type RunsOn = "selection" | "each-frame" | "file" | "list";

export interface ScriptMeta {
  name: string;
  /** One line on what it does. */
  line: string;
  runsOn: RunsOn;
}

export interface Script extends ScriptMeta {
  /** `script-<folder>`, unique among things in the Store. */
  id: string;
  code: string;
}

const RUNS_ON: RunsOn[] = ["selection", "each-frame", "file", "list"];

export const RUNS_ON_WORDS: Record<RunsOn, string> = {
  selection: "What you have picked",
  "each-frame": "Each frame",
  file: "The whole file",
  list: "A list you give it",
};

export function readMeta(text: string, fallback: string): ScriptMeta {
  let m: Partial<ScriptMeta> = {};
  try {
    m = JSON.parse(text) as Partial<ScriptMeta>;
  } catch {
    /* a broken script.json still shows, by its folder name */
  }
  return {
    name: typeof m.name === "string" && m.name.trim() ? m.name.trim() : fallback,
    line: typeof m.line === "string" ? m.line.trim() : "",
    runsOn: RUNS_ON.includes(m.runsOn as RunsOn) ? (m.runsOn as RunsOn) : "selection",
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

let scripts: Script[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadScripts() {
  try {
    const list = await invoke<{ id: string; meta: string; code: string }[]>("list_user_scripts");
    scripts = list.map(({ id, meta, code }) => ({ id: `script-${id}`, code, ...readMeta(meta, id) }));
  } catch {
    scripts = [];
  }
  emit();
}

export const getScripts = () => scripts;
export function useScripts(): Script[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => scripts,
  );
}

/** Save a script, new or changed. A changed one keeps its folder even when renamed. Returns a message if it could not be saved. */
export async function saveScript(meta: ScriptMeta, code: string, id?: string): Promise<{ id: string } | { error: string }> {
  const folder = id ? id.replace(/^script-/, "") : slug(meta.name);
  if (!meta.name.trim() || !folder) return { error: "Give the script a name." };
  if (!code.trim()) return { error: "The script has no code yet." };
  if (!id && scripts.some((s) => s.id === `script-${folder}`)) return { error: "You already have a script with that name." };
  const body = JSON.stringify({ name: meta.name.trim(), line: meta.line.trim(), runsOn: meta.runsOn }, null, 2);
  try {
    await invoke("write_user_script", { id: folder, meta: body, code });
  } catch (e) {
    return { error: String(e) };
  }
  await loadScripts();
  return { id: `script-${folder}` };
}

export async function deleteScript(id: string) {
  try {
    await invoke("delete_user_script", { id: id.replace(/^script-/, "") });
  } catch {
    /* ignore */
  }
  await loadScripts();
}

// ---- running ----

/** What a script is handed as `duet.items`: ids of what it runs on, or the lines of a list. */
export function itemsFor(runsOn: RunsOn, doc: Doc, selection: string[], list: string[] = []): string[] {
  if (runsOn === "selection") return [...selection];
  if (runsOn === "list") return list.map((l) => l.trim()).filter(Boolean);
  if (runsOn === "each-frame") return doc.rootIds.filter((id) => doc.elements[id]?.type === "frame");
  return [];
}

/** Names the script must not reach: the internet, other workers, storage. Removed from the worker before its code runs. */
const CLOSED = ["fetch", "XMLHttpRequest", "WebSocket", "WebSocketStream", "EventSource", "importScripts", "Worker", "SharedWorker", "indexedDB", "caches", "BroadcastChannel", "WebTransport", "navigator"];

/** The worker's whole source: the doors shut, then `duet`, then the script. */
export function workerSource(code: string): string {
  return `"use strict";
const post = self.postMessage.bind(self);
for (const k of ${JSON.stringify(CLOSED)}) {
  for (let o = self; o; o = Object.getPrototypeOf(o)) {
    try { if (Object.prototype.hasOwnProperty.call(o, k)) delete o[k]; } catch (e) {}
  }
  try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch (e) {}
}
let n = 0;
const waits = new Map();
const duet = {
  items: [],
  call(tool, args) {
    return new Promise((resolve, reject) => {
      const id = ++n;
      waits.set(id, { resolve, reject });
      post({ type: "call", id, tool: String(tool), args: args === undefined ? {} : JSON.parse(JSON.stringify(args)) });
    });
  },
  log(...a) { post({ type: "log", text: a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ") }); },
};
Object.freeze(duet.call); Object.freeze(duet.log);
const script = async (duet) => {
${code}
};
self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "reply") {
    const w = waits.get(m.id);
    if (!w) return;
    waits.delete(m.id);
    if (m.error) w.reject(new Error(m.error)); else w.resolve(m.value);
    return;
  }
  if (m.type === "start") {
    duet.items = m.items;
    try { await script(duet); post({ type: "done" }); }
    catch (err) { post({ type: "error", text: String(err && err.message ? err.message : err) }); }
  }
};
`;
}

export interface RunResult {
  /** True when the design changed and a step was added to history. */
  changed: boolean;
  /** How many changes the script made. */
  steps: number;
  logs: string[];
  /** What went wrong, in the script's words. Nothing was changed when this is set. */
  error?: string;
}

/**
 * One run, as messages in and out, with no worker in it, so it can be checked on its own.
 * Each change is made on a copy of the design; nothing reaches the screen until `finish`.
 */
export class ScriptRun {
  doc: Doc;
  readonly start: Doc;
  steps = 0;
  logs: string[] = [];
  constructor(doc: Doc) {
    this.doc = doc;
    this.start = doc;
  }
  /** Answer one message from the script. Returns the reply to send back, if any. */
  handle(m: { type: string; id?: number; tool?: string; args?: unknown; text?: string }): { type: "reply"; id: number; value?: unknown; error?: string } | null {
    if (m.type === "log") {
      if (this.logs.length < 200) this.logs.push(String(m.text ?? ""));
      return null;
    }
    if (m.type !== "call" || typeof m.id !== "number") return null;
    const res = scriptStep(this.doc, String(m.tool), m.args);
    if ("error" in res) return { type: "reply", id: m.id, error: res.error };
    if (res.doc !== this.doc) this.steps++;
    this.doc = res.doc;
    return { type: "reply", id: m.id, value: res.value };
  }
}

/** A script that runs longer than this is stopped, and changes nothing. */
const LIMIT_MS = 30_000;

/** Run a script on the design on screen. All or nothing: it changes the design only if it ends well. */
export function runScript(script: Pick<Script, "name" | "code" | "runsOn">, list: string[] = []): Promise<RunResult> {
  const s = getState();
  const run = new ScriptRun(currentDoc());
  const items = itemsFor(script.runsOn, run.doc, s.selection, list);
  if (script.runsOn === "selection" && !items.length) return Promise.resolve({ changed: false, steps: 0, logs: [], error: "Pick something first. This script works on what you have picked." });
  const url = URL.createObjectURL(new Blob([workerSource(script.code)], { type: "text/javascript" }));
  const worker = new Worker(url);
  return new Promise<RunResult>((resolve) => {
    const end = (error?: string) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      const changed = !error && run.doc !== run.start;
      // the screen moved on while the script ran: its work is set aside, never laid over newer changes
      if (changed && currentDoc() !== run.start) return resolve({ changed: false, steps: run.steps, logs: run.logs, error: "The design changed while the script ran, so nothing was changed. Run it again." });
      if (changed) liveRoom.restoreDoc(run.doc, `Ran the script ${script.name}`, "ai", `Script: ${script.name}`);
      resolve({ changed, steps: run.steps, logs: run.logs, ...(error ? { error } : {}) });
    };
    const timer = setTimeout(() => end("The script took longer than 30 seconds, so it was stopped. Nothing was changed."), LIMIT_MS);
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; text?: string };
      if (m.type === "done") return end();
      if (m.type === "error") return end(`${m.text ?? "The script stopped."} Nothing was changed.`);
      const reply = run.handle(m);
      if (reply) worker.postMessage(reply);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      end(`${e.message || "The script has a mistake in it."} Nothing was changed.`);
    };
    worker.postMessage({ type: "start", items });
  });
}

/** What the script maker sends the AI when the designer asks it to write a script. */
export function scriptAsk(ask: string, runsOn: RunsOn, name = "", code = ""): string {
  const parts = [
    `Write me a Duet script${name.trim() ? ` called "${name.trim()}"` : ""}: ${ask.trim()}`,
    `It runs on: ${RUNS_ON_WORDS[runsOn].toLowerCase()} (runsOn "${runsOn}").`,
  ];
  if (code.trim()) parts.push(`Start from what I have so far:\n\`\`\`js\n${code.trim()}\n\`\`\``);
  parts.push("Look at the design first if it helps, then hand it to me with save_script. Do not change the design yourself.");
  return parts.join("\n\n");
}

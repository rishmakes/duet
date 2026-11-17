import { invoke } from "@tauri-apps/api/core";

/**
 * Long work an AI asks for, like making a video, waits in a line here and runs one after another, on its
 * own. The AI that asked gets an answer at once and is free; any AI can ask how the line is doing. When a
 * job ends, Duet says so itself, and every job is kept in renders.log in Duet's folder.
 */

export type JobState = "waiting" | "running" | "done" | "failed";

export interface Job {
  /** Its number, from 1, for as long as Duet is open. */
  n: number;
  /** What it makes, in words: the frame's name. */
  what: string;
  /** The project it comes from. */
  project: string;
  /** The AI that asked. */
  by?: string;
  /** The file it makes, once known. */
  file?: string;
  state: JobState;
  /** How far along, 0 to 1. */
  done: number;
  /** Seconds of video it makes, to guess how long it takes. */
  seconds: number;
  asked: number;
  started?: number;
  ended?: number;
  error?: string;
}

/** Hooks the line calls, so it can be tried without Duet around it. */
export interface JobHooks {
  /** Wait until no other video is being made, like one the designer started. */
  free: () => boolean;
  /** Say that a job ended: notification, chat, trail. */
  ended: (job: Job) => void;
  /** Keep one line in the render log. */
  log: (line: string) => void;
}

/** Most jobs that may wait at once, so a runaway AI cannot pile up work. */
export const MOST_WAITING = 20;
/** Finished jobs kept to tell about. */
const KEPT = 30;

const jobs: Job[] = [];
const runs = new Map<number, (progress: (done: number) => void) => Promise<string | null>>();
const listeners = new Set<() => void>();
let hooks: JobHooks = { free: () => true, ended: () => {}, log: () => {} };
let running = false;
let next = 1;

export function setJobHooks(h: JobHooks) {
  hooks = h;
}

export function subscribeJobs(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const changed = () => {
  for (const l of listeners) l();
};

export const allJobs = (): readonly Job[] => jobs;

/** Put a job in the line. It starts when the ones before it are done. */
export function addJob(info: Pick<Job, "what" | "project" | "by" | "file" | "seconds">, run: (progress: (done: number) => void) => Promise<string | null>): Job | { error: string } {
  const waiting = jobs.filter((j) => j.state === "waiting").length;
  if (waiting >= MOST_WAITING) return { error: `${waiting} videos are already waiting. Wait for some to finish (ask with jobs), then try again.` };
  const job: Job = { ...info, n: next++, state: "waiting", done: 0, asked: Date.now() };
  jobs.push(job);
  runs.set(job.n, run);
  // only the finished ones are let go, never one waiting or running
  while (jobs.length > KEPT) {
    const old = jobs.findIndex((j) => j.state === "done" || j.state === "failed");
    if (old < 0) break;
    jobs.splice(old, 1);
  }
  changed();
  void work();
  return job;
}

async function work() {
  if (running) return;
  running = true;
  try {
    for (let job = jobs.find((j) => j.state === "waiting"); job; job = jobs.find((j) => j.state === "waiting")) {
      while (!hooks.free()) await new Promise((ok) => setTimeout(ok, 2000));
      const run = runs.get(job.n)!;
      job.state = "running";
      job.started = Date.now();
      changed();
      try {
        const file = await run((d) => {
          job.done = d;
          changed();
        });
        if (file) {
          job.file = file;
          job.done = 1;
          job.state = "done";
        } else {
          job.state = "failed";
          job.error = "It was stopped.";
        }
      } catch (e) {
        job.state = "failed";
        job.error = e instanceof Error ? e.message : String(e);
      }
      job.ended = Date.now();
      runs.delete(job.n);
      changed();
      hooks.log(logLine(job));
      hooks.ended(job);
    }
  } finally {
    running = false;
  }
}

const secs = (ms: number) => Math.max(1, Math.round(ms / 1000));
const name = (j: Job) => `${j.n}. ${j.what} (${j.project})`;

/** About how long a job takes, from how the last finished one went, or a guess of two seconds a second of video. */
function rate(): number {
  const last = [...jobs].reverse().find((j) => j.state === "done" && j.started && j.ended && j.seconds > 0);
  return last ? (last.ended! - last.started!) / 1000 / last.seconds : 2;
}

/** Seconds until a job is done, counting the ones before it. */
export function secondsLeft(job: Job): number {
  const r = rate();
  let left = 0;
  for (const j of jobs) {
    if (j.state === "running") left += j.started && j.done > 0.02 ? ((Date.now() - j.started) / 1000) * ((1 - j.done) / j.done) : j.seconds * r * (1 - j.done);
    else if (j.state === "waiting") left += j.seconds * r;
    if (j === job) break;
  }
  return Math.max(1, Math.round(left));
}

/** When to ask again: soon for a short wait, rarely for a long one. */
export function askAgainIn(left: number): number {
  return Math.max(10, Math.min(300, Math.round(left / 3)));
}

export function aboutTime(s: number): string {
  if (s < 90) return `about ${Math.max(5, Math.round(s / 5) * 5)} seconds`;
  if (s < 5400) return `about ${Math.round(s / 60)} minutes`;
  return `about ${Math.round(s / 360) / 10} hours`;
}

/** One job, in a line for an AI. */
export function jobLine(j: Job): string {
  switch (j.state) {
    case "waiting":
      return `${name(j)}: waiting in line, done in ${aboutTime(secondsLeft(j))}.`;
    case "running":
      return `${name(j)}: being made, ${Math.round(j.done * 100)}% done, ${aboutTime(secondsLeft(j))} left. Saving to ${j.file ?? "the Exports folder"}.`;
    case "done":
      return `${name(j)}: done in ${secs(j.ended! - j.started!)} seconds. ${j.file}`;
    case "failed":
      return `${name(j)}: not made. ${j.error ?? ""}`.trim();
  }
}

/** The whole line, for the jobs tool. */
export function jobsText(): string {
  if (!jobs.length) return "No videos have been asked for since Duet opened. Every video ever made is kept in renders.log in Duet's folder.";
  const busy = jobs.filter((j) => j.state === "running" || j.state === "waiting");
  const lines = jobs.map(jobLine);
  if (busy.length) {
    const last = busy[busy.length - 1];
    lines.push("", `Ask again in about ${askAgainIn(secondsLeft(last))} seconds, not sooner. You can keep working in Duet meanwhile.`);
  }
  return lines.join("\n");
}

/** A line of the render log: when, what, how it went. */
export function logLine(j: Job): string {
  const when = new Date(j.ended ?? Date.now()).toISOString();
  const took = j.started && j.ended ? `${secs(j.ended - j.started)}s` : "-";
  return [when, j.state === "done" ? "done" : "failed", took, j.project, j.what, j.by ?? "-", j.state === "done" ? j.file : (j.error ?? "")].join("\t");
}

/** How many lines the render log keeps. */
const LOG_LINES = 1000;

/** Add a line to renders.log in Duet's folder, keeping the newest. */
export async function appendRenderLog(line: string) {
  try {
    const home = await invoke<string>("duet_home");
    const path = `${home}/renders.log`;
    const old = await invoke<string>("read_text_file", { path }).catch(() => "");
    const lines = old.split("\n").filter(Boolean);
    lines.push(line);
    await invoke("write_text_file", { path, contents: lines.slice(-LOG_LINES).join("\n") + "\n" });
  } catch {
    // the log is a help, never a reason for a video to fail
  }
}

/** Only for tests: start the line afresh. */
export function resetJobs() {
  jobs.length = 0;
  runs.clear();
  running = false;
  next = 1;
}

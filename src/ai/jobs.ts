import { invoke } from "@tauri-apps/api/core";

/**
 * Long work, like making a video or a design's files, waits in a line here and runs one after another, on its
 * own. The AI that asked gets an answer at once and is free; any AI can ask how the line is doing. When a
 * job ends, Duet says so itself, and every job is kept in renders.log in Duet's folder.
 */

export type JobState = "waiting" | "running" | "done" | "failed" | "stopped";

export interface Job {
  /** Its number, from 1, for as long as Duet is open. */
  n: number;
  /** What it makes, in words: the frame's name. */
  what: string;
  /** The kind of file, in words, like MP4. */
  kind?: string;
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
  /** Held halfway by the designer, to carry on later. */
  paused?: boolean;
  /** Put in the line by the designer to start later: it waits until they press Start. */
  planned?: boolean;
}

/** How a running job is held or given up on. A job without it can only be taken out while it waits. */
export interface JobControl {
  pause: (on: boolean) => void;
  stop: () => void;
}

/** Hooks the line calls, so it can be tried without Duet around it. */
export interface JobHooks {
  /** Wait until no other video is being made, like one the designer started. */
  free: () => boolean;
  /** Say that a job ended: notification, chat, trail. */
  ended: (job: Job) => void;
  /** Keep one line in the render log. */
  log: (line: string) => void;
  /** The line is empty and the computer sleeps or shuts down in a minute: say so. */
  restSoon?: (what: Rest) => void;
  /** Now put the computer to sleep, or shut it down. */
  rest?: (what: Rest) => void;
}

/** What the computer does once every job is over. */
export type AfterLine = "nothing" | Rest;
export type Rest = "sleep" | "shutdown";
/** How long the designer has to cancel before the computer sleeps or shuts down. */
export const REST_WARNING = 60_000;

/** Most jobs that may wait at once, so a runaway AI cannot pile up work. */
export const MOST_WAITING = 20;
/** Finished jobs kept to tell about. */
const KEPT = 30;

const jobs: Job[] = [];
const runs = new Map<number, (progress: (done: number) => void) => Promise<string | null>>();
const controls = new Map<number, JobControl>();
const listeners = new Set<() => void>();
let hooks: JobHooks = { free: () => true, ended: () => {}, log: () => {} };
let running = false;
let next = 1;
/** The whole line held: the running job paused, and no new one starts until it is let go. */
let held = false;
let after: AfterLine = "nothing";
/** The computer rests at this time, unless cancelled. */
let resting: { what: Rest; at: number; timer: ReturnType<typeof setTimeout> } | null = null;

export function setJobHooks(h: JobHooks) {
  hooks = h;
}

export function subscribeJobs(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

const changed = () => {
  for (const l of listeners) l();
};

export const allJobs = (): readonly Job[] => jobs;

/** Put a job in the line. It starts when the ones before it are done. */
let planning = false;

/** Add jobs that only wait: the designer is planning the line and starts it themselves. */
export function addPlanned<T>(make: () => T): T {
  planning = true;
  try {
    return make();
  } finally {
    planning = false;
  }
}

/** Let planned jobs go: the given ones, or every planned one. They are made in their order in the line. */
export function startPlanned(ns?: number[]) {
  for (const j of jobs) if (j.planned && j.state === "waiting" && (!ns || ns.includes(j.n))) j.planned = false;
  changed();
  void work();
}

/** The next one to be made: the first waiting one that is not planned. */
const nextUp = () => jobs.find((j) => j.state === "waiting" && !j.planned);

export function addJob(info: Pick<Job, "what" | "kind" | "project" | "by" | "file" | "seconds">, run: (progress: (done: number) => void) => Promise<string | null>, control?: JobControl): Job | { error: string } {
  const waiting = jobs.filter((j) => j.state === "waiting").length;
  if (waiting >= MOST_WAITING) return { error: `${waiting} exports are already waiting. Wait for some to finish (ask with jobs), then try again.` };
  const job: Job = { ...info, n: next++, state: "waiting", done: 0, asked: Date.now(), ...(planning ? { planned: true } : {}) };
  jobs.push(job);
  runs.set(job.n, run);
  if (resting) {
    clearTimeout(resting.timer);
    resting = null;
  }
  if (control) controls.set(job.n, control);
  // only the finished ones are let go, never one waiting or running
  while (jobs.length > KEPT) {
    const old = jobs.findIndex((j) => j.state === "done" || j.state === "failed" || j.state === "stopped");
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
  let ran = false;
  try {
    for (let job = nextUp(); job; job = nextUp()) {
      while (!hooks.free() || held) await new Promise((ok) => setTimeout(ok, held ? 300 : 2000));
      const run = runs.get(job.n)!;
      job.state = "running";
      job.started = Date.now();
      ran = true;
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
          job.state = "stopped";
          job.error = "It was stopped.";
        }
      } catch (e) {
        job.state = "failed";
        job.error = e instanceof Error ? e.message : String(e);
      }
      job.ended = Date.now();
      job.paused = false;
      runs.delete(job.n);
      controls.delete(job.n);
      changed();
      hooks.log(logLine(job));
      hooks.ended(job);
    }
  } finally {
    running = false;
  }
  // planned files still waiting for Start keep the computer awake
  if (ran && after !== "nothing" && !jobs.some((j) => j.state === "waiting")) restSoon(after);
}

export const afterLine = () => after;
/** When the computer sleeps or shuts down, while that is coming. */
export const restingAt = () => (resting ? { what: resting.what, at: resting.at } : null);

/** Choose what the computer does when the line is empty. Do nothing also cancels a minute already counting. */
export function setAfterLine(a: AfterLine) {
  after = a;
  if (a === "nothing") cancelRest();
  else changed();
}

function restSoon(what: Rest) {
  if (resting) return;
  const timer = setTimeout(() => {
    resting = null;
    // done once: the next line ends with Do nothing until chosen again
    after = "nothing";
    changed();
    hooks.rest?.(what);
  }, REST_WARNING);
  resting = { what, at: Date.now() + REST_WARNING, timer };
  changed();
  hooks.restSoon?.(what);
}

/** Keep the computer awake after all: the minute stops and the choice goes back to Do nothing. */
export function cancelRest() {
  if (resting) clearTimeout(resting.timer);
  resting = null;
  after = "nothing";
  changed();
}

const find = (n: number) => jobs.find((j) => j.n === n);

/** Hold the running job halfway, or carry it on. */
export function pauseJob(n: number, on: boolean): boolean {
  const job = find(n);
  const control = controls.get(n);
  if (!job || job.state !== "running" || !control) return false;
  control.pause(on);
  job.paused = on;
  changed();
  return true;
}

export const lineHeld = () => held;

/** Hold the whole line, or let it go: the running job pauses and carries on with it. */
export function holdLine(on: boolean) {
  held = on;
  const now = jobs.find((j) => j.state === "running");
  if (now && !!now.paused !== on) pauseJob(now.n, on);
  else changed();
}

/** Give up on a job: one waiting or finished is taken off the list, one running is stopped where it is. */
export function stopJob(n: number): boolean {
  const job = find(n);
  if (!job) return false;
  if (job.state !== "running") {
    jobs.splice(jobs.indexOf(job), 1);
    runs.delete(n);
    controls.delete(n);
    changed();
    return true;
  }
  const control = controls.get(n);
  if (!control) return false;
  control.stop();
  return true;
}

/** Take every finished job (made, stopped or not made) off the list. */
export function clearFinished() {
  for (const j of jobs.filter((x) => x.state !== "waiting" && x.state !== "running")) stopJob(j.n);
}

/** Move a waiting job to another place among the waiting ones, 0 being next. */
export function moveJob(n: number, place: number): boolean {
  const job = find(n);
  if (!job || job.state !== "waiting") return false;
  jobs.splice(jobs.indexOf(job), 1);
  const waiting = jobs.filter((j) => j.state === "waiting");
  const before = waiting[Math.max(0, Math.min(place, waiting.length))];
  jobs.splice(before ? jobs.indexOf(before) : jobs.length, 0, job);
  changed();
  return true;
}

/** Make these waiting jobs next, in this order, before anything else still waiting. */
export const putFirst = (ns: number[]) => ns.forEach((n, i) => moveJob(n, i));

const secs = (ms: number) => Math.max(1, Math.round(ms / 1000));
const name = (j: Job) => `${j.n}. ${j.what} (${j.project})`;

/** About how long a job takes, from how the last finished one went, or a guess of two seconds a second of video. */
function rate(): number {
  const last = [...jobs].reverse().find((j) => j.state === "done" && j.started && j.ended && j.seconds > 0);
  return last ? (last.ended! - last.started!) / 1000 / last.seconds : 2;
}

/** About how many seconds it takes to make this many seconds of video, from how the last one went. */
export const guessSeconds = (videoSeconds: number) => videoSeconds * rate();

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
      if (j.planned) return `${name(j)}: planned by the designer. It starts when they press Start.`;
      return `${name(j)}: waiting in line, done in ${aboutTime(secondsLeft(j))}.`;
    case "running":
      if (j.paused) return `${name(j)}: paused by the designer at ${Math.round(j.done * 100)}%. It carries on when they say so.`;
      return `${name(j)}: being made, ${Math.round(j.done * 100)}% done, ${aboutTime(secondsLeft(j))} left. Saving to ${j.file ?? "the Exports folder"}.`;
    case "done":
      return `${name(j)}: done in ${secs(j.ended! - j.started!)} seconds. ${j.file}`;
    case "failed":
      return `${name(j)}: not made. ${j.error ?? ""}`.trim();
    case "stopped":
      return `${name(j)}: stopped before it was done.`;
  }
}

/** The whole line, for the jobs tool. */
export function jobsText(): string {
  if (!jobs.length) return "Nothing has been exported since Duet opened. Every export ever made is kept in renders.log in Duet's folder.";
  const busy = jobs.filter((j) => j.state === "running" || j.state === "waiting");
  const lines = jobs.map(jobLine);
  if (held && busy.length) lines.push("", "The designer has paused the whole line. Nothing new starts until they carry on.");
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
  return [when, j.state, took, j.project, j.what, j.by ?? "-", j.state === "done" ? j.file : (j.error ?? "")].join("\t");
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
  controls.clear();
  running = false;
  held = false;
  next = 1;
  if (resting) clearTimeout(resting.timer);
  resting = null;
  after = "nothing";
}

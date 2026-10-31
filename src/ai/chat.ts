import { useSyncExternalStore } from "react";
import { giveNames, tidyName } from "./names";
import type { Given } from "./names";

export type Mode = "suggest" | "ask" | "auto";

export interface Proposal {
  tool: string;
  args: unknown;
  summary: string;
  status: "open" | "applied" | "dismissed";
  /** The AI tool that suggested it, when it said who it is. */
  by?: string;
}

export interface Approval {
  summary: string;
  status: "waiting" | "allowed" | "declined";
}

/** How one turn of an AI went: which tool and model, how long it took, and how many changes it made. */
export interface Took {
  tool: string;
  /** The model the designer chose, when they chose one. */
  model?: string;
  ms: number;
  changes: number;
}

/** How a turn went, in words: "Antigravity, Gemini 3 Pro, took 3 min, made 12 changes". */
export function tookLine(t: Took): string {
  const s = Math.round(t.ms / 1000);
  const time = s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  const changes = t.changes === 0 ? "no changes" : t.changes === 1 ? "1 change" : `${t.changes} changes`;
  return `${t.tool}${t.model ? `, ${t.model}` : ""}, took ${time}, made ${changes}`;
}

export interface Msg {
  id: number;
  role: "you" | "duet" | "note" | "error" | "working" | "break";
  text: string;
  /** Milliseconds since 1970, when it was said. */
  time?: number;
  proposal?: Proposal;
  approval?: Approval;
  /** The numbers of the pictures that went with this message. */
  pictures?: number[];
  /** History step this change created, so Undo can take it back. */
  undoStep?: number;
  undone?: boolean;
  /** The name of the history step this change created. Unlike undoStep, it still means the same step after the project is opened again. */
  step?: string;
  /** For what an AI said: the name of the agent that said it, so a chat with several agents shows who spoke. */
  by?: string;
  /** On the last thing an AI said in a turn: how that turn went. */
  took?: Took;
}

/**
 * Who a message is meant for, when it names an agent with @. "@antigravity tidy this" and
 * "@Claude Code look" both work: the name may be shortened and may hold a space.
 */
export function mentioned(text: string, installed: Partial<Record<AgentId, boolean>>, names: Given = {}): AgentId | null {
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const m of text.matchAll(/@([A-Za-z][A-Za-z0-9]*(?: [A-Za-z][A-Za-z0-9]*)?)/g)) {
    const words = m[1].split(" ");
    for (const said of [flat(m[1]), flat(words[0])]) {
      if (said.length < 3) continue;
      // an AI is called by the name it goes by in the project, "@Juniper", or by its tool's name
      const hit = AGENTS.find((a) => a.runnable && installed[a.id] && (flat(a.name).startsWith(said) || a.id === said || (!!names[a.name] && flat(names[a.name]).startsWith(said))));
      if (hit) return hit.id;
    }
  }
  return null;
}

/** A picture or a written brief the designer gave the AI with a message. It is never part of the design. */
export interface Picture {
  /** The number the AI asks for it by. Counts up through the conversation. */
  n: number;
  name: string;
  /** Shrunk, as base64. */
  data: string;
  mime: string;
  width: number;
  height: number;
  /** A tiny copy to show in the chat. */
  thumb: string;
  /** The words, when this is a written brief and not a picture. */
  text?: string;
  /** False while it waits in the message box. */
  sent: boolean;
}

export type AgentId = "claude" | "agy" | "codex" | "opencode";

/** Every tool Duet looks for. Only some can be driven so far. */
export const AGENTS: { id: AgentId; name: string; runnable: boolean; install: string }[] = [
  { id: "claude", name: "Claude Code", runnable: true, install: "https://claude.com/claude-code" },
  { id: "agy", name: "Antigravity", runnable: true, install: "https://antigravity.google" },
  { id: "codex", name: "Codex", runnable: false, install: "" },
  { id: "opencode", name: "OpenCode", runnable: false, install: "" },
];

export interface ChatState {
  agent: AgentId;
  installed: Partial<Record<AgentId, boolean>>;
  messages: Msg[];
  /** Conversations closed with "Start a fresh conversation". Not shown, but the project keeps them. */
  earlier: Msg[];
  pictures: Picture[];
  mode: Mode;
  /** Whether the AI in the conversation on show is at work. */
  running: boolean;
  /** The project whose conversation the chat's AI is at work in, which may not be the one on show. Null when it is not at work. */
  busy: string | null;
  minimized: boolean;
  /** null while we are still looking */
  agentFound: boolean | null;
  sessionId: string | null;
  /** When the AI tool's own session was last used, and how many messages it has taken. */
  sessionUsed: number;
  sessionMessages: number;
  /** The model chosen for each tool. Empty means the tool's own default. */
  models: Partial<Record<AgentId, string>>;
  effort: string;
  /** Side conversations, each with one AI, of every open project. */
  tasks: Task[];
  /** The task on show, by its key. Null for the project's main chat. */
  thread: string | null;
  /** The names the AIs go by in the project on show, by tool: "Claude Code" goes by "Juniper". */
  names: Given;
}

/** A side conversation with one AI on a project. It runs by itself, beside the main chat and other tasks. */
export interface Task {
  /** "task:" and a number, so it never looks like a project file. */
  key: string;
  /** The project file it belongs to. Empty for work that has no file yet. */
  project: string;
  agent: AgentId;
  /** Its first words, once the designer has said something. */
  title: string;
  messages: Msg[];
  sessionId: string | null;
  sessionUsed: number;
  sessionMessages: number;
  running: boolean;
  /** It finished a turn the designer has not looked at yet. */
  done: boolean;
}

export const isTaskKey = (where: string | null | undefined): where is string => !!where && where.startsWith("task:");

export interface ModelChoice {
  id: string;
  name: string;
}

/** Models Duet knows without asking. Antigravity lists its own. */
export const CLAUDE_MODELS: ModelChoice[] = [
  { id: "", name: "Default" },
  { id: "sonnet", name: "Sonnet (quick)" },
  { id: "opus", name: "Opus (careful)" },
  { id: "haiku", name: "Haiku (fastest)" },
];
export const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
export const EFFORT_NAMES: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra", max: "Max" };

const pick = (key: string): string => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

const MODE_KEY = "duet:ai-mode";
const AGENT_KEY = "duet:ai-tool";

function savedAgent(): AgentId {
  try {
    const a = localStorage.getItem(AGENT_KEY);
    if (AGENTS.some((x) => x.id === a && x.runnable)) return a as AgentId;
  } catch {
    /* ignore */
  }
  return "claude";
}

function savedMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === "suggest" || m === "ask" || m === "auto") return m;
  } catch {
    /* ignore */
  }
  return "ask";
}

let state: ChatState = {
  agent: savedAgent(),
  installed: {},
  messages: [],
  earlier: [],
  pictures: [],
  mode: savedMode(),
  running: false,
  busy: null,
  minimized: false,
  agentFound: null,
  sessionId: null,
  sessionUsed: 0,
  sessionMessages: 0,
  models: { claude: pick("duet:model:claude"), agy: pick("duet:model:agy") },
  effort: pick("duet:effort"),
  tasks: [],
  thread: null,
  names: {},
};
let nextId = 1;
let nextPicture = 1;
/** Older pictures are let go, so a long conversation does not fill the memory. */
const PICTURES_KEPT = 30;
const listeners = new Set<() => void>();
const pendingApprovals = new Map<number, (allowed: boolean) => void>();

function set(patch: Partial<ChatState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const getChat = () => state;
export const subscribeChat = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export function useChat<T>(selector: (s: ChatState) => T): T {
  return useSyncExternalStore(subscribeChat, () => selector(state));
}

/** What a conversation holds. The one on show lives in the chat state; the others are kept aside. */
type Conversation = Pick<ChatState, "messages" | "earlier" | "pictures" | "sessionId" | "sessionUsed" | "sessionMessages" | "names">;
const blank = (): Conversation => ({ messages: [], earlier: [], pictures: [], sessionId: null, sessionUsed: 0, sessionMessages: 0, names: {} });

/**
 * Change the conversation of one project, on show or not. An AI at work in a project that is not
 * on screen writes to its own conversation, never to the one the designer is looking at.
 */
function inConversation(project: string | null | undefined, change: (c: Conversation) => Partial<Conversation>) {
  if (isTaskKey(project)) {
    set({ tasks: state.tasks.map((t) => (t.key === project ? { ...t, ...change({ ...t, earlier: [], pictures: [], names: {} }) } : t)) });
    return;
  }
  if (project === undefined || project === null || project === shownFor) {
    set(change(state));
    return;
  }
  const c = kept.get(project) ?? blank();
  kept.set(project, { ...c, ...change(c) });
}

/** The messages of one project's conversation, on show or not. */
export const messagesOf = (project?: string | null): Msg[] =>
  isTaskKey(project) ? (state.tasks.find((t) => t.key === project)?.messages ?? []) : (project === undefined || project === null || project === shownFor ? state.messages : (kept.get(project)?.messages ?? []));

export function addMsg(m: Omit<Msg, "id">, project?: string | null): number {
  const id = nextId++;
  inConversation(project, (c) => ({ messages: [...c.messages, { time: Date.now(), ...m, id }] }));
  return id;
}

export function updateMsg(id: number, patch: Partial<Msg>, project?: string | null) {
  inConversation(project, (c) => ({ messages: c.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
}

/** Keep pictures waiting in the message box, to go with the next message. */
export function addPictures(list: Omit<Picture, "n" | "sent">[]) {
  if (!list.length) return;
  const all = [...state.pictures, ...list.map((p) => ({ ...p, n: nextPicture++, sent: false }))];
  set({ pictures: all.slice(-PICTURES_KEPT) });
}

/** Take a waiting picture out again, before it is sent. */
export function removePicture(n: number) {
  set({ pictures: state.pictures.filter((p) => p.n !== n || p.sent) });
}

/** The waiting pictures go with the message being sent. Returns them. */
export function sendPictures(): Picture[] {
  const going = state.pictures.filter((p) => !p.sent);
  if (going.length) set({ pictures: state.pictures.map((p) => (p.sent ? p : { ...p, sent: true })) });
  return going;
}

export function removeWorking(project?: string | null) {
  inConversation(project, (c) => ({ messages: c.messages.filter((m) => m.role !== "working") }));
}

export function setMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore */
  }
  set({ mode });
}

/** The chat's AI starts work in the conversation on show, or stops wherever it was. */
export const setRunning = (running: boolean) => set(running ? { running, busy: shownFor } : { running, busy: null });
export const setMinimized = (minimized: boolean) => set({ minimized });
export const setAgentFound = (agentFound: boolean) => set({ agentFound });

/** Remember which tools are installed, and whether the chosen one is ready. */
export function setInstalled(installed: Partial<Record<AgentId, boolean>>) {
  // the tool picked before, or the first one, may not be on this computer: answer with one that is
  const agent = installed[state.agent] ? state.agent : (AGENTS.find((a) => a.runnable && installed[a.id])?.id ?? state.agent);
  set({ installed, agent, agentFound: installed[agent] ?? false });
}

/** Switch to another AI tool. The conversation stays: Duet holds it, and hands the new tool a note of it. */
export function setAgent(agent: AgentId) {
  try {
    localStorage.setItem(AGENT_KEY, agent);
  } catch {
    /* ignore */
  }
  declineAllWaiting();
  for (const k of kept.values()) k.sessionId = null;
  set({ agent, agentFound: state.installed[agent] ?? false, sessionId: null });
}
export function setModel(agent: AgentId, model: string) {
  try {
    localStorage.setItem(`duet:model:${agent}`, model);
  } catch {
    /* ignore */
  }
  for (const k of kept.values()) k.sessionId = null;
  set({ models: { ...state.models, [agent]: model }, sessionId: null });
}

export function setEffort(effort: string) {
  try {
    localStorage.setItem("duet:effort", effort);
  } catch {
    /* ignore */
  }
  set({ effort });
}

export const setSessionId = (sessionId: string | null, project?: string | null) => inConversation(project, () => ({ sessionId }));

/** The AI tool starts fresh on the next message, instead of carrying its own session on. */
export const dropSession = (where?: string | null) => inConversation(where, () => ({ sessionId: null, sessionMessages: 0 }));
/** A message went into the AI tool's session, or it has just finished answering. */
export const sessionUsed = (message = false, project?: string | null) => inConversation(project, (c) => ({ sessionUsed: Date.now(), sessionMessages: c.sessionMessages + (message ? 1 : 0) }));

/** Start a fresh conversation. The one before is not shown any more, but the project keeps it. */
export function newConversation() {
  declineAllWaiting();
  const closed = state.messages.filter((m) => m.role !== "working");
  const earlier = closed.length ? [...state.earlier, ...closed, { id: nextId++, role: "break" as const, text: "", time: Date.now() }] : state.earlier;
  set({ messages: [], earlier, pictures: state.pictures.filter((p) => !p.sent), sessionId: null, sessionMessages: 0 });
}

/** Conversations of the projects opened earlier, by project file. Kept while Duet is open. */
const kept = new Map<string, Conversation>();
/** The project file the conversation on show belongs to. Empty for work that has no file yet. */
let shownFor = "";

/**
 * A conversation belongs to a project. Opening another project puts this one away and brings
 * that project's own conversation back, so the AI never talks about the design you just left.
 * A brand new project always starts with an empty one.
 */
export function showConversationFor(project: string, fresh = false) {
  if (project === shownFor && !fresh) return;
  declineAllWaiting();
  // work without a file is gone once another project opens, and so is its conversation
  if (shownFor && project !== shownFor) {
    kept.set(shownFor, {
      // the project waits in its tab with its history, so Undo still points at the right step; an AI still at work there keeps its working line
      messages: shownFor === state.busy ? state.messages : state.messages.filter((m) => m.role !== "working"),
      // pictures still waiting in the message box do not come along
      earlier: state.earlier,
      pictures: state.pictures.filter((p) => p.sent),
      sessionId: state.sessionId,
      sessionUsed: state.sessionUsed,
      sessionMessages: state.sessionMessages,
      names: state.names,
    });
  }
  const back = fresh ? undefined : kept.get(project);
  kept.delete(project);
  shownFor = project;
  set({
    messages: back?.messages ?? [],
    earlier: back?.earlier ?? [],
    pictures: back?.pictures ?? [],
    sessionId: back?.sessionId ?? null,
    sessionUsed: back?.sessionUsed ?? 0,
    sessionMessages: back?.sessionMessages ?? 0,
    names: back?.names ?? {},
    running: state.busy !== null && state.busy === project,
    thread: null,
  });
}

/** A project was closed. Its history is let go, so Undo in its conversation no longer points anywhere. */
export function forgetSteps(project: string) {
  const c = kept.get(project);
  if (c) kept.set(project, { ...c, messages: c.messages.map((m) => (m.undoStep === undefined ? m : { ...m, undoStep: undefined })) });
}

/** The project file the conversation on show belongs to. Empty for work that has no file yet. */
export const conversationProject = () => shownFor;

/**
 * Put back a conversation that was saved with its project, when Duet has just opened it and has
 * nothing of its own to show. The AI tool's own session is long gone, so it starts fresh.
 */
export function restoreConversation(now: Omit<Msg, "id">[], earlier: Omit<Msg, "id">[], names: Given = {}) {
  if (state.messages.length || state.earlier.length) return;
  // names come back even with nothing said: an AI may have worked from its own window
  if (Object.keys(names).length && !Object.keys(state.names).length) set({ names });
  if (!now.length && !earlier.length) return;
  const number = (list: Omit<Msg, "id">[]) => list.map((m) => ({ ...m, id: nextId++ }));
  // pictures are not kept, and a new one must not take the number of one that is gone
  for (const m of [...now, ...earlier]) for (const n of m.pictures ?? []) nextPicture = Math.max(nextPicture, n + 1);
  set({ messages: number(now), earlier: number(earlier), sessionId: null, sessionUsed: 0, sessionMessages: 0 });
}

/** Give a name to each AI tool met in the project on show that has none yet. */
export function nameAgents(tools: string[]) {
  const names = giveNames(tools, state.names);
  if (names !== state.names) set({ names });
}

/** The designer renames an AI in the project on show. An empty name, or one another AI has, is not taken. */
export function renameAgent(tool: string, typed: string): boolean {
  const name = tidyName(typed);
  if (!name) return false;
  if (Object.entries(state.names).some(([t, n]) => t !== tool && n.toLowerCase() === name.toLowerCase())) return false;
  set({ names: { ...state.names, [tool]: name } });
  return true;
}

/** Save As: the conversation stays with the work and goes to its new file. */
export function moveConversationTo(project: string) {
  kept.delete(project);
  moveTasks(shownFor, project);
  shownFor = project;
}

/** Ask the designer a yes or no question and wait for the answer. */
export function askDesigner(summary: string): Promise<boolean> {
  return new Promise((resolve) => {
    // asked where the designer is looking, the main chat or a task, so it is never missed
    const where = state.thread ?? undefined;
    const id = addMsg({ role: "note", text: "", approval: { summary, status: "waiting" } }, where);
    // an AI working from outside may ask while the chat is folded away, or behind another tab in Video
    set({ minimized: false });
    if (typeof window !== "undefined") window.dispatchEvent(new Event("duet:show-chat"));
    pendingApprovals.set(id, (allowed) => {
      updateMsg(id, { approval: { summary, status: allowed ? "allowed" : "declined" } }, where);
      resolve(allowed);
    });
  });
}

export function answerApproval(id: number, allowed: boolean) {
  const fn = pendingApprovals.get(id);
  pendingApprovals.delete(id);
  fn?.(allowed);
}

/** If the agent stops, nobody should be left waiting. */
export function declineAllWaiting() {
  for (const [id, fn] of [...pendingApprovals]) {
    pendingApprovals.delete(id);
    fn(false);
  }
}

// ---- tasks: side conversations, each with one AI ----

let nextTask = 1;
const taskName = (said: string) => {
  const words = said.trim().replace(/\s+/g, " ").split(" ").slice(0, 5).join(" ");
  return words.length > 32 ? `${words.slice(0, 31)}…` : words;
};

/** Start a task with one AI on the project on show, and show it. Returns its key. */
export function newTask(agent: AgentId): string {
  const key = `task:${Date.now().toString(36)}${nextTask++}`;
  const task: Task = { key, project: shownFor, agent, title: "", messages: [], sessionId: null, sessionUsed: 0, sessionMessages: 0, running: false, done: false };
  set({ tasks: [...state.tasks, task], thread: key });
  return key;
}

/** Show a task, or the main chat with null. Looking at a finished task clears its mark. */
export function showThread(key: string | null) {
  const thread = key && state.tasks.some((t) => t.key === key) ? key : null;
  set({ thread, tasks: thread ? state.tasks.map((t) => (t.key === thread ? { ...t, done: false } : t)) : state.tasks });
}

export const taskOf = (key: string | null | undefined): Task | undefined => (key ? state.tasks.find((t) => t.key === key) : undefined);

/** A task starts or stops work. When it stops out of sight, it is marked done. */
export function setTaskRunning(key: string, running: boolean) {
  set({ tasks: state.tasks.map((t) => (t.key === key ? { ...t, running, done: !running && state.thread !== key } : t)) });
}

/** Name a task after the first thing the designer said in it. */
export function nameTask(key: string, said: string) {
  const t = taskOf(key);
  if (!t || t.title || !said.trim()) return;
  set({ tasks: state.tasks.map((x) => (x.key === key ? { ...x, title: taskName(said) } : x)) });
}

/** Close a task for good. */
export function removeTask(key: string) {
  set({ tasks: state.tasks.filter((t) => t.key !== key), thread: state.thread === key ? null : state.thread });
}

/** Tasks saved with a project come back when it opens. Only when Duet has none of its own for it. */
export function restoreTasks(project: string, saved: { agent: AgentId; title: string; messages: Omit<Msg, "id">[] }[]) {
  if (!saved.length || state.tasks.some((t) => t.project === project)) return;
  const back: Task[] = saved.map((x) => ({
    key: `task:${Date.now().toString(36)}${nextTask++}`,
    project,
    agent: x.agent,
    title: x.title,
    messages: x.messages.map((m) => ({ ...m, id: nextId++ })),
    sessionId: null,
    sessionUsed: 0,
    sessionMessages: 0,
    running: false,
    done: false,
  }));
  set({ tasks: [...state.tasks, ...back] });
}

/** Save As: the tasks go with the work to its new file. */
function moveTasks(from: string, to: string) {
  if (from === to) return;
  set({ tasks: state.tasks.map((t) => (t.project === from ? { ...t, project: to } : t)) });
}

/** A project was closed: its tasks go, unless one is still at work. */
export function forgetTasks(project: string) {
  set({ tasks: state.tasks.filter((t) => t.project !== project || t.running) });
}

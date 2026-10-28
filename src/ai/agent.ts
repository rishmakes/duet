import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { saveNow, tabName } from "../project/project";
import { getState } from "../state/store";
import {
  AGENTS,
  addMsg,
  declineAllWaiting,
  dropSession,
  conversationProject,
  getChat,
  messagesOf,
  nameTask,
  removeTask,
  removeWorking,
  sendPictures,
  sessionUsed,
  setInstalled,
  setRunning,
  setSessionId,
  setTaskRunning,
  taskOf,
  updateMsg,
} from "./chat";
import { brief, carryOn, keepable } from "../memory/thread";
import type { AgentId, Msg } from "./chat";
import { mentioned, setAgent } from "./chat";
import { FROM_CHAT, OUTSIDE } from "./who";
import { chatRules } from "./rules";
import { aiStarted, bindAi } from "./tools";

/** Runs the AI tool the designer already has, and shows what it says as chat. */

const WORKING: Record<string, string> = {
  get_context: "Looking at your design",
  get_outline: "Looking at your design",
  get_document: "Looking at your design",
  look_at_image: "Looking at a picture",
  look_at_design: "Checking how it looks",
  picture_of_duet: "Taking a picture of Duet",
  look_at_attachment: "Looking at your picture",
  create_instance: "Placing a copy",
  place_image: "Bringing in a picture",
  make_mask: "Cutting something to a shape",
  trace_image: "Tracing a picture",
  select_elements: "Pointing at things",
  create_element: "Adding something",
  create_elements: "Building a section",
  set_curve: "Shaping a move",
  set_props: "Changing something",
  move_elements: "Moving things",
  resize_element: "Resizing something",
  reparent_elements: "Moving things between frames",
  delete_elements: "Clearing something away",
  duplicate_elements: "Making a copy",
  save_skill: "Saving your rules as a skill",
};

/**
 * One AI at work: the main chat's, or a task's. Each keeps its own place in its own conversation, so
 * several can talk at once without their words getting mixed.
 */
interface Run {
  /** "chat", or the task's key. */
  id: string;
  agent: AgentId;
  /** The conversation it talks in: the project file for the main chat, the task's key for a task. */
  where: string;
  sawText: boolean;
  /** When this turn began, and the last message before it, to tell afterwards how the turn went. */
  turn: { at: number; after: number; tool: string; model?: string } | null;
  stderrLines: string[];
  workingId: number | null;
  /** False once the designer has stopped the AI. What it says after that is not shown. */
  live: boolean;
  streamId: number | null;
  lastStreamId: number | null;
}
const runs = new Map<string, Run>();
const CHAT = "chat";

/** Save what the AI did, but only to a project that has a file: work never saved is not interrupted with a Save window. */
const keepIt = () => {
  if (getState().project.path) void saveNow();
};

/** The main chat's run, the one the rest of Duet asks about. */
const chatRun = () => runs.get(CHAT);

/** The name of the agent that is answering in a run. */
const speaker = (r: Run) => AGENTS.find((a) => a.id === r.agent)?.name;

/** Look for every AI tool this computer has. */
export async function detectAgent() {
  const found: Partial<Record<AgentId, boolean>> = {};
  await Promise.all(
    AGENTS.map(async (a) => {
      try {
        found[a.id] = await invoke<boolean>("agent_available", { program: a.id });
      } catch {
        found[a.id] = false;
      }
    }),
  );
  setInstalled(found);
}

function onClaudeLine(r: Run, line: string) {
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return; // shell start-up noise, not a message
  }

  if (ev.type === "system" && ev.subtype === "init") {
    if (typeof ev.session_id === "string") setSessionId(ev.session_id, r.where);
    const servers = (ev.mcp_servers as { name: string; status: string }[] | undefined) ?? [];
    const duet = servers.find((s) => s.name === "duet");
    if (duet && duet.status !== "connected") {
      removeWorking(r.where);
      addMsg({ role: "error", text: "The AI could not connect to your canvas. Try again in a moment." }, r.where);
    }
    return;
  }

  if (ev.type === "assistant") {
    const content = ((ev.message as { content?: unknown[] } | undefined)?.content ?? []) as Record<string, unknown>[];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        removeWorking(r.where);
        r.workingId = null;
        r.sawText = true;
        addMsg({ role: "duet", text: block.text.trim(), by: speaker(r) }, r.where);
      } else if (block.type === "tool_use") {
        const tool = String(block.name ?? "").replace(/^mcp__duet__/, "");
        showWorking(r, `${WORKING[tool] ?? "Working"}...`);
      }
    }
    return;
  }

  // a tool's answer coming back means that tool has finished
  if (ev.type === "user" && r.workingId !== null) {
    showWorking(r, "Thinking...");
    return;
  }

  if (ev.type === "result") {
    if (typeof ev.session_id === "string") setSessionId(ev.session_id, r.where);
    const text = typeof ev.result === "string" ? ev.result.trim() : "";
    if (ev.is_error) {
      removeWorking(r.where);
      addMsg({ role: "error", text: friendly(text || r.stderrLines.join(" ")) }, r.where);
      r.sawText = true;
    } else if (!r.sawText && text) {
      removeWorking(r.where);
      addMsg({ role: "duet", text, by: speaker(r) }, r.where);
      r.sawText = true;
    }
  }
}


// ---- Antigravity: streams small pieces of text, tool steps, then a result ----

function streamText(r: Run, piece: string) {
  removeWorking(r.where);
  r.workingId = null;
  r.sawText = true;
  const cur = r.streamId !== null ? messagesOf(r.where).find((m) => m.id === r.streamId) : undefined;
  if (cur && r.streamId !== null) {
    updateMsg(r.streamId, { text: cur.text + piece }, r.where);
  } else {
    r.streamId = addMsg({ role: "duet", text: piece.replace(/^\s+/, ""), by: speaker(r) }, r.where);
  }
  r.lastStreamId = r.streamId;
}

function showWorking(r: Run, text: string) {
  if (r.workingId !== null && messagesOf(r.where).some((m) => m.id === r.workingId)) updateMsg(r.workingId, { text }, r.where);
  else r.workingId = addMsg({ role: "working", text }, r.where);
}

function onAgyLine(r: Run, line: string) {
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  if (ev.event === "init" && typeof ev.conversation_id === "string") {
    setSessionId(ev.conversation_id, r.where);
  } else if (ev.event === "step_update") {
    const step = ev.step_update as Record<string, unknown> | undefined;
    if (!step) return;
    if (step.step_type === "agent_response") {
      if (step.state === "ACTIVE" && typeof step.text_delta === "string") streamText(r, step.text_delta);
      else if (step.state === "DONE") r.streamId = null;
    } else if (step.step_type === "tool" && step.state === "ACTIVE") {
      r.streamId = null;
      const info = step.tool_info as { parameters?: { ToolName?: string } } | undefined;
      if (step.tool_name === "call_mcp_tool") {
        showWorking(r, `${WORKING[String(info?.parameters?.ToolName ?? "")] ?? "Working"}...`);
      } else {
        // Antigravity can reach for its own tools too. Say so, so nothing happens out of sight.
        showWorking(r, `Antigravity is using its own tool (${String(step.tool_name ?? "unknown")})...`);
      }
    } else if (step.step_type === "tool" && step.state === "DONE") {
      // the tool has finished: do not leave its message up as if it were still running
      if (r.workingId !== null) showWorking(r, "Thinking...");
    }
  } else if (ev.event === "result") {
    r.streamId = null;
    const res = (ev.result ?? {}) as Record<string, unknown>;
    if (typeof res.conversation_id === "string") setSessionId(res.conversation_id, r.where);
    if (res.status !== "SUCCESS") {
      removeWorking(r.where);
      const err = typeof res.error === "string" ? res.error : typeof res.response === "string" ? res.response : "";
      addMsg({ role: "error", text: friendly(err || r.stderrLines.join(" ")) }, r.where);
      r.sawText = true;
    } else if (!r.sawText && typeof res.response === "string" && res.response.trim()) {
      removeWorking(r.where);
      addMsg({ role: "duet", text: res.response.trim(), by: speaker(r) }, r.where);
      r.sawText = true;
    } else if (typeof res.response === "string" && res.response.trim() && r.lastStreamId !== null) {
      // Streamed pieces can get lost on the way in. The final result holds the whole reply, so
      // if the last message on screen is a shorter start of it, show the full text instead.
      const full = res.response.trim();
      const cur = messagesOf(r.where).find((m) => m.id === r.lastStreamId);
      const shown = (cur?.text ?? "").trim();
      if (cur && shown.length < full.length && full.startsWith(shown.slice(0, Math.min(20, shown.length)))) {
        updateMsg(r.lastStreamId, { text: full }, r.where);
      }
    }
  }
}

/** The turn is over: put on the AI's last reply how long it took and how many changes it made. */
function noteTook(r: Run) {
  const t = r.turn;
  r.turn = null;
  if (!t) return;
  const since = messagesOf(r.where).filter((m) => m.id > t.after);
  const changes = since.filter((m) => m.role === "note" && !!m.step).length;
  const reply = [...since].reverse().find((m) => m.role === "duet");
  if (reply) updateMsg(reply.id, { took: { tool: t.tool, ...(t.model ? { model: t.model } : {}), ms: Date.now() - t.at, changes } }, r.where);
}

function onLine(r: Run, line: string) {
  if (!r.live) return;
  if (r.agent === "agy") onAgyLine(r, line);
  else onClaudeLine(r, line);
}

/** Turn technical failures into something a designer can act on. */
/** Why Antigravity could not be joined to Duet, in words a designer can act on. */
export function connectHelp(why: string, app: string): string {
  const fix = app ? ` To do it yourself, open a terminal and run this once: agy mcp add duet "${app}" --mcp-bridge` : "";
  const t = why.toLowerCase();
  if (t.includes("could not start agy") || t.includes("not recognized") || t.includes("no such file") || t.includes("cannot find"))
    return `Duet could not start Antigravity (agy). Check that Antigravity is installed and that "agy" works in a terminal, then try again.${fix}`;
  return `Duet could not connect itself to Antigravity.${why.trim() ? ` Antigravity said: ${why.trim().slice(0, 160)}.` : ""}${fix}`;
}

function friendly(raw: string): string {
  // already written for the designer
  if (raw.includes("Duet could not")) return raw.replace(/^Error: /, "");
  const t = raw.toLowerCase();
  if (t.includes("login") || t.includes("authenticat") || t.includes("api key") || t.includes("sign in"))
    return "Your AI tool is not signed in. Open a terminal, run it once, sign in, then try again.";
  if (t.includes("rate") || t.includes("limit") || t.includes("usage"))
    return "Your AI tool says you have hit its usage limit. Try again a little later.";
  if (t.includes("not found") || t.includes("command not found"))
    return "Duet could not find your AI tool. Check that it is installed.";
  return raw ? `Something went wrong: ${raw.slice(0, 240)}` : "Something went wrong and the AI stopped.";
}

/** A run has ended, by itself or because it was stopped: tidy its conversation and say it is free. */
function ended(r: Run) {
  r.live = false;
  r.workingId = null;
  runs.delete(r.id);
  removeWorking(r.where);
  if (r.id === CHAT) {
    declineAllWaiting();
    setRunning(false);
  } else {
    setTaskRunning(r.id, false);
  }
}

export async function startAgentListeners(): Promise<() => void> {
  type Said = { run?: string; line: string };
  const offLine = await listen<Said>("agent-line", (e) => {
    const r = runs.get(e.payload.run ?? CHAT);
    if (r) onLine(r, e.payload.line);
  });
  const offErr = await listen<Said>("agent-stderr", (e) => {
    const r = runs.get(e.payload.run ?? CHAT);
    if (r) r.stderrLines = [...r.stderrLines.slice(-5), e.payload.line];
  });
  const offExit = await listen<{ run?: string; code: number | null }>("agent-exit", (e) => {
    const r = runs.get(e.payload.run ?? CHAT);
    // the designer has moved to another project, and that chat was already tidied
    if (!r || !r.live) return;
    ended(r);
    sessionUsed(false, r.where);
    noteTook(r);
    if (!r.sawText) {
      const detail = r.stderrLines.filter((l) => !/job control|no tty/i.test(l)).join(" ");
      addMsg({ role: "error", text: friendly(detail) }, r.where);
    }
    keepIt();
  });
  return () => {
    offLine();
    offErr();
    offExit();
  };
}

/** Antigravity reaches Duet through one shared bridge, so it can only be at work in one place at a time. */
function agyBusy(): boolean {
  return [...runs.values()].some((r) => r.agent === "agy");
}

/**
 * What goes to the AI with a message: the message, and if its own session has gone cold, a short note
 * from Duet of what was said and done before. Pictures waiting in the box go too.
 */
function shape(said: string, where: string | undefined, conv: { sessionId: string | null; sessionUsed: number; sessionMessages: number; messages: Msg[] }) {
  // Duet holds the conversation, not the AI tool. A quick back and forth carries the tool's own session on.
  // Otherwise it starts fresh and light, with a short note from Duet of what was said and done.
  const resume = carryOn({ sessionId: conv.sessionId, used: conv.sessionUsed, messages: conv.sessionMessages });
  if (!resume) dropSession(where);
  const note = resume ? "" : brief(keepable(conv.messages));
  const past = note ? `${note}\n\nThe designer now says:\n` : "";
  const pictures = sendPictures();
  addMsg({ role: "you", text: said, pictures: pictures.length ? pictures.map((p) => p.n) : undefined }, where);
  // The pictures do not travel inside the message. The AI is told they are there and asks to see each one,
  // the same way it looks at the canvas, so every AI tool gets them the same way.
  const what = pictures.every((p) => p.text === undefined) ? "picture" : pictures.every((p) => p.text !== undefined) ? "text file" : "file";
  const attached = pictures.length
    ? `\n\n(The designer attached ${pictures.length === 1 ? `a ${what}` : `${pictures.length} ${what}s`} to this message: ${pictures.map((p) => `number ${p.n}`).join(", ")}. Look at ${pictures.length === 1 ? "it" : "each one"} with look_at_attachment before you do anything else.)`
    : "";
  return { past, prompt: `${said || "Look at what I attached."}${attached}`, session: resume ? conv.sessionId : null };
}

export async function sendToAgent(text: string) {
  const said = text.trim();
  if (getChat().running) return;
  const away = getChat().busy;
  if (away !== null) {
    addMsg({ role: "note", text: `The AI is still at work in ${away ? `"${tabName(away)}"` : "another design"}. It can start here once it is done there.` });
    return;
  }
  if (!said && !getChat().pictures.some((p) => !p.sent)) return;
  // naming an agent with @ hands the message to that one, and it answers from then on
  const asked = mentioned(said, getChat().installed, getChat().names);
  if (asked && asked !== getChat().agent) setAgent(asked);
  const agent = getChat().agent;
  if (agent === "agy" && agyBusy()) {
    addMsg({ role: "note", text: "Antigravity is at work on a task. It can answer here once that is done." });
    return;
  }
  const { past, prompt, session } = shape(said, undefined, getChat());
  sessionUsed(true);
  const project = conversationProject();
  setRunning(true);
  await launch({ id: CHAT, agent, where: project }, project, past, prompt, session);
}

/** Send a message in a task. Its AI answers there, beside the main chat and the other tasks. */
export async function sendToTask(key: string, text: string) {
  const said = text.trim();
  const task = taskOf(key);
  if (!task || task.running) return;
  if (!said && !getChat().pictures.some((p) => !p.sent)) return;
  if (task.agent === "agy" && agyBusy()) {
    addMsg({ role: "note", text: "Antigravity is at work somewhere else. It can do this once that is done." }, key);
    return;
  }
  nameTask(key, said);
  const { past, prompt, session } = shape(said, key, task);
  sessionUsed(true, key);
  setTaskRunning(key, true);
  await launch({ id: key, agent: task.agent, where: key }, task.project, past, prompt, session);
}

/** Start the AI tool for a run, with the message and Duet's instructions. */
async function launch(base: Pick<Run, "id" | "agent" | "where">, project: string, past: string, prompt: string, session: string | null) {
  const r: Run = { ...base, sawText: false, turn: null, stderrLines: [], workingId: null, live: true, streamId: null, lastStreamId: null };
  runs.set(r.id, r);
  const agent = r.agent;
  const name = speaker(r) ?? agent;
  const task = r.id === CHAT ? undefined : r.id;
  // some tools reach Duet through its bridge and look like they work from outside: tie both to this project
  if (!task) bindAi(name, project || null);
  bindAi(name + OUTSIDE, project || null, task);
  r.turn = { at: Date.now(), after: messagesOf(r.where).reduce((n, m) => Math.max(n, m.id), 0), tool: name, model: getChat().models[agent] ?? undefined };
  // keeps an area it already has up; the area only appears once the AI claims one or changes the design
  aiStarted(speaker(r));
  r.workingId = addMsg({ role: "working", text: "Thinking..." }, r.where);
  try {
    const info = await invoke<{ port: number; token: string }>("mcp_info");
    const home = await invoke<string>("duet_home");
    const url = `http://127.0.0.1:${info.port}/mcp`;
    // the name goes with every request, so each step can say which AI tool made it, and for which task
    const headers = { Authorization: `Bearer ${info.token}`, "X-Duet-Client": `${FROM_CHAT}${name}${task ? `/${task}` : ""}` };
    let args: string[];
    let agyInput = "";

    if (agent === "agy") {
      // Antigravity has no flag for instructions or per-run connections. Duet joins its list once
      // (a small bridge that finds the running Duet), and the instructions go in with the message.
      try {
        await invoke("agy_connect");
      } catch (e) {
        // the AI never started, so say what failed and the one command that fixes it by hand
        const app = await invoke<string>("bridge_command").catch(() => "");
        throw new Error(connectHelp(String(e), app));
      }
      const whole = `${chatRules()}\n\nFor this job use only the "duet" tools. Do not run commands, browse, or read or write files.\n\n${past || "The designer says:\n"}${prompt}`;
      // The instructions and the message go in through the input, not the command line: on Windows a
      // command line stops at about 8,000 letters, and the instructions with skills are twice that.
      agyInput = JSON.stringify({ event: "user", message: { role: "user", content: whole } }) + "\n";
      args = ["--print=", "--input-format", "stream-json", "--output-format", "stream-json"];
      if (getChat().models.agy) args.push("--model", getChat().models.agy as string);
      // The Antigravity model names already carry their level, e.g. "(High)", so no --effort here.
      if (session) args.push("--conversation", session);
    } else {
      const files = await invoke<{ system: string; mcp: string }>("write_agent_files", {
        system: chatRules(),
        mcp: JSON.stringify({ mcpServers: { duet: { type: "http", url, headers } } }),
        run: r.id,
      });
      args = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        files.mcp,
        "--allowedTools",
        "mcp__duet",
        "--append-system-prompt-file",
        files.system,
      ];
      if (getChat().models.claude) args.push("--model", getChat().models.claude as string);
      if (getChat().effort) args.push("--effort", getChat().effort);
      if (session) args.push("--resume", session);
    }
    await invoke("agent_run", { program: agent, args, input: agent === "agy" ? agyInput : `${past}${prompt}`, cwd: `${home}/agent-workspace`, run: r.id });
  } catch (e) {
    ended(r);
    addMsg({ role: "error", text: friendly(String(e)) }, r.where);
  }
}

/** Stop the main chat's AI, or a task's when its key is given. */
export async function stopAgent(key?: string) {
  const id = key ?? CHAT;
  const r = runs.get(id);
  try {
    await invoke("agent_cancel", { run: id });
  } catch {
    /* nothing running */
  }
  // The run normally ends when the tool's output closes. A helper the tool left behind can keep it
  // open, and Stop would look dead, so if the end has not come, end it here.
  await new Promise((res) => setTimeout(res, 1200));
  if (!r || !r.live || runs.get(id) !== r) return;
  ended(r);
  addMsg({ role: "note", text: "Stopped." }, r.where);
  keepIt();
}

/** A task is closed: its AI stops if it was at work. */
export async function closeTask(key: string) {
  if (runs.has(key)) await stopAgent(key);
  removeTask(key);
}

/**
 * Before another project is opened. The AI works on whatever design is open, so it must not carry on
 * into the next one. If it is in the middle of something the designer decides: let it finish here,
 * or stop it. Returns false to stay.
 */
export async function readyToLeave(closing = false, project = conversationProject()): Promise<boolean> {
  if (getChat().busy !== project) return true;
  const go = await ask(closing ? "Duet is still working on this design. Stop it and close the project?" : "Duet is still working on this design. Stop it and open the other project?", {
    title: "Duet",
    kind: "warning",
    okLabel: closing ? "Stop and close" : "Stop and open",
    cancelLabel: "Let it finish",
  });
  if (!go) return false;
  // it may have finished while the question was up
  if (getChat().busy !== project) return true;
  const r = chatRun();
  if (r) r.live = false;
  await stopAgent();
  if (r) ended(r);
  addMsg({ role: "note", text: closing ? "Stopped, because you closed the project." : "Stopped, because you opened another project." }, r?.where ?? project);
  return true;
}

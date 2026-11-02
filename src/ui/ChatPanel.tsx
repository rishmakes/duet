import { OUTSIDE, isOutside, toolLabel } from "../ai/who";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { detectAgent, sendToAgent, sendToTask, stopAgent } from "../ai/agent";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../project/project";
import { AGENTS, CLAUDE_MODELS, EFFORTS, EFFORT_NAMES, answerApproval, nameAgents, removePicture, renameAgent, tookLine, setEffort, setModel, newTask, setAgent, setMinimized, setMode, showThread, updateMsg, useChat } from "../ai/chat";
import { giveNames, nameOf } from "../ai/names";
import { chatHistory, findInHistory } from "./chatHistory";
import type { Found, Item } from "./chatHistory";
import type { AgentId } from "../ai/chat";
import { attachFiles } from "../ai/pictures";
import type { ModelChoice, Mode } from "../ai/chat";
import { applyProposal, undoAiStep } from "../ai/tools";
import { goTo, setFocus, useStore } from "../state/store";
import { directionOf, parentOf, startsDirection } from "../state/directions";
import ConnectAi from "./ConnectAi";
import Rich from "./rich";
import Icon from "./Icons";
import { CHAT_MIN, setLayout, useLayout } from "./layout";
import type { Corner } from "./layout";
import { agentColour, whoColour } from "../ai/colours";
import { busyOutside, seenOutside } from "../ai/outside";
import { useDismiss } from "./useDismiss";
import { pickWaitingLine } from "../ai/waitingLines";

const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: "suggest", label: "Suggest", hint: "Duet only suggests. Nothing changes until you tap Apply." },
  { mode: "ask", label: "Ask first", hint: "Duet makes design changes. It asks before deleting anything or bringing in a file." },
  { mode: "auto", label: "Auto", hint: "Duet does what you ask on its own. You can undo any step." },
];

/** What the chips say, and what each one asks. */
const IDEAS = [
  { label: "Describe this design", ask: "Describe this design" },
  { label: "Tidy the spacing", ask: "Tidy the spacing" },
  { label: "Check text contrast", ask: "Check text contrast" },
  { label: "Trace a picture", ask: "Trace the selected picture into shapes I can edit. If nothing is selected, tell me which picture to trace." },
];

/** How many changes show when a group is opened, before "and more". */
const FIRST_CHANGES = 5;

const FOUND_KIND: Record<Found["kind"], string> = { said: "Said", change: "Change", version: "Version", name: "AI" };

function renderYouText(content: string, membersList: { name: string; tool: string }[]) {
  const parts = content.split(/(@[A-Za-z0-9_-]+)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("@") && part.length > 1) {
      const word = part.slice(1).toLowerCase();
      const flat = (n: string) => n.replace(/\s+/g, "").toLowerCase();
      const hit = membersList.find((m) => flat(m.name).startsWith(word)) ?? membersList.find((m) => flat(m.tool).startsWith(word)) ?? AGENTS.map((a) => ({ tool: a.name })).find((a) => flat(a.tool).startsWith(word));
      if (hit) {
        return (
          <span key={idx} style={{ color: agentColour(hit.tool), fontWeight: "bold" }}>
            {part}
          </span>
        );
      }
    }
    return part;
  });
}

type ResizeHandle = "t" | "b" | "l" | "r" | "tl" | "tr" | "bl" | "br";

const HANDLES: { pos: ResizeHandle; cls: string }[] = [
  { pos: "tl", cls: "corner t l" },
  { pos: "t", cls: "edge t" },
  { pos: "tr", cls: "corner t r" },
  { pos: "r", cls: "edge r" },
  { pos: "br", cls: "corner b r" },
  { pos: "b", cls: "edge b" },
  { pos: "bl", cls: "corner b l" },
  { pos: "l", cls: "edge l" },
];

/** Antigravity's models, asked for once: starting the tool takes seconds, and the chat is built again each time you switch to it. */
let agyModelsAsked: Promise<ModelChoice[]> | null = null;
function agyModelList(): Promise<ModelChoice[]> {
  agyModelsAsked ??= invoke<ModelChoice[]>("agent_models", { program: "agy" })
    .then((list) => [{ id: "", name: "Default" }, ...list])
    .catch(() => {
      agyModelsAsked = null; // try again next time
      return [{ id: "", name: "Default" }];
    });
  return agyModelsAsked;
}

/** `docked` fills the space it is given, as the middle of Chat; otherwise it floats on the canvas. */
export default function ChatPanel({ docked = false }: { docked?: boolean }) {
  // the main chat, or the task on show
  const task = useChat((s) => (s.thread ? s.tasks.find((t) => t.key === s.thread) : undefined));
  const mainMessages = useChat((s) => s.messages);
  const messages = task ? task.messages : mainMessages;
  const mode = useChat((s) => s.mode);
  const mainRunning = useChat((s) => s.running);
  const running = task ? task.running : mainRunning;
  const folded = useChat((s) => s.minimized);
  const minimized = folded && !docked;
  const found = useChat((s) => s.agentFound);
  const mainAgent = useChat((s) => s.agent);
  const agent = task ? task.agent : mainAgent;
  const installed = useChat((s) => s.installed);
  const models = useChat((s) => s.models);
  const effort = useChat((s) => s.effort);
  const pictures = useChat((s) => s.pictures);
  const cursor = useStore((s) => s.cursor);
  const projectName = useStore((s) => s.project.name);
  // each selector hands back something that only changes when the thing itself changes; a fresh list here would loop forever
  const focus = useStore((s) => s.focus);
  const focusEls = useStore((s) => s.timeline[s.cursor].doc.elements);
  const focusNames = focus.filter((id) => focusEls[id]).map((id) => focusEls[id].name);
  const timeline = useStore((s) => s.timeline);
  const given = useChat((s) => s.names);
  // what was said, every change and every version, on one line
  const items = chatHistory(messages, timeline, !task);
  // a design with any history is not a blank start, even before anyone writes here
  const isEmpty = docked && items.length === 0;
  const place = useLayout((d) => d.chat);
  const chatW = useLayout((d) => d.chatW);
  const chatH = useLayout((d) => d.chatH);

  const [connecting, setConnecting] = useState(false);
  const [pictureNote, setPictureNote] = useState<string | null>(null);
  const [agyModels, setAgyModels] = useState<ModelChoice[]>([]);
  const [sizing, setSizing] = useState<{ w: number; h: number; x?: number; y?: number } | null>(null);
  const [moving, setMoving] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState("");
  const [room, setRoom] = useState<number | null>(null);
  const [busyName, setBusyName] = useState<string | null>(() => busyOutside());
  /** An AI from outside that looked or worked here lately, shown before it has changed anything. */
  const [seenName, setSeenName] = useState<string | null>(() => seenOutside());
  const [litStep, setLitStep] = useState<string | null>(null);
  const [popOpen, setPopOpen] = useState(false);
  // model and effort stay folded until asked for, so the menu is only who answers
  const [tuneOpen, setTuneOpen] = useState(false);
  useEffect(() => setTuneOpen(false), [popOpen]);
  const [permOpen, setPermOpen] = useState(false);
  /** Groups of changes opened, and those showing all their changes. */
  const [openGroups, setOpenGroups] = useState<Record<string, "open" | "all">>({});
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** The AI being renamed, by its tool, and the name typed so far. */
  const [renaming, setRenaming] = useState<{ tool: string; name: string } | null>(null);
  const itemsRef = useRef<Item[]>(items);
  itemsRef.current = items;

  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The New task menu, and the AI picked in it. */
  const [taskPick, setTaskPick] = useState<AgentId | null>(null);
  const [mentionHidden, setMentionHidden] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);

  const chatTool = AGENTS.find((a) => a.id === agent)?.name || "AI";
  // an AI from its own window is kept apart from the chat's own, so it shows under its own name
  const workingTool = running ? chatTool : busyName && busyName + OUTSIDE;
  const isWorking = Boolean(workingTool);
  const [waitingLine, setWaitingLine] = useState("");
  const workStartRef = useRef<number | null>(null);
  const lastLineRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isWorking) {
      workStartRef.current = null;
      lastLineRef.current = null;
      setWaitingLine("");
      return;
    }

    workStartRef.current = Date.now();
    const first = pickWaitingLine();
    lastLineRef.current = first;
    setWaitingLine(first);

    const interval = setInterval(() => {
      const elapsed = workStartRef.current ? Date.now() - workStartRef.current : 0;
      const next = pickWaitingLine(lastLineRef.current ?? undefined, elapsed);
      lastLineRef.current = next;
      setWaitingLine(next);
    }, 6000);

    return () => clearInterval(interval);
  }, [isWorking, workingTool]);

  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const justMoved = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const litTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useDismiss(popOpen, () => setPopOpen(false), ".agent-pop, [data-name='agent-button'], [data-name='members']");
  useDismiss(permOpen, () => setPermOpen(false), ".perm-pop, [data-name='perm-button']");
  useDismiss(settingsOpen, () => setSettingsOpen(false), ".chat-settings, [data-name='chat-settings']");
  useDismiss(taskPick !== null, () => setTaskPick(null), ".task-pop, [data-name='new-task']");
  useDismiss(findOpen && !query, () => setFindOpen(false), ".chat-find, [data-name='chat-find']");

  useEffect(() => {
    if (minimized) {
      setPopOpen(false);
      setPermOpen(false);
      setSettingsOpen(false);
    }
  }, [minimized]);

  useEffect(() => {
    if (agent !== "agy" || agyModels.length || !inTauri()) return;
    let alive = true;
    agyModelList().then((list) => alive && setAgyModels(list));
    return () => {
      alive = false;
    };
  }, [agent, agyModels.length]);

  // the list of installed AI tools is looked for again if it is ever empty, so nobody is left with no one to ask
  const nobody = Object.keys(installed).length === 0;
  useEffect(() => {
    if (nobody && inTauri()) void detectAgent();
  }, [nobody]);

  useEffect(() => {
    const onDraft = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      if (detail?.text) {
        setText(detail.text);
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    };
    window.addEventListener("duet:chat-draft", onDraft);
    return () => window.removeEventListener("duet:chat-draft", onDraft);
  }, []);

  const dragging = moving !== null;
  useLayoutEffect(() => {
    const el = box.current;
    const parent = el?.parentElement;
    if (!el || !parent || minimized) return;
    const hangs = dragging || !("corner" in place) || place.corner.startsWith("t");
    const measure = () => {
      const body = list.current;
      if (!body) return;
      let rest = el.offsetHeight - el.clientHeight; // the border
      for (const c of Array.from(el.children) as HTMLElement[]) if (c !== body && !c.classList.contains("csize") && !c.classList.contains("chat-start-spacer")) rest += c.offsetHeight;
      // hanging from the top it must stop above the bottom edge; sitting on the bottom it may reach up to the top
      const space = docked ? parent.clientHeight : hangs ? parent.clientHeight - el.offsetTop - 16 : parent.clientHeight - 32;
      const next = Math.max(48, Math.floor(space - rest));
      setRoom((was) => (was === next ? was : next));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(parent);
    watch.observe(el);
    return () => watch.disconnect();
  }, [minimized, place, dragging, docked]);

  useEffect(() => {
    if (list.current) list.current.scrollTop = connecting ? 0 : list.current.scrollHeight;
  }, [messages, items.length, minimized, room, sizing, chatH, connecting, isWorking]);

  useEffect(() => setConnecting(false), [messages.length]);

  useEffect(() => {
    const timer = setInterval(() => {
      setBusyName(busyOutside());
      setSeenName(seenOutside());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onShowRequest = (ev: Event) => {
      const step = (ev as CustomEvent<string | undefined>).detail;
      if (!step) return;
      setMinimized(false);
      setLitStep(step);
      const group = itemsRef.current.find((i) => i.kind === "changes" && i.changes.some((c) => c.step === step));
      if (group) setOpenGroups((g) => ({ ...g, [group.key]: "all" }));
      if (litTimer.current) clearTimeout(litTimer.current);
      litTimer.current = setTimeout(() => {
        setLitStep(null);
      }, 1500);
      const scrollAndLight = () => {
        const el = list.current?.querySelector<HTMLElement>(`[data-step="${step}"]`);
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          el.classList.add("lit");
          setTimeout(() => el.classList.remove("lit"), 1500);
        }
      };
      setTimeout(scrollAndLight, 50);
    };
    window.addEventListener("duet:show-request", onShowRequest);
    return () => {
      window.removeEventListener("duet:show-request", onShowRequest);
      if (litTimer.current) clearTimeout(litTimer.current);
    };
  }, []);

  /** Go to something found: open its group, bring it into view and light it for a moment. */
  const jump = (f: Found) => {
    if (f.group) setOpenGroups((g) => ({ ...g, [f.group as string]: "all" }));
    setFindOpen(false);
    setQuery("");
    setTimeout(() => {
      const el = list.current?.querySelector<HTMLElement>(`[data-key="${f.key}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("lit");
      setTimeout(() => el.classList.remove("lit"), 1500);
    }, 60);
  };

  const waiting = pictures.filter((p) => !p.sent);
  const attach = (files: File[]) => void attachFiles(files).then(setPictureNote);

  /**
   * Pull any edge or corner: that side follows the hand, the opposite side stays still, and the chat
   * stops only at the edges of the canvas. A side that pulls away from the corner the chat sits in
   * lets go of the corner, so the far side stays where it was.
   */
  const resize = (e: React.PointerEvent, handle: ResizeHandle) => {
    if (minimized || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = box.current;
    const parent = el?.parentElement;
    const body = list.current;
    if (!el || !parent || !body) return;
    const b = el.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    // everything around the message area keeps its height while the chat is pulled
    const around = b.height - body.offsetHeight;
    const from = { x: e.clientX, y: e.clientY, l: b.left - p.left, t: b.top - p.top, r: b.right - p.left, b: b.bottom - p.top };
    const corner = "corner" in place ? place.corner : null;
    const free = !corner || handle.includes(corner[0]) || handle.includes(corner[1]);
    const EDGE = 16;
    const at = (m: PointerEvent) => {
      const dx = m.clientX - from.x;
      const dy = m.clientY - from.y;
      let { l, t, r, b: btm } = from;
      if (handle.includes("l")) l = Math.max(EDGE, Math.min(r - CHAT_MIN.w, l + dx));
      if (handle.includes("r")) r = Math.min(p.width - EDGE, Math.max(l + CHAT_MIN.w, r + dx));
      if (handle.includes("t")) t = Math.max(EDGE, Math.min(btm - CHAT_MIN.h - around, t + dy));
      if (handle.includes("b")) btm = Math.min(p.height - EDGE, Math.max(t + CHAT_MIN.h + around, btm + dy));
      return { w: Math.round(r - l), h: Math.round(btm - t - around), x: Math.round(l), y: Math.round(t) };
    };
    const move = (m: PointerEvent) => {
      const next = at(m);
      setSizing(free ? next : { w: next.w, h: next.h });
    };
    const up = (m: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const next = at(m);
      setSizing(null);
      setLayout(free ? { chat: { x: next.x, y: next.y }, chatW: next.w, chatH: next.h } : { chatW: next.w, chatH: next.h });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const w = sizing?.w ?? chatW;
  const h = sizing?.h ?? chatH;

  const grab = (e: React.PointerEvent) => {
    if ((e.target as Element).closest(".mode") || e.button !== 0) return;
    const el = box.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const b = el.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    const start = { px: e.clientX, py: e.clientY, ox: b.left - p.left, oy: b.top - p.top };
    let dragged = false;
    const at = (m: PointerEvent) => ({
      x: Math.max(0, Math.min(p.width - b.width, start.ox + m.clientX - start.px)),
      y: Math.max(0, Math.min(p.height - b.height, start.oy + m.clientY - start.py)),
    });
    const move = (m: PointerEvent) => {
      if (!dragged && Math.hypot(m.clientX - start.px, m.clientY - start.py) < 5) return;
      dragged = true;
      setMoving(at(m));
    };
    const up = (m: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragged) return;
      justMoved.current = true;
      setTimeout(() => (justMoved.current = false), 0);
      const pos = at(m);
      const near = 110;
      const left = pos.x < near;
      const right = p.width - (pos.x + b.width) < near;
      const top = pos.y < near;
      const bottom = p.height - (pos.y + b.height) < near;
      setMoving(null);
      if ((left || right) && (top || bottom)) setLayout({ chat: { corner: `${top ? "t" : "b"}${left ? "l" : "r"}` as Corner } });
      else setLayout({ chat: { x: pos.x, y: pos.y } });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const chosenAgentObj = AGENTS.find((a) => a.id === agent);
  // with nothing installed, the button must not name a tool that is not there
  const toolName = found === false ? "No AI installed" : chosenAgentObj?.name || "AI";

  const outsideAgents: string[] = [];
  for (const e of timeline) {
    if (e.actor === "ai" && e.by && isOutside(e.by) && !outsideAgents.includes(e.by)) outsideAgents.push(e.by);
  }
  if (seenName && !outsideAgents.includes(seenName + OUTSIDE)) outsideAgents.push(seenName + OUTSIDE);

  const members = AGENTS.filter((a) => a.runnable && Boolean(installed[a.id]));

  // an AI keeps its name once it has said or changed something here; until then it shows the name it will get
  const acted: string[] = [];
  for (const m of messages) if (m.role === "duet" && m.by && !acted.includes(m.by)) acted.push(m.by);
  for (const e of timeline) if (e.actor === "ai" && e.by && !acted.includes(e.by)) acted.push(e.by);
  const actedKey = acted.join("|");
  useEffect(() => {
    if (actedKey) nameAgents(actedKey.split("|"));
  }, [actedKey]);
  const names = giveNames([...acted, toolName, ...members.map((m) => m.name), ...outsideAgents], given);
  /** The name an AI goes by here: "Juniper". */
  const nm = (tool: string | undefined) => nameOf(tool, names) || "AI";
  const chatName = found === false ? toolName : nm(toolName);
  const modelChoices = agent === "agy" ? (agyModels.length ? agyModels : [{ id: "", name: "Default" }]) : CLAUDE_MODELS;
  const modelName = models[agent] ? modelChoices.find((m) => m.id === models[agent])?.name : undefined;
  // what each AI will use, written under its name in the picker
  const usesLine = (id: AgentId) => {
    const choices = id === "agy" ? agyModels : CLAUDE_MODELS;
    const model = models[id] ? (choices.find((c) => c.id === models[id])?.name ?? models[id]) : "Default model";
    return id === "claude" && effort ? `${model} · ${EFFORT_NAMES[effort]} effort` : model;
  };

  // every badge opens the one place to pick who answers
  const openPicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (minimized) setMinimized(false);
    setPopOpen(true);
    setPermOpen(false);
    setSettingsOpen(false);
  };

  const mentionMatch = text.match(/@([A-Za-z]*)$/);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const matchingMembers = mentionQuery !== null
    ? members.filter((m) => m.name.toLowerCase().startsWith(mentionQuery) || nm(m.name).toLowerCase().startsWith(mentionQuery))
    : [];
  const showMentions = !mentionHidden && mentionMatch !== null && matchingMembers.length > 0;
  const activeMentionIdx = Math.min(mentionIndex, Math.max(0, matchingMembers.length - 1));

  const insertMention = (m: (typeof AGENTS)[number]) => {
    const replacement = "@" + nm(m.name).replace(/\s+/g, "") + " ";
    const next = text.replace(/@[A-Za-z]*$/, replacement);
    setText(next);
    setMentionHidden(false);
    setMentionIndex(0);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = next.length;
      }
    }, 0);
  };

  const send = (t: string) => {
    if ((!t.trim() && !waiting.length) || running) return;
    setText("");
    setPictureNote(null);
    void (task ? sendToTask(task.key, t) : sendToAgent(t));
  };

  // the direction you are on; what was done in another one is shown quieter
  const line = directionOf(timeline, cursor);
  const other = (at: number) => at >= 0 && !line.has(at);
  const later = (at: number) => at > cursor && !other(at);
  const laterTitle = "This comes after the moment you are looking at";
  const otherTitle = "This was done in another direction. Click a change to go back to it";
  const fork = (at: number) => (at >= 0 && startsDirection(timeline, at) ? timeline[parentOf(timeline, at)]?.label : undefined);

  /** An AI's name in its colour, then the tool it is. Click the name to rename it. */
  const authorLine = (tool: string) => {
    const colour = agentColour(tool);
    if (renaming?.tool === tool)
      return (
        <input
          className="m-rename"
          autoFocus
          value={renaming.name}
          style={{ color: colour }}
          onChange={(e) => setRenaming({ tool, name: e.target.value })}
          onBlur={() => {
            renameAgent(tool, renaming.name);
            setRenaming(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setRenaming(null);
          }}
        />
      );
    return (
      <>
        <span className="m-author-name" style={{ color: colour }} title="Click to rename" onClick={() => setRenaming({ tool, name: nm(tool) })}>
          {nm(tool)}
        </span>
        <span className="m-author-tool">
          {tool}
          {task ? " · task" : ""}
        </span>
      </>
    );
  };

  /** Changes sit on the line as dots. Several fold into one, opened on click; each opens the design at that moment. */
  const renderChanges = (item: Extract<Item, { kind: "changes" }>) => {
    const colour = item.actor === "you" ? "var(--text)" : whoColour("ai", item.by);
    const count = item.changes.length;
    const who = item.actor === "you" ? "You" : isOutside(item.by) ? `${nm(item.by)} · ${toolLabel(item.by as string)}` : "";
    const shown = count === 1 ? "all" : openGroups[item.key];
    const allLater = item.changes.every((c) => later(c.at));
    const allOther = item.changes.every((c) => other(c.at));
    const forkedFrom = item.changes.map((c) => fork(c.at)).find((f) => f !== undefined);
    const forkLine = forkedFrom !== undefined && (
      <div key={`${item.key}-fork`} className={`hl-fork ${allOther ? "other" : ""}`}>
        New direction, from “{forkedFrom}”
      </div>
    );
    if (!shown)
      return [
        forkLine,
        <div key={item.key} data-key={item.key} className={`hl-changes ${allLater ? "later" : ""} ${allOther ? "other" : ""}`} style={{ ["--who" as string]: colour }} title={allOther ? otherTitle : allLater ? laterTitle : undefined}>
          <span className="hl-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <button type="button" className="hl-chip" onClick={() => setOpenGroups((g) => ({ ...g, [item.key]: "open" }))}>
            <span>
              {allOther ? "Another direction · " : who ? `${who} · ` : ""}
              {count} changes
            </span>
            <svg width={9} height={9} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 3.5l3 3 3-3" />
            </svg>
          </button>
        </div>,
      ];
    const list = shown === "all" ? item.changes : item.changes.slice(0, FIRST_CHANGES);
    const rest = count - list.length;
    return [
      forkLine,
      <div key={item.key} data-key={item.key} className={`hl-changes open ${allOther ? "other" : ""}`} style={{ ["--who" as string]: colour }}>
        {who && <div className="hl-who">{who}</div>}
        {list.map((c) => {
          const m = c.msg;
          const gone = c.at < 0 || !!m?.undone;
          return (
            <div
              key={c.key}
              data-key={c.key}
              data-step={c.step}
              className={`hl-change ${c.at === cursor ? "now" : ""} ${later(c.at) ? "later" : ""} ${other(c.at) ? "other" : ""} ${gone ? "gone" : ""} ${c.step && litStep === c.step ? "lit" : ""}`}
              title={gone ? undefined : c.at === cursor ? "The design is at this moment" : other(c.at) ? "Go back to this direction, at this moment" : "See the design at this moment"}
              onClick={() => !gone && goTo(c.at)}
            >
              <i className="hl-dot" aria-hidden="true" />
              <span>{c.text}</span>
              {m && !gone && c.at === cursor && m.undoStep === cursor && cursor === timeline.length - 1 && (
                <span
                  className="undo"
                  onClick={(e) => {
                    e.stopPropagation();
                    undoAiStep(m.id);
                  }}
                >
                  Undo
                </span>
              )}
              {m?.undone && <em> Undone</em>}
            </div>
          );
        })}
        {count > 1 && (
          <div className="hl-more">
            {rest > 0 && (
              <>
                <span onClick={() => setOpenGroups((g) => ({ ...g, [item.key]: "all" }))}>and {rest} more</span>
                {" · "}
              </>
            )}
            <span
              onClick={() =>
                setOpenGroups((g) => {
                  const next = { ...g };
                  delete next[item.key];
                  return next;
                })
              }
            >
              Fold
            </span>
          </div>
        )}
      </div>,
    ];
  };

  const hits = findOpen ? findInHistory(items, query, nm) : [];

  return (
    <div
      ref={box}
      className={`chat ${docked ? "docked" : ""} ${isEmpty ? "is-empty" : ""} ${minimized ? "min" : ""} ${moving ? "moving free" : sizing?.x !== undefined ? "free" : "corner" in place ? `c-${place.corner}` : "free"}`}
      style={{
        ...(moving
          ? { left: moving.x, top: moving.y }
          : sizing?.x !== undefined && sizing?.y !== undefined
          ? { left: sizing.x, top: sizing.y }
          : "x" in place
          ? { left: place.x, top: place.y }
          : {}),
        width: w,
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        // a picture dropped on the chat is for the AI to look at; dropped on the canvas it joins the design
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setMinimized(false);
        attach(Array.from(e.dataTransfer.files));
      }}
    >
      <div
        className="chead"
        onPointerDown={docked ? undefined : grab}
        title="Drag to move me. Let go near a corner and I will snap there."
        onClick={() => !justMoved.current && setMinimized(!minimized)}
      >
        <div className="ctitle">
          {task ? (
            <>
              <button
                type="button"
                className="task-back"
                title="Back to the main chat"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  showThread(null);
                }}
              >
                Chat
              </button>
              <span className="task-sep">/</span>
              <b className="task-title">{task.title || "New task"}</b>
            </>
          ) : (
            <b>Chat</b>
          )}
        </div>
        <button
          type="button"
          className="chat-new-btn"
          data-name="new-task"
          disabled={members.length === 0}
          title="Start a side task with one AI. It works by itself, beside this chat."
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (minimized) setMinimized(false);
            setTaskPick(taskPick === null ? (members.find((m) => m.id === mainAgent)?.id ?? members[0]?.id ?? null) : null);
            setPopOpen(false);
            setSettingsOpen(false);
          }}
        >
          <Icon name="new-chat" size={13} />
          <span>New task</span>
        </button>
        {taskPick !== null && (
          <div className="agent-pop task-pop" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <div className="agent-pop-label">Who works on it?</div>
            <div className="who-answers-list">
              {members.map((m) => (
                <div key={m.id} className={`who-answer-row ${m.id === taskPick ? "active" : ""}`} onClick={() => setTaskPick(m.id)}>
                  <span className="member-badge" style={{ backgroundColor: agentColour(m.name) }}>
                    {nm(m.name).charAt(0)}
                  </span>
                  <span className="who-answer-name">
                    <b>{nm(m.name)}</b>
                    <small>{m.name}</small>
                  </span>
                </div>
              ))}
            </div>
            <div className="agent-pop-empty">It works on its own beside this chat. You can start more than one at a time.</div>
            <button
              type="button"
              className="mini primary task-start"
              onClick={() => {
                newTask(taskPick);
                setTaskPick(null);
                setTimeout(() => textareaRef.current?.focus(), 0);
              }}
            >
              Start
            </button>
          </div>
        )}
        <div
          className="members-cluster"
          data-name="members"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {members.map((m) => {
            const isAnswers = m.id === agent;
            return (
              <div
                key={m.id}
                className={`member-badge ${isAnswers ? "answers-ring" : ""} ${isAnswers && running ? "answering" : ""}`}
                style={{ backgroundColor: agentColour(m.name), ["--who" as string]: agentColour(m.name) }}
                title={`${nm(m.name)} · ${m.name}`}
                onClick={openPicker}
              >
                {nm(m.name).charAt(0)}
              </div>
            );
          })}
          {/* the same tool opened in its own window is another AI, so it gets its own badge and its own name */}
          {outsideAgents.map((by) => (
            <div
              key={by}
              className={`member-badge outside ${workingTool === by ? "answering" : ""}`}
              style={{ backgroundColor: agentColour(by), ["--who" as string]: agentColour(by) }}
              title={`${nm(by)} · ${toolLabel(by)}`}
              onClick={openPicker}
            >
              {nm(by).charAt(0)}
            </div>
          ))}

        </div>

        <button
          type="button"
          className={`chat-settings-btn ${findOpen ? "on" : ""}`}
          data-name="chat-find"
          title="Search what was said, the changes, the versions and the AIs"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (minimized) setMinimized(false);
            setFindOpen((o) => !o);
            setQuery("");
            setSettingsOpen(false);
            setPopOpen(false);
          }}
        >
          <Icon name="search" size={14} />
        </button>
        <button
          type="button"
          className="chat-settings-btn"
          data-name="chat-settings"
          title="More"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (minimized) setMinimized(false);
            setSettingsOpen((o) => !o);
            setPopOpen(false);
          }}
        >
          <Icon name="dots" size={14} />
        </button>


        {settingsOpen && (
          <div
            className="chat-settings"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="chat-settings-section">
              <div className="agent-pop-label">How much agents may do</div>
              <div className="mode">
                {MODES.map((m) => (
                  <span
                    key={m.mode}
                    className={mode === m.mode ? "on" : ""}
                    title={m.hint}
                    onClick={() => setMode(m.mode)}
                  >
                    {m.label}
                  </span>
                ))}
              </div>
              <div className="mode-hint" style={{ padding: "6px 0 0" }}>
                {MODES.find((m) => m.mode === mode)?.hint}
              </div>
            </div>

            <div className="chat-settings-section">
              <div
                className="agent-pop-link connect-link"
                onClick={() => {
                  setConnecting((c) => !c);
                  setSettingsOpen(false);
                }}
              >
                Add another AI tool
              </div>
            </div>
          </div>
        )}
      </div>

      {!minimized && findOpen && (
        <div className="chat-find">
          <input
            autoFocus
            value={query}
            placeholder="Search messages, changes, versions, AIs"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setFindOpen(false);
              if (e.key === "Enter" && hits[0]) jump(hits[0]);
            }}
          />
          {query.trim() && (
            <div className="chat-find-list">
              {hits.map((f) => (
                <div key={`${f.kind}-${f.key}`} className="chat-find-row" onClick={() => jump(f)}>
                  <small>{FOUND_KIND[f.kind]}</small>
                  <span>{f.text}</span>
                </div>
              ))}
              {hits.length === 0 && <div className="chat-find-empty">Nothing found</div>}
            </div>
          )}
        </div>
      )}
      {!minimized && (
        <>
          {HANDLES.map((hnd) => (
            <div
              key={hnd.pos}
              className={`csize ${hnd.cls}`}
              onPointerDown={(e) => resize(e, hnd.pos)}
              title="Pull to make the chat bigger or smaller"
            />
          ))}
          <div className="cbody" ref={list} style={{ height: sizing ? h : room === null ? h : Math.min(h, room) }}>
            {connecting && <ConnectAi />}
            {found === false && (
              <div className="m">
                Duet works with the AI tool you already use, so it costs nothing extra. No AI tool is installed on this computer yet.
                Install {AGENTS.filter((a) => a.runnable).map((a) => `${a.name} from ${a.install}`).join(" or ")}, sign in once, then reopen Duet.
              </div>
            )}
            {!docked && items.length === 0 && found !== false && (
              <div className="m greeting">
                <span className="member-badge" style={{ backgroundColor: agentColour(toolName) }}>
                  {chatName.charAt(0)}
                </span>
                Hey, {chatName} here, using {toolName}. Tell me what to make or change. I can see what is selected on your canvas.
              </div>
            )}
            <div className="hl">
            {items.map((item) => {
              if (item.kind === "changes") return renderChanges(item);
              if (item.kind === "version")
                return (
                  <div
                    key={item.key}
                    data-key={item.key}
                    className={`hl-version ${later(item.at) ? "later" : ""} ${other(item.at) ? "other" : ""} ${item.at === cursor ? "now" : ""}`}
                    title="See the design at this version"
                    onClick={() => goTo(item.at)}
                  >
                    <i className="hl-square" aria-hidden="true" />
                    Version saved: <b>{item.name}</b>
                  </div>
                );
              const m = item.msg;
              const isOther = m.undoStep !== undefined && m.undoStep < timeline.length && other(m.undoStep);
              const isLater = isOther || (m.undoStep !== undefined && later(m.undoStep));
              const isLit = litStep === m.step;
              const title = isOther ? otherTitle : isLater ? laterTitle : undefined;

              if (m.role === "you")
                return (
                  <div
                    key={m.id}
                    data-key={item.key}
                    data-step={m.step}
                    className={`m you ${isLater ? "later" : ""} ${isLit ? "lit" : ""}`}
                    title={title}
                  >
                    <div className="m-author">
                      <span className="m-badge you-badge">Y</span>
                      <span className="m-author-name">You</span>
                    </div>
                    {m.pictures && (
                      <div className="pics">
                        {m.pictures.map((n) => {
                          const p = pictures.find((x) => x.n === n);
                          if (p && p.text !== undefined) return <span key={n} className="pic-text" title={p.name}>{p.name}</span>;
                          return p ? <img key={n} src={p.thumb} alt={p.name} title={p.name} /> : <span key={n} className="pic-gone" title="This picture is no longer kept" />;
                        })}
                      </div>
                    )}
                    <div className="m-body">{renderYouText(m.text, members.map((x) => ({ name: nm(x.name), tool: x.name })))}</div>
                  </div>
                );
              if (m.role === "error")
                return (
                  <div
                    key={m.id}
                    data-key={item.key}
                    data-step={m.step}
                    className={`m err ${isLater ? "later" : ""} ${isLit ? "lit" : ""}`}
                    title={title}
                  >
                    {m.text}
                  </div>
                );
              if (m.proposal)
                return (
                  <div
                    key={m.id}
                    data-key={item.key}
                    data-step={m.step}
                    className={`m card ${isLater ? "later" : ""} ${isLit ? "lit" : ""}`}
                    title={title}
                  >
                    <div className="tagline">Suggestion</div>
                    {m.proposal.summary}
                    <div className="act">
                      {m.proposal.status === "open" ? (
                        <>
                          <span onClick={() => applyProposal(m.id)}>Apply</span>
                          <span onClick={() => updateMsg(m.id, { proposal: { ...m.proposal!, status: "dismissed" } }, task?.key)}>Not now</span>
                        </>
                      ) : (
                        <em>{m.proposal.status === "applied" ? "Applied" : "Dismissed"}</em>
                      )}
                    </div>
                  </div>
                );
              if (m.approval)
                return (
                  <div
                    key={m.id}
                    data-key={item.key}
                    data-step={m.step}
                    className={`m card warn ${isLater ? "later" : ""} ${isLit ? "lit" : ""}`}
                    title={title}
                  >
                    <div className="tagline">Duet is asking</div>
                    {m.approval.summary}
                    <div className="act">
                      {m.approval.status === "waiting" ? (
                        <>
                          <span onClick={() => answerApproval(m.id, true)}>Allow</span>
                          <span onClick={() => answerApproval(m.id, false)}>Not now</span>
                        </>
                      ) : (
                        <em>{m.approval.status === "allowed" ? "Allowed" : "Not now"}</em>
                      )}
                    </div>
                  </div>
                );
              if (m.role === "note")
                return (
                  <div key={m.id} data-key={item.key} className="m note">
                    {m.text}
                  </div>
                );
              const tool = m.by || toolName;
              return (
                <div key={m.id} data-key={item.key} data-step={m.step} className={`m ai ${isLater ? "later" : ""} ${isLit ? "lit" : ""}`} title={title}>
                  <div className="m-author" title={m.took ? tookLine(m.took) : undefined}>
                    <span className="m-badge" style={{ backgroundColor: agentColour(tool) }}>
                      {nm(tool).charAt(0)}
                    </span>
                    {authorLine(tool)}
                  </div>
                  <div className="m-body">
                    <Rich text={m.text} />
                  </div>
                </div>
              );
            })}
            </div>
            {isWorking && workingTool && waitingLine && (
              <div className="chat-working-line">
                <span className="chat-working-tool" style={{ color: agentColour(workingTool) }}>{nm(workingTool)}</span>
                <span className="chat-working-which"> · {toolLabel(workingTool)}</span>: {waitingLine}
              </div>
            )}
          </div>

          {!docked && items.length === 0 && found !== false && (
            <div className="chips">
              {IDEAS.map((i) => (
                <span key={i.label} className="chip" onClick={() => send(i.ask)}>
                  {i.label}
                </span>
              ))}
            </div>
          )}

          {docked && found !== false && (
            <div className="chat-start-title" aria-hidden={!isEmpty}>
              {task ? `What should ${chatName} do?` : "What shall we make?"}
            </div>
          )}

          {(waiting.length > 0 || pictureNote) && (
            <div className="waiting">
              {waiting.map((p) => (
                <span key={p.n} className="pic" title={p.name}>
                  {p.text !== undefined ? <span className="pic-text">{p.name}</span> : <img src={p.thumb} alt={p.name} />}
                  <b onClick={() => removePicture(p.n)} title="Take this out">
                    ×
                  </b>
                </span>
              ))}
              {pictureNote && <em>{pictureNote}</em>}
            </div>
          )}
          {projectName && (!docked || !isEmpty) && <div className="working-on" title="The AI works on the project that is open here.">Working on: {projectName}</div>}
          {focusNames.length > 0 && (!docked || !isEmpty) && (
            <div className="focus-chip" title="The AI is told to work here. Nothing else is blocked. Press Tab on the canvas to change it.">
              <span>AI focus: {focusNames.slice(0, 3).join(", ")}{focusNames.length > 3 ? ` and ${focusNames.length - 3} more` : ""}</span>
              <button aria-label="Clear focus" onClick={() => setFocus([])}>×</button>
            </div>
          )}
          <div className="cfoot">
            <input
              ref={picker}
              type="file"
              accept="image/*,.md,.markdown,.txt,text/plain,text/markdown"
              multiple
              hidden
              onChange={(e) => {
                attach(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <div className="agent-anchor" data-name="model-row">
              <button
                type="button"
                className="agent-btn"
                data-name="agent-button"
                title={task ? "This task's AI" : "Who answers"}
                disabled={!!task}
                onClick={() => {
                  setPopOpen((o) => !o);
                  setPermOpen(false);
                  setSettingsOpen(false);
                }}
              >
                <span className="agent-btn-badge" style={{ backgroundColor: agentColour(toolName) }}>{chatName.charAt(0)}</span>
                <span className="agent-btn-name" title={found === false ? undefined : `${chatName} uses ${toolName}`}>{chatName}</span>
                {modelName && <span className="agent-btn-model">{modelName}</span>}
                <span className="agent-btn-v">
                  <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 3.5l3 3 3-3" />
                  </svg>
                </span>
              </button>
              <button
                type="button"
                data-name="perm-button"
                className={`agent-perm ${mode === "auto" ? "auto" : ""}`}
                title="How much agents may do"
                onClick={() => {
                  setPermOpen((o) => !o);
                  setPopOpen(false);
                }}
              >
                <span>{MODES.find((m) => m.mode === mode)?.label}</span>
                <span className="agent-btn-v">
                  <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 3.5l3 3 3-3" />
                  </svg>
                </span>
              </button>
              {permOpen && (
                <div className="agent-pop perm-pop">
                  <div className="agent-pop-label">How much agents may do</div>
                  <div className="who-answers-list">
                    {MODES.map((m) => (
                      <div
                        key={m.mode}
                        className={`perm-row ${m.mode === mode ? "active" : ""}`}
                        onClick={() => {
                          setMode(m.mode);
                          setPermOpen(false);
                        }}
                      >
                        <b>{m.label}</b>
                        <small>{m.hint}</small>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {popOpen && (
                <div className="agent-pop">
                  <div>
                    <div className="agent-pop-label">Who answers</div>
                    <div className="who-answers-list">
                      {members.map((m) => (
                        <div
                          key={m.id}
                          className={`who-answer-row ${m.id === agent ? "active" : ""}`}
                          style={{ ["--who" as string]: agentColour(m.name) }}
                          onClick={() => {
                            if (running) return;
                            setAgent(m.id);
                            setPopOpen(false);
                          }}
                        >
                          <span
                            className="member-badge"
                            style={{ backgroundColor: agentColour(m.name) }}
                          >
                            {nm(m.name).charAt(0)}
                          </span>
                          <span className="who-answer-name">
                            <b>
                              {nm(m.name)} <i className="who-answer-tool">{m.name}</i>
                            </b>
                            {m.id === agent ? (
                              <small
                                className="who-answer-tune"
                                title="Change the model and effort"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTuneOpen((o) => !o);
                                }}
                              >
                                {usesLine(m.id)} {tuneOpen ? "⌃" : "⌄"}
                              </small>
                            ) : (
                              <small>{usesLine(m.id)}</small>
                            )}
                          </span>
                          {m.id === agent && <span className="who-answer-tick">✓</span>}
                        </div>
                      ))}
                      {members.length === 0 && (
                        <div className="agent-pop-empty">No members installed.</div>
                      )}
                    </div>
                  </div>
                  {tuneOpen && members.some((m) => m.id === agent) && (
                    <div>
                      <div className="agent-pop-label">Model</div>
                      <div className="pick-choice wrap">
                        {modelChoices.map((m) => (
                          <button key={m.id} type="button" className={m.id === (models[agent] ?? "") ? "on" : ""} disabled={running} onClick={() => setModel(agent, m.id)}>
                            {m.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {tuneOpen && agent === "claude" && (
                    <div>
                      <div className="agent-pop-label">Effort{effort ? "" : " · it decides"}</div>
                      <div className="pick-choice" title="How hard it thinks. More effort takes longer and costs more. Click the chosen one again to let it decide.">
                        {EFFORTS.filter(Boolean).map((x) => (
                          <button key={x} type="button" className={x === effort ? "on" : ""} disabled={running} onClick={() => setEffort(x === effort ? "" : x)}>
                            {EFFORT_NAMES[x]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {members.length > 1 && <div className="agent-pop-empty">Or write @ and a name, like @{nm(members.find((x) => x.id !== agent)?.name)}, to ask another one once.</div>}
                </div>
              )}
            </div>
            <button className="mini attach" disabled={found === false} title="Attach a picture, or a text or Markdown brief, for the AI to look at. You can also paste or drop them here." onClick={() => picker.current?.click()}>
              <Icon name="plus" size={16} />
            </button>
            {showMentions && (
              <div className="mention-list">
                {matchingMembers.map((m, idx) => (
                  <div
                    key={m.id}
                    className={`mention-item ${idx === activeMentionIdx ? "selected" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(m);
                    }}
                  >
                    <span
                      className="member-badge"
                      style={{ backgroundColor: agentColour(m.name) }}
                    >
                      {nm(m.name).charAt(0)}
                    </span>
                    <span>
                      {nm(m.name)} <small>{m.name}</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={text}
              rows={1}
              placeholder={found === false ? "Install an AI tool to start" : task ? `Ask ${chatName} about this task` : `Ask ${chatName}`}
              disabled={found === false}
              onChange={(e) => {
                setText(e.target.value);
                setMentionHidden(false);
                setMentionIndex(0);
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
                if (!files.length) return;
                e.preventDefault();
                attach(files);
              }}
              onKeyDown={(e) => {
                if (showMentions) {
                  if (e.key === "Tab" || e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    const chosen = matchingMembers[activeMentionIdx] ?? matchingMembers[0];
                    if (chosen) insertMention(chosen);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setMentionHidden(true);
                    return;
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMentionIndex((i) => (i + 1) % matchingMembers.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMentionIndex((i) => (i - 1 + matchingMembers.length) % matchingMembers.length);
                    return;
                  }
                }
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(text);
                }
              }}
            />
            {running ? (
              <button className="mini primary send-round stop" title="Stop" aria-label="Stop" onClick={() => void stopAgent(task?.key)}>
                <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
                  <rect x={1} y={1} width={8} height={8} rx={1.5} fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                className="mini primary send-round"
                title="Send"
                aria-label="Send"
                style={{ backgroundColor: agentColour(toolName) }}
                disabled={(!text.trim() && !waiting.length) || found === false}
                onClick={() => send(text)}
              >
                <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 12V2M2.5 6.5L7 2l4.5 4.5" />
                </svg>
              </button>
            )}
          </div>
          {docked && found !== false && (
            <div className="chips chat-start-chips" aria-hidden={!isEmpty}>
              {IDEAS.map((i) => (
                <span key={i.label} className="chip" onClick={() => send(i.ask)}>
                  {i.label}
                </span>
              ))}
            </div>
          )}
          {docked && <div className="chat-start-spacer" />}
        </>
      )}
    </div>
  );
}

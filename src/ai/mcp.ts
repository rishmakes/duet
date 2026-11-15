import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { outsideRules } from "./rules";
import { outsideWorking } from "./outside";
import { TOOLS, callTool } from "./tools";
import { getChat, subscribeChat } from "./chat";
import { fromChat, OUTSIDE, toolName } from "./who";
import { recordStep, startTrace } from "./trace";

/** Answers the questions agents ask over MCP. Duet owns the design, so the answers come from here. */

interface Rpc {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** Antigravity starts every helper in its own list, even a switched off one, and some keep running after it stops and heat the computer. */
const ANTIGRAVITY_NOTE = `A note for Antigravity: do not start helper programs for other tools, such as Figma, for this job; Duet needs none of them. If the designer says the computer is hot or slow, tell them to look at Antigravity's list of connected tools and remove the ones they do not use.`;

let version = "";
/** Tools for building Duet itself. Only the build Duet is developed with loads them. */
let builder: typeof import("./builder") | null = null;

/** `client` is what the AI tool calls itself, passed on by the bridge or set by Duet's own chat. */
async function answer(rpc: Rpc, client?: string | null): Promise<unknown> {
  switch (rpc.method) {
    case "initialize":
      return {
        protocolVersion: (rpc.params?.protocolVersion as string) ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "duet", version },
        // an AI that connects from outside reads how to work here; Duet's own chat is told the same
        instructions: toolName(client) === "Antigravity" ? outsideRules() + "\n" + ANTIGRAVITY_NOTE : outsideRules(),
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: builder ? [...TOOLS, ...builder.BUILDER_TOOLS] : TOOLS };
    case "tools/call": {
      const name = String(rpc.params?.name ?? "");
      const tool = toolName(client);
      // the chat marks the AI it starts, even through the bridge, so the same tool opened in a terminal is told apart
      const chats = fromChat(client);
      // a step remembers who made it, and whether that AI worked from its own window
      const by = tool && !chats ? tool + OUTSIDE : tool;
      // an AI from outside shows as soon as it looks; only a change counts as working, and a builder tool as neither
      if (tool && !chats && !name.startsWith("dev_")) outsideWorking(tool, /^(get_|look_|select_)/.test(name));
      // a task's AI carries its task after a slash, so its changes are told in that task
      const thread = /\/(task:[\w-]+)$/.exec(client ?? "")?.[1];
      const began = performance.now();
      const at = Date.now();
      const result = builder?.isBuilderTool(name) ? await builder.callBuilderTool(name, rpc.params?.arguments, by) : await callTool(name, rpc.params?.arguments, by, thread);
      // Duet dev keeps the AI trail: what was asked and what came back, word for word
      recordStep({ at, ms: Math.round(performance.now() - began), who: by ?? client ?? "unknown", tool: name, args: rpc.params?.arguments ?? {}, text: result.text, ...(result.image ? { image: result.image } : {}), error: !!result.isError });
      const content: Record<string, unknown>[] = [{ type: "text", text: result.text }];
      if (result.image) content.push({ type: "image", data: result.image.data, mimeType: result.image.mime });
      return { content, isError: !!result.isError };
    }
    default:
      throw Object.assign(new Error(`Method not found: ${rpc.method}`), { code: -32601 });
  }
}

export async function startMcp(): Promise<() => void> {
  version = await getVersion().catch(() => "");
  if (import.meta.env.DEV) {
    builder = await import("./builder");
    builder.watchErrors();
    startTrace();
  }
  // The bridge answers from this while Duet is closed, so an outside AI tool that starts first
  // still learns what Duet can do, and only has to be told to open Duet.
  void invoke("write_agent_file", { name: "bridge.json", body: JSON.stringify({ version, instructions: outsideRules(), tools: TOOLS }) }).catch(() => undefined);
  // The two file tools are answered by the bridge, which cannot ask the interface. It reads the
  // permission level from this file instead, and it keeps the last level when Duet is closed.
  let level = "";
  const publishLevel = () => {
    const mode = getChat().mode;
    if (mode === level) return;
    level = mode;
    void invoke("write_agent_file", { name: "permission.json", body: JSON.stringify({ level: mode }) }).catch(() => undefined);
  };
  publishLevel();
  const stopLevel = subscribeChat(publishLevel);
  const stopRequests = await listen<{ id: number; body: Rpc; client?: string | null }>("mcp-request", async (e) => {
    const { id, body, client } = e.payload;
    let response: unknown;
    try {
      response = { jsonrpc: "2.0", id: body.id, result: await answer(body, client) };
    } catch (err) {
      const code = (err as { code?: number }).code ?? -32603;
      response = { jsonrpc: "2.0", id: body.id, error: { code, message: (err as Error).message } };
    }
    await invoke("mcp_reply", { id, response: JSON.stringify(response) });
  });
  await invoke("mcp_ready");
  return () => {
    stopLevel();
    stopRequests();
  };
}

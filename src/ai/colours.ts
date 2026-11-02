/**
 * The colour of whoever did something. The history line and the chat both use it, so an agent has
 * one colour everywhere: the designer is white, Duet's own AI is orange, and any AI that says its
 * name gets a colour of its own that never changes for that name.
 */
const AI_PALETTE = ["#35c9b5", "#5aa9ff", "#e6c14a", "#c58bff", "#7ed957"];

/** The agents designers meet most keep a colour of their own, the same on every computer. */
const KNOWN: Record<string, string> = { "Claude Code": "#ff8a5c", Claude: "#ff8a5c", Antigravity: "#35c9b5", Codex: "#5aa9ff", Gemini: "#c58bff", Cursor: "#e6c14a" };

export function agentColour(name: string): string {
  if (KNOWN[name]) return KNOWN[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AI_PALETTE[(h >>> 0) % AI_PALETTE.length];
}

export function whoColour(actor: "you" | "ai", by?: string): string {
  if (actor === "you") return "var(--text)";
  // the same tool working from its own window is another AI, so it has a colour of its own
  return by ? agentColour(by) : "var(--duet)";
}

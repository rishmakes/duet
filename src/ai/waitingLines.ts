export const PLAIN_LINE = "Still working. Nothing is wrong. You can keep designing.";

export const WAITING_LINES: string[] = [
  "Thinking…",
  "Hold your horses, pony friend.",
  "Go stretch.",
  "The pixels are being very careful.",
  "Thinking so hard it forgot to blink.",
  "Not stuck. Just dramatic.",
  "Something is happening. Trust the process.",
  "Arguing with a rectangle. The rectangle is losing.",
  "Cooking. Do not open the oven.",
  "Fetching the right shade of blue.",
  "Nobody panic. Someone has the wheel.",
  "Counting pixels. There are a lot.",
  "Almost there. Said every designer, ever.",
  "Still alive in here. Promise.",
  "Teaching an ellipse to behave.",
  "Consulted the color wheel. It was inconclusive.",
  "Just nudging a few vectors.",
];

/**
 * Pick a waiting line to show while an AI works.
 * After 60 seconds (60000 ms), returns the plain reassurance line.
 * Otherwise picks a random line from the starter list that does not repeat the last one.
 */
export function pickWaitingLine(last?: string, elapsed = 0): string {
  const isPlain = elapsed >= 60000;
  if (isPlain) {
    return PLAIN_LINE;
  }
  const pool = last ? WAITING_LINES.filter((line) => line !== last) : WAITING_LINES;
  const candidates = pool.length > 0 ? pool : WAITING_LINES;
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

export function formatWaitingLine(tool: string, line: string): string {
  return `${tool}: ${line}`;
}

/** Playful lines on the card while Duet listens for words in a clip (#364). */
export const LISTENING_LINES: string[] = [
  "Ears on.",
  "Listening very, very closely.",
  "Was that a word or a cough? Checking.",
  "Writing it all down. Neatly.",
  "Pretending to be a court stenographer.",
  "Two languages in one sentence? No problem.",
  "Turning sound into words, one syllable at a time.",
  "Rewinding that bit. You mumbled.",
  "Counting the ums. There are a few.",
  "Not stuck. Just a careful listener.",
  "Nodding along politely.",
  "Go grab a chai. This is on it.",
  "Still listening. Promise.",
];

/** A listening line that does not repeat the last one. */
export function pickListeningLine(last?: string): string {
  const pool = LISTENING_LINES.filter((line) => line !== last);
  return pool[Math.floor(Math.random() * pool.length)];
}

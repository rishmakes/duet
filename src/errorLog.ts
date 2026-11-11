import { invoke } from "@tauri-apps/api/core";

/**
 * Keep the last few errors in ~/.duet/errors.log, on this computer only, so a problem that
 * does not show on screen can still be found. Nothing is sent anywhere.
 */

const recent: string[] = [];

export function logError(where: string, e: unknown) {
  const text = e instanceof Error ? `${e.name}: ${e.message}\n${(e.stack ?? "").split("\n").slice(0, 6).join("\n")}` : String(e);
  console.error(where, e);
  if (recent.some((r) => r.includes(text))) return;
  recent.push(`${new Date().toISOString()}  ${where}\n${text}\n`);
  if (recent.length > 20) recent.shift();
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  invoke<string>("duet_home")
    .then((home) => invoke("write_text_file", { path: `${home}/errors.log`, contents: recent.join("\n") }))
    .catch(() => undefined);
}

/** Notes in errors.log that a step took long, with the time it took, so a freeze can be traced to what ran in it. */
export function noteSlow(what: string, started: number, over = 250, detail = "") {
  const ms = Math.round(performance.now() - started);
  if (ms < over) return;
  logError(`slow: ${what}`, new Error(`${what} took ${ms} ms${detail ? `. ${detail}` : ""}`));
}

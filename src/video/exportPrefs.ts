import type { ExportChoice } from "./scene";
import { defaultChoice } from "./scene";

/** How the last video was made, and the folder each project last exported to. Kept on this computer. */
interface Prefs {
  choice?: Omit<ExportChoice, "to" | "dir">;
  dirs?: Record<string, string>;
}

const KEY = "duet.export";

function read(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function write(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // nothing to do: the next export simply starts from the standard choice
  }
}

/** The choice to start from for a project: the last settings used anywhere, and this project's own folder. */
export function lastChoice(project: string | null): ExportChoice {
  const p = read();
  const dir = project ? p.dirs?.[project] : undefined;
  return { ...defaultChoice(), ...p.choice, ...(dir ? { dir } : {}) };
}

/** Remember how a video was just made, and where, for the next one. */
export function rememberExport(project: string | null, choice: ExportChoice) {
  const p = read();
  const { to: _to, dir, ...rest } = choice;
  void _to;
  p.choice = rest;
  if (project) p.dirs = { ...p.dirs, ...(dir ? { [project]: dir } : {}) };
  if (project && !dir && p.dirs) delete p.dirs[project];
  write(p);
}

/** A folder named the short way: its last two parts. */
export const shortFolder = (dir: string) => dir.split(/[\\/]/).filter(Boolean).slice(-2).join(", ");

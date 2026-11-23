import type { ExportChoice } from "./scene";
import { defaultChoice } from "./scene";
import type { DesignFile } from "../project/designExport";

/** How the last video and the last screens were made, and the folder each project last exported to. Kept on this computer. */
interface Prefs {
  choice?: Omit<ExportChoice, "to" | "dir">;
  design?: DesignFile[];
  dirs?: Record<string, string>;
  menuTab?: MenuTab;
}

/** Which half of the top-bar Export menu was open last: making a file, or the line of files being made. */
export type MenuTab = "export" | "queue";

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
  keepFolder(p, project, dir);
  write(p);
}

/** A project's folder is kept when chosen, and forgotten when it goes back to Duet's own. */
function keepFolder(p: Prefs, project: string | null, dir: string | undefined) {
  if (project) p.dirs = { ...p.dirs, ...(dir ? { [project]: dir } : {}) };
  if (project && !dir && p.dirs) delete p.dirs[project];
}

/** The kinds of file the last screens were made into, PNG at twice the size to begin with. Photoshop files only in Photo. */
export function lastDesign(photo: boolean): DesignFile[] {
  const d = read().design;
  const kept = Array.isArray(d) ? d.filter((f) => photo || f.kind !== "psd") : [];
  return kept.length ? kept : [{ kind: "png", scale: 2, ending: "@2x" }];
}

/** Remember the kinds of file screens were just made into, and where, for the next time. */
export function rememberDesign(project: string | null, files: DesignFile[], dir: string | undefined) {
  const p = read();
  p.design = files;
  keepFolder(p, project, dir);
  write(p);
}

/** A folder named the short way: its last two parts. */
export const shortFolder = (dir: string) => dir.split(/[\\/]/).filter(Boolean).slice(-2).join(", ");

/** The half of the Export menu the designer looked at last, so it opens there again. */
export const lastMenuTab = (): MenuTab => (read().menuTab === "queue" ? "queue" : "export");

export function rememberMenuTab(tab: MenuTab) {
  write({ ...read(), menuTab: tab });
}

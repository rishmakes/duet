import { invoke } from "@tauri-apps/api/core";

/** Where a project's memory lives inside its working folder. It is packed into the project file with everything else. */
const THREAD_FILE = "memory/thread.json";

const inside = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}/${name}`;

/** The text of a project's thread file, or null if it has none yet. */
export async function loadThread(dir: string): Promise<string | null> {
  try {
    const path = inside(dir, THREAD_FILE);
    if ((await invoke<boolean>("path_exists", { path })) !== true) return null;
    return await invoke<string>("read_text_file", { path });
  } catch {
    return null;
  }
}

export async function saveThread(dir: string, text: string): Promise<void> {
  await invoke("write_text_file", { path: inside(dir, THREAD_FILE), contents: text });
}

/** Which recipe a project was last used with, kept in its file so it comes back with it. */
const RECIPE_FILE = "memory/recipe.json";

/** The recipe a project was used with: an id, null when it was put away, undefined when the project has never said. */
export async function loadRecipeChoice(dir: string): Promise<string | null | undefined> {
  try {
    const path = inside(dir, RECIPE_FILE);
    if ((await invoke<boolean>("path_exists", { path })) !== true) return undefined;
    const data = JSON.parse(await invoke<string>("read_text_file", { path }));
    return typeof data?.recipe === "string" ? data.recipe : null;
  } catch {
    return undefined;
  }
}

export async function saveRecipeChoice(dir: string, id: string | null): Promise<void> {
  await invoke("write_text_file", { path: inside(dir, RECIPE_FILE), contents: JSON.stringify({ recipe: id }) });
}

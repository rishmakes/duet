import * as native from "@tauri-apps/plugin-dialog";

/**
 * Duet's questions and file windows. In Duet dev they show inside the window as plain buttons and a
 * box, so a helper agent can read and answer them with its own tools, the way a designer would.
 * Everywhere else they are the system's own.
 */
let inWindow = false;
export const showDialogsInWindow = () => void (inWindow = true);

type Choice = { label: string; value: unknown };

/** A small sheet over the window: the words, an optional box, and a row of buttons. */
function sheet(title: string, text: string, choices: Choice[], box?: string): Promise<{ value: unknown; typed: string }> {
  return new Promise((done) => {
    const back = document.createElement("div");
    back.className = "sheet-back";
    back.dataset.name = "dev-dialog";
    const card = document.createElement("div");
    card.className = "sheet";
    const head = document.createElement("div");
    head.className = "sheet-title";
    head.textContent = title;
    const lead = document.createElement("p");
    lead.className = "sheet-lead";
    lead.textContent = text;
    card.append(head, lead);
    let input: HTMLInputElement | null = null;
    if (box !== undefined) {
      input = document.createElement("input");
      input.className = "feedback-email";
      input.value = box;
      input.placeholder = "Where, as a full file path";
      card.append(input);
    }
    const row = document.createElement("div");
    row.className = "sheet-actions";
    choices.forEach((c, i) => {
      const b = document.createElement("button");
      b.className = `mini ${i === choices.length - 1 ? "primary" : ""}`;
      b.textContent = c.label;
      b.onclick = () => {
        back.remove();
        done({ value: c.value, typed: input?.value.trim() ?? "" });
      };
      row.append(b);
    });
    card.append(row);
    back.append(card);
    document.body.append(back);
    (input ?? (row.lastElementChild as HTMLElement | null))?.focus();
  });
}

const titleOf = (o: unknown, fallback: string) => (o && typeof o === "object" && "title" in o && typeof o.title === "string" ? o.title : fallback);

export const ask: typeof native.ask = async (text, o) => {
  if (!inWindow) return native.ask(text, o);
  const opts = typeof o === "string" ? { title: o } : (o ?? {});
  const { value } = await sheet(opts.title ?? "Duet", text, [
    { label: opts.cancelLabel ?? "No", value: false },
    { label: opts.okLabel ?? "Yes", value: true },
  ]);
  return value === true;
};

export const message: typeof native.message = async (text, o) => {
  if (!inWindow) return native.message(text, o);
  const opts = typeof o === "string" ? { title: o } : (o ?? {});
  await sheet(opts.title ?? "Duet", text, [{ label: "OK", value: true }]);
  return "Ok" as Awaited<ReturnType<typeof native.message>>;
};

export const open: typeof native.open = (async (o?: native.OpenDialogOptions) => {
  if (!inWindow) return native.open(o);
  const many = !!o?.multiple;
  const { value, typed } = await sheet(titleOf(o, "Open"), many ? "Type the full paths, one per line or split by |." : "Type the full path.", [
    { label: "Cancel", value: false },
    { label: "Open", value: true },
  ], typeof o?.defaultPath === "string" ? o.defaultPath : "");
  if (value !== true || !typed) return null;
  return many ? typed.split(/[|\n]/).map((p) => p.trim()).filter(Boolean) : typed;
}) as typeof native.open;

export const save: typeof native.save = async (o) => {
  if (!inWindow) return native.save(o);
  const { value, typed } = await sheet(titleOf(o, "Save"), "Type the full path to save to.", [
    { label: "Cancel", value: false },
    { label: "Save", value: true },
  ], o?.defaultPath ?? "");
  return value === true && typed ? typed : null;
};

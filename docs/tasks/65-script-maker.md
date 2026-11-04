# Task 65: make, try and run scripts in the Store (#151)

A script is a small piece of JavaScript of the designer's own (see `src/store/scripts.ts`; do not change that file, `src/store/things.ts`, `src/ai/` or `src-tauri/`). Already there for you: `saveScript(meta, code, id?)`, `deleteScript(id)`, `runScript(script, list)` (returns `{changed, steps, logs, error}`), `RUNS_ON_WORDS`, `scriptAsk(ask, runsOn, name, code)`, `useScripts()`. `sendToAgent(text)` from `src/ai/agent.ts` sends a message to the AI; then `window.dispatchEvent(new Event("duet:show-chat"))` shows the chat. When the AI saves a script, the window gets `duet:script-saved` with the script id in `detail`.

Change only `src/ui/StorePage.tsx` and `src/styles.css`:
1. "+ Make new" asks first: Skill or Script (two plain choices). Skill keeps today's editor.
2. The script maker, same look as the skill editor: Name, What it does (one line), Runs on (the four `RUNS_ON_WORDS`), and the code in a monospace box. Above the code, one line "Ask the AI to write it" with a text field and a Send button: it sends `scriptAsk(...)` with what is filled in, shows the chat, and says under it "The AI will ask you before it saves the script." Buttons at the bottom: Try it, Save, Cancel.
3. Try it runs the code as it is now with `runScript`. Show the result in one quiet line: "Made N changes. One Undo takes them back." or the error, plus any log lines. For Runs on "A list you give it", show a text box "One item per line" above Try it and pass its lines.
4. A script's page (yours) shows what it does, Runs on, a Run button (with the list box when it runs on a list), the result line, Edit (opens the maker filled in) and Delete. Show the code read-only, folded, behind "See the code".
5. On `duet:script-saved`, open that script's page on the Yours side.
6. A new saved script lands on its page, Yours side, like skills do.

Plain words, colour tokens only, never purple, dark and light. No new packages.
Check: Duet dev is running. Look with the dev_* tools at the maker and a script's page, dark and light. Only open the Store; do not open other files or Kitchen. Do not press Try it or Run (they change the open design). Run `npx tsc --noEmit` and `npx vitest run`.
Rules: NEVER use the real mouse, keyboard, AppleScript or UI scripting. Never delete or create .duet files. Do not commit. Touch only the files named. Do not stop to ask for approval of a plan; build it.
Log problems to `docs/tasks/65-log.md`. Finish with a 3-line summary.

# Tasks for Sonnet

Small tasks, one at a time, in order. Each file is one task with its issue.

## Rules for every session

- Read `AGENTS.md` once. Then read only the task file and the files it names. Do not explore the repo.
- No browser tools, no computer use, no screenshots, no Duet dev driving. They burn tokens. The creator click-tests in his own app.
- No subagents. Search with `grep`, read with line ranges, cap command output (`| tail -20`).
- Hand anything simple to Antigravity: `agy -p "<task>" --mode accept-edits`, run in the background, on a `helper/<issue>-<two words>` branch. Simple means interface, styles, panels, text, docs. Brief it with the task file and end the brief with: do only this task, write every problem you hit to `scratch/agy-log.md`, report the exact commands you ran and their output. Then run the tests yourself before trusting it.
- Keep the risky parts yourself: the file format (`src/document/serialize.ts`, `types.ts`), time (`src/document/time.ts`), export (`src/video/scene.ts`), commands.
- Every design change goes through a command in `src/commands/`. Commands never mutate. Add a test with each.
- Check: `npx tsc --noEmit && npm test 2>&1 | grep "Tests "`.
- Commit on branch `work-in-project`, one commit per task, a message a designer understands, `Fixes #N`. Do not push.
- After a task works, build and install his app: `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.duet-keys/duet-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" APPLE_SIGNING_IDENTITY=- npm run tauri build -- --bundles app` in the background, then move `/Applications/Duet.app` to the Trash with Finder and `ditto src-tauri/target/release/bundle/macos/Duet.app /Applications/Duet.app`. Never open his app. Tell him: save, quit, reopen. Build after a batch of two or three tasks, not after every small one.
- No public release unless he asks.
- Replies to him: a few short lines, plain words, what changed and what to click. No recaps.

## Order

| # | Task | Issue | Who |
|---|---|---|---|
| 01 | Masked pictures black in export | #146 | Sonnet |
| 02 | Mask soft edge, invert, grow | #153 | Sonnet |
| 03 | Mask settings in the right panel | #154 | Antigravity |
| 04 | Pen mask over a clip | #155 | Sonnet, small |
| 05 | Roto: shape keys | #156 | Sonnet |
| 06 | Roto: editing adds a key | #157 | Sonnet |
| 07 | Roto: keys in the timeline | #158 | Antigravity |
| 08 | Box-select in Cut | #159 | Antigravity |
| 09 | Drag a clip to another row | #160 | Antigravity |
| 10 | Change shortcuts | #161 | Later |

Automatic roto (the Mac finds the person) is not here. Plan it with Opus first. See #63 and `docs/handoff-masking.md`.

- **Never touch the real mouse or keyboard.** Only `dev_*` tools and files. No CoreGraphics events, pyautogui, cliclick, osascript or System Events, no clicking, no key presses, no bringing windows to the front, no scripting Chrome or Terminal. If a native dialog blocks a test, stop that test and write it down.

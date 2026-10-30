# Duet

An opinionated, free-to-use desktop design app (source available under PolyForm Shield) where a designer and an AI work on the same canvas. Read `README.md` for what exists, `docs/principles.md` for why, and `docs/next-steps.md` for what to do next (including a decided but unfinished swap of Gemini CLI for Antigravity).

## Run it

```sh
npm install
npm run tauri dev          # the app
npm test                   # front end tests
npx tsc --noEmit           # type check
cargo test --manifest-path src-tauri/Cargo.toml    # history and file tests
```

Restart `tauri dev` after installing a new npm package. Vite re-bundles dependencies mid-session and the open window can break until restarted.

## Layout

- `src/document/` the flat JSON document, geometry, and the file format (`serialize.ts`).
- `src/commands/` every change to a design. Pure functions, document in and document out.
- `src/state/store.ts` the one store: history timeline, selection, viewport, project.
- `src/canvas/` Canvas 2D renderer, pointer and keyboard handling, resize handles.
- `src/ui/` panels: layers, skills, properties, history strip, chat, toolbar.
- `src/ai/` agent runner, MCP responder, tools with permission rules, chat store, skills. Shipped skills are Markdown in `src/ai/skills/`.
- `src/project/` open, save, autosave, versions.
- `src-tauri/src/lib.rs` file access, bundled Git history (libgit2), user skills in `~/.duet/skills`.
- `src-tauri/src/ai.rs` local MCP server (127.0.0.1, token), and the runner for the user's agent tool.
- `mockups/` how the interface was thought through. `docs/` plans and decisions.
- `ref/` and `scratch/` stay on this machine, never committed. Their READMEs say how they are sorted; `scripts/ref-tidy` does the sorting.

## Project links

- Website (private repo `rishmakes/duet-site`, folder `~/Desktop/DEV/duet-site`): https://duet.noisyarchitects.org. Deploy with `npm run deploy` there. Update what works in `src/content/status.ts` after each version.
- The private part (private repo `rishmakes/duet-private`, folder `~/Desktop/DEV/duet-private`): research, plans and technology that are not released. Public issues say what a designer gets; how it works is written there. Never copy from it into this repo, its issues or its commits without the creator saying so.
- Feedback form: https://forms.gle/Zs6s7bX6CpJigCCf6. Creator booking: https://cal.com/rishmakes/coffee.
- Release: push a tag like `v0.2.0`. GitHub Actions builds Mac and Windows installers into a draft release. Publish with `gh release edit <tag> --draft=false`. Not a pre-release: installed copies look for the latest release and offer it as an update. Releases are signed with Duet's own update key, `~/.duet-keys/duet-updater.key` (also the GitHub secret TAURI_SIGNING_PRIVATE_KEY). Lose it and installed copies can never update again.
- Licence: PolyForm Shield 1.0.0 (source available, not open source). v0.1.0 was MIT.
- Use the GitHub noreply email in this repo: `10191373+rishmakes@users.noreply.github.com`.
- The app id `com.justsourish.duet` in `src-tauri/tauri.conf.json` stays as it is after the move to `rishmakes`: changing it would cut installed copies off from their projects and settings.

## Rules

- Every design change goes through a command in `src/commands/`. The interface and the AI use the same ones. Never edit the document any other way.
- Commands never mutate. Add a test when you add one.
- Permission levels (suggest, ask first, auto) are enforced in `src/ai/tools.ts`, not left to the agent.
- Designer language in the interface. No commit, tag, JSON or id in front of a designer.
- Only build and promise what is real. Half-built features stay out of the interface.
- Nothing copied from other design tools. Own icons, colours and code.
- Commits carry the author's identity only. No tool names or attribution lines.
- Every commit names its issue (`#123`). The same day, label that issue `built - needs testing`.
- Antigravity tests each fix step by step in Duet dev and posts its report on the issue. If it all passes, Claude closes the issue and moves it to Tested. The creator gives one-line verdicts from using Duet and can reopen anything.
- Words for status: "checks pass" (code tests only), "checked in Duet dev" (Antigravity used it), "tried by the creator". Never just "tested".
- Before opening an issue, search open and closed issues for a similar one (`gh issue list --state all --search "<words>"`). Never skip this. If one exists, comment there instead.
- No secrets in the repository. The agent token lives only in `~/.duet/session.json`.

## If you are a helper agent

Some tasks are handed to a smaller, cheaper agent. If your task came from an issue comment titled "Task for a helper agent", these rules are yours.

- Do only what the task says. If something else looks wrong, write it in your report and leave it.
- Work on a branch named `helper/<issue number>-<two words>`. Never on `main`. Never push.
- Run `git config core.hooksPath .githooks` once. A check then runs before every save. If it refuses, fix the cause. Never skip it with `--no-verify`.
- Do not touch: `src-tauri/`, `src/project/`, `src/memory/`, `src/state/`, `src/document/serialize.ts`, `src/ai/tools.ts`, `.github/`, `.githooks/`, `AGENTS.md`, `LICENSE`, `package.json`. If the task seems to need one of them, stop and say so.
- No new packages. No renaming or moving files. No tidying code you were not asked to change.
- Match the code around you. Read the file before you change it.
- One save per task, with a message a designer would understand. Author identity only.
- Finish with a short report: the branch name, the files you changed, what you could not do, and the click list from the task so the creator can test.

## Working with the person who started this

- Short messages. One idea per line.
- Plan in chat before changing files. After the plan is agreed, work end to end.
- Research goes to Gemini, not here. Treat its answers as unverified until checked.

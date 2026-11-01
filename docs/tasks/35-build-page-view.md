# Task 35: build page view (#250)

Your plan is docs/tasks/34-page-view-plan.md. Build it with these changes from Claude:

1. The pages mark lives in the design, not localStorage. `Doc.pages?: true` already exists and saves (commit b3542a7). Do NOT add viewMode to layout.ts. Add a command `set_pages` ({ on: boolean }) in src/commands/pages.ts with a test; Home runs it for sized items (post, story, thumbnail, slide, A4, custom). Open canvas and App screens leave it off.
2. Build only: `add_page` and `reorder_pages` (with tests, never mutate), page view in CanvasView (setOnlyFrame + pan lock + fit on resize, like Motion focus #135), and src/ui/PageStrip.tsx at the bottom: real thumbnails of each page, active one marked, drag to reorder, "+ Add page" (copies the current page's size and fill, then opens it), and an "All pages" button at the end.
3. "All pages" shows the open canvas with every page in a row. In that view, clicking a page's name label on the canvas opens it as a page again. No double-click. No other new button anywhere.
4. Cut: duplicate page, delete page, page arrows, keyboard page turning, the one-time hint.
5. Page view applies only when `doc.pages` is true and the space is Design or Photo. Video keeps its own focus.

Rules: AGENTS.md helper rules (no src/state, src/project, serialize.ts, src-tauri). Colours only from tokens, both themes. Designer words only. Never touch the mouse, keyboard, AppleScript or any open Duet window. Check visually only with `npx vite --port 5299` in this folder and your browser bridge. Run `npm test` and `npx tsc --noEmit` and paste the real last lines. Log every problem in docs/tasks/35-log.md. Commit once on this branch with a designer message naming #250. Finish with a 5-line summary and screenshot paths.

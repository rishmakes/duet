# Task 45: comments can mark an area (#272)

Work in the worktree you are given, on branch helper/272-comment-marks. Do not push. One commit, message names #272.
Never use the mouse, keyboard, screen capture, AppleScript, `open -a`, or any browser or computer-use tool. Log problems to docs/tasks/45-log.md as you go.

## What to build
Today the comment tool (tool "comment", key C) pins a note where you click: `src/canvas/CanvasView.tsx` around line 1085, pins drawn in the comments layer near line 2232.
Add marks, so a comment can point at an area instead of a spot:
1. `src/document/types.ts` Comment: add optional `mark?: { kind: "box" | "arrow" | "free"; points: number[] }` in page pixels (box: x1,y1,x2,y2; arrow: from x,y to x,y; free: x,y pairs). Old files without it keep working.
2. Commands `add_comment` in `src/commands/index.ts`: accept and keep `mark`. Add a test next to the existing comment tests.
3. Canvas: with the comment tool, a click still drops a pin. A drag draws a mark: box by default, arrow with Shift held, freehand with Option/Alt held. On release the comment box opens; its pin sits at the end of the mark (box: top-right corner; arrow: its head; free: last point). Esc or an empty comment drops the mark.
4. Draw marks in the comments layer as a thin SVG line in the pin colour (AI comments in the AI colour), hidden with the pins (Shift C) and when resolved. Marks are never part of the design, never exported, never a layer.
5. AI sees it: wherever comments are given to the AI (search `comments` in `src/ai/tools.ts`, get_context), include the mark in plain words, e.g. "marks the box 120,80 to 480,300" or "arrow from .. to ..", "freehand around x1,y1 to x2,y2" (its bounding box).
6. The AI's own add_comment tool may pass a mark too.

Rules: match the code around you; no new packages; colours from existing CSS tokens; designer words in the interface.
Check: `npx tsc --noEmit` and `npm test` both pass. Finish with a 5-line summary and the exact files changed.

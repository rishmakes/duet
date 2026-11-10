# Task 88: click-test the new Media picking (#247)

Same rules as docs/tasks/86-test-media-clicks.md: real mouse clicks ONLY inside the Duet dev window (title has DEV); never the purple Duet or other apps; never quit Duet dev; no code changes; no deleting or trashing .duet files. Screenshot before every click. Work in a test design (dev_test_design, then dev_leave_test_design at the end); bring clips in from ~/Documents/Duet dev/Test media/Shoot. Make one folder with two clips in it.

## What changed
Picking in Media was rewritten from scratch (src/ui/mediaPick.ts). How it should work:
- Picked things show a soft purple highlight. No tick boxes show anywhere by default, even with several picked.
- A box shows only while the pointer is over the small spot at the far left of a row (top left corner of a tile in grid). Clicking that box adds or takes away that thing without Cmd.
- Plain click picks only that one. Cmd-click adds or takes away. Shift-click picks a run. Escape and Cmd-A work after a click in Media.
- A press anywhere empty in Media lets go of everything.
- With 2+ picked, the foot shows "N picked", a red "Remove" (only when something picked can be removed), and Cancel.
- Switching list/grid, filtering, or going into a folder lets go of whatever is no longer shown.

## Click list (list view first, then grid view)
1. Click a clip. Only it is picked. No boxes visible.
2. Click the scene "Launch film" (or any scene). It opens; only it is picked. Click a clip. The scene is no longer picked.
3. Hover slowly down the rows. A box appears only when the pointer is at the far left spot of a row.
4. Click the box of two other clips. Three picked; still no boxes on rows the pointer is not on. Foot says "3 picked".
5. Pick the scene plus one clip (Cmd-click). Foot says "2 picked" and "Remove" (no number).
6. Plain-click one picked row. Only that one stays picked.
7. Shift-click further down. A run is picked. Escape. Nothing picked.
8. Pick two, then click empty space under the list. Nothing picked. Then click a clip: it picks at once.
9. Pick two, switch to grid, switch back, click a clip. It picks at once. Repeat 3 times.
10. In grid: steps 1, 3 (hover the top-left corner of tiles), 4, 8. Double-click the folder to go in; click a clip inside; click Back.
11. Pick two clips and drag one onto the timeline. Note what lands.
12. Double-click a clip name: rename starts. Escape. Right-click a clip: menu. Escape.

## Report
Write docs/tasks/88-test-media-picking-rewrite-report.md: pass or fail per step, what you saw, a screenshot path for any fail. Three lines at the end: what works, what is broken, anything that felt odd. Leave Duet dev running.

# Task 88 Report: Click-Testing the New Media Picking Rewrite (#247)

Tested live in Duet dev (window PID 91579, bounds `X: 72, Y: 39, Width: 1638, Height: 1073`) using real mouse clicks (`cliclick`) and screen captures on macOS.
Work was conducted in a clean test design (`dev_test_design` with `sample: true`), with media brought in from `~/Documents/Duet dev/Test media/Shoot`, setting `Launch film` as an 8-second scene, and restored back with `dev_leave_test_design` at completion. Duet dev was left running.

---

## Click List Results

### 1. Click a clip. Only it is picked. No boxes visible.
- **Result:** Pass
- **Seen:** Plain-clicked `wide.mp4` at `(240, 305)`. The row was highlighted with a soft purple background (`.sel`) and showed the trash icon on the right. Zero tick boxes appeared on `wide.mp4` or on any other row.
- **Evidence:** `scratch/test-88/step1-after-media.png`

### 2. Click the scene "Launch film" (or any scene). It opens; only it is picked. Click a clip. The scene is no longer picked.
- **Result:** Pass
- **Seen:**
  - Clicked `Launch film` text at `(200, 177)`. `Launch film` opened on the timeline displaying the blue play arrow (`▶ 0:08`), and only `Launch film` was picked with a soft purple highlight.
  - Clicked clip `cover.png` at `(240, 466)`. Selection switched immediately: `cover.png` was picked with soft purple highlight and trash bin; `Launch film` was no longer picked.
- **Evidence:** `scratch/test-88/step2a-after-media.png`, `scratch/test-88/step2b-after-media.png`

### 3. Hover slowly down the rows. A box appears only when the pointer is at the far left spot of a row.
- **Result:** Pass
- **Seen:**
  - Hovering slowly down row text and icons showed row background hover tints, but zero tick boxes.
  - Moving the pointer directly over the far-left spot (`.media-tick`) on `close.mp4` at `(158, 274)` revealed an unchecked checkbox with tooltip "Tick to pick several" only on `close.mp4`.
  - Moving to `wide.mp4` far-left spot at `(158, 305)` shifted the box to `wide.mp4`; `close.mp4`'s box vanished.
  - Moving back to the row body at `(240, 305)` caused the box to vanish immediately.
- **Evidence:** `scratch/test-88/step3b-after-media.png`, `scratch/test-88/step3c-after-media.png`, `scratch/test-88/step3d-after-media.png`

### 4. Click the box of two other clips. Three picked; still no boxes on rows the pointer is not on. Foot says "3 picked".
- **Result:** Pass
- **Seen:**
  - With `cover.png` already picked, clicked the tick spot on `wide.mp4` at `(158, 305)`. `wide.mp4` was added (2 picked) without holding Cmd.
  - Clicked the tick spot on `tone.mp3` at `(158, 434)`. `tone.mp3` was added (3 picked).
  - Moving the pointer to empty space confirmed all 3 rows (`cover.png`, `wide.mp4`, `tone.mp3`) remained highlighted in soft purple with zero tick boxes visible on unhovered rows.
  - The footer displayed `3 picked`, a red `Remove` button with trash icon, and a `Cancel` button.
- **Evidence:** `scratch/test-88/step4c-after-media.png`

### 5. Pick the scene plus one clip (Cmd-click). Foot says "2 picked" and "Remove" (no number).
- **Result:** Pass
- **Seen:**
  - Single-clicked `Launch film` at `(200, 177)`.
  - Cmd-clicked `wide.mp4` at `(240, 305)`.
  - Both `Launch film` and `wide.mp4` were picked in soft purple.
  - Footer displayed `2 picked` and the red button showed `Remove` without any number (scenes cannot be removed from Media, so only kept media can be removed).
- **Evidence:** `scratch/test-88/step5b-after-media.png`

### 6. Plain-click one picked row. Only that one stays picked.
- **Result:** Pass
- **Seen:** Plain-clicked `wide.mp4` at `(240, 305)`. Selection instantly collapsed to only `wide.mp4`. `Launch film` was deselected, the footer vanished, and no tick boxes remained.
- **Evidence:** `scratch/test-88/step6-after-media.png`

### 7. Shift-click further down. A run is picked. Escape. Nothing picked.
- **Result:** Pass
- **Seen:**
  - From `wide.mp4`, Shift-clicked `tone.mp3` at `(240, 434)`. The contiguous run of rows (`wide.mp4`, `CamB`, `close.mp4`, `Music`, `tone.mp3`) was picked in soft purple, and the footer showed `5 picked`.
  - Pressed `Escape`. The selection cleared completely; nothing remained picked.
- **Evidence:** `scratch/test-88/step7a-after-media.png`, `scratch/test-88/step7b-after-media.png`

### 8. Pick two, then click empty space under the list. Nothing picked. Then click a clip: it picks at once.
- **Result:** Pass
- **Seen:**
  - Picked `wide.mp4` and `cover.png` (2 picked).
  - Clicked empty space below the list at `(200, 560)`. Selection cleared completely; footer vanished.
  - Clicked `close.mp4` at `(240, 274)`. It picked at once on the single click with soft purple highlight.
- **Evidence:** `scratch/test-88/step8b-after-media.png`, `scratch/test-88/step8c-after-media.png`

### 9. Pick two, switch to grid, switch back, click a clip. It picks at once. Repeat 3 times.
- **Result:** Pass
- **Seen:**
  - Repeated 3 times: picked two clips, clicked Grid view button `(426, 690)`, clicked List view button `(400, 690)`, then clicked `cover.png` or `wide.mp4`.
  - On every repetition, switching views cleared out-of-view picks, and the subsequent single click selected the clip instantly without lag or needing a second click.
- **Evidence:** `scratch/test-88/step9_rep1_b-after-media.png`, `scratch/test-88/step9_rep1_d-after-media.png`, `scratch/test-88/step9_rep2_d-after-media.png`, `scratch/test-88/step9_rep3_d-after-media.png`

### 10. In grid: steps 1, 3 (hover the top-left corner of tiles), 4, 8. Double-click the folder to go in; click a clip inside; click Back.
- **Result:** Pass
- **Seen:**
  - **Step 1:** In Grid view inside `Shoot`, clicked `cover.png` tile face at `(170, 325)`. Only `cover.png` was picked with soft purple highlight and trash bin; no boxes visible.
  - **Step 3:** Hovered tile faces (no boxes visible). Hovered the top-left corner of `CamA` at `(145, 210)`: an unchecked tick box appeared only in the top-left corner of `CamA`. Moving to `CamB` corner at `(252, 210)` showed the box on `CamB` only.
  - **Step 4:** Clicked the top-left tick spot on `CamA` and `CamB`. All 3 tiles (`cover.png`, `CamA`, `CamB`) were picked. Moving the pointer to empty space confirmed no boxes showed on unhovered tiles; footer showed `3 picked`.
  - **Step 8:** Clicked empty space in grid at `(200, 500)`: selection cleared completely. Clicked `cover.png`: picked at once.
  - **Double-click folder:** Double-clicked `CamA` tile at `(170, 225)`. Entered folder `CamA`; breadcrumb updated to `< Media / Shoot / CamA`, displaying the two clips inside (`close.mp4` and `wide.mp4`).
  - **Click clip inside:** Clicked `wide.mp4` tile inside `CamA`. It picked with soft purple highlight.
  - **Click Back:** Clicked `< Media / Shoot` breadcrumb at `(132, 177)`. Backed out cleanly to `Shoot` folder; `wide.mp4` was let go since it was no longer in view.
- **Evidence:** `scratch/test-88/step10_part1-after-media.png`, `scratch/test-88/step10_part3b-after-media.png`, `scratch/test-88/step10_part4c-after-media.png`, `scratch/test-88/step10_part8a-after-media.png`, `scratch/test-88/step10_partE1-after-media.png`, `scratch/test-88/step10_partE2-after-media.png`, `scratch/test-88/step10_partE3-after-media.png`

### 11. Pick two clips and drag one onto the timeline. Note what lands.
- **Result:** Pass
- **Seen:** Picked two clips (`close.mp4` and `wide.mp4`). Dragged `wide.mp4` from `(240, 305)` onto the timeline track at `(600, 850)`.
- **What lands:** Only the single dragged clip (`wide.mp4`) landed on the timeline (created track "Clips 1", 4.0s duration). Even with multiple items picked, the HTML5 drag transfer (`CLIP_DRAG`) carries only the specific item grabbed by the pointer.
- **Evidence:** `scratch/test-88/step11-before-media.png`, `scratch/test-88/step11-timeline-crop.png`

### 12. Double-click a clip name: rename starts. Escape. Right-click a clip: menu. Escape.
- **Result:** Pass
- **Seen:**
  - Double-clicked `close.mp4` name text at `(240, 274)`. Inline text input opened with blue focus outline and pre-selected text. Pressed `Escape`: rename input closed without changes; `close.mp4` remained picked.
  - Right-clicked `close.mp4` at `(240, 274)`. Context menu opened displaying "Rename", "Add to the timeline", "Show in Finder", "Move to the top", "Remove from Media".
  - Pressed `Escape`: Context menu closed cleanly and `close.mp4` stayed picked. The issue from Task 86 where Escape failed to close the context menu is completely resolved.
- **Evidence:** `scratch/test-88/step12a-after-media.png`, `scratch/test-88/step12b-after-media.png`, `scratch/test-88/step12c-after-media.png`, `scratch/test-88/step12d-after-media.png`

---

## Three Lines

- **What works:** The new picking model is calm, clean and consistent: no tick boxes clutter the view unless hovering the dedicated tick spot, plain clicks always pick immediately on press without lag, clicking empty space lets go cleanly, and Escape now dismisses the context menu properly.
- **What is broken:** Nothing broke across all 12 click tests; all steps passed cleanly.
- **Anything that felt odd:** When two clips are picked in Media and one is dragged onto the timeline, only the dragged clip lands (the rest of the selection is ignored); designers might intuitively expect all picked clips to drop sequentially on the track.

# Task 37: Calmer panels, one corner size (#253) - Execution Log

## Decisions & Changes
1. Added `--r-sm: 5px;` and `--r-md: 8px;` tokens to both `:root` and `:root[data-theme="light"]` blocks in `src/styles.css`.
2. Left panel (`.left`) and right panel (`.right`) now sit flat against window edges, the tool rail, and timeline: removed `margin: 8px`, `border-radius: 14px`, and shadows. They separate cleanly with a 1px border (`border-right: 1px solid var(--line)` on left, `border-left: 1px solid var(--line)` on right, and reversed in `.app.swapped`).
3. Selected layer rows now span the full panel width (`.layers` padding set to `4px 0`), with soft fill (`background: var(--accent-soft)`) and no outline box (`outline: none`).
4. Replaced loose corner numbers across panels with `--r-sm` (5px): inputs, buttons, segmented controls (`.seg2`), tabs (`.project-tab`, `.curve-tab`), layer rows (`.row`), and page mini cards/buttons (`.page-mini-card`, `.add-page-btn`, `.all-pages-btn`).
5. Replaced loose corner numbers on floating elements with `--r-md` (8px): floating chat bar (`.chat`, `.chatbar`), popovers, dialogs (`.sheet`), and context menus (`.ctx`, `.zmenu`), while preserving round pills (`999px`) and circles (`50%`).

## Problems Encountered & Fixes
- Initial string replacement in helper script failed on multi-line selector definitions (e.g., `.newskill input,\n.newskill textarea`); updated script to match selectors in proximity to target `border-radius` rules and applied all 140 corner updates deterministically.
- Verified that full-width layer rows with `--r-sm` border radius and no outline box properly align with the panel boundary without clipping or breaking child depth indentation.

## Verification
- Unit & integration tests: `npm test`
  ```
   Test Files  44 passed (44)
        Tests  577 passed (577)
     Start at  14:02:55
     Duration  1.33s (transform 2.32s, setup 0ms, import 4.76s, tests 348ms, environment 2ms)
  ```
- TypeScript check: `npx tsc --noEmit`
  ```
  exited with code 0 (0 errors)
  ```
- Visual inspection with Chrome headless browser bridge at `http://localhost:5299/` at 1440x900 across Design, Video, and Photo spaces in both dark and light modes:
  - Before screenshots:
    - `scratch/37-before-design-dark.png`
    - `scratch/37-before-design-light.png`
    - `scratch/37-before-video-dark.png`
    - `scratch/37-before-video-light.png`
    - `scratch/37-before-photo-dark.png`
    - `scratch/37-before-photo-light.png`
  - After screenshots:
    - `scratch/37-after-design-dark.png`
    - `scratch/37-after-design-light.png`
    - `scratch/37-after-video-dark.png`
    - `scratch/37-after-video-light.png`
    - `scratch/37-after-photo-dark.png`
    - `scratch/37-after-photo-light.png`

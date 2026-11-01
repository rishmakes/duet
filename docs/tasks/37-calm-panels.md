# Task 37: calmer panels, one corner size (#253)

Rish, word for word: "The rounded look is really weird to me because the tabs are rounded. That is fine, but Layers, the bottom one, is not rounded... a lot of things are rounded... I can work with a little bit less rounding. If the pages, the forms, and the chat are a little bit less rounded... see the Layers asset skills: it has this gap outside... It gives a little bit of unprofessionalism to me. It could have been more subtle."

Duet uses 11 corner sizes in src/styles.css today. Make one rule:
1. Left panel (Layers/Assets/Skills) and right panel (Properties/Colour/Chat) sit flat against the window edges, rail and timeline: no outer gap, no rounded card, no shadow. A 1px line (existing line token) separates them, like the page strip.
2. Small things inside panels (inputs, buttons, segmented controls, tabs, selected layer row, page thumbnails) use one token `--r-sm` (5px). The selected layer row spans the full panel width: soft fill, no outline box.
3. Floating things (chat bar, menus, pop-ups, dialogs) use one token `--r-md` (8px). Pills that are already fully round (999px) stay round.
Add the two tokens to both :root blocks and use them instead of the loose numbers.

Only CSS (src/styles.css) and, if truly needed, class names in src/ui. No layout moves, no wording changes, nothing else.

Check: before you change anything, run `npx vite --port 5299` in THIS folder and screenshot Design, Video and Photo in light and dark at 1440x900 (before). Then after, same shots. Save to scratch/37-before-*.png and scratch/37-after-*.png.
SAFETY: do NOT use Duet dev (another agent is testing in it) or Rish's Duet app. Never touch the mouse, keyboard, AppleScript or any Duet window. Browser bridge on port 5299 only.
Run `npm test` and `npx tsc --noEmit`, paste the real last lines. Log problems in docs/tasks/37-log.md. One commit on this branch naming #253. 5-line summary with screenshot paths.

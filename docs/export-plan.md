# Export: what exists, what is possible, build order

Written 23 Nov 2026 after reading the code. Step 1 is being built under #360.

## What exists today

- **Video** is made by one path: `exportScene` in `src/video/scene.ts`. It draws every picture on a canvas, hands it to the encoder (`src-tauri/src/video.rs`), and writes MP4 or ProRes. Progress is reported. Stop works (a flag checked every picture).
- **Work area or whole scene** is already a choice (`ExportChoice.whole`). **Size, frames a second, quality, folder** are all in `ExportChoice`. The folder and last choices are remembered per project (`src/video/exportPrefs.ts`).
- **A line of jobs already exists** (`src/ai/jobs.ts`, from #353). Up to 20 wait, they run one after another, each is logged to `renders.log`, Duet tells you when one ends. Only AI uses it today. The designer's own Export bypasses it.
- **The scene is frozen at add time for free.** `exportScene` takes the document as an argument and commands never mutate, so holding the document at that moment costs nothing.
- **Design and Photo** export lives in `src/ui/ExportMenu.tsx` and `src/project/exporter.ts`: PNG at 1x to 3x, SVG, PDF (all screens, one page each), PSD in Photo. Many screens at once works, but asks for a folder each time and has no list of file kinds.
- **Quit guard** exists: Duet will not quit while a video is made (`making_video`).

## What is possible, and what it needs

| Wish | Today | Needs |
| --- | --- | --- |
| Export a chosen clip alone | no | the scene renderer drawn with only that clip shown; small |
| Pause and resume a video | no | the picture loop waits on a flag, same as Stop; small. Encoder keeps its place. |
| Several in a row | yes for AI | designer's Export goes into the same line |
| Reorder, remove a waiting job | no | line gets move and remove; small |
| Stop a running job | yes | wire to the line |
| Line survives a restart | no | jobs hold a running function. Waiting jobs would be saved as settings and rebuilt. Medium. First version: line is lost on quit, Duet warns. |
| See-through video | no | the picture is drawn on black and sent as RGB. Needs the canvas cleared to see-through, 16-bit RGBA to the encoder, and ProRes 4444 or WebM. Medium. |
| GIF | no | an extra encoder setting plus a palette step. Small to medium. |
| Many Design file types in one go | no | rows of kind, size, ending, folder; loop the existing writers. Small. |
| Sleep or shut down when done | no | Mac: `pmset sleepnow` / `osascript` shut down. Windows: `shutdown /s`, `rundll32 powrprof.dll,SetSuspendState`. A few lines in `src-tauri`, with a 60 second warning you can cancel. Duet must stay open until the line is empty. |
| Agents add jobs | video only | `export_frame` should use the same line. Permission rules stay in `src/ai/tools.ts`. |

## What gets replaced

- The timeline "Export video" button and its pop-up in `src/ui/TimeStrip.tsx` (about lines 1655 to 1760) go. The top-bar Export button opens the dropdown instead.
- `src/ui/ExportMenu.tsx` is replaced by the dropdown and the full page.

## Build order, each step small and shippable

1. **Queue engine for everything.** Designer's video export goes through `jobs.ts`. Add pause, resume, stop, move, remove. Checks pass for each. No new screen yet: the timeline button just uses the line.
2. **Queue page** (the Queue tab): rows with progress, pause, stop, drag to reorder, finished list, Show in folder.
3. **Set up page, Video**: grid of what to export (whole scene, work area, chosen clips), rows of file kinds, folder, four summary tiles, Export now and Add to queue. Delete the timeline pop-up.
4. **Dropdown** under the top-bar Export button: start with last settings, queue at a glance, open the whole queue.
5. **Set up page, Design and Photo**: screens as ticked tiles, several kinds and sizes per export, file endings. Design and Photo jobs go through the same line. Delete `ExportMenu.tsx`. Done 23 Nov: `src/ui/ExportDesign.tsx`, `src/project/designExport.ts`; the dropdown's design part, the old one-at-a-time `exportDesign` and `savePhotoshopFile` and the File menu's four export items went, File, Export… opens this page.
6. **After the queue**: Do nothing, Sleep, Shut down, with a cancel warning.
7. **Later, own steps**: see-through video, GIF, queue surviving a restart, chosen clips.

## Decided 23 Nov (Rish said Y to the order as written)

- First version: the queue is not kept across a restart. Closing the window while a video is made keeps Duet running until it is done (already true). Saving the queue comes later.
- See-through video and GIF come after Sleep and Shut down.
- Step 1 is #360 (it already asked for the designer's Export to join the line).

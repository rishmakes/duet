# Plan: import an SVG as editable layers (#330)

Agreed with Rish on 12 Nov 2026. Build after a context clear. Read this first.

## Why

Rish exported his old resume from Figma and wants to edit it in Duet. Today an SVG placed with `place_image` is one flat picture. Another Claude session (rish-d3) was blocked on the same file and asked whether Duet could break it apart. It cannot. This feature fixes that for him and for the AI.

## Test file (the proof)

`~/Desktop/Resume (3)/A4 - 7.svg` (595x842, exported 12 Nov 04:10 with Outline text OFF and ids ON). It has:

- 52 `<text>` elements, many with several `<tspan>` lines (each tspan has its own x and y). Fonts: Open Sans (36), Oxygen (14), Roboto, Oregano.
- 26 `<path>`, 3 `<image>` (base64, reached through `<pattern>` + `<use>`), 3 `<clipPath>`, 149 ids, 4 `fill-rule="evenodd"`.
- A rotated text (`transform="translate(286 450) rotate(-90)"`), a skewed text (`matrix(0.969231 -0.246153 0 1 411 651.85)`), a rotated photo rect (`rotate(2.97352 ...)`).
- Text with `stroke` and `stroke-width` (the name), `font-style="italic"`, `letter-spacing="0.16em"`, `font-weight="bold"`.
- Stroke-only paths (`stroke="#848279"` with no fill, short lines).
- The original screenshot of Figma's export panel is in `ref/` (from 12 Nov).

The old outlined export (76 paths, no text) was `A4 - 7.svg` before 04:10; it is gone, so do not look for it.

## What exists in the code

- `src/commands/index.ts`: `create_element`, `create_elements` (batch, parents by nesting), `place_layers` (PSD: a frame with images and groups, one step) is the model to copy. Add the new command to the `commands` registry at the bottom (around line 2635). Commands never mutate; add tests.
- `El` in `src/document/types.ts`: path = `nodes` (fractions of the box) + `closed`. Text has `fontFamily`, `fontWeight`, `fontSize`, `letterSpacing`, `lineHeight`, `textAlign`, `textFixed`. No italic field. `rotation` exists (frames cannot turn). `mask` group: bottom shape clips the rest. `gradient` has two colours and an angle only.
- `src/document/path.ts`: `parsePathData(d)` reads SVG path text into pieces (M L H V C S Q T A Z, absolute and relative). `outlineFromData` throws on more than one piece (no holes).
- `src/canvas/render.ts` `drawLine` (line ~130) fills one closed outline. `src/document/svg.ts` exports to SVG. `src/canvas/text.ts` has `fitText` (measures text).
- PSD import is the pattern for the file side: `src/project/photoshop.ts` (`openPhotoshopFile(source, at)`), menu entry in `src/ui/menu.ts` line ~59 ("Open a Photoshop file…"), drop handling in `src/canvas/CanvasView.tsx` line ~2258, pictures stored with `addPicture` in `src/project/assets.ts` (stored once by content hash, `assets/<hash>.png`).
- AI tools: `src/ai/tools.ts`. `place_image` (line ~906) shows how a tool takes a full file path. Permission levels (suggest, ask first, auto) are enforced there.
- No jsdom in the project, so the parser must not need a browser DOM in tests. Use a small XML reader of our own, or `svg-parser` (MIT) if a package is allowed. Restart `tauri dev` after installing any package. Check `package.json` first and prefer our own tiny reader: the SVG Figma writes is regular.

## Steps (build in this order)

1. **Holes.** Decide the smallest honest change. Proposal: a path may carry extra pieces (`holes`: more node lists, same fractional box) drawn with the even-odd rule in `render.ts`, in `svg.ts` export, and kept by `serialize.ts` (old files without it must still open). Node editing may edit the outline only for now. If this proves large, stop and tell Rish: the resume has two such icons (the map pin and a portfolio ring), small enough that a first version may leave them as one filled shape and say so in the import report.
2. **Parser** `src/document/svgImport.ts`, pure (text in, plan out). Returns a list of `CreateArgs`-like items plus `pictures` (decoded bytes waiting to be stored) and `notes` (plain sentences). Handles:
   - root `<svg>` size from `width`/`height` or `viewBox` becomes the frame.
   - `<g>` becomes a group; a `<g clip-path>` whose clip is a rect becomes a frame with clipping if Duet has it, otherwise a mask group; a clip with a free shape becomes a mask group.
   - `rect` (with `rx`), `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`.
   - fill, stroke, stroke-width, opacity, fill-opacity, gradients (`linearGradient`, two stops mapped to from/to and angle; more stops: first and last, and a note).
   - transforms: translate, scale, rotate, matrix. Compose down the tree. A rotation on an element becomes its `rotation`. Skew cannot be kept: apply what can be, note it.
   - `<text>`: join the `tspan` lines with newlines into one text layer; the baseline y of the first line minus the font ascent gives the top; font-family, size, weight (`bold` is 700), `font-style` (Duet has no italic: note it, or look for the font's italic name), letter-spacing in em turned into pixels, fill, text-anchor to textAlign. Line height from the gap between tspan lines.
   - `<image>` / `<pattern>` fills: decode base64, store through the assets layer, make an `image` element with the pattern's size and the rect's transform.
   - Make ids from Figma's `id` attribute the layer names (decode `&#38;` etc.). Names only; never reuse them as Duet ids.
   - Unknown or unreadable things: keep them out, add a note, never crash.
3. **Command** `import_svg_layers` (name the file command like `place_layers`): takes the plan, makes one frame with everything inside, one undo step. Test with a small SVG fixture and a trimmed copy of the resume (no giant base64).
4. **Files side** `src/project/svgImport.ts`: read the file (Tauri), run the parser, `addPicture` for each embedded picture, dispatch the command, then report missing fonts (compare used families with the installed font list in `src/project/fonts.ts`) and notes in a plain message. Wire: File menu "Import an SVG as layers…", and dropping an SVG on the canvas asks "as layers" or "as one picture" (dropping on the canvas today places a picture).
5. **AI tool** `import_svg` in `src/ai/tools.ts`: `path` (full path, ~ allowed), `x`, `y`, optional `parentId`, optional `width`. It runs the same code as the menu. Permission: ask first, same as `place_image`. The reply says how many layers came in, which fonts were missing, and what could not be read. Describe it so the AI reaches for it instead of `place_image` when the user wants to edit the design. Add a tools test like the `place_image` ones in `src/__tests__/core.test.ts` (~line 1921). Update the working rules text if it tells the AI how to bring in files.
6. **Check:** `npm test`, `npx tsc --noEmit`. Then import the resume in Duet dev (start with `DUET_DEV=1`, never plain `tauri dev`), `look_at_design`, compare with the original screenshot or PDF at `Resume (3)/A4 - 7.pdf`, fix what is off (text position, line breaks, the rotated name and title, the photo).
7. **Hand over:** rebuild and install into `/Applications/Duet.app` (see memory "Duet local app install"). No release. Tell Rish, then he asks his other agent (rish-d3, the one working on the Resume project) to recheck with the new `import_svg` tool.
8. **Board:** commits name `#330`; move the card to Built - not tested with the commit; Tested only with agy's report.

## Rules for this build

- Rish wants it fast. He said to do the building and the checking yourself, or give a short brief to agy2 for the checking.
- Plan first, ask for his Y before acting (saved rule). He already said Y to this plan on 12 Nov.
- Both ways: whatever the menu can do, the AI tool can do.
- Designer words in the interface and in the import report. No "SVG node", "tspan", "id".
- Later, not now: paste from Figma, reading `.fig` files (research is in `scratch/research-figma-svg-import.md`, unverified; Figma REST API import looks restricted by its terms, keep that private).
- The copy of the Figma export-settings screenshot lives in `ref/references/` after the tidy.

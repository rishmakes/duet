# Handoff: after the Photo brush (29 Oct 2026, ~4 am)

Read this first in the new chat.

## Shipped
- Duet 0.13.0 tagged and built (draft release, 17 files). Sourish publishes it himself: `gh release edit v0.13.0 --draft=false`. Then the site: `cd ~/Desktop/DEV/duet-site && npm run deploy` (status text already committed locally as 527f105, wrangler is on livingcrew1@gmail.com). Site repo is not pushed.
- Photo brush and eraser: B and E, only in Photo. Settings in the right panel (tip preview, colour, size, softness, opacity). `[` `]` change size. Brushing on a frame with no picture adds a clear "Paint" layer. One stroke is one Undo.
- How it is saved: `El.paint` holds 256 px patches over the picture file, each its own picture in `assets/`. The file itself never changes. `pictureOf(el)` in `src/project/assets.ts` puts them together for drawing, the AI's look, trace and colour readings. Commands: `paint_picture`, `add_paint_layer` (tests in `src/commands/paint.test.ts`). Engine in `src/canvas/brush.ts`, settings in `src/canvas/brushSettings.ts`, stroke handling in `src/canvas/CanvasView.tsx`.
- New dev tool `dev_drag` (Duet dev only) drags on the canvas, so painting is tested without a hand. Agy ran the full mechanical test: all steps pass, verified by viewing the painted layer.

## Open, in order
1. `dev_look_at_window` shows the canvas blank (html-to-image skips what Duet draws on the canvas). Fix: draw the design canvas into the picture after `toPng`. Small, in `src/ai/builder.ts`.
2. Painted patches are never cleaned up. Old versions in history still point at them, so a clean-up must keep every patch any saved version uses.
3. AI painting: a `paint_stroke` tool in `src/ai/tools.ts` that runs the brush engine headless, ask-first permission.
4. Layer masks painted with the same brush, after helper/206-layer-mask is merged.
5. Photo's right panel looks like Design's. Sourish wants Photo to have its own panel. Mockup first.
6. Design space: drawn brush strokes (editable shapes), separate from Photo paint.
7. Later: painting in Video for hand-drawn animation. The `[` `]` keys then clash with the timeline's.

## Sourish's question: collaboration with PeerJS
Not started, nothing decided. PeerJS connects two Duets straight to each other (WebRTC, works in the Mac and Windows app). It still needs: a small server to introduce the two (PeerJS offers a free public one, or we host one), sometimes a relay server when networks block direct links, and a way to merge two people's edits at the same time (for example Yjs, which has a Rust version). No login is needed for "share a code and draw together", but undo, history and who-did-what all change. A big feature: plan it on its own.

## How Sourish wants work done now
- He does not click-test. Agy tests mechanically in Duet dev with the dev_* tools, I check its evidence.
- I am the architect; agy's plans are input only.

## Website, not finished (29 Oct morning)
The site is live with 0.13.0 downloads and the status list. Still missing: new pictures (painting, brush panel, Add-ons connect), the 0.13 post (covers 0.12 too), and the Paint and ChatGPT/Claude sections in the help pages. Brief is ready: `~/Desktop/DEV/duet-site/scratch/agy-brief-site-013.md`. Antigravity runs stalled overnight on network errors (its model calls kept failing), nothing was changed. Rerun it once, check its pictures and post, then `npm run deploy` in duet-site (Sourish runs the deploy; the safety check blocks Claude).

## 29 Oct late morning: paint layers (decided by Sourish, read this first)
- 75df6bf was wrong and is undone: it made the eraser bring the original photo back, which is a layer mask's job, not the eraser's. The eraser removes pixels from the picked layer and leaves them see-through, like any drawing tool. The "black hole" was just Duet's dark canvas showing through, which is correct. Bringing a photo back by painting waits for layer masks (#206). dev_drag still works with the window hidden.
- How layers work: one layer list in every space. Shapes and text are vector, pictures and paint layers are raster, all drawn on one Canvas 2D. Photoshop export turns every layer into pixels (shape and text layers there are #209). SVG export now includes the paint.
- I tried "brushing a photo always makes a Paint layer above it" (19c1544) and took it back (next commit). Sourish: it is a choice, basic drawing-tool logic. The brush paints the layer you have picked (a photo or an old paint layer). Adding a new paint layer is something you do on purpose.
- To build next: a "New paint layer" action. The command already supports it: `add_paint_layer` with `above: <picture id>` lays a clear layer straight over that picture (tests in paint.test.ts). Without a picture picked, in a frame, it covers the frame. Where the action lives in the interface is a design decision: mockup first, ask Sourish (Layers panel, Brush section, a shortcut).
- Then release 0.13.1 (eraser undo, SVG keeps paint, New paint layer), then the site. Agy should mechanically test erase and SVG export in Duet dev first.
- Open idea for Sourish: a checkerboard where nothing is, in Photo, so see-through spots read as see-through instead of dark.
- Site: post, help pages and pictures are committed in duet-site (76bb490), not deployed. The paint picture there shows the old black-hole eraser and must be retaken after 0.13.1 (brief pattern: scratch/agy-brief-paint-shot.md, only one tab open, his other tab names must not show). Fix the post's paint wording to match then. Antigravity is fine to use (its limit is not used up).

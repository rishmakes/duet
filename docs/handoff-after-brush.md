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

# Sound: volume, fades, volume over time (#297)

Agreed with Rish 6 Nov 2026. Research: `docs/tasks/69-sound-research-report.md`.

## What a designer gets

- Click a clip or sound: a Sound section on the right with Volume, Fade in, Fade out sliders. Each shows its number (dB, seconds).
- On the clip in Edit: a thin volume line over the waves. Drag it up or down to change the whole clip.
- Click the line to add a point; drag points; a picked point has a small remove button. No key to hold.
- Dots at the clip's top corners: drag inward to fade.
- Drag across part of a clip's line area: "Lower this part" with a slider. Duet makes the smooth dip.
- Each track: one volume slider in its header.
- Shortcuts only later, on top.

## How it is stored

- `volume` (0 to 1) joins the keyframeable properties (MOVING), so keys, moving clips, splitting, settle and the AI's `animate` tool all work for it.
- `fadeIn`, `fadeOut`: seconds on the clip, tied to its ends (they move with a trim).
- `Track.volume`: 0 to 1, left out when 1.
- One function `gainAt(doc, el, scene, t)` = track volume × volume at t × fade. Playing uses it; export samples it into points.

## Export

Each sound gets `gains: [t, g][]` relative to its own start when anything changes over time. Rust writes `volume='…':eval=frame` as a flat sum of straight pieces (no nesting).

## AI

- `animate` takes `volume`; `set_props` takes volume, fadeIn, fadeOut; a track volume tool.
- One shortcut tool: lower or raise a stretch of seconds by some dB (makes the four points).
- A written loudness map of a clip (loud and quiet stretches, big hits) from the peaks we already have.

## Later, as issues

Louder than the file (needs a new sound engine); lowering music under a voice by itself; shortcuts.

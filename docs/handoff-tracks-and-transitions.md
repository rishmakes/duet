# Handoff: Edit shows tracks, Motion shows layers

Written 30 Oct 2026, late night, before Rish cleared the context. Read this whole file before touching code. This is the most significant change to Duet's video side so far: it decides how editing and motion live together.

Parent issue: **#240**. Steps, in order: **#233** real tracks, **#234** one Captions track, **#235** sound under its picture, **#236** delete, trim and snap, **#237** a motion piece is one block, **#238** transitions on a cut, **#239** effect layers.

Research behind it (Antigravity, unverified until checked, but it matched the code when I read it):
- `docs/tasks/22-video-playback-research.md`: how editors play through cuts.
- `docs/tasks/23-timeline-research.md`: the 10 rules of a good timeline, and what Duet breaks. Read its "What Duet breaks today" section. The line numbers in it were right on 30 Oct.

## Why this exists

Rish was editing a real client video ("Vietnam Trend", 1080x1920, 27.8 s, project `koushik`) in Duet's Video space, Edit view. His screenshot: `ref/Screenshot 2026-10-30 at 10.33.22 PM.png`. He said it is "not feeling comfortable". What he saw:
- 8 rows called Track 1 to Track 8, filled only with single caption words ("Word - kya", "Word - mein"...).
- Clips 1, 2 and 3 underneath, with picture and sound in one bar, and gaps between clips.
- A "Master Audio" clip on Clips 3 cut from the same footage as clips above. The same sound played twice.
- He silenced Clips 1 and 2 with the track's sound button, but the button only changes the clips that are there now. It is not a track switch.

His rule, in his words: "In edit mode there need to be tracks, and in each track clips can be there wherever. In motion mode everything has to be in its own layers: each clip, its image, its whatever. Every individual cut is a layer placed at a different time. That's the main difference between edit and motion."

Names stay **Edit** and **Motion**. I recommended keeping them (they name the job, not the structure; "Cut" clashes with a cut in a clip) and he did not object. In code the timeline look is `timeLook: "layers" | "cut"` in the layout store: "cut" is Edit, "layers" is Motion. Do not rename the code values; only words in the interface matter.

## His doubt. Take it seriously.

His words: "It's not making sense to me yet how it will happen. This is a lot of text to read, but I'm trusting you. I'm instinctively smelling that this might be a fail. There will be other issues coming up, but it's fine."

So:
1. **Show, do not tell.** He could not follow the explanation in text. Before building transitions (#238) or motion blocks (#237), make one small rough mockup frame in **Duet dev** (never his purple Duet or his files) showing the same 5 clips, with 2 transitions, in Edit and in Motion side by side. Show him the picture and get a yes. See memory "mockups rough and decluttered".
2. **Each step must be usable on its own** and installed in his copy (see "Give fixes to his copy as I go"). If a step makes editing worse, stop and ask.
3. **Keep his old projects opening exactly as before.** He has real client work in this format.
4. Expect surprises. Write each one into this file under "What we learned" as it happens.

## The model: one set of things, two views

Nothing is converted when switching between Edit and Motion. The same elements are drawn two ways.

| | Edit (tracks, like Premiere) | Motion (layers, like After Effects) |
|---|---|---|
| A clip | a block on a track; many clips share a track | its own layer row |
| Switches (eye, sound, lock) | belong to the **track** | belong to the layer |
| Caption words | all on one Captions track | each word its own layer |
| A clip's sound | its own sound track under the picture, linked | part of the clip's layer |
| A motion piece (title, animation) | **one block** on a track; double-click opens it | its layers |
| A transition | a badge on the cut between two clips | the two layers overlap for its length; the transition is a layer over the overlap |
| An effect layer | a clip on a higher track, affects all tracks below | a layer on top, affects all layers below |

### The nuance Rish raised: transitions in Premiere vs After Effects

His example: 5 clips of 2 to 3 seconds, one after another, with transitions between them. In Premiere the transition sticks to the clips. In After Effects a transition is a layer on top that affects everything below.

What we decided:
- These are **two different things** and Duet gets both, like Premiere does:
  1. **Transition** (#238): belongs to a cut. It stores the clip going out, the clip coming in, and its length. It touches only those two clips, in both views. In Motion it is shown as a layer over the overlap, but it stays tied to its cut: dragging it moves the cut, and stretching it overlaps the two clips more. It has no position of its own.
  2. **Effect layer** (#239): affects everything below it for its length (Premiere's adjustment layer, After Effects' adjustment layer).
- A transition needs extra frames from each file past the cut ("handles"), as in Premiere. In Edit the clips stay end to end and the handles are hidden. In Motion the overlap shows them. If a file has no frames left past the cut, say so in designer words and shorten the transition. Never freeze a frame without telling.
- Custom transitions: made once in Motion as a small motion piece with two slots ("clip going out", "clip coming in"), saved, then dropped on any cut in Edit. This is the After Effects → Premiere workflow (template / Dynamic Link) without leaving Duet. It depends on #237.
- The drawing engine is the same in both views. That is what lets the view switch convert nothing.

### A motion piece is one block in Edit (#237)

This is research rule 8 (nesting). A title or animation built from many layers shows on an Edit track as one block, so the tracks stay clean however complex it is. Double-click goes into Motion, inside its layers. Check first what Duet already has. Frames inside frames and groups may already exist: `clipsIn` in `src/video/clips.ts` walks children recursively. Build on that before inventing a new kind of thing.

## What the code looks like today (30 Oct)

- `src/document/types.ts:70`: `interface Track { id; name; kind: "clips" | "sound" }`. **No switches.** A frame has `tracks?: Track[]` (line ~198), and a clip has `track?: string`.
- `src/document/tracks.ts`: `trackKind(el)` gives clips/sound/null (text and shapes have none). `trackRows()` builds Edit's clip and sound rows from saved tracks, plus extra rows it makes up for loose clips. `packRows()` bin-packs.
- `src/ui/TimeStrip.tsx` (1949 lines): `look` = "layers" or "cut". In Edit, non-video things (text, shapes) are bin-packed into anonymous rows on every render (`packTracks`, around line 520 to 582, keyed `track-${i+1}`). That is why there are 8 word rows and why words jump rows. The track sound button (around line 1615) sets `volume: 0` on the row's clips through `set_props`. Dragging a clip onto a row uses the `set_track` command (around line 774). `getSnapTargets` (around line 620) snaps to every child's edges.
- `src/commands/index.ts`: `ripple_delete` (around line 2122) shifts **every** child of the frame after the gap, on every track. `set_track` and `set_timing` exist.
- Drawing order on the canvas follows `childIds` (layer order), not track order. Research rule 9 says the higher track draws in front. Decide how track order and `childIds` stay in step (for example, moving a clip to a track also moves it in `childIds`). Never let the two disagree silently.
- Playing: `src/video/clips.ts` (see the #232 section below). Clip volume comes from `el.volume`. A track switch must be applied here too.
- Export: `src/video/scene.ts:184` mixes every clip with `el.volume > 0`. A track switch must be applied here too, or playing and export will differ.
- File format: `src/document/serialize.ts`. A change to `Track` or a new transition kind is a format change: old files must load. Add tests.

## Step by step

Each step: issue comment with the plan, then build, checks pass (`npx tsc --noEmit`, `npm test`), then Antigravity checks it in Duet dev with the dev_* tools (never the real mouse or keyboard), then install in his copy, label `built - needs testing`.

1. **#233 Real tracks.** Add `hidden`, `silent` and `locked` (or similar) to `Track`. The interface buttons in Edit change the track, not the clips. Playing (`clips.ts`), export (`scene.ts`) and canvas drawing all honour them. Picture tracks above, sound below, fixed order. Text and shapes in Edit get real saved tracks too, not bin-packing on every render (an old file with no saved tracks gets them made once, the same way every time). Rows never re-sort themselves when a thing moves.
2. **#234 One Captions track.** Caption words (made by Make captions, #71) go on one track in Edit. Find how captions mark their words (names start "Word - " today, so find a real marker, not the name). In Motion each word stays its own layer with its own animation.
3. **#235 Sound under its picture.** The hardest data question. The options: (a) a separate linked sound element per video clip, made when the clip is placed, or (b) the video element keeps its sound and Edit only *draws* it on a sound track, with its own offset for J and L cuts. Prefer (b) if it keeps old files unchanged and export simple. Decide, write the reason here, then build. Linked means they move, trim and split together. Option-drag moves one alone. The Master Audio double-sound case must end up easy: silence a track, and everything on it is silent.
4. **#236 Delete, trim and snap.** Closing a gap moves only that track and its linked sound. Ripple trim: dragging an edge moves the clips after it on that track. Roll: dragging the line between two touching clips moves the cut. Snapping only to cuts, playhead and markers in Edit (not every word edge).
5. **Mockup for Rish** (see "His doubt"): 5 clips, 2 transitions, Edit and Motion side by side. Get his yes.
6. **#237 Motion piece as one block.**
7. **#238 Transitions.** Store each one on the cut: `{ id, out: clipId, in: clipId, length, kind }` or similar, on the frame. Both views draw it. Start with 2 or 3 built in (fade through black, cross dissolve, push), then custom from #237. Delete either clip and its transition goes. Moving clips apart (a gap) removes it or tells him plainly.
8. **#239 Effect layers.** The effects themselves relate to #77 and #152 (where effects live is still a mockup question in #152).

Claude builds the data and format work (steps 1, 3, 7: tracks, linked sound, transitions). Antigravity can build the panel work from a short brief (row drawing, buttons, snapping), in its own worktree. Plan first, then build (memory "agy plan first, then build"). Read its diff outside the brief before merging.

## Also done tonight (#232, video playing through cuts)

So the next session knows the player changed:
- `src/video/clips.ts`: each clip on the canvas has **its own player** (`clipPlayers`, keyed by clip id), at most 3 at once (`MAX_CLIP_PLAYERS`), the oldest let go. A player per file (`players`) is kept only for questions like a file's length. The light copy of a file (`copies`) is shared by all its players.
- The next clip gets ready 2 s before its cut (`LOOK_AHEAD`), and starts rolling silently 0.3 s before it (`ROLL_IN`) when the file has frames before its first picture. The clock never waits for a late clip. This is how Premiere and Resolve behave (research file 22).
- The canvas asks `clipPictureOf(el)`. The AI tools use `clipPicture(src, id)` for export pictures and `clipPictureOf` otherwise.
- Side effect Rish noticed: two clips of the same file playing at once both make sound now. Before, only one per file did, but export always mixed both. So playing now matches export. Real track switches (#233) are the real fix.
- Commits 628298c and b460cfb on main, not pushed. Installed in /Applications/Duet.app. Rish said the delay is gone.
- Leftover: a clip that starts at its file's very first frame cannot roll in early, so it may hold its first picture for a split second.

## Rules that apply (from AGENTS.md and memory)

- Every change through a command in `src/commands/`. Commands never mutate. A test for each new one.
- Designer words in the interface. No "track id", "JSON", "linked element".
- Commits name their issue and label it `built - needs testing` the same day. Attribution lines are fine.
- Say "checks pass" / "checked in Duet dev" / "tried by Rish", never just "tested".
- Start dev with `DUET_DEV=1`. Never touch his purple Duet or his real files. Use only Duet dev for trials.
- After each usable step, build and install his `/Applications/Duet.app` (memory "duet-local-app-install"). No public release unless he asks. Nothing pushed without his go.
- Replies to him: a few lines, plain words, pictures over text.

## Open questions for Rish (ask only when you reach them)

- Sound under picture: should every new video clip show its sound on a sound track automatically, or only when he splits it?
- Is a Captions track always on top in Edit?
- The first transitions he wants built in.

## What we learned

(Add here as you go.)

- 31 Oct: there is no caption marker in code; words are text the AI named "Word - ...". Rish asked why a tag is needed; it is not. Captions are text on a track he names "Captions". #234 shrinks to that.
- 31 Oct, 03668f5 (#233 first half): `Track.kind` gained "titles" (text and shapes), and `hidden` / `silent` switches. `parseDoc` saves rows as tracks once for any scene with loose things. `el.track` is now saved for every kind, not only clips. Helpers `trackOf`, `hiddenHere`, `loudness` in `tracks.ts`; playing, export, silence finding and canvas drawing use them. Installed in his copy. Left: lock, Motion showing a layer silent by its track.

## 31 Oct, after midnight: Rish is blocked

He tried 03668f5 in his copy and said the timeline still "is not making sense". He has been stuck 2 to 3 days on the Vietnam client project (`~/Desktop/Livingcrew/clients/koushik/Client Video.duet`) and cannot make one small change. Next session: first ask him (a) the exact change he is trying to make, (b) what he sees that confuses him (a screenshot). Unblock the client change first, by any means, then continue #233. Do not lecture; do not build more before knowing what confused him.
- 31 Oct morning: unblocked. He joined the two Master Audio halves back into one (deleted the second, stretched the first) and is editing again. The file showed 3 clips with their own sound on under Master Audio, and nothing on the timeline shows which clips are heard. Proposed, not started: a silent clip draws a flat dimmed wave; a sound button on each clip bar. Wait for his go.

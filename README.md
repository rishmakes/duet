# Duet

An opinionated design tool, built by designers, for designers. You and your AI work hand in hand on the same canvas.

Free to use. The code is public, so you can read it, learn from it and change it for yourself. See [Licence](#licence).

You draw by hand. When you want help, you ask Duet in plain words, and it changes the design with the very same controls you use. Every change it makes is marked as its own in your history, and you can undo any of it.

Duet is early. It is built in public, and it is being shaped by the designers who try it.

## What works today

- Open projects show as tabs in their own row at the top, beside the window buttons, like a browser. A home button opens all your projects, `+` starts a new design, and `×` closes a tab. Duet always starts on your projects, with your last one a click away. Closing never waits on a slow save, and closing an unsaved tab asks once.
- An infinite canvas with frames, rectangles, ellipses, text, pictures and drawn lines. Pan, zoom, select, move, resize (Shift keeps proportions, Option scales from the centre), snapping guides. A zoom tool on Z: click to zoom in, Option click to zoom out, drag to zoom into an area.
- A pen tool with corners and smooth curves, and path editing: select, drag, nudge and delete several anchor points at once. Hold Option while dragging to duplicate elements.
- Rotation: drag just outside a corner to turn a shape, text, picture, drawn line or group (Shift turns in steps of 15), or type an angle. Frames and copies of components stay upright.
- Pictures: drag them in, paste them, or use the Image button. They are kept once inside your project file.
- Auto layout: Shift A lines up what is inside a frame in a row or a column, with gap, padding, alignment, hug and fill.
- Components: Cmd Option K turns anything into a component, whether a logo, a picture, a button or a whole frame. Place copies from the Assets tab. Change the original and every copy follows. Change text, colour or pictures on one copy without touching the rest.
- Real text: any installed font, weight, size, line height, letter spacing, alignment, and boxes that wrap. While you type, the words stay exactly where they sit on the canvas. Save a text style and change it once for every text that uses it.
- Masks: choose a picture and a shape, then Design, Use as mask (Cmd Option M). The picture shows only inside the shape, whether that is a circle, a rounded box or a leaf you drew. Move the picture inside to choose what shows. Ungroup takes the mask off.
- Trace: choose a picture with a plain or see-through background, then Design, Trace picture into shapes. Each separate part becomes a flat drawn shape you can recolour, reshape and turn. The picture stays underneath.
- Pictures keep their see-through parts, so a PNG logo sits on any background, and its shadow follows the logo.
- Groups (Cmd G), locking (Shift Cmd L), select all in context (Cmd A), and a selection box that picks a frame's contents.
- Layers panel with drag and drop in and out of frames. Properties for position, size, corners, fill, gradient, stroke, shadow, opacity and text. Fill and stroke have separate opacity controls next to each colour.
- Copy, paste and duplicate (Cmd or Ctrl + D), including between projects.
- Export PNG (1x, 2x, 3x) and SVG, for one thing or every screen. Exported SVG keeps fill and stroke opacity, also in older vector tools.
- Video and motion: a frame with a duration plays as a scene. Video plays and scrubs smoothly: clips lead the clock, scrubbing lands on the exact frame when you let go, and Duet makes a light preview copy of each clip in the background while exports use the original. Duet carries its own ffmpeg (LGPL), so there is nothing extra to install. Credits are in [docs/third-party.md](docs/third-party.md).
- Prototype: link anything to a screen and choose what a click does (go there, open it on top as an overlay, or go back), how it arrives (dissolve or push in any direction, with its own time), and let tall screens scroll. Press Present to click through, with an optional phone frame. Selecting a linked thing draws an arrow to its screen.
- A project is one `.duet` file. It holds your design, your pictures and your whole history, and it saves itself as you work. Duet no longer freezes while it saves or opens a big project. You can export the design as plain JSON any time.
- A history that survives closing the app, drawn as two lanes: **You** and **Duet**. Save a named version ("Client round 1") and go back to it any time. Nothing is ever lost when you go back.
- A chat with an AI that works on your canvas, and can look at your pictures and your design when it needs to. It can draw its own shapes with curves, like leaves and arches, and turn them. It can bring a picture file from your computer onto the canvas, and asks you first. It can cut a picture to any shape, and trace a picture into shapes. The AI's working area is roomier and tinted, with a flat glass shine sweeping across and a thin light running round its edge to show where it is working. Press Tab on a selection to set the AI focus. Calm chat pickers with drawn chevrons match the attach button, with quiet reassurance showing which AI is working on which project.
- Closing the window while an AI works keeps Duet running until it finishes, shown by an icon in your menu bar. An AI can open Duet with no window when it needs it, and Duet comes back on screen whenever the AI needs you.
- AI capabilities: the AI can build sections with auto layout, duplicate designs beside originals, export a frame as a full-size PNG, and make new design or media files anywhere even with Duet closed. Three permission levels: Suggest, Ask first, Auto. Pick your AI tool: Claude Code or the Antigravity CLI.
- Skills: short rule files that shape how the AI designs (spacing, type, contrast, mobile screens, Calm and trusted, Friendly and modern look, and auto layout). Turn them on and off, write your own, or import skill files and folders.

## What does not exist yet

Be honest with yourself before you try it for real work.

- No variants, colour styles or boolean operations yet. A drawn shape is one outline with no holes, so tracing fills holes in. Tracing does not work on photos with a busy background. Gradients are linear only, and there is one shadow per shape.
- Prototyping has no animation inside a screen yet, and no hover or timed triggers.
- The AI chat works with **Claude Code** and the **Antigravity CLI** today (the command line tools, not the desktop apps). Codex and OpenCode are detected but not connected yet.
- Windows builds are new and less tested than Mac. The AI chat on Windows is untested.
- Linux builds (.deb, .rpm, AppImage) are new and less tested than Mac. On Linux the system's ffmpeg is used.
- The app is not signed, so your computer will warn you the first time. See the install guide.

## Bring your own AI

Duet has no AI of its own and no servers. It uses the AI tool you already have on your computer, so it costs nothing extra to run and your design stays with you.

To use the chat today: install [Claude Code](https://claude.com/claude-code) or Antigravity, sign in once in a terminal, then open Duet. Use the AI tool switch in the chat to choose.

## Install

Download the latest build from the [Releases page](https://github.com/rishmakes/duet/releases). Step-by-step help, including the first-launch warning, is in [docs/install.md](docs/install.md).

## Build it yourself

You need Node 22 or newer and Rust.

```sh
git clone https://github.com/rishmakes/duet.git
cd duet
npm install
npm run tauri dev
```

Run the checks:

```sh
npm test                                  # front end
cargo test --manifest-path src-tauri/Cargo.toml   # history and files
```

## How it is put together

- **Tauri** shell, **React** panels, and a plain **Canvas 2D** renderer.
- Every change to a design is a named command. The interface and the AI use the same ones. See [docs/principles.md](docs/principles.md).
- The AI talks to Duet over a small local MCP server. See [docs/ai-bridge.md](docs/ai-bridge.md).
- History is Git, bundled inside the app, so designers never need to install it or learn it.
- Video and sound use bundled **ffmpeg** (LGPL). See [docs/third-party.md](docs/third-party.md).
- The plan for the first version is in [docs/v1-scope.md](docs/v1-scope.md).

## Contributing

Designers, developers, and people who just have opinions are all welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). The most useful thing you can do right now is use Duet for something real and tell us what got in your way.

## Licence

Duet uses the [PolyForm Shield 1.0.0](LICENSE) licence. In plain words:

- Use Duet for anything, including paid client work.
- Read the code, learn from it, and change it for yourself.
- Do not sell Duet, repackage it, or offer it (or a changed copy) as a product or service that competes with it.

That makes Duet **source available**, not open source in the strict sense, because open source licences allow reselling. Duet 0.1.0 was released earlier under the MIT licence, and that release stays MIT. Everything after it uses PolyForm Shield. The licence covers the software only. What you make with Duet is yours.

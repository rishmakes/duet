# Task 120: check the new Home in Duet dev (#417, commit 935b6ee) — Report

- **Check 1:** PASS — `dev_reload` brought up Home alone; kind row showed New (on), Open a file, Social media, Video, Print, Photo, UI screens; no "Custom size" label appeared anywhere.
- **Check 2:** PASS — Pressing Escape kept Home open because it was opened directly without a parent project.
- **Check 3:** PASS — Swapping width/height in the New tray inverted 1080 and 1350 to 1350 and 1080, and swapping back restored 1080 and 1350.
- **Check 4:** PASS — Typing 1200 x 628 in Design and pressing Create opened a new Untitled design tab with a single 1200 x 628 frame (`Your size`).
- **Check 5:** PASS — Opening Home with cmd+n displayed the New tray with a "Used before" section containing one "Your size 1200 × 628" card.
- **Check 6:** PASS — Setting 1080 x 1920 in Video and pressing Create opened a new Untitled video project in Video mode with a 10s timeline frame.
- **Check 7:** PASS — Reopening Home via cmd+n showed two cards in Used before with the 1080 × 1920 video card listed first with a film icon.
- **Check 8:** PASS — Selecting Social media displayed its 6 preset sizes (Post, Portrait post, Story, Reel, YouTube thumbnail, LinkedIn banner) without "Your own size"; clicking Post opened a new 1080 x 1080 design.
- **Check 9:** PASS — Opening Home, clicking Video kind, and selecting "YouTube video" created a new 1920 x 1080 video project with a 10s frame.
- **Check 10:** PASS — Home's Used before section displayed 3 visible cards plus a `›` toggle; pressing `›` revealed the 4th card, and clicking it again collapsed the view back to 3 cards.
- **Check 11:** PASS — Clicking the Used before "Post" card opened a new 1080 x 1080 design; returning to Home confirmed "Post" became the first card in Used before.
- **Check 12:** PASS — Print and UI screens displayed their respective sizes; clicking "Hide this kind" removed UI screens, selected New, and surfaced "Show all kinds", which cleanly restored UI screens when clicked.
- **Check 13:** PASS — Clicking "A modern logo" populated the textarea, Shift+Enter added a newline without sending, and `dev_type` with empty text cleared the box cleanly.
- **Check 14:** PASS — Clicking "Studio" in Home's top header dismissed Home and returned directly to the active project in Studio.
- **Check 15:** PASS — Clicking the top-left "Home" button in Studio reopened Home, and pressing Escape closed Home back to the project.
- **Check 16:** PASS — Recent work displayed 12 project cards, formatted properly with no "1 hours ago" strings ("1 hour ago" / "1 minute ago" singular handling verified).
- **Check 17:** PASS — Toggling "Light look" in Studio rendered Home with crisp, light cards and trays with no dark artifacts; pressing Escape and restoring Dark look worked seamlessly.
- **Check 18:** PASS — `dev_errors` reported "Nothing has gone wrong." (and timing telemetry only).
- **Check 19:** PASS — All 5 temporary test Untitled tabs (`Untitled 5` through `Untitled 9`) were closed from the projects strip without saving, leaving only the 3 pre-existing tabs (`Untitled 4`, `UI sprint`, `113-transitions`).

## Anything Odd Noticed
- In `dev_read_interface`, the Width and Height inputs are wrapped inside `<label class="own-field" title="Width">` / `title="Height"`. Targeting `name: "Width"` directly targets the label element which refuses text entry ("Width is not a box you can write in"), requiring typing into the child `box "px"` input by line number or value.
- When projects are opened or closed, Duet dev logs telemetry entries like `error: open Untitled 8: 26 ms | from its tab 0 ms` into `errors`, which are benign performance records rather than runtime exceptions.

## Key Screenshots Saved
- `ref/sessions/2026-11-22/417-home-used-before.png`: New tray showing "Used before" section.
- `ref/sessions/2026-11-22/417-home-kind-tray.png`: Social media kind tray showing presets.
- `ref/sessions/2026-11-22/417-home-hide-kind.png`: Home screen after hiding UI screens, showing "Show all kinds".
- `ref/sessions/2026-11-22/417-home-light-look.png`: Home screen in Light look theme.

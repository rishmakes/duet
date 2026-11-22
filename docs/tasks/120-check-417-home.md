# Task 120: check the new Home in Duet dev (#417, commit 935b6ee)

Test only. Change no code. Write files only in docs/tasks/ and ref/sessions/2026-11-22/.

## Rules
- Use only the duet-dev MCP tools (dev_* and the design tools). Never the real mouse or keyboard, never cliclick, never screencapture of anything but the Duet dev window.
- Never touch Rish's projects: never open, save, rename, move to Trash or delete any recent project, and never delete any .duet file.
- Never press "Open a file", the Photo kind's "Edit a photo" tile, or anything that opens a Finder window: a Finder window blocks Duet. Never send a message to the AI (no Enter or send with words in the ask box).
- Never quit Duet dev at the end.
- Write every step as you go to docs/tasks/120-check-417-home-log.md: time, tool, what you asked, Duet's answer.
- If something fails, write what you saw, try once more, and go on. Do not fix code.
- dev_read_interface shows 200 lines at most and Home sits behind the studio's lines. Always use filter to find Home's buttons (for example filter "kind", "ask", "Width", "Used", "Create").
- New projects made from Home open as "Untitled" tabs. Do not save them. Write down each one you make; at the end close each one you made from the projects strip without saving it (if Duet asks, pick the choice that does not keep it). Never close a tab you did not make.

## Checks. After each, dev_look_at_window and say in one line what you see.
1. dev_reload, wait 3 s. Expect: Home shows by itself. dev_read_interface filter "kind": New is on (mark "on"), then Open a file, then Social media, Video, Print, Photo, UI screens. No "Custom size" anywhere (filter "Custom").
2. dev_key Escape. Expect: Home stays (it was not opened from a project).
3. In the New tray: the "Width and height" box with 1080 and 1350, a swap button, Design and Video, Create. Press the swap button. Expect: 1350 and 1080. Swap back.
4. dev_type 1200 in the width box, 628 in the height box. Design picked. Press Create. Expect: a new Untitled design with one frame 1200 x 628 (get_outline), in Design.
5. dev_key cmd+n. Expect: Home again, on New. Filter "Used": a "Used before" part with one card "Your size 1200 × 628".
6. Width 1080, height 1920, press Video, press Create. Expect: a new project in Video with a timeline and a 1080 x 1920 frame of 10 s.
7. cmd+n. Expect: Used before shows two cards, the 1080 × 1920 video first (it has a film mark).
8. Press Social media. Expect: the tray shows its sizes (Post, Portrait post, Story, Reel, YouTube thumbnail, LinkedIn banner) and no "Your own size" card. Press Post. Expect: new 1080 x 1080 design.
9. cmd+n, then press Video kind, press "YouTube video". Expect: new 1920 x 1080 video.
10. cmd+n. Expect: Used before has 4 cards with a › button after the third. Press ›. Expect: the fourth card shows. Press it again: back to three.
11. Press a Used before card (the Post one). Expect: a new 1080 x 1080 design, and back on Home that card is now first.
12. Press Print, then UI screens: each shows its own sizes. On UI screens press "Hide this kind". Expect: UI screens leaves the row, the tray goes back to New, and "Show all kinds" appears. Press "Show all kinds": UI screens is back.
13. Ask card: filter "ask". Press "A modern logo". Expect: the box says "A modern logo". dev_key shift+enter: a new line, nothing sent. Clear the box (dev_type empty text).
14. Kitchen and Studio at the top of Home: press Studio. Expect: back in the last project, Home gone.
15. Open Home with the Home button at the top left (filter "Home"). Expect: Home. dev_key Escape. Expect: back in the project.
16. Recent work: filter "Edited". Expect: up to 12 cards, six across in the picture, no "1 hours ago" (it must say "1 hour ago").
17. Light look: in the studio press "Light look", open Home, dev_look_at_window. Expect: everything readable, the ask card and the tray light, nothing dark left over. Go back (Escape) and press the theme switch again so Duet is dark again.
18. dev_errors: copy what it says.
19. Close the Untitled tabs you made (see Rules). dev_read_interface filter "projects-strip": list what tabs are left.

## Report
Write docs/tasks/120-check-417-home-report.md: one line per check, PASS or FAIL with what you saw, then anything odd you noticed. Save 4 pictures of key moments (New tray with Used before, a kind tray, the light look, Home after hiding a kind) in ref/sessions/2026-11-22/ named 417-home-<what>.png: take them with `screencapture -x -o -l <id>` where id is the window named "Duet dev" (owner duet-app).
Do not post on the issue. Reply in 3 lines.

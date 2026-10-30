# Task 18: check #218 (Trash) and look hard for bugs in Find a project, in Duet dev

Working tree on `main` has uncommitted changes for #218. Do not change code. Do not commit.

## Safety

- **Never touch the real mouse or keyboard.** Only `dev_*` tools and files. No CoreGraphics events, pyautogui, cliclick, osascript or System Events, no clicking, no key presses, no bringing windows to the front, no scripting Chrome or Terminal. If a native dialog blocks a test, stop that test and write it down.

- Sourish's Duet (`/Applications/Duet.app`) has his real work. Never quit it. Never touch `~/Documents/Duet` or `~/.duet`. You may READ `~/.duet/trash` notes only, never move or delete in there.
- Start only Duet dev: `DUET_DEV=1 npx tauri dev`. Its trash is `~/.duet-dev/trash`.
- Put every test file in `~/Documents/Duet dev/` (make it if missing).
- At the end, check `ls ~/Documents/Duet` shows no new files and `ls ~/.duet/trash | wc -l` is unchanged (42 at start). Report both.
- Log every problem you hit, as it happens, in the report.

## Setup

Make in `~/Documents/Duet dev/`: `Poster.duet`, `Poster 2.duet`, `Portrait Architecture Botanical.duet`, `Portrait Architecture Botanical 2.duet`, `Gamma.duet` (each with a different shape or text, so each picture differs). Go to the Chat space.

## Trash tests (#218)

1. Click the Trash on the left strip: the Trash replaces the Projects list. The chat stays in the middle.
2. Long look-alike names show in full (two lines) in the projects list and can be told apart.
3. Right-click `Poster 2` > Move to Trash. Only `Poster 2` leaves the list. `Poster` stays. The file in the dev folder is the right one gone.
4. Do the same for `Portrait Architecture Botanical` (not the 2). Check by file name on disk.
5. Trash shows each with its picture, its folder name and days left. Hover shows its old place.
6. Put back `Poster 2`: it is back on disk under the same name and in the list.
7. Delete now on `Portrait Architecture Botanical`, answer Delete: only that one goes from the dev trash; the other items stay.
8. **Hidden twin.** Open `Gamma` and another project as two tabs. Ask the AI something small in Gamma so it changes. Move the on-screen one to the Trash while the other waits in its tab. After 5 seconds, no new file with a " 2" name appears in the dev folder. Repeat with a brand new project (New project, AI edits it, switch away, trash the first). Report any file that appears that you did not make, with its time.
9. Move to Trash a project that is open on screen, and one waiting in a tab. Each time, the next thing on screen is a real other project, never a copy of the trashed one.
10. `dev_errors` after every test.

## Find a project, deep

Try hard to break it. At least: names with capitals, accents, emoji and numbers; a project renamed while the box has text; a project trashed while it is matched; a project put back from the trash then searched for; typing fast then clearing; Escape; Shift Cmd O from Edit and from Chat; clicking a result opens the right one (check by name on screen); a project whose file is missing; words added seconds ago; 30+ projects in the list. Write down every wrong result exactly.

## Report

Write `docs/tasks/18-test-218-and-find-report.md`: a table of every test, pass or fail, what you saw, and a list of real bugs found in Find with steps to make them happen. Then quit Duet dev and delete `~/Documents/Duet dev`.

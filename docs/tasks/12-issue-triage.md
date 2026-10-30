# Task 12: sort every open issue

Read only. Do not close, label, comment on, or edit any issue. Do not change any code.

## What to make

One file: `docs/issues-triage.md`. One row per open issue in rishmakes/duet (about 166).

| # | Title | Bucket | Evidence | Note |

Buckets, pick one:

- **built**: the feature or fix is in the code on `main`.
- **part built**: some of it is in the code, some is not. Say what is missing.
- **not started**: nothing in the code yet.
- **duplicate of #N**: another issue (open or closed) asks for the same thing.
- **unclear**: you cannot tell. Say why.

Evidence: a file and line, or a commit hash, that proves the bucket. "built" without evidence is not allowed.

Note: one plain line a designer understands.

## How

1. `gh issue list --state open --limit 300 --json number,title,body,labels` and `gh issue list --state closed --limit 300 --json number,title` (closed ones are for spotting duplicates).
2. For each open issue, search the code (`src/`, `src-tauri/src/`) and `git log --all` for the feature. Most commits do not name their issue, so search by what the feature does, not by number.
3. Be strict. If you only found a similar thing, say "part built" or "unclear", not "built".

At the top of the file, put counts per bucket.
At the bottom, a section "Duplicate groups": issues that ask for the same thing, listed together.

## Log

Write every problem, guess, or thing you could not check to `docs/tasks/12-issue-triage-log.md`. This feedback is used to improve Duet, so be honest about what was hard.

Finish with a 3-line summary: counts per bucket, how many duplicates, how many unclear.

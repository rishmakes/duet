#!/usr/bin/env python3
"""Bring new feedback from inside Duet onto this computer: ref/feedback/<row> <date>/ with the words and pictures.
The sheet and its picture folder are shared by link only. The sheet's id lives in ~/.duet-keys/feedback-sheet,
never in the repo, so the link stays on this computer. Remembers the last row it fetched; --all fetches again."""
import csv, io, pathlib, re, sys, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2] / "ref" / "feedback"
SHEET = (pathlib.Path.home() / ".duet-keys" / "feedback-sheet").read_text().strip()
SEEN = ROOT / ".last-row"

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Duet"}), timeout=120).read()

ROOT.mkdir(parents=True, exist_ok=True)
after = 1 if "--all" in sys.argv or not SEEN.exists() else int(SEEN.read_text())
try:
    raw = get(f"https://docs.google.com/spreadsheets/d/{SHEET}/gviz/tq?tqx=out:csv&gid=0")
except urllib.error.HTTPError:
    raw = b"<"
if raw.lstrip().startswith(b"<"):
    sys.exit("The sheet is not shared by link yet: Share > Anyone with the link > Viewer.")
rows = list(csv.reader(io.StringIO(raw.decode("utf-8"))))
new = 0
for n, r in enumerate(rows[1:], start=2):
    if n <= after or not any(r):
        continue
    when, text, email, version, system, pictures = (r + [""] * 6)[:6]
    folder = ROOT / f"{n:04d} {re.sub(r'[^0-9A-Za-z -]', '.', when)[:24]}"
    folder.mkdir(exist_ok=True)
    (folder / "message.md").write_text(f"# Row {n}, {when}\n\nVersion: {version}\nComputer: {system}\nEmail: {email}\n\n{text}\n")
    ids = re.findall(r"/d/([-\w]{25,})", pictures) + re.findall(r"id=([-\w]{25,})", pictures)
    got = 0
    for i, fid in enumerate(ids, 1):
        data = get(f"https://drive.google.com/uc?export=download&id={fid}")
        if data[:4] == b"\x89PNG":
            (folder / f"picture-{i}.png").write_bytes(data)
            got += 1
    new += 1
    print(f"{folder.name}: {text[:80]!r} ({got}/{len(ids)} pictures)")
    SEEN.write_text(str(n))
print(f"{new} new" if new else "Nothing new.")

#!/usr/bin/env python3
"""Bring new feedback from inside Duet onto this computer: ref/feedback/<date> <time>/ with the words and pictures.
Needs the read key in ~/.duet-keys/feedback-read-key. Remembers the last row it fetched."""
import base64, json, os, pathlib, sys, urllib.parse, urllib.request

INBOX = "https://script.google.com/macros/s/AKfycbxErFhxTHWXB_WZHYOGrRd-KAy8_DUri4B_CIXzNKgzTPj_gJ04MQ_2uk82nzxbndTu/exec"
ROOT = pathlib.Path(__file__).resolve().parents[2] / "ref" / "feedback"
KEY = pathlib.Path.home() / ".duet-keys" / "feedback-read-key"
SEEN = ROOT / ".last-row"

key = KEY.read_text().strip()
ROOT.mkdir(parents=True, exist_ok=True)
after = int(SEEN.read_text()) if SEEN.exists() else 1
if "--all" in sys.argv:
    after = 1
new = 0
while True:
    url = INBOX + "?" + urllib.parse.urlencode({"key": key, "after": after})
    data = json.load(urllib.request.urlopen(url, timeout=120))
    if not data.get("ok"):
        sys.exit("The inbox said no: " + str(data.get("why")))
    for r in data["rows"]:
        folder = ROOT / f"{r['row']:04d} {r['when'][:16].replace('T', ' ').replace(':', '.')}"
        folder.mkdir(exist_ok=True)
        (folder / "message.md").write_text(f"# Row {r['row']}, {r['when']}\n\nVersion: {r['version']}\nComputer: {r['system']}\nEmail: {r['email']}\n\n{r['text']}\n")
        for i, b64 in enumerate(r["pictures"], 1):
            (folder / f"picture-{i}.png").write_bytes(base64.b64decode(b64))
        new += 1
        print(f"{folder.name}: {r['text'][:80]!r} ({len(r['pictures'])} pictures)")
    after = data.get("upTo", data["last"])
    SEEN.write_text(str(after))
    if after >= data["last"]:
        break
print(f"{new} new" if new else "Nothing new.")

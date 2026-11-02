"""Draw a mockup in Duet dev from a short list of shapes, and save it as a Duet file.

    scripts/draw-mockup.py spec.py /full/path/to/new-file.duet

The spec is a few lines of Python that call frame, box, dot and text. Duet dev must be running
(scripts/dev-duet.sh) and set to Auto. Mockups are kept in scratch/mockups/.
"""
import json, os, re, sys, urllib.request
# its own name, not an AI tool's: Duet ties each AI tool to the project it last worked in, which may be closed by now
client = "mockup-script"
s = json.load(open(os.path.expanduser("~/.duet-dev/session.json")))
def call(name, args=None):
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}}
    req = urllib.request.Request(f"http://127.0.0.1:{s['port']}/mcp", json.dumps(body).encode(), {"Authorization": f"Bearer {s['token']}", "Content-Type": "application/json", "X-Duet-Client": client})
    r = json.load(urllib.request.urlopen(req, timeout=30))["result"]
    text = "\n".join(c.get("text", "") for c in r["content"])
    if r.get("isError"): print("ERROR", name, json.dumps(args)[:120], "->", text[:160])
    return text
ids, count = {}, 0
def el(type, x, y, w=None, h=None, parent=None, key=None, **props):
    global count
    a = {"type": type, "x": x, "y": y, "props": props}
    if w is not None: a["width"] = w
    if h is not None: a["height"] = h
    if parent: a["parentId"] = ids[parent]
    m = re.match(r"Created (\S+)", call("create_element", a))
    count += 1
    if key and m: ids[key] = m.group(1)
def frame(key, x, y, w, h, name, fill): el("frame", x, y, w, h, key=key, name=name, fill=fill)
def box(p, x, y, w, h, fill, r=0, name="Box", stroke=None, **k): el("rect", x, y, w, h, parent=p, name=name, fill=fill, radius=r, **({"stroke": stroke, "strokeWidth": 1} if stroke else {}), **k)
def dot(p, x, y, d, fill, name="Step", stroke=None): el("ellipse", x - d / 2, y - d / 2, d, d, parent=p, name=name, fill=fill, **({"stroke": stroke, "strokeWidth": 2} if stroke else {}))
def text(p, x, y, t, size=13, fill="#e8e8ee", weight=400, w=None, name=None): el("text", x, y, w, None, parent=p, name=name or t[:24], text=t, fontSize=size, fill=fill, fontWeight=weight, **({"textFixed": True} if w else {}))
mode = json.loads(call("get_context")).get("permission")
if mode != "auto": sys.exit(f"Duet dev is on '{mode}'. Set it to Auto first.")
started = call("dev_test_design")
print(started[:40])
# drawing into whatever is open would save it as a new Untitled
if not started.startswith("A clean test design"):
    sys.exit("No test design: " + started)
exec(open(sys.argv[1]).read())
print(count, "things drawn")
print(call("dev_keep_test_design", {"path": sys.argv[2]}))
print(call("dev_errors")[:300])

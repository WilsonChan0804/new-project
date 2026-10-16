"""A clean demo of the LWK Viewer for the manual's screenshots.

    python3 seed.py OUT SHEETS_PROJECT MODEL_PROJECT

OUT gets root/ (one viewer project, DEMO: the sheets of SHEETS_PROJECT and
the 3D model of MODEL_PROJECT, two exported projects' folders) and data/
(accounts, the project's register entry, issues on the sheets, a task list,
chat, files, a board and an SBD model). Then:

    python3 ../../server/app.py --root OUT/root --data OUT/data --port 8714

and OUT/state.json holds the admin's token for shoot.mjs. Nothing here is
a real project: the names are made up.
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.normpath(os.path.join(HERE, "..", "..", "..", "server", "app.py"))
PORT = 8714
B = "http://localhost:%d" % PORT
PID = "DEMO"
TOK = ""


def call(method, path, body=None, project=None, raw=None, ctype="application/json"):
    h = {"Content-Type": ctype, "X-Viewer-Token": TOK}
    if project:
        h["X-Project"] = project
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(B + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raise SystemExit("%s %s -> %s %s" % (method, path, e.code, e.read()[:300]))


def main(out, sheets_src, model_src):
    global TOK
    if os.path.exists(out):
        shutil.rmtree(out)
    root, data = os.path.join(out, "root"), os.path.join(out, "data")
    proj = os.path.join(root, PID)
    os.makedirs(proj)
    os.makedirs(data)
    # the viewer project: sheets of one export, the 3D model of another
    shutil.copytree(os.path.join(sheets_src, "sheets"), os.path.join(proj, "sheets"))
    shutil.copytree(os.path.join(model_src, "fragments"), os.path.join(proj, "fragments"))
    ms = json.load(open(os.path.join(sheets_src, "manifest.json")))
    mm = json.load(open(os.path.join(model_src, "manifest.json")))
    names = ["Ground floor plan", "Typical floor plan", "North elevation", "Section A-A", "Roof plan"]
    sheets = [dict(s, name=names[i] if i < len(names) else s.get("name")) for i, s in enumerate(ms["sheets"])]
    man = {"source": {"title": "Kai Tak Demo Tower"}, "sheets": sheets, "models": mm["models"]}
    if mm.get("lwk_frame"):
        man["lwk_frame"] = mm["lwk_frame"]
    json.dump(man, open(os.path.join(proj, "manifest.json"), "w"))

    # the site admin
    r = subprocess.run([sys.executable, SERVER, "--root", root, "--data", data, "--add-admin", "wilson@lwk.com",
                        "--admin-name", "Wilson Chan"], capture_output=True, text=True)
    pw = [l.split(":")[1].split()[0] for l in r.stdout.splitlines() if l.startswith("temporary password")][0]
    srv = subprocess.Popen([sys.executable, SERVER, "--root", root, "--data", data, "--port", str(PORT)],
                           stdout=open(os.path.join(out, "server.log"), "w"), stderr=subprocess.STDOUT)
    for _ in range(100):
        try:
            urllib.request.urlopen(B + "/admin.html")
            break
        except Exception:
            time.sleep(0.3)
    try:
        TOK = call("POST", "/api/login", {"email": "wilson@lwk.com", "password": pw})["token"]
        call("POST", "/api/me/password", {"old": pw, "new": "Demo-pass-2026"})
        TOK = call("POST", "/api/login", {"email": "wilson@lwk.com", "password": "Demo-pass-2026"})["token"]
        seed()
    finally:
        srv.terminate()
        srv.wait()
    json.dump({"token": TOK, "project": PID, "list": LIST[0], "port": PORT}, open(os.path.join(out, "state.json"), "w"))
    print("demo ready in", out)


LIST = [""]


def seed():
    people = {}
    for n, t, o, d in [("Jake Reyes", "BIM", "Manila", "ARCH"), ("Jannah Cruz", "BIM", "Manila", "ARCH"),
                       ("Dustin Ong", "BIM", "Manila", "STR"), ("Wing Lee", "Design", "Hong Kong", "ARCH"),
                       ("Clarence Po", "BIM", "Manila", "MEP")]:
        u = call("POST", "/api/admin/users", {"email": n.split()[0].lower() + "@lwk.com", "name": n, "team": t,
                                             "office": o, "discipline": d, "project": PID, "role": "member"})
        people[n] = u["user"]
    me = call("GET", "/api/me")["user"]
    uid = lambda n: {"uid": people[n]["id"], "name": n}
    # the project's register entry (the Projects page, Folders)
    reg = call("POST", "/api/registry", {"name": "Kai Tak Demo Tower", "code": "KTD-01", "short": "KTD", "team": "Manila BIM",
                                         "status": "Active", "viewers": [PID],
                                         "owners": [{"uid": me["id"], "name": me["name"]}, uid("Wing Lee")],
                                         "notes": "Residential tower, 38 storeys over a 3-storey podium."})
    reg_id = reg.get("id") or reg.get("project", {}).get("id")
    call("POST", "/api/registry", {"name": "Harbour Lane Offices", "code": "HLO-02", "short": "HLO", "team": "HK Design",
                                   "status": "On hold", "owners": [uid("Wing Lee")]})
    # issues and comments on the sheets
    sh = [s["number"] for s in json.load(open(os.path.join(ROOT[0], PID, "manifest.json")))["sheets"]]
    marks = [
        (sh[0], "cloud", [[0.32, 0.30], [0.46, 0.42]], {"title": "Door swing clashes with column at grid C/4", "status": "Open", "priority": "High", "assignee": "Jake Reyes"}),
        (sh[0], "rect", [[0.58, 0.52], [0.70, 0.64]], {"title": "Check fire exit width (1.2 m min.)", "status": "In progress", "priority": "Medium", "assignee": "Jannah Cruz"}),
        (sh[1 % len(sh)], "cloud", [[0.40, 0.25], [0.55, 0.38]], {"title": "Slab edge not aligned with facade", "status": "Open", "priority": "High", "assignee": "Dustin Ong"}),
        (sh[-1], "ellipse", [[0.20, 0.60], [0.30, 0.70]], {"title": "Missing level tag", "status": "Resolved", "priority": "Low", "assignee": "Clarence Po"}),
    ]
    for i, (s, ty, pts, iss) in enumerate(marks):
        call("POST", "/api/items", {"id": "demoiss%02d" % i, "sheet": s, "type": ty, "points": pts,
                                    "style": {"color": "#dc2626", "width": 0.004}, "issue": iss}, project=PID)
    call("POST", "/api/items", {"id": "demotxt01", "sheet": sh[0], "type": "text", "points": [[0.62, 0.20]],
                                "text": "Confirm finishes with ID", "style": {"color": "#2563eb", "size": 0.018}}, project=PID)
    # a task list
    lid = call("POST", "/api/task-lists", {"title": "KTD Design Team", "team": "Manila BIM",
                                          "groups": [{"title": "Kai Tak Demo Tower", "project": PID, "reg": reg_id}, {"title": "Coordination"}]})["id"]
    LIST[0] = lid
    d = call("GET", "/api/tasks?list=" + lid)
    g = {x["title"]: x["id"] for x in d["groups"]}
    rows = [("GBP submission set", "Kai Tak Demo Tower", "High", "2026-10-05", "2026-10-30", ["Wing Lee"]),
            ("Podium model update", "Kai Tak Demo Tower", "Medium", "2026-10-12", "2026-10-20", ["Jake Reyes"]),
            ("Typical floor mark-ups", "Kai Tak Demo Tower", "Medium", "2026-10-14", "2026-10-23", ["Jannah Cruz"]),
            ("Structure / architecture clash review", "Coordination", "High", "2026-10-15", "2026-10-21", ["Dustin Ong", "Clarence Po"]),
            ("SBD check - permeability", "Coordination", "Low", "2026-10-19", "2026-10-28", ["Wing Lee"]),
            ("Client presentation", "Kai Tak Demo Tower", "High", "2026-10-26", "2026-10-27", ["Wilson Chan"]),
            ("Fee proposal - stage 3", "Coordination", "Medium", "2026-10-07", "2026-10-09", ["Wilson Chan"])]
    tasks = [{"id": "demotask%02d" % i, "title": t, "group_id": g[gr], "priority": p, "start": s, "due": du,
              "owners": [uid(o) if o in people else {"uid": me["id"], "name": me["name"]} for o in os_]} for i, (t, gr, p, s, du, os_) in enumerate(rows)]
    tasks[0]["links"] = [{"kind": "issue", "project": PID, "ref": "demoiss00", "title": "#1 Door swing", "url": "index.html?project=%s&select=demoiss00" % PID}]
    call("POST", "/api/tasks", {"list": lid, "tasks": tasks})
    subs = [{"id": "demosub%02d" % i, "title": "Sheet %s mark-ups" % s, "parent_id": "demotask00", "owners": [uid("Jannah Cruz")]}
            for i, s in enumerate(sh[:3])]
    call("POST", "/api/tasks", {"list": lid, "tasks": subs})
    call("POST", "/api/tasks", {"list": lid, "tasks": [{"id": "demosub00", "done": True}]})
    call("POST", "/api/tasks/demotask00/comments", {"body": "@Jannah Cruz the A-101 mark-ups are on the viewer now."})
    # chat: the project's channel and a group
    rooms = call("GET", "/api/chat/rooms")["rooms"]
    ch = next((r for r in rooms if r.get("kind") == "project" and r.get("project") in (PID, reg_id)), None)
    if not ch:
        ch = call("POST", "/api/chat/rooms", {"kind": "project", "project": reg_id})
        ch = ch.get("room", ch)
    for m in ["Morning all - the GBP set is due on 30 Oct.", "I've clouded the door swing at C/4 on A-101, please check.",
              "Podium model updated, new sheets exported."]:
        call("POST", "/api/chat/rooms/%s/messages" % ch["id"], {"body": m})
    call("POST", "/api/chat/rooms", {"kind": "group", "title": "Facade team", "members": [people["Wing Lee"]["id"], people["Jake Reyes"]["id"]]})
    # files
    if reg_id:
        call("POST", "/api/files/%s/mkdir" % reg_id, {"path": "", "name": "Correspondence"})
        call("POST", "/api/files/%s/mkdir" % reg_id, {"path": "", "name": "Drawings issued"})
        for path, name, body in [("", "Design brief.pdf", b"%PDF-1.4\n%demo\n"), ("Correspondence", "Client comments 2026-10-08.docx", b"PK demo"),
                                 ("Correspondence", "Minutes - design meeting 12.pdf", b"%PDF-1.4\n%demo\n")]:
            call("POST", "/api/files/%s/upload?path=%s&name=%s" % (reg_id, urllib.request.quote(path), urllib.request.quote(name)),
                 raw=body, ctype="application/octet-stream")
    # a board
    call("POST", "/api/boards", {"title": "Design review - podium", "objects": [
        {"id": "demoobj0001", "t": "text", "x": 100, "y": 30, "w": 420, "h": 50, "z": 1, "text": "Podium options", "fs": 32},
        {"id": "demoobj0002", "t": "sticky", "x": 100, "y": 110, "w": 200, "h": 160, "z": 2, "text": "Lobby entrance: widen to 3 m?", "fill": "#fff3a3", "fs": 18},
        {"id": "demoobj0003", "t": "sticky", "x": 330, "y": 110, "w": 200, "h": 160, "z": 3, "text": "Retail frontage along the street", "fill": "#c6f6d5", "fs": 18},
        {"id": "demoobj0004", "t": "sticky", "x": 560, "y": 110, "w": 200, "h": 160, "z": 4, "text": "Podium roof garden - check SBD", "fill": "#bee3f8", "fs": 18}]}, project=PID)
    # an SBD model (the sample masses) and its result
    sample = os.path.join(HERE, "sbd_sample.json")
    if os.path.exists(sample):
        call("POST", "/api/sbd/model", json.load(open(sample)), project=PID)


ROOT = [""]
if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    ROOT[0] = os.path.join(sys.argv[1], "root")
    main(*sys.argv[1:])

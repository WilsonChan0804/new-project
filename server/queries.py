# -*- coding: utf-8 -*-
"""Queries: questions raised on a project (the Projects page's register),
answered by the team in the viewer.

A query is numbered per project (Q-001 ...), addressed to people of the
project, has a due date (shown in their Calendar), pictures of the sheet
or 3D view it is about (each opening that exact view again), linked tasks,
an answer and a discussion. Kept in tasks.db (tables in tasks.SCHEMA),
with the same revision counter as the tasks: a page asks for what changed
since the last rev it holds.

  GET  /api/queries?reg=&since=     the project's queries (+ its people)
  GET  /api/queries/projects        the projects you can raise queries on
  GET  /api/queries/mine            open queries to you / raised by you
  POST /api/queries                 {reg, queries: [patch], deleted: [id]}
  GET  /api/queries/{id}            one, with its discussion
  POST /api/queries/{id}/comments   {body, files}
  POST /api/queries/{id}/send       its card into the project's chat
  POST /api/queries/{id}/thread     {kind: question|answer, text}: the conversation
  POST /api/queries/{id}/views/remove {i, key}: a marker deleted on a sheet / in 3D
  GET  /api/query-views?project=    the pictures of a viewer project, as markers

Who: the project's people see and raise queries. The raiser, the people it
is addressed to and the project's admins change it; the addressed and the
admins answer; the raiser and the admins close, reopen and delete.
"""

import json
import os
import re
import threading
import uuid
from urllib.parse import unquote

from fastapi import HTTPException, Request, Header
from starlette.concurrency import run_in_threadpool

import tasks as T

STATUSES = ("Open", "Answered", "Closed")
PRIORITIES = ("Normal", "High", "Urgent")
SAFE_Q = re.compile(r"^q[0-9a-f]{8,30}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_VIEWS = 30


def db(core):
    return T.Db(os.path.join(core.CFG["data"], "tasks.db"))


def _num(n):
    return isinstance(n, (int, float)) and not isinstance(n, bool) and abs(n) < 1e12 and n == n


def new_qid():
    return "q" + uuid.uuid4().hex[:19]


def _j(raw, empty):
    try:
        v = json.loads(raw or "")
        return v if isinstance(v, type(empty)) else empty
    except Exception:
        return empty


def row(r):
    q = dict(r)
    q["to"] = _j(q.pop("addressed", "[]"), [])
    q["views"] = _j(q["views"], [])
    q["tasks"] = _j(q.pop("task_ids", "[]"), [])
    q["history"] = _j(q["history"], [])
    q["followups"] = _j(q.get("followups"), [])
    q["deleted"] = bool(q["deleted"])
    q["code"] = "Q-%03d" % (q["number"] or 0)
    return q


def people_of(core, reg):
    """[{uid, name}] of a register project, by name."""
    uids, _ = T.project_people(core, reg)
    out = []
    for uid in uids:
        try:
            u = core.ACC.get(uid) if core.accounts_on() else None
        except Exception:
            u = None
        if u and u["active"]:
            out.append({"uid": uid, "name": u["name"]})
    return sorted(out, key=lambda p: p["name"].lower())


def access(core, w, reg):
    """'admin', 'member' or None for this person on a register project."""
    if w.site_admin:
        return "admin"
    if T.project_admin(core, w, reg):
        return "admin"
    uids, r = T.project_people(core, reg)
    if r is None:
        return None
    return "member" if w.uid in uids else None


def query_access(core, w, qid):
    """The person's access to a query's project (chat.py: its files)."""
    if not isinstance(qid, str) or not SAFE_Q.match(qid):
        return None
    with db(core) as d:
        r = d.execute("SELECT reg FROM queries WHERE id = ? AND deleted = 0", (qid,)).fetchone()
    return access(core, w, r["reg"]) if r else None


def my_projects(core, w):
    """[{id, name, short, code}] of the register projects this person is on."""
    with db(core) as d:
        regs = T.project_order(d.execute("SELECT * FROM projects WHERE deleted = 0").fetchall())
    out = []
    for r in regs:
        if access(core, w, r["id"]):
            out.append({"id": r["id"], "name": r["name"], "short": r["short"] or r["name"], "code": r["code"] or "",
                        "viewers": T.viewers_of(r)})
    return out


def url_of(core, q):
    return "%stasks.html?mode=queries&reg=%s&q=%s" % (core.CFG.get("base_url") or "", q["reg"], q["id"])


def card_of(q, event):
    first = next((v for v in q.get("views") or [] if v.get("snapshot")), None)
    return {"type": "query", "event": event, "reg": q["reg"], "id": q["id"], "code": q["code"],
            "title": q["title"] or "Untitled query", "status": q["status"], "due": q["due"] or "",
            "to": [p.get("name") for p in q.get("to") or []], "raised_by": q.get("raised_by") or "",
            "snapshot": first["snapshot"] if first else "", "text": card_text(q, event)[:300]}


def card_text(q, event):
    """The words on its chat card: the newest of the conversation that fits."""
    fu = q.get("followups") or []
    if event == "followup":
        last = next((f for f in reversed(fu) if f["kind"] == "question"), None)
        return last["text"] if last else ""
    if event == "answered":
        last = next((f for f in reversed(fu) if f["kind"] == "answer"), None)
        return last["text"] if last else (q.get("answer") or "")
    return q.get("question") or ""


def ref_card(core, w, qid):
    """A query as a chat card a person sends (chat.py), if they may open it."""
    if not isinstance(qid, str) or not SAFE_Q.match(qid):
        return None
    with db(core) as d:
        r = d.execute("SELECT * FROM queries WHERE id = ? AND deleted = 0", (qid,)).fetchone()
    if not r or not access(core, w, r["reg"]):
        return None
    return card_of(row(r), "shared")


def search(core, w, ql, reg=""):
    """Queries for the Messenger's ? picker: [{kind, label, sub, url}]."""
    regs = [reg] if reg else [p["id"] for p in my_projects(core, w)]
    regs = [r for r in regs if access(core, w, r)]
    if not regs:
        return []
    names = dict((p["id"], p["short"]) for p in my_projects(core, w))
    with db(core) as d:
        rows = d.execute("SELECT * FROM queries WHERE deleted = 0 AND reg IN (%s) "
                         "ORDER BY CASE status WHEN 'Open' THEN 0 WHEN 'Answered' THEN 1 ELSE 2 END, number DESC"
                         % ",".join("?" * len(regs)), regs).fetchall()
    out = []
    for r in rows:
        q = row(r)
        hay = ("%s %s %s" % (q["code"], q["title"], q["question"])).lower()
        if ql and ql.lower() not in hay:
            continue
        out.append({"kind": "query", "label": "%s %s" % (q["code"], q["title"] or "Untitled query"),
                    "sub": " · ".join(x for x in ("" if reg else names.get(q["reg"], ""), q["status"],
                                                   ("due " + q["due"]) if q["due"] else "") if x),
                    "url": "tasks.html?mode=queries&reg=%s&q=%s" % (q["reg"], q["id"])})
        if len(out) >= 20:
            break
    return out


def calendar(core, w, start, end):
    """Open queries due in the window that are addressed to this person or
    were raised by them (calendar_feed.py)."""
    out = []
    try:
        projects = dict((p["id"], p) for p in my_projects(core, w))
        if not projects:
            return out
        with db(core) as d:
            rows = d.execute("SELECT * FROM queries WHERE deleted = 0 AND status != 'Closed' AND due != '' "
                             "AND due BETWEEN ? AND ?", (start, end)).fetchall()
    except Exception:
        return out
    for r in rows:
        q = row(r)
        if q["reg"] not in projects:
            continue
        mine = q.get("raised_uid") == w.uid or any(p.get("uid") == w.uid for p in q["to"])
        if not mine:
            continue
        out.append({"kind": "query", "id": "q-" + q["id"], "title": "%s %s" % (q["code"], q["title"] or "Query"),
                    "start": q["due"], "end": q["due"], "all_day": True, "status": q["status"],
                    "from": projects[q["reg"]]["short"],
                    "url": "tasks.html?mode=queries&reg=%s&q=%s" % (q["reg"], q["id"])})
    return out


def register(app, core):

    def notify(people, subject, text, actor_uid, url):
        """Under the bell (and on their phones), and by email when set up."""
        try:
            import chat
            seen = set()
            for p in people:
                uid = p.get("uid")
                if uid is None or uid == actor_uid or uid in seen:
                    continue
                seen.add(uid)
                chat.inbox_post(uid, "query", subject, text.split("\n")[0][:240], url)
        except Exception as ex:
            print("query inbox: %s" % ex)
        if not core.accounts_on() or not core.smtp_ready():
            return
        targets = []
        for p in people:
            if p.get("uid") is None or p.get("uid") == actor_uid:
                continue
            u = core.ACC.get(p["uid"])
            if u and u["active"] and u["email"]:
                targets.append((u["name"], u["email"]))

        def run():
            for name, email in targets:
                try:
                    core.send_mail(email, subject, "Hello %s,\n\n%s\n\n%s\n\n- LWK Viewer" % (name, text, url))
                except Exception as ex:
                    print("query mail to %s: %s" % (email, ex))
        if targets:
            threading.Thread(target=run, daemon=True).start()

    def card(q, event, by, skip=""):
        try:
            import chat
            chat.post_card([q["reg"]], card_of(q, event), by, skip)
        except Exception as ex:
            print("query card: %s" % ex)

    def need(w, reg):
        if not isinstance(reg, str) or not T.SAFE_ID.match(reg):
            raise HTTPException(status_code=404, detail="No such project")
        a = access(core, w, reg)
        if not a:
            raise HTTPException(status_code=403, detail="You are not one of this project's people")
        return a

    def clean_people(v, allowed):
        ok = dict((p["uid"], p) for p in allowed)
        out, seen = [], set()
        for p in v if isinstance(v, list) else []:
            uid = p.get("uid") if isinstance(p, dict) else None
            if uid in ok and uid not in seen:
                seen.add(uid)
                out.append({"uid": uid, "name": ok[uid]["name"]})
        return out[:20]

    def clean_views(v):
        out = []
        for x in v if isinstance(v, list) else []:
            if not isinstance(x, dict):
                continue
            kind = x.get("kind") if x.get("kind") in ("sheet", "view3d", "image") else None
            url = str(x.get("url") or "")
            snap = str(x.get("snapshot") or "")
            if snap and not re.match(r"^/snapshots/[0-9a-f]{8,64}\.(jpg|png)$", snap):
                snap = ""
            if kind == "image":
                url = ""                  # a picture of its own (a screenshot, a file): only the picture
                if not snap:
                    continue
            elif not kind or not re.match(r"^(index|model)\.html\?", url) or len(url) > 6000:
                continue
            v = {"kind": kind, "url": url, "snapshot": snap, "project": T.clean_text(x.get("project"), 80),
                 "title": T.clean_text(x.get("title"), 200), "sheet": T.clean_text(x.get("sheet"), 60),
                 "at": T.clean_text(x.get("at"), 30), "by": T.clean_text(x.get("by"), 80)}
            # marked up: the picture as it was taken, and the drawing (to change it again)
            clean = str(x.get("clean") or "")
            if snap and re.match(r"^/snapshots/[0-9a-f]{8,64}\.(jpg|png)$", clean):
                mk = x.get("markup")
                if isinstance(mk, list) and len(mk) <= 400 and len(json.dumps(mk)) <= 200000:
                    v["clean"], v["markup"] = clean, mk
            # where its marker goes: a point on the paper (mm) / in the model (scene mm)
            pin = x.get("pin")
            if kind == "sheet" and isinstance(pin, dict) and all(_num(pin.get(k)) for k in ("u", "v")):
                v["pin"] = {"u": round(float(pin["u"]), 1), "v": round(float(pin["v"]), 1)}
            pm = x.get("pin_mm")
            if kind == "view3d" and isinstance(pm, list) and len(pm) == 3 and all(_num(n) for n in pm):
                v["pin_mm"] = [round(float(n)) for n in pm]
            out.append(v)
        return out[:MAX_VIEWS]

    def own_views(old, new, w):
        """Who added each picture: kept for the ones already there, this
        person for the new ones (never what the browser says)."""
        key = lambda v: (v.get("kind"), v.get("url"), v.get("clean") or v.get("snapshot"))
        was = dict((key(v), v.get("uid")) for v in old)
        was.update(((v.get("kind"), v.get("url"), v.get("snapshot")), v.get("uid")) for v in old)
        for v in new:
            k = key(v)
            v["uid"] = was[k] if k in was else w.uid
        return new

    def reg_of(qid):
        """The project of a live query (404 when there is none)."""
        r = None
        if isinstance(qid, str) and SAFE_Q.match(qid):
            with db(core) as d:
                r = d.execute("SELECT reg FROM queries WHERE id = ? AND deleted = 0", (qid,)).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="No such query (it may have been deleted)")
        return r["reg"]

    def appends(old, new):
        """True when new is old with pictures added at the end."""
        key = lambda v: (v.get("kind"), v.get("url"), v.get("snapshot"))
        return len(new) > len(old) and [key(v) for v in new[:len(old)]] == [key(v) for v in old]

    def clean_tasks(v):
        return [t for t in (v if isinstance(v, list) else []) if isinstance(t, str) and T.SAFE_ID.match(t)][:30]

    @app.get("/api/queries/projects")
    def q_projects(request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        return {"projects": my_projects(core, w)}

    @app.get("/api/queries")
    def q_list(request: Request, reg: str = "", since: int = 0, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        a = need(w, reg)
        with db(core) as d:
            rev = T.current_rev(d)
            if since > 0:
                rows = d.execute("SELECT * FROM queries WHERE reg = ? AND rev > ?", (reg, since)).fetchall()
            else:
                rows = d.execute("SELECT * FROM queries WHERE reg = ? AND deleted = 0", (reg,)).fetchall()
        out = {"queries": [row(r) for r in rows], "rev": rev, "full": since <= 0, "admin": a == "admin"}
        if since <= 0:
            out["people"] = people_of(core, reg)
        return out

    @app.get("/api/queries/mine")
    def q_mine(request: Request, x_viewer_token: str = Header(default="")):
        """Open queries addressed to you, and answered ones you raised (to close)."""
        w = core.who(request, x_viewer_token)
        regs = dict((p["id"], p) for p in my_projects(core, w))
        if not regs:
            return {"to_me": 0, "to_close": 0, "rows": []}
        with db(core) as d:
            rows = d.execute("SELECT * FROM queries WHERE deleted = 0 AND status != 'Closed' AND reg IN (%s)"
                             % ",".join("?" * len(regs)), list(regs)).fetchall()
        to_me, to_close, out = 0, 0, []
        for r in rows:
            q = row(r)
            mine_to = q["status"] == "Open" and any(p.get("uid") == w.uid for p in q["to"])
            mine_close = q["status"] == "Answered" and q.get("raised_uid") == w.uid
            if mine_to or mine_close:
                to_me += 1 if mine_to else 0
                to_close += 1 if mine_close else 0
                out.append({"id": q["id"], "reg": q["reg"], "code": q["code"], "title": q["title"], "status": q["status"],
                            "due": q["due"], "project": regs[q["reg"]]["short"]})
        return {"to_me": to_me, "to_close": to_close, "rows": out[:50]}

    @app.post("/api/queries")
    async def q_save(request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        raw = await request.body()
        if len(raw) > 2 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Too long")
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        # the rest on a thread: the database, the chat card and the inbox
        # must not hold up everyone else's requests (a slow /api/ping reads
        # as "offline" on every open page)
        return await run_in_threadpool(save, w, body)

    def save(w, body):
        reg = body.get("reg")
        a = need(w, reg)
        allowed = people_of(core, reg)
        by, t = w.name or "Someone", T.now_iso()
        events = []                       # (query, event) for notifications and cards
        out = []
        with db(core) as d:
            rev = T.next_rev(d)
            for p in body.get("queries") or []:
                if not isinstance(p, dict) or not isinstance(p.get("id"), str) or not SAFE_Q.match(p["id"]):
                    raise HTTPException(status_code=400, detail="Bad query id")
                old = d.execute("SELECT * FROM queries WHERE id = ?", (p["id"],)).fetchone()
                if old and old["reg"] != reg:
                    raise HTTPException(status_code=400, detail="That query belongs to another project")
                if old and old["deleted"]:
                    raise HTTPException(status_code=409, detail="That query was deleted")
                if old is None:
                    n = (d.execute("SELECT MAX(number) AS n FROM queries WHERE reg = ?", (reg,)).fetchone()["n"] or 0) + 1
                    d.execute("INSERT INTO queries (id, reg, number, raised_uid, raised_by, created_at, updated_at, updated_by, rev) "
                              "VALUES (?,?,?,?,?,?,?,?,?)", (p["id"], reg, n, w.uid, by, t, t, by, rev))
                    old = d.execute("SELECT * FROM queries WHERE id = ?", (p["id"],)).fetchone()
                    created = True
                else:
                    created = False
                q = row(old)
                raiser = q.get("raised_uid") == w.uid or created
                addressed = any(x.get("uid") == w.uid for x in q["to"])
                admin = a == "admin"
                can_edit = raiser or addressed or admin
                hist = q["history"]
                if created:
                    hist.append({"at": t, "by": by, "event": "raised"})
                sets = {}

                def change(field, col, val, label=None):
                    if q.get(field) != val:
                        if not created:          # a new query: "raised" says it all
                            hist.append({"at": t, "by": by, "event": "changed", "field": label or field,
                                         "old": str(q.get(field) if not isinstance(q.get(field), list) else len(q.get(field)))[:200],
                                         "new": str(val if not isinstance(val, list) else len(val))[:200]})
                        sets[col] = json.dumps(val) if isinstance(val, list) else val
                        q[field] = val
                # anyone on the project may add a picture (+ Query on a sheet / in
                # 3D); only the people above remove or reorder them
                adds_only = "views" in p and not can_edit and appends(q["views"], clean_views(p["views"]))
                if not can_edit and any(k in p for k in ("title", "question", "to", "due", "priority", "tasks")
                                        ) or ("views" in p and not can_edit and not adds_only):
                    raise HTTPException(status_code=403, detail="Only who raised it, who it is addressed to, or a project admin can change it")
                if "title" in p:
                    change("title", "title", T.clean_text(p["title"], 200))
                if "question" in p:
                    change("question", "question", T.clean_text(p["question"], 8000, True))
                if "to" in p:
                    before = set(x["uid"] for x in q["to"])
                    change("to", "addressed", clean_people(p["to"], allowed), "to")
                    added = [x for x in q["to"] if x["uid"] not in before]
                    if added and not created:
                        events.append((q, "addressed", added))
                if "due" in p:
                    due = str(p["due"] or "")[:10]
                    if due and not DATE.match(due):
                        raise HTTPException(status_code=400, detail="Due: a date please (YYYY-MM-DD)")
                    change("due", "due", due)
                if "priority" in p:
                    change("priority", "priority", p["priority"] if p["priority"] in PRIORITIES else "Normal")
                if "views" in p:
                    change("views", "views", own_views(q["views"], clean_views(p["views"]), w))
                if "tasks" in p:
                    change("tasks", "task_ids", clean_tasks(p["tasks"]), "tasks")
                if "answer" in p:
                    if not (addressed or admin):
                        raise HTTPException(status_code=403, detail="Only the people it is addressed to (or a project admin) answer it")
                    ans = T.clean_text(p["answer"], 8000, True)
                    if ans != q["answer"]:
                        change("answer", "answer", ans)
                        sets["answered_by"], sets["answered_at"] = by, t
                        q["answered_by"], q["answered_at"] = by, t
                if "status" in p and p["status"] in STATUSES and p["status"] != q["status"]:
                    st = p["status"]
                    if st == "Answered" and not (addressed or admin):
                        raise HTTPException(status_code=403, detail="Only the people it is addressed to (or a project admin) mark it answered")
                    if st == "Answered" and not (q["answer"] or "").strip():
                        raise HTTPException(status_code=400, detail="Write the answer first")
                    if st in ("Closed", "Open") and not (raiser or admin) and not (st == "Open" and addressed):
                        raise HTTPException(status_code=403, detail="Only who raised it (or a project admin) closes or reopens it")
                    hist.append({"at": t, "by": by, "event": st.lower()})
                    sets["status"] = st
                    sets["closed_at"] = t if st == "Closed" else ""
                    q["status"] = st
                    events.append((q, st.lower(), None))
                if created:
                    events.append((q, "raised", None))
                sets.update({"history": json.dumps(hist[-200:]), "updated_at": t, "updated_by": by, "rev": rev})
                d.execute("UPDATE queries SET %s WHERE id = ?" % ", ".join("%s = ?" % k for k in sets),
                          list(sets.values()) + [p["id"]])
                out.append(row(d.execute("SELECT * FROM queries WHERE id = ?", (p["id"],)).fetchone()))
            for qid in body.get("deleted") or []:
                r = d.execute("SELECT * FROM queries WHERE id = ? AND reg = ? AND deleted = 0", (qid, reg)).fetchone()
                if not r:
                    continue
                if not (r["raised_uid"] == w.uid or a == "admin"):
                    raise HTTPException(status_code=403, detail="Only who raised it (or a project admin) deletes it")
                d.execute("UPDATE queries SET deleted = 1, rev = ?, updated_at = ?, updated_by = ? WHERE id = ?", (rev, t, by, qid))
        # tell the people concerned, and the project's chat
        fresh = dict((q["id"], q) for q in out)
        for q, ev, who in events:
            q = fresh.get(q["id"], q)
            url = url_of(core, q)
            label = "%s %s" % (q["code"], q["title"] or "Untitled query")
            if ev in ("raised", "addressed"):
                notify(who or q["to"], "Query for you: " + label,
                       "%s raised a query%s:\n%s" % (by, " (due %s)" % q["due"] if q["due"] else "", q["question"] or q["title"]),
                       w.uid, url)
            elif ev == "answered":
                notify([{"uid": q.get("raised_uid")}], "Answered: " + label,
                       "%s answered your query:\n%s" % (by, q["answer"]), w.uid, url)
            elif ev in ("closed", "open"):
                notify(q["to"], ("Closed: " if ev == "closed" else "Reopened: ") + label,
                       "%s %s the query." % (by, "closed" if ev == "closed" else "reopened"), w.uid, url)
            if ev in ("raised", "answered", "closed"):
                card(q, ev, by, skip=str(body.get("skip_chat") or ""))
        return {"queries": out, "rev": rev}

    @app.get("/api/queries/{qid}")
    def q_one(request: Request, qid: str, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        if not SAFE_Q.match(qid):
            raise HTTPException(status_code=404, detail="No such query")
        # who may see it first: need() opens the database itself, and the
        # database is not re-entrant (opening it inside would hang the server)
        need(w, reg_of(qid))
        with db(core) as d:
            r = d.execute("SELECT * FROM queries WHERE id = ? AND deleted = 0", (qid,)).fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="No such query (it may have been deleted)")
            cs = d.execute("SELECT * FROM query_comments WHERE query_id = ? ORDER BY created_at", (qid,)).fetchall()
            q = row(r)
            # the linked tasks, as they are now
            ts = []
            for tid in q["tasks"]:
                t = d.execute("SELECT id, list_id, title, done, due FROM tasks WHERE id = ? AND deleted = 0", (tid,)).fetchone()
                if t:
                    ts.append({"id": t["id"], "list_id": t["list_id"], "title": t["title"], "done": bool(t["done"]), "due": t["due"]})
        comments = []
        try:
            import chat
            for c in cs:
                c = dict(c)
                c["files"] = chat.files_for(_j(c["files"], []), task=qid) if _j(c["files"], []) else []
                comments.append(c)
        except Exception:
            comments = [dict(c, files=[]) for c in cs]
        q["comments"] = comments
        q["task_rows"] = ts
        return q

    @app.post("/api/queries/{qid}/comments")
    async def q_comment(request: Request, qid: str, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        try:
            body = json.loads((await request.body()).decode("utf-8") or "{}")
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        return await run_in_threadpool(comment, w, qid, body)

    def comment(w, qid, body):
        text = T.clean_text(body.get("body"), 8000, True).strip()
        files = [f for f in body.get("files") or [] if isinstance(f, str)][:20]
        if not text and not files:
            raise HTTPException(status_code=400, detail="Write something")
        with db(core) as d:
            r = d.execute("SELECT * FROM queries WHERE id = ? AND deleted = 0", (qid,)).fetchone() if SAFE_Q.match(qid) else None
            if not r:
                raise HTTPException(status_code=404, detail="No such query")
        need(w, r["reg"])
        try:
            import chat
            files = [f["id"] for f in chat.files_for(files, task=qid)] if files else []
        except Exception:
            files = []
        cid, t = T.new_id(), T.now_iso()
        with db(core) as d:
            d.execute("INSERT INTO query_comments (id, query_id, uid, author, body, files, created_at) VALUES (?,?,?,?,?,?,?)",
                      (cid, qid, w.uid, w.name or "Someone", text, json.dumps(files), t))
            d.execute("UPDATE queries SET rev = ?, updated_at = ?, updated_by = ? WHERE id = ?", (T.next_rev(d), t, w.name or "", qid))
            q = row(d.execute("SELECT * FROM queries WHERE id = ?", (qid,)).fetchone())
        others = q["to"] + [{"uid": q.get("raised_uid")}]
        notify(others, "Comment on %s %s" % (q["code"], q["title"]), "%s: %s" % (w.name or "Someone", text), w.uid, url_of(core, q))
        return {"ok": True, "id": cid}

    @app.post("/api/queries/{qid}/send")
    def q_send(request: Request, qid: str, x_viewer_token: str = Header(default="")):
        """Its card into the project's chat channel."""
        w = core.who(request, x_viewer_token)
        with db(core) as d:
            r = d.execute("SELECT * FROM queries WHERE id = ? AND deleted = 0", (qid,)).fetchone() if SAFE_Q.match(qid) else None
        if not r:
            raise HTTPException(status_code=404, detail="No such query")
        need(w, r["reg"])
        card(row(r), "shared", w.name or "")
        return {"ok": True}

    @app.get("/api/query-views")
    def q_onviews(request: Request, project: str = "", x_viewer_token: str = Header(default="")):
        """The query pictures of a viewer project (sheets and 3D), each as a
        marker: where it goes and what it belongs to. Image pictures have no
        place on a drawing and are left out."""
        w = core.who(request, x_viewer_token)
        regs = [p for p in my_projects(core, w) if project and project in p["viewers"]]
        if not regs:
            return {"views": []}
        admin = dict((p["id"], access(core, w, p["id"]) == "admin") for p in regs)
        with db(core) as d:
            rows = d.execute("SELECT * FROM queries WHERE deleted = 0 AND reg IN (%s) ORDER BY number"
                             % ",".join("?" * len(regs)), [p["id"] for p in regs]).fetchall()
        today = T.now_iso()[:10]
        out = []
        for r in rows:
            q = row(r)
            people = admin[q["reg"]] or q["raised_uid"] == w.uid or any(x.get("uid") == w.uid for x in q["to"])
            for i, v in enumerate(q["views"]):
                if v["kind"] not in ("sheet", "view3d") or (v.get("project") and v["project"] != project):
                    continue
                e = {"qid": q["id"], "reg": q["reg"], "code": q["code"], "title": q["title"] or "Untitled query",
                     "status": q["status"], "due": q["due"] or "", "overdue": bool(q["status"] == "Open" and q["due"] and q["due"] < today),
                     "to": [x.get("name") for x in q["to"]], "i": i, "kind": v["kind"], "url": v["url"],
                     "snapshot": v.get("snapshot") or "", "view_title": v.get("title") or "", "by": v.get("by") or "",
                     "key": "%s|%s|%s" % (v["kind"], v["url"], v.get("snapshot") or ""),
                     "can_remove": bool(people or (v.get("uid") is not None and v.get("uid") == w.uid))}
                if v["kind"] == "sheet":
                    m = re.search(r"[?&]sheet=([^&]*)", v["url"])
                    e["sheet"] = v.get("sheet") or (unquote(m.group(1)) if m else "")
                    a = re.search(r"[?&]area=([^&]*)", v["url"])
                    try:
                        e["area"] = [float(n) for n in unquote(a.group(1)).split(",")][:4] if a else None
                    except ValueError:
                        e["area"] = None
                    e["pin"] = v.get("pin") or ({"u": e["area"][0] + e["area"][2] / 2, "v": e["area"][1] + e["area"][3] / 2}
                                                if e["area"] and len(e["area"]) == 4 else None)
                    if not e["pin"]:
                        continue
                else:
                    e["pin_mm"] = v.get("pin_mm")
                    if not e["pin_mm"]:
                        continue
                out.append(e)
        return {"views": out}

    @app.post("/api/queries/{qid}/views/remove")
    async def q_unview(request: Request, qid: str, x_viewer_token: str = Header(default="")):
        """A marker deleted on a sheet / in 3D: its picture leaves the query;
        the query itself stays."""
        w = core.who(request, x_viewer_token)
        body = await request.json()
        return await run_in_threadpool(unview, w, qid, body if isinstance(body, dict) else {})

    def unview(w, qid, body):
        a = need(w, reg_of(qid))                     # before the database is opened: it is not re-entrant
        with db(core) as d:
            r = d.execute("SELECT * FROM queries WHERE id = ? AND deleted = 0", (qid,)).fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="No such query (it may have been deleted)")
            q = row(r)
            i = body.get("i")
            if not isinstance(i, int) or not 0 <= i < len(q["views"]):
                raise HTTPException(status_code=409, detail="That picture is no longer on the query - reload")
            v = q["views"][i]
            if body.get("key") != "%s|%s|%s" % (v["kind"], v["url"], v.get("snapshot") or ""):
                raise HTTPException(status_code=409, detail="The query changed meanwhile - reload and try again")
            people = a == "admin" or q["raised_uid"] == w.uid or any(x.get("uid") == w.uid for x in q["to"])
            if not (people or (v.get("uid") is not None and v.get("uid") == w.uid)):
                raise HTTPException(status_code=403, detail="Only who raised the query, who it is to, a project admin or who added the picture removes it")
            views = q["views"][:i] + q["views"][i + 1:]
            t, by = T.now_iso(), w.name or "Someone"
            hist = q["history"] + [{"at": t, "by": by, "event": "changed", "field": "views",
                                    "old": str(len(q["views"])), "new": str(len(views))}]
            rev = T.next_rev(d)
            d.execute("UPDATE queries SET views = ?, history = ?, updated_at = ?, updated_by = ?, rev = ? WHERE id = ?",
                      (json.dumps(views), json.dumps(hist[-200:]), t, by, rev, qid))
            out = row(d.execute("SELECT * FROM queries WHERE id = ?", (qid,)).fetchone())
        return {"query": out, "rev": rev}

    @app.post("/api/queries/{qid}/thread")
    async def q_thread(request: Request, qid: str, x_viewer_token: str = Header(default="")):
        """The conversation after the first answer: {kind: question|answer, text}.
        Anyone on the project asks a follow-up (the query is open again);
        the people it is to, or an admin, answer it."""
        w = core.who(request, x_viewer_token)
        body = await request.json()
        return await run_in_threadpool(thread, w, qid, body if isinstance(body, dict) else {})

    def thread(w, qid, body):
        kind = body.get("kind")
        text = T.clean_text(body.get("text"), 8000, True).strip()
        if kind not in ("question", "answer"):
            raise HTTPException(status_code=400, detail="A question or an answer")
        if not text:
            raise HTTPException(status_code=400, detail="Write something")
        t, by = T.now_iso(), w.name or "Someone"
        a = need(w, reg_of(qid))
        with db(core) as d:
            r = d.execute("SELECT * FROM queries WHERE id = ? AND deleted = 0", (qid,)).fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="No such query (it may have been deleted)")
            q = row(r)
            addressed = any(x.get("uid") == w.uid for x in q["to"])
            if kind == "answer" and not (addressed or a == "admin"):
                raise HTTPException(status_code=403, detail="Only the people it is addressed to (or a project admin) answer it")
            first = kind == "answer" and not (q["answer"] or "").strip() and not q["followups"]
            # the first answer is the query's answer; the rest is the conversation after it
            fu = q["followups"] + ([] if first else [{"id": T.new_id(), "kind": kind, "text": text, "uid": w.uid, "by": by, "at": t}])
            hist = q["history"] + [{"at": t, "by": by, "event": "follow-up" if kind == "question" else "answered"}]
            sets = {"followups": json.dumps(fu[-200:]), "history": json.dumps(hist[-200:]), "updated_at": t, "updated_by": by}
            if kind == "question":
                sets.update({"status": "Open", "closed_at": ""})
            else:
                sets.update({"status": "Answered", "closed_at": ""})
                if first:                      # the first answer; a later one stays in the conversation
                    sets.update({"answer": text, "answered_by": by, "answered_at": t})
            sets["rev"] = T.next_rev(d)
            d.execute("UPDATE queries SET %s WHERE id = ?" % ", ".join("%s = ?" % k for k in sets), list(sets.values()) + [qid])
            q = row(d.execute("SELECT * FROM queries WHERE id = ?", (qid,)).fetchone())
        url = url_of(core, q)
        label = "%s %s" % (q["code"], q["title"] or "Untitled query")
        if kind == "question":
            notify(q["to"] + [{"uid": q.get("raised_uid")}], "Follow-up question: " + label,
                   "%s asked:\n%s" % (by, text), w.uid, url)
            card(q, "followup", by)
        else:
            askers = [{"uid": q.get("raised_uid")}] + [{"uid": f["uid"]} for f in q["followups"] if f["kind"] == "question"]
            notify(askers, "Answered: " + label, "%s answered:\n%s" % (by, text), w.uid, url)
            card(q, "answered", by)
        return {"query": q, "rev": sets["rev"]}

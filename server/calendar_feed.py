"""Calendar - what is coming up for one person, in one place.

Registered by app.py:  calendar_feed.register(app, core).

  meetings  events sent in the Messenger (+ > Event) in the chats you are in,
            with your reply (Going / Maybe / Can't go)
  tasks     tasks you are an owner of, on their due date
  issues    issues assigned to you that are still open, on their due date

GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD   the Calendar page
GET /api/calendar/feed                           your calendar's address
POST /api/calendar/feed                          a new address (the old stops)
GET /cal/<key>.ics                               the same as an iCalendar feed

  leave     annual leave (and sick / other days off): your own, and that of
            the people who share a calendar group with you
GET/POST /api/calendar/groups, PUT/DELETE /api/calendar/groups/<id>
                                                 calendar groups: who sees whose leave
POST /api/calendar/leave, DELETE /api/calendar/leave/<id>
GET /api/holidays, PUT /api/holidays             public holidays added by a site admin
                                                 (the built-in lists are in viewer/holidays.js)

The feed is what links it to Outlook: Outlook (Add calendar > From
internet / Subscribe, or the webcal:// link) reads it every few hours and
shows it beside your own calendar. The key in the address is the only
sign-in it has, so it is long, random and can be replaced. Outlook on the
web and on phones fetch it from Microsoft's servers, which only works when
the viewer is reachable from the internet; Outlook on a PC in the office
fetches it from the PC itself.

Named calendar_feed, not calendar: the standard library's calendar module
is used by chat.py.
"""

import calendar
import json
import os
import re
import secrets
import threading
import time

from fastapi import HTTPException, Request, Header
from fastapi.responses import Response

_LOCK = threading.Lock()
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _keys_path(core):
    return os.path.join(core.CFG["data"], "calendar_keys.json")


def _load_keys(core):
    try:
        with open(_keys_path(core), encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def _save_keys(core, keys):
    p = _keys_path(core)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(keys, f)
    os.replace(tmp, p)


def _json_path(core, name):
    return os.path.join(core.CFG["data"], name)


def _load(core, name, default):
    try:
        with open(_json_path(core, name), encoding="utf-8") as f:
            v = json.load(f)
            return v if isinstance(v, type(default)) else default
    except Exception:
        return default


def _save(core, name, value):
    p = _json_path(core, name)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=1)
    os.replace(tmp, p)


GROUPS = "calendar_groups.json"     # [{id, name, owner, members: [uid]}]
LEAVE = "leave.json"                # [{id, uid, start, end, half, type, note, at}]
HOLIDAYS = "holidays.json"          # {"hk": {date: name}, "ph": {date: name}}
LEAVE_TYPES = ("Annual leave", "Sick leave", "Other leave")


def my_groups(core, uid):
    return [g for g in _load(core, GROUPS, []) if uid in (g.get("members") or [])]


def _leave(core, w, start, end, others=True):
    """Days off between start and end: mine, and (others) those of the
    people in my calendar groups, each with the groups we share."""
    shared = {}                     # uid -> [group id]
    if others:
        for g in my_groups(core, w.uid):
            for u in g.get("members") or []:
                if u != w.uid:
                    shared.setdefault(u, []).append(g["id"])
    out = []
    for r in _load(core, LEAVE, []):
        u = r.get("uid")
        if u != w.uid and u not in shared:
            continue
        if r.get("end", "") < start or r.get("start", "") > end:
            continue
        user = core.ACC.get(u) if hasattr(core, "ACC") else None
        name = (user or {}).get("name") or "?"
        half = r.get("half") or ""
        what = r.get("type") or "Annual leave"
        out.append({
            "kind": "leave", "id": "l-" + r["id"], "leave_id": r["id"],
            "title": ("%s - %s" % (name, what)) + (" (%s)" % half.upper() if half else ""),
            "start": r["start"], "end": r["end"], "all_day": True, "half": half, "type": what,
            "notes": r.get("note") or "", "from": name, "uid": u, "mine": u == w.uid,
            "groups": shared.get(u, []), "url": "calendar.html?day=" + r["start"],
        })
    return out


def feed_key(core, uid, new=False):
    """This person's feed key (made the first time it is asked for)."""
    with _LOCK:
        keys = _load_keys(core)
        k = keys.get(str(uid))
        if new or not k:
            k = secrets.token_hex(20)
            keys[str(uid)] = k
            _save_keys(core, keys)
        return k


def uid_of_key(core, key):
    if not re.match(r"^[0-9a-f]{40}$", key or ""):
        return None
    for u, k in _load_keys(core).items():
        if secrets.compare_digest(k, key):
            return int(u)
    return None


# ------------------------------------------------------------ the entries

def _meetings(w, start, end):
    """Events sent in the chats this person is in (chat.py event cards)."""
    out = []
    try:
        import chat
    except Exception:
        return out
    try:
        with chat.db() as d:
            rows = d.execute(
                "SELECT x.*, r.title AS room_title, r.kind AS room_kind FROM messages x "
                "JOIN room_members m ON m.room = x.room AND m.uid = ? "
                "JOIN rooms r ON r.id = x.room AND r.deleted = 0 "
                "WHERE x.deleted = 0 AND x.card LIKE '%\"type\": \"event\"%'", (w.uid,)).fetchall()
    except Exception:
        return out
    for r in rows:
        try:
            c = json.loads(r["card"])
        except ValueError:
            continue
        day0, day1 = c.get("start", "")[:10], (c.get("end") or c.get("start", ""))[:10]
        if not day0 or day1 < start or day0 > end:
            continue
        ans = chat.answers_of(r)
        mine = next((k for k, v in ans.items() if w.uid in v), "")
        out.append({
            "kind": "meeting", "id": "m-" + r["id"], "title": c.get("title") or "Event",
            "start": c["start"], "end": c.get("end") or c["start"], "all_day": bool(c.get("all_day")),
            "tz": c.get("tz") or 0, "where": c.get("location") or "", "link": c.get("link") or "",
            "notes": c.get("notes") or "", "cancelled": bool(c.get("cancelled")),
            "from": r["room_title"] if r["room_kind"] != "dm" else "Direct message",
            "by": r["author"] or "", "reply": mine,
            "going": len(ans.get("yes") or []),
            "url": "messenger.html?room=%s&msg=%s" % (r["room"], r["id"]),
        })
    return out


def _owns_below(d, tid, mine, depth=0):
    """True when the person owns a sub-task of task tid (any level, up to 5)."""
    if depth >= 5:
        return False
    for x in d.execute("SELECT id, owners FROM tasks WHERE parent_id = ? AND deleted = 0", (tid,)).fetchall():
        if mine(x["owners"]) or _owns_below(d, x["id"], mine, depth + 1):
            return True
    return False


def _tasks(core, w, start, end):
    """Tasks due in the window that this person owns - or that sit below
    (sub-tasks, at any level) a task they own: the owners of a task see
    its sub-tasks' due dates too - or that hold a sub-task they own: the
    task's own due date shows beside its sub-tasks'."""
    out = []
    try:
        import tasks as T
    except Exception:
        return out
    mine = lambda raw: any(p.get("uid") == w.uid for p in _owners(raw))
    try:
        with T.Db(os.path.join(core.CFG["data"], "tasks.db")) as d:
            rows = d.execute("SELECT t.*, l.title AS list_title, g.title AS group_title FROM tasks t "
                             "JOIN lists l ON l.id = t.list_id AND l.deleted = 0 "
                             "LEFT JOIN groups g ON g.id = t.group_id "
                             "WHERE t.deleted = 0 AND t.due != '' AND substr(t.due, 1, 10) BETWEEN ? AND ?",
                             (start, end)).fetchall()
            par = {}                  # id -> (title, owners json, parent_id) of the tasks above

            def up(pid):
                if pid not in par:
                    x = d.execute("SELECT title, owners, parent_id FROM tasks WHERE id = ? AND deleted = 0", (pid,)).fetchone()
                    par[pid] = (x["title"], x["owners"], x["parent_id"]) if x else None
                return par[pid]
            picked = []
            for r in rows:
                parent = ""
                if mine(r["owners"]):
                    ok = True
                    if r["parent_id"] and up(r["parent_id"]):
                        parent = up(r["parent_id"])[0] or "Untitled task"
                else:
                    ok, pid, depth = False, r["parent_id"], 0
                    while pid and depth < 5:
                        x = up(pid)
                        if not x:
                            break
                        if not parent:
                            parent = x[0] or "Untitled task"
                        if mine(x[1]):
                            ok = True
                            break
                        pid, depth = x[2], depth + 1
                if not ok and _owns_below(d, r["id"], mine):
                    ok = True         # a task whose sub-tasks are this person's: its own due date shows too
                if ok:
                    picked.append((r, parent))
    except Exception:
        return out
    for r, parent in picked:
        t = T.task_row(r)
        out.append({
            "kind": "task", "id": "t-" + t["id"], "title": t["title"] or "Untitled task",
            "start": t["due"][:10], "end": t["due"][:10], "all_day": True, "done": t["done"],
            "from": "%s / %s" % (r["list_title"] or "", r["group_title"] or ""),
            "parent": parent,
            "priority": t["priority"],
            "url": "tasks.html?list=%s&task=%s" % (t["list_id"], t["id"]),
        })
    return out


def _owners(raw):
    try:
        v = json.loads(raw or "[]")
        return v if isinstance(v, list) else []
    except Exception:
        return []


_ISS = {}        # project -> (rev, [issues with a due date])


def _issues(core, w, start, end):
    """Open issues assigned to this person, due in the window."""
    out = []
    me = (w.name or "").strip().lower()
    if not me:
        return out
    for p in core.list_projects():
        pid = p["id"]
        if not core.role_in(w, pid):
            continue
        try:
            st = core.store_for(pid)
            rev = st.current_rev()
            hit = _ISS.get(pid)
            if not hit or hit[0] != rev:
                due = []
                for it in st.all_items()[1]:
                    iss = it.get("issue") or {}
                    if it.get("deleted") or not iss.get("due_date"):
                        continue
                    due.append({"id": it.get("id"), "sheet": it.get("sheet") or "", "number": iss.get("number"),
                                "title": iss.get("title") or "Issue", "status": iss.get("status") or "Open",
                                "due": str(iss.get("due_date"))[:10], "to": (iss.get("assigned_to") or "").strip()})
                hit = (rev, due)
                _ISS[pid] = hit
        except Exception:
            continue
        for i in hit[1]:
            if i["to"].lower() != me or i["status"] in ("Resolved", "Closed") or not (start <= i["due"] <= end):
                continue
            url = ("index.html?project=%s&sheet=%s&select=%s" % (pid, i["sheet"], i["id"]) if i["sheet"]
                   else "model.html?project=%s&select=%s" % (pid, i["id"]))
            out.append({
                "kind": "issue", "id": "i-%s-%s" % (pid, i["id"]),
                "title": "#%s %s" % (i["number"] or "?", i["title"]), "start": i["due"], "end": i["due"],
                "all_day": True, "status": i["status"], "from": p.get("title") or pid, "url": url,
            })
    return out


def _queries(core, w, start, end):
    """Open queries due in the window, addressed to this person or raised by them."""
    try:
        import queries
        return queries.calendar(core, w, start, end)
    except Exception:
        return []


def entries(core, w, start, end, others=True):
    out = (_meetings(w, start, end) + _tasks(core, w, start, end) + _issues(core, w, start, end)
           + _queries(core, w, start, end) + _leave(core, w, start, end, others))
    out.sort(key=lambda e: (e["start"], e["kind"] != "meeting", e["title"].lower()))
    return out


# ------------------------------------------------------------ iCalendar

def _esc(v):
    return (v or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line):
    out, b = [], line.encode("utf-8")
    while len(b) > 74:
        cut = 74
        while cut and (b[cut] & 0xC0) == 0x80:
            cut -= 1
        out.append(b[:cut].decode("utf-8"))
        b = b" " + b[cut:]
    out.append(b.decode("utf-8"))
    return "\r\n".join(out)


def _utc(x, tz):
    t = time.strptime(x if "T" in x else x + "T00:00", "%Y-%m-%dT%H:%M")
    return time.strftime("%Y%m%dT%H%M00Z", time.gmtime(calendar.timegm(t) - int(tz or 0) * 60))


def _next_day(day):
    return time.strftime("%Y%m%d", time.gmtime(calendar.timegm(time.strptime(day[:10], "%Y-%m-%d")) + 86400))


def ics(entries_, base, name):
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LWK Viewer//Calendar//EN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", "X-WR-CALNAME:" + _esc(name), "X-PUBLISHED-TTL:PT1H",
             "REFRESH-INTERVAL;VALUE=DURATION:PT1H"]
    for e in entries_:
        what = {"meeting": "", "task": "Task: ", "issue": "Issue: ", "query": "Query: ", "leave": ""}.get(e["kind"], "")
        if e["kind"] == "meeting" and not e["all_day"]:
            end = e["end"] if e["end"] > e["start"] else None
            when = ["DTSTART:" + _utc(e["start"], e.get("tz")),
                    ("DTEND:" + _utc(end, e.get("tz"))) if end else "DURATION:PT1H"]
        else:
            when = ["DTSTART;VALUE=DATE:" + e["start"][:10].replace("-", ""),
                    "DTEND;VALUE=DATE:" + _next_day(e["end"] or e["start"])]
        desc = "\n".join(x for x in (e.get("notes"), e.get("link"), "From: " + e.get("from", ""),
                                     base + e["url"]) if x)
        lines += ["BEGIN:VEVENT", "UID:%s@lwk-viewer" % e["id"], "DTSTAMP:" + stamp] + when + [
            "SUMMARY:" + _esc(("CANCELLED: " if e.get("cancelled") else "") + what + e["title"]
                              + (" (done)" if e.get("done") else "")),
            "DESCRIPTION:" + _esc(desc), "URL:" + base + e["url"]]
        if e.get("where"):
            lines.append("LOCATION:" + _esc(e["where"]))
        if e["kind"] != "meeting":
            lines.append("TRANSP:TRANSPARENT")          # a due date does not block the day
        lines += ["STATUS:" + ("CANCELLED" if e.get("cancelled") else "CONFIRMED"), "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(x) for x in lines) + "\r\n"


# ------------------------------------------------------------ routes

def register(app, core):

    def me(request, token):
        w = core.who(request, token)
        if w.uid is None:
            raise HTTPException(status_code=400, detail="The calendar needs accounts switched on (Admin page)")
        return w

    def window(frm, to):
        today = time.strftime("%Y-%m-%d")
        frm = frm if DAY.match(frm or "") else today
        to = to if DAY.match(to or "") else time.strftime("%Y-%m-%d", time.gmtime(time.time() + 62 * 86400))
        if to < frm:
            frm, to = to, frm
        return frm, to

    def base_url(request):
        b = core.CFG.get("base_url") or ""
        if b:
            return b if b.endswith("/") else b + "/"
        return str(request.base_url)

    @app.get("/api/calendar")
    def cal(request: Request, frm: str = "", to: str = "", x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        q = request.query_params
        start, end = window(q.get("from") or frm, q.get("to") or to)
        return {"from": start, "to": end, "entries": entries(core, w, start, end)}

    def feed_info(request, uid, new=False):
        k = feed_key(core, uid, new)
        url = base_url(request) + "cal/" + k + ".ics"
        return {"url": url, "webcal": re.sub(r"^https?://", "webcal://", url)}

    @app.get("/api/calendar/feed")
    def feed(request: Request, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        return feed_info(request, w.uid)

    @app.post("/api/calendar/feed")
    async def feed_new(request: Request, x_viewer_token: str = Header(default="")):
        """A new address: the old one stops working (shared by mistake)."""
        w = me(request, x_viewer_token)
        return feed_info(request, w.uid, new=True)

    # ---------------------------------------------- calendar groups

    def site_admin(w):
        try:
            return bool(w.site_admin)
        except Exception:
            return False

    def people_ids(core_, ids):
        out = []
        for u in ids or []:
            try:
                u = int(u)
            except (TypeError, ValueError):
                continue
            user = core_.ACC.get(u)
            if user and user.get("active") and u not in out:
                out.append(u)
        return out

    def group_view(g, w):
        mem = []
        for u in g.get("members") or []:
            user = core.ACC.get(u) or {}
            mem.append({"uid": u, "name": user.get("name") or "?", "office": user.get("office") or ""})
        return {"id": g["id"], "name": g.get("name") or "", "owner": g.get("owner"),
                "members": mem, "can_edit": g.get("owner") == w.uid or site_admin(w)}

    @app.get("/api/calendar/groups")
    def groups_list(request: Request, x_viewer_token: str = Header(default="")):
        """My calendar groups (all of them for a site admin)."""
        w = me(request, x_viewer_token)
        gs = _load(core, GROUPS, [])
        mine = [g for g in gs if w.uid in (g.get("members") or []) or g.get("owner") == w.uid or site_admin(w)]
        return {"groups": [group_view(g, w) for g in mine]}

    @app.post("/api/calendar/groups")
    async def groups_new(request: Request, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        body = await request.json() or {}
        name = str(body.get("name") or "").strip()[:60]
        if not name:
            raise HTTPException(status_code=400, detail="Give the group a name.")
        members = people_ids(core, body.get("members"))
        if w.uid not in members:
            members.insert(0, w.uid)
        g = {"id": secrets.token_hex(6), "name": name, "owner": w.uid, "members": members}
        with _LOCK:
            gs = _load(core, GROUPS, [])
            gs.append(g)
            _save(core, GROUPS, gs)
        return group_view(g, w)

    def editable(gid, w):
        gs = _load(core, GROUPS, [])
        g = next((x for x in gs if x.get("id") == gid), None)
        if not g:
            raise HTTPException(status_code=404, detail="No such group")
        if g.get("owner") != w.uid and not site_admin(w):
            raise HTTPException(status_code=403, detail="Only the person who made the group (or a site admin) can change it.")
        return gs, g

    @app.put("/api/calendar/groups/{gid}")
    async def groups_edit(gid: str, request: Request, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        body = await request.json() or {}
        with _LOCK:
            gs, g = editable(gid, w)
            if "name" in body:
                name = str(body.get("name") or "").strip()[:60]
                if name:
                    g["name"] = name
            if "members" in body:
                g["members"] = people_ids(core, body.get("members"))
            _save(core, GROUPS, gs)
        return group_view(g, w)

    @app.delete("/api/calendar/groups/{gid}")
    async def groups_delete(gid: str, request: Request, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        with _LOCK:
            gs, g = editable(gid, w)
            _save(core, GROUPS, [x for x in gs if x is not g])
        return {"deleted": gid}

    @app.post("/api/calendar/groups/{gid}/leave-group")
    async def groups_quit(gid: str, request: Request, x_viewer_token: str = Header(default="")):
        """Leave a group someone else made."""
        w = me(request, x_viewer_token)
        with _LOCK:
            gs = _load(core, GROUPS, [])
            g = next((x for x in gs if x.get("id") == gid), None)
            if not g:
                raise HTTPException(status_code=404, detail="No such group")
            g["members"] = [u for u in g.get("members") or [] if u != w.uid]
            _save(core, GROUPS, gs)
        return {"left": gid}

    # ---------------------------------------------- leave

    @app.post("/api/calendar/leave")
    async def leave_new(request: Request, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        body = await request.json() or {}
        a, b = str(body.get("start") or ""), str(body.get("end") or body.get("start") or "")
        if not (DAY.match(a) and DAY.match(b)):
            raise HTTPException(status_code=400, detail="Give the first and last day (YYYY-MM-DD).")
        if b < a:
            a, b = b, a
        half = body.get("half") if body.get("half") in ("am", "pm") and a == b else ""
        what = body.get("type") if body.get("type") in LEAVE_TYPES else "Annual leave"
        r = {"id": secrets.token_hex(6), "uid": w.uid, "start": a, "end": b, "half": half, "type": what,
             "note": str(body.get("note") or "").strip()[:200], "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        with _LOCK:
            rows = _load(core, LEAVE, [])
            rows.append(r)
            _save(core, LEAVE, rows)
        return {"leave": r}

    @app.delete("/api/calendar/leave/{lid}")
    async def leave_delete(lid: str, request: Request, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        with _LOCK:
            rows = _load(core, LEAVE, [])
            r = next((x for x in rows if x.get("id") == lid), None)
            if not r:
                raise HTTPException(status_code=404, detail="No such leave")
            if r.get("uid") != w.uid and not site_admin(w):
                raise HTTPException(status_code=403, detail="Only your own leave can be removed.")
            _save(core, LEAVE, [x for x in rows if x is not r])
        return {"deleted": lid}

    # ---------------------------------------------- public holidays added by an admin

    @app.get("/api/holidays")
    def holidays_get(request: Request, x_viewer_token: str = Header(default="")):
        me(request, x_viewer_token)
        h = _load(core, HOLIDAYS, {})
        return {"hk": h.get("hk") or {}, "ph": h.get("ph") or {}}

    @app.put("/api/holidays")
    async def holidays_put(request: Request, x_viewer_token: str = Header(default="")):
        """Next year's dates, or a holiday proclaimed late (Eid'l Fitr and
        Eid'l Adha in the Philippines): added over the built-in lists. A name
        "-" takes a built-in date away."""
        w = me(request, x_viewer_token)
        if not site_admin(w):
            raise HTTPException(status_code=403, detail="Only a site admin can change the holiday list.")
        body = await request.json() or {}
        out = {}
        for reg in ("hk", "ph"):
            d = body.get(reg) or {}
            out[reg] = {k: str(v).strip()[:80] for k, v in d.items() if DAY.match(str(k)) and str(v).strip()} if isinstance(d, dict) else {}
        with _LOCK:
            _save(core, HOLIDAYS, out)
        return out

    @app.get("/cal/{key}.ics")
    def feed_ics(request: Request, key: str):
        uid = uid_of_key(core, key)
        user = core.ACC.get(uid) if uid is not None and core.accounts_on() else None
        if not user or not user.get("active"):
            raise HTTPException(status_code=404, detail="No such calendar")
        w = core.Who(user)
        t = time.time()
        start = time.strftime("%Y-%m-%d", time.gmtime(t - 60 * 86400))
        end = time.strftime("%Y-%m-%d", time.gmtime(t + 365 * 86400))
        # your own leave only: Outlook shows the calendar to whoever you share it with
        body = ics(entries(core, w, start, end, others=False), base_url(request), "LWK Viewer - " + (user.get("name") or ""))
        return Response(content=body, media_type="text/calendar; charset=utf-8",
                        headers={"Cache-Control": "no-cache"})

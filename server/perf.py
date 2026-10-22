# -*- coding: utf-8 -*-
"""How fast the server answers, and where people wait (Admin > Speed).

Three things are measured, all kept in <data>/perf/:

- Every request: its route, how long it took and how much it sent, added
  up per route and per day (stats-YYYY-MM-DD.json, a percentile sample
  kept per route). A request over SLOW_MS goes to slow-YYYY-MM.jsonl.
- The server's main loop: a watchdog thread asks it to answer every half
  second. When it does not answer for STALL_S, the loop is busy with
  something that should not run there - the watchdog writes down what the
  loop was doing at that moment (its Python stack: the function to move
  off it) and the requests running then (stalls-YYYY-MM.jsonl).
- Each page as people open it (boot.js): time to the first byte, until the
  page could be used, and its slowest data requests, with the device's
  connection (client-YYYY-MM.jsonl, added up per page and day).

GET /api/admin/perf?days=7 (site admin) gives the summary the Admin page
shows. Nothing here may slow a request down or fail one: every step is
guarded, and the files are written by a background thread."""

import asyncio
import json
import os
import sys
import threading
import time
import traceback
from collections import deque

SLOW_MS = 2000            # a request this slow is written down one by one
STALL_S = 1.0             # the main loop not answering this long is a stall
SAMPLE = 400              # durations kept per route and day, for the percentiles
FLUSH_S = 60
# answers that wait on purpose (until there is news, up to ~25 s): counted,
# but not as slow, and not in the figures of how long answers take
WAITING = ("/api/chat/notify", "/api/chat/sync")


class Perf(object):

    def __init__(self, data_dir):
        self.dir = os.path.join(data_dir, "perf")
        self.lock = threading.Lock()
        self.days = {}                     # "YYYY-MM-DD" -> {route: stats}
        self.client = {}                   # "YYYY-MM-DD" -> {page: stats}
        self.inflight = {}                 # id -> (route, path, t0)
        self.recent = deque(maxlen=300)    # (t0, t1, route, path) just finished
        self.lines = deque()               # (file, record) waiting to be written
        self.loop = None
        self.loop_thread = None
        self.started = time.time()
        self.stalls_today = 0
        self._seq = 0
        try:
            os.makedirs(self.dir, exist_ok=True)
        except OSError:
            pass
        self._load(time.strftime("%Y-%m-%d"))

    # ------------------------------------------------------------ requests

    def begin(self, path):
        with self.lock:
            self._seq += 1
            k = self._seq
            self.inflight[k] = (None, path, time.time())
        return k

    def end(self, k, route, method, status, nbytes, project=""):
        t1 = time.time()
        with self.lock:
            got = self.inflight.pop(k, None)
        if not got:
            return
        _, path, t0 = got
        ms = (t1 - t0) * 1000.0
        key = "%s %s" % (method, route)
        day = time.strftime("%Y-%m-%d", time.localtime(t0))
        if path in WAITING:
            with self.lock:
                st = self.days.setdefault(day, {}).setdefault(key + " (waits for news)", {"n": 0, "ms": 0.0, "max": 0.0, "bytes": 0,
                                                                                        "err": 0, "slow": 0, "sample": []})
                st["n"] += 1
                st["bytes"] += int(nbytes or 0)
                if status >= 500:
                    st["err"] += 1
            return
        with self.lock:
            self.recent.append((t0, t1, key, path))
            st = self.days.setdefault(day, {}).setdefault(key, {"n": 0, "ms": 0.0, "max": 0.0, "bytes": 0, "err": 0,
                                                                "slow": 0, "sample": []})
            st["n"] += 1
            st["ms"] += ms
            st["max"] = max(st["max"], ms)
            st["bytes"] += int(nbytes or 0)
            if status >= 500:
                st["err"] += 1
            if ms >= SLOW_MS:
                st["slow"] += 1
            s = st["sample"]
            if len(s) < SAMPLE:
                s.append(round(ms, 1))
            else:
                # keep a fair sample of the day: replace one at random
                import random
                i = random.randrange(st["n"])
                if i < SAMPLE:
                    s[i] = round(ms, 1)
        if ms >= SLOW_MS:
            self._line("slow", {"at": _iso(t0), "ms": round(ms), "route": key, "path": path[:300], "status": status,
                                "bytes": int(nbytes or 0), "project": project[:80]})

    def set_route(self, k, route):
        with self.lock:
            got = self.inflight.get(k)
            if got:
                self.inflight[k] = (route, got[1], got[2])

    # ------------------------------------------------------- the main loop

    def start(self, loop):
        """Called on the loop once the server runs: the watchdog starts."""
        self.loop = loop
        self.loop_thread = threading.get_ident()
        # more room for answers worked out on threads (40 by default): a few
        # slow ones must not hold up the rest
        try:
            import anyio.to_thread
            lim = anyio.to_thread.current_default_thread_limiter()
            lim.total_tokens = max(lim.total_tokens, 100)
        except Exception:
            pass
        threading.Thread(target=self._watch, name="perf-watchdog", daemon=True).start()
        threading.Thread(target=self._writer, name="perf-writer", daemon=True).start()

    def _watch(self):
        while True:
            done = threading.Event()
            t0 = time.time()
            try:
                self.loop.call_soon_threadsafe(done.set)
            except Exception:
                return                                 # the loop has closed
            if done.wait(STALL_S):
                time.sleep(0.5)
                continue
            # the loop is busy: what is it doing?
            stack = ""
            try:
                fr = sys._current_frames().get(self.loop_thread)
                if fr is not None:
                    stack = "".join(traceback.format_stack(fr)[-14:])
            except Exception:
                pass
            with self.lock:
                running = [{"route": r or p[:80], "path": p[:200], "s": round(time.time() - t, 1)}
                           for r, p, t in self.inflight.values() if p not in WAITING]
            done.wait(600)
            lag = time.time() - t0
            self.stalls_today += 1
            with self.lock:
                # requests that ran through the stall (they may have caused it)
                over = [{"route": k, "path": p[:200], "s": round(b - a, 1)}
                        for a, b, k, p in self.recent if b >= t0 and b - a >= STALL_S]
                day = self.days.setdefault(time.strftime("%Y-%m-%d"), {})
                st = day.setdefault("(stalls)", {"n": 0, "ms": 0.0, "max": 0.0, "bytes": 0, "err": 0, "slow": 0, "sample": []})
                st["n"] += 1
                st["ms"] += lag * 1000.0
                st["max"] = max(st["max"], lag * 1000.0)
            self._line("stalls", {"at": _iso(t0), "s": round(lag, 2), "doing": _where(stack), "stack": stack[-4000:],
                                  "running": running[:20], "finished_during": over[:20]})

    # ------------------------------------------------------------- pages

    def client_report(self, rec):
        day = time.strftime("%Y-%m-%d")
        page = str(rec.get("page") or "?")[:40]
        with self.lock:
            st = self.client.setdefault(day, {}).setdefault(page, {"n": 0, "ready": [], "ttfb": [], "slow_api": {}})
            st["n"] += 1
            for k in ("ready", "ttfb"):
                v = rec.get(k + "_ms")
                if isinstance(v, (int, float)) and 0 <= v < 600000:
                    if len(st[k]) < SAMPLE:
                        st[k].append(round(v))
                    else:
                        import random
                        i = random.randrange(st["n"])
                        if i < SAMPLE:
                            st[k][i] = round(v)
            for a in rec.get("api") or []:
                if not isinstance(a, dict):
                    continue
                p = str(a.get("path") or "")[:120]
                ms = a.get("ms")
                if not p or not isinstance(ms, (int, float)):
                    continue
                s = st["slow_api"].setdefault(p, {"n": 0, "ms": 0.0, "max": 0.0})
                s["n"] += 1
                s["ms"] += ms
                s["max"] = max(s["max"], ms)
            if len(st["slow_api"]) > 200:
                for p in sorted(st["slow_api"], key=lambda q: st["slow_api"][q]["ms"])[:50]:
                    st["slow_api"].pop(p, None)
        self._line("client", rec)

    # ------------------------------------------------------------ summary

    def summary(self, days=7):
        days = max(1, min(int(days or 7), 60))
        names = [time.strftime("%Y-%m-%d", time.localtime(time.time() - 86400 * i)) for i in range(days)]
        for d in names:
            if d not in self.days:
                self._load(d)
        with self.lock:
            routes = {}
            per_day = []
            for d in names:
                rs = self.days.get(d) or {}
                stalls = rs.get("(stalls)") or {}
                tot = [v for k, v in rs.items() if k != "(stalls)"]
                allms = sorted(x for v in tot for x in v["sample"])
                per_day.append({"day": d, "requests": sum(v["n"] for v in tot), "slow": sum(v["slow"] for v in tot),
                                "errors": sum(v["err"] for v in tot), "p50_ms": _pct(allms, 0.5), "p95_ms": _pct(allms, 0.95),
                                "stalls": stalls.get("n", 0), "stall_max_s": round(stalls.get("max", 0.0) / 1000.0, 1)})
                for k, v in rs.items():
                    if k == "(stalls)":
                        continue
                    r = routes.setdefault(k, {"n": 0, "ms": 0.0, "max": 0.0, "bytes": 0, "err": 0, "slow": 0, "sample": []})
                    for f in ("n", "ms", "bytes", "err", "slow"):
                        r[f] += v[f]
                    r["max"] = max(r["max"], v["max"])
                    r["sample"] += v["sample"]
            rout = []
            for k, r in routes.items():
                s = sorted(r["sample"])
                rout.append({"route": k, "n": r["n"], "avg_ms": round(r["ms"] / r["n"]) if r["n"] else 0,
                             "p50_ms": _pct(s, 0.5), "p95_ms": _pct(s, 0.95), "max_ms": round(r["max"]),
                             "total_s": round(r["ms"] / 1000.0, 1), "kb": round(r["bytes"] / 1024.0), "slow": r["slow"], "err": r["err"]})
            rout.sort(key=lambda r: -r["total_s"])
            pages = {}
            for d in names:
                for p, v in (self.client.get(d) or {}).items():
                    g = pages.setdefault(p, {"n": 0, "ready": [], "ttfb": [], "slow_api": {}})
                    g["n"] += v["n"]
                    g["ready"] += v["ready"]
                    g["ttfb"] += v["ttfb"]
                    for a, s in v["slow_api"].items():
                        t = g["slow_api"].setdefault(a, {"n": 0, "ms": 0.0, "max": 0.0})
                        t["n"] += s["n"]
                        t["ms"] += s["ms"]
                        t["max"] = max(t["max"], s["max"])
            pout = []
            for p, g in pages.items():
                rd, tf = sorted(g["ready"]), sorted(g["ttfb"])
                worst = sorted(g["slow_api"].items(), key=lambda kv: -kv[1]["ms"] / max(1, kv[1]["n"]))[:5]
                pout.append({"page": p, "n": g["n"], "ready_p50_ms": _pct(rd, 0.5), "ready_p95_ms": _pct(rd, 0.95),
                             "ttfb_p50_ms": _pct(tf, 0.5),
                             "slow_api": [{"path": a, "n": s["n"], "avg_ms": round(s["ms"] / max(1, s["n"])), "max_ms": round(s["max"])}
                                          for a, s in worst]})
            pout.sort(key=lambda p: -(p["ready_p95_ms"] or 0))
            running = [{"route": r or p[:80], "path": p[:200], "s": round(time.time() - t, 1)}
                       for r, p, t in self.inflight.values() if p not in WAITING]
        month = time.strftime("%Y-%m")
        return {"days": per_day, "routes": rout[:80], "pages": pout,
                "stalls": _tail(os.path.join(self.dir, "stalls-%s.jsonl" % month), 40),
                "slow": _tail(os.path.join(self.dir, "slow-%s.jsonl" % month), 80),
                "running": running, "since": _iso(self.started),
                "server": {"cpus": os.cpu_count(), "python": sys.version.split()[0], "pid": os.getpid(),
                           "threads": threading.active_count()}}

    # -------------------------------------------------------------- files

    def _line(self, kind, rec):
        with self.lock:
            if len(self.lines) < 5000:
                self.lines.append((kind, rec))

    def _writer(self):
        last = time.time()
        while True:
            time.sleep(2)
            with self.lock:
                batch = list(self.lines)
                self.lines.clear()
            month = time.strftime("%Y-%m")
            by = {}
            for kind, rec in batch:
                by.setdefault(kind, []).append(rec)
            for kind, recs in by.items():
                try:
                    with open(os.path.join(self.dir, "%s-%s.jsonl" % (kind, month)), "a", encoding="utf-8") as f:
                        for r in recs:
                            f.write(json.dumps(r, ensure_ascii=False) + "\n")
                except Exception:
                    pass
            if time.time() - last >= FLUSH_S:
                last = time.time()
                self.flush()

    def flush(self):
        today = time.strftime("%Y-%m-%d")
        with self.lock:
            snap = {"routes": json.loads(json.dumps(self.days.get(today) or {})),
                    "client": json.loads(json.dumps(self.client.get(today) or {}))}
            # older days stay on disk only
            for d in [d for d in self.days if d < today]:
                if d != today:
                    self.days.pop(d, None)
            for d in [d for d in self.client if d < today]:
                self.client.pop(d, None)
        try:
            p = os.path.join(self.dir, "stats-%s.json" % today)
            with open(p + ".tmp", "w", encoding="utf-8") as f:
                json.dump(snap, f)
            os.replace(p + ".tmp", p)
        except Exception:
            pass

    def _load(self, day):
        try:
            with open(os.path.join(self.dir, "stats-%s.json" % day), encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            return
        with self.lock:
            self.days.setdefault(day, d.get("routes") or {})
            self.client.setdefault(day, d.get("client") or {})


def _iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(t))


def _pct(s, q):
    if not s:
        return None
    return round(s[min(len(s) - 1, int(q * len(s)))])


def _tail(path, n):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 400000))
            lines = f.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return []
    out = []
    for line in reversed(lines):
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
        if len(out) >= n:
            break
    return out


def _where(stack):
    """The deepest frame of the server's own code in a stack: the function
    to move off the main loop."""
    here = os.path.dirname(os.path.abspath(__file__))
    best = ""
    for line in stack.splitlines():
        line = line.strip()
        if line.startswith("File ") and here in line and "perf.py" not in line:
            best = line
    return best.replace(here + os.sep, "")


def _route_of(scope):
    r = scope.get("route")
    p = getattr(r, "path", None)
    if p:
        return p
    ep = scope.get("endpoint")
    if ep is not None and getattr(ep, "__name__", "") and (scope.get("path") or "").startswith("/api/"):
        return "%s()" % ep.__name__
    path = scope.get("path") or ""
    if path.startswith("/data/"):
        return "/data/{project}/" + ("..." + os.path.splitext(path)[1] if "." in path.rsplit("/", 1)[-1] else "...")
    if path.startswith("/snapshots/"):
        return "/snapshots/..."
    if path.startswith("/api/"):
        return path
    ext = os.path.splitext(path)[1]
    return "(viewer files %s)" % (ext or "/")


class PerfMiddleware(object):
    """Times every http request (pure ASGI: it does not hold a response
    back while it streams)."""

    def __init__(self, app, perf):
        self.app = app
        self.perf = perf

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        P = self.perf
        if P.loop is None:
            try:
                P.start(asyncio.get_running_loop())          # the first request: the watchdog starts
            except Exception:
                P.loop = False
        try:
            k = P.begin(scope.get("path") or "")
        except Exception:
            return await self.app(scope, receive, send)
        box = {"status": 0, "bytes": 0, "done": False}

        async def send2(msg):
            try:
                t = msg.get("type")
                if t == "http.response.start":
                    box["status"] = int(msg.get("status") or 0)
                    if box["status"] and not box.get("route"):
                        box["route"] = _route_of(scope)
                        P.set_route(k, box["route"])
                elif t == "http.response.body":
                    box["bytes"] += len(msg.get("body") or b"")
                    if not msg.get("more_body"):
                        box["done"] = True
            except Exception:
                pass
            await send(msg)

        try:
            await self.app(scope, receive, send2)
        except BaseException:
            box["status"] = box["status"] or 500
            raise
        finally:
            try:
                proj = ""
                for hk, hv in scope.get("headers") or []:
                    if hk == b"x-project":
                        proj = hv.decode("utf-8", "replace")
                        break
                P.end(k, box.get("route") or _route_of(scope), scope.get("method") or "", box["status"] or 0, box["bytes"], proj)
            except Exception:
                pass


def register(app, core):
    perf = Perf(core.CFG["data"])
    core.PERF = perf
    app.add_middleware(PerfMiddleware, perf=perf)

    from fastapi import HTTPException, Request, Header

    @app.post("/api/perf/client")
    async def perf_client(request: Request, x_viewer_token: str = Header(default="")):
        raw = await request.body()
        if len(raw) > 20000:
            raise HTTPException(status_code=413, detail="Too big")
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        # sendBeacon cannot set a header: the token may come in the body
        w = core.who(request, x_viewer_token or str(body.pop("token", "") or ""))
        body.pop("token", None)
        rec = {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "user": w.name or ""}
        for k in ("page", "project", "ready_ms", "ttfb_ms", "dom_ms", "load_ms", "how", "net", "device", "cached", "api"):
            if k in body:
                rec[k] = body[k]
        if isinstance(rec.get("api"), list):
            rec["api"] = rec["api"][:8]
        perf.client_report(rec)
        return {"ok": True}

    @app.get("/api/admin/perf")
    def perf_summary(request: Request, days: int = 7, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        if core.accounts_on() and not w.site_admin:
            raise HTTPException(status_code=403, detail="Only a site admin can see the speed figures")
        return perf.summary(days)

    return perf

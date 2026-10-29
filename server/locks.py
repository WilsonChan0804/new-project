"""Taking a database's lock, without waiting for ever.

Each of the server's small databases (chat, tasks, boards, folders) lets one
request at a time in, by a lock. If a request ever keeps its lock - a bug, as
on 26 Oct when one waited on itself - everyone after it used to wait with it,
for good. Now the wait ends after WAIT_S: that one answer says the server is
busy, and the server log says who has held the lock and where they took it,
so the cause can be fixed.
"""
import sys
import threading
import time

from fastapi import HTTPException

WAIT_S = 20.0
_HELD = {}                 # id(lock) -> (what, thread, where, since)


def _where():
    """The first frame outside this file and the database classes: the route."""
    f = sys._getframe(2)
    while f is not None and f.f_code.co_name in ("__enter__", "take"):
        f = f.f_back
    if f is None:
        return "?"
    return "%s:%d %s" % (f.f_code.co_filename.replace("\\", "/").rsplit("/", 1)[-1], f.f_lineno, f.f_code.co_name)


def take(lock, what):
    if not lock.acquire(timeout=WAIT_S):
        h = _HELD.get(id(lock))
        held = ("by %s in %s, for %.0f s" % (h[1], h[2], time.time() - h[3])) if h else "by no one known"
        print("LOCK %s database: not free after %.0f s - held %s; wanted by %s in %s"
              % (what, WAIT_S, held, threading.current_thread().name, _where()), flush=True)
        raise HTTPException(status_code=503, detail="The server is busy - try again in a moment")
    # the last to take a lock is its holder (nothing to clear on release)
    _HELD[id(lock)] = (what, threading.current_thread().name, _where(), time.time())

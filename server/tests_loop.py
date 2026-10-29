"""No database work on the event loop.

The server answers everyone from one event loop. A route written as
`async def` runs on that loop, so if it opens a database (whose lock may be
held by a request in the threadpool) the whole server waits - on 26 Oct a
stuck lock left it answering no one for ten minutes. Such work belongs in a
plain `def` route (FastAPI runs it in the threadpool) or in a nested
function handed to run_in_threadpool.

    python3 tests_loop.py
"""
import ast
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ("app.py", "chat.py", "tasks.py", "boards.py", "queries.py", "files.py", "lv_api.py", "sbd_api.py", "push.py")


def _is_route(fn):
    for d in fn.decorator_list:
        if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr in (
                "get", "post", "put", "patch", "delete", "api_route"):
            return True
    return False


def _opens_db(w):
    for it in w.items:
        s = ast.unparse(it.context_expr)
        head = s.split("(")[0].split(".")[-1]
        if head in ("db", "Db", "db_for", "lock_for") or head.endswith("_db") or head.endswith("Db"):
            return True
    return False


def offenders(path):
    tree = ast.parse(open(path, encoding="utf-8").read(), path)
    out = []

    def walk(node, fn):
        for ch in ast.iter_child_nodes(node):
            if isinstance(ch, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                continue                      # a nested function: run elsewhere (threadpool)
            if isinstance(ch, (ast.With, ast.AsyncWith)) and _opens_db(ch):
                out.append("%s:%d %s" % (os.path.basename(path), ch.lineno, fn.name))
            walk(ch, fn)

    for n in ast.walk(tree):
        if isinstance(n, ast.AsyncFunctionDef) and _is_route(n):
            walk(n, n)
    return out


class NoDbOnLoop(unittest.TestCase):
    def test_async_routes_do_not_open_databases(self):
        bad = []
        for f in FILES:
            p = os.path.join(HERE, f)
            if os.path.isfile(p):
                bad += offenders(p)
        self.assertEqual(bad, [], "async routes opening a database on the event loop:\n  " + "\n  ".join(bad))


if __name__ == "__main__":
    sys.exit(unittest.main())

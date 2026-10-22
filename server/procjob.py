# -*- coding: utf-8 -*-
"""Long work in its own process, at lower priority, so the server keeps
answering meanwhile (a Python process does one thing at a time: minutes of
work on one of its threads slow every answer).

    run("sheettiles", "make_sheet_tiles", [args], timeout=...) -> its result

The function is <module>.<func> of the server's folder, its arguments and
result plain JSON. Run here as  python -m procjob <in.json> <out.json>.
If a process cannot be started at all, the work is done in this one."""

import importlib
import json
import os
import subprocess
import sys
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))


def _flags():
    if os.name == "nt":
        return {"creationflags": 0x00004000 | 0x08000000}       # BELOW_NORMAL_PRIORITY_CLASS | CREATE_NO_WINDOW
    return {"preexec_fn": lambda: os.nice(10)}


def run(module, func, args, timeout=3600):
    fd, src = tempfile.mkstemp(prefix="lwk-job-", suffix=".in.json")
    os.close(fd)
    dst = src[:-8] + ".out.json"
    try:
        with open(src, "w", encoding="utf-8") as f:
            json.dump({"module": module, "func": func, "args": args}, f)
        try:
            p = subprocess.Popen([sys.executable, "-m", "procjob", src, dst], cwd=HERE,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, **_flags())
        except OSError:
            return getattr(importlib.import_module(module), func)(*args)
        try:
            _, err = p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            p.kill()
            p.communicate()
            raise RuntimeError("%s.%s took over %d min and was stopped" % (module, func, timeout // 60))
        try:
            with open(dst, encoding="utf-8") as f:
                r = json.load(f)
        except (OSError, ValueError):
            raise RuntimeError("%s.%s stopped without a result: %s"
                               % (module, func, (err or b"").decode("utf-8", "replace")[-300:]))
        if "error" in r:
            raise RuntimeError(r["error"])
        return r["result"]
    finally:
        for f in (src, dst, dst + ".tmp"):
            try:
                os.remove(f)
            except OSError:
                pass


def main(src, dst):
    try:
        with open(src, encoding="utf-8") as f:
            job = json.load(f)
        sys.path.insert(0, HERE)
        out = {"result": getattr(importlib.import_module(job["module"]), job["func"])(*job["args"])}
    except Exception as e:
        out = {"error": "%s: %s" % (type(e).__name__, e), "trace": traceback.format_exc()[-2000:]}
    with open(dst + ".tmp", "w", encoding="utf-8") as f:
        json.dump(out, f)
    os.replace(dst + ".tmp", dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

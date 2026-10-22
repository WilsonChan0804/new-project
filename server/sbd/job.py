"""One SBD check in its own process, so the server keeps answering while it
runs (a big model takes minutes of pure-Python work, which would hold the
server's interpreter all that time):

    python -m sbd.job <in.json> <out.json>

in.json: {"model": ..., "axis", "angle_deg", "levels"}; out.json: the
result, or {"ok": false, "error": "..."}."""

import json
import sys
import traceback

from . import engine


def main(src, dst):
    try:
        with open(src, encoding="utf-8") as f:
            job = json.load(f)
        r = engine.run(job["model"], axis=job.get("axis") or "street", angle_deg=float(job.get("angle_deg") or 0),
                       levels=job.get("levels"))
    except Exception as e:
        r = {"ok": False, "error": "%s: %s" % (type(e).__name__, e), "trace": traceback.format_exc()[-2000:]}
    tmp = dst + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(r, f)
    import os
    os.replace(tmp, dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

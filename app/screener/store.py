"""Screen the whole listed universe, not a hand-picked list.

## Why this matters beyond convenience

You cannot know every US stock, so a ranking engine that only works on names
you already thought of is not doing the job. But there is a second reason, and
it is the more important one.

The backtest found `valuation` significant **between** sectors (+0.112, t=2.30)
and not **within** them (+0.023, t=0.76) — a sector rotation bet rather than
company selection. That conclusion carries a caveat the decomposition itself
flagged: **the median sector cohort was six companies.** Six is not enough to
detect a within-sector effect even if one exists.

Screen two thousand names and a sector cohort becomes two or three hundred.
At that width the within-sector question becomes answerable rather than
suggestive. So the screener is not just a feature — it is the instrument that
settles the open finding.

## What it costs to run

One SEC `companyfacts` call and one price request per ticker, both free, both
cached. SEC asks for no more than about ten requests a second. Two thousand
names takes roughly 20-40 minutes on a first run and seconds afterwards.

Alpha Vantage is skipped entirely: 25 calls a day cannot screen anything, and
everything the screener needs comes from SEC filings and Yahoo prices.
"""
import json
from datetime import datetime, timezone

from ..config import settings
from ..storage.db import connect

SCHEMA = """
CREATE TABLE IF NOT EXISTS screen_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    as_of_date TEXT NOT NULL,
    engine_version TEXT,
    universe_size INTEGER,
    scored INTEGER DEFAULT 0,
    skipped INTEGER DEFAULT 0,
    params_json TEXT
);

CREATE TABLE IF NOT EXISTS screen_results (
    run_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    name TEXT,
    sector TEXT,
    price REAL,
    dollar_volume REAL,
    score REAL,
    coverage REAL,
    confidence REAL,
    valuation REAL,
    fundamentals REAL,
    growth REAL,
    technical REAL,
    money_flow REAL,
    sector_rank INTEGER,
    sector_percentile REAL,
    overall_percentile REAL,
    red_flag_count INTEGER,
    red_flags_text TEXT,
    detail_json TEXT,
    PRIMARY KEY (run_id, ticker)
);

CREATE TABLE IF NOT EXISTS screen_progress (
    run_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    PRIMARY KEY (run_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_screen_score ON screen_results(run_id, score DESC);
"""


def init():
    with connect() as conn:
        conn.executescript(SCHEMA)
        have = {r["name"] for r in conn.execute("PRAGMA table_info(screen_results)")}
        for col, typ in (("red_flag_count", "INTEGER"), ("red_flags_text", "TEXT")):
            if col not in have:
                conn.execute(f"ALTER TABLE screen_results ADD COLUMN {col} {typ}")


def sectors(run_id=None):
    """Sector names present in a run, for the filter drop-down."""
    run_id = run_id or latest_finished_id()
    if run_id is None:
        return []
    return sorted(cohort_sizes(run_id))


def latest_finished_id():
    init()
    with connect() as conn:
        row = conn.execute("SELECT id FROM screen_runs WHERE finished_at IS NOT NULL "
                           "ORDER BY id DESC LIMIT 1").fetchone()
    return row["id"] if row else None


def progress():
    """What the most recent screen is doing, for the dashboard."""
    init()
    with connect() as conn:
        run = conn.execute("SELECT * FROM screen_runs ORDER BY id DESC LIMIT 1").fetchone()
        if not run:
            return {"status": "never_run"}
        run = dict(run)
        counts = {r["status"]: r["c"] for r in conn.execute(
            "SELECT status, COUNT(*) c FROM screen_progress WHERE run_id = ? "
            "GROUP BY status", (run["id"],)).fetchall()}
    done = sum(counts.values())
    return {
        "status": "finished" if run["finished_at"] else "running_or_interrupted",
        "run_id": run["id"], "as_of_date": run["as_of_date"],
        "started_at": run["started_at"], "finished_at": run["finished_at"],
        "universe_size": run["universe_size"], "attempted": done,
        "scored": counts.get("ok", 0), "illiquid": counts.get("illiquid", 0),
        "no_data": counts.get("no_data", 0),
    }


def start_run(as_of, version, universe_size, params):
    init()
    with connect() as conn:
        cur = conn.execute(
            """INSERT INTO screen_runs
               (started_at, as_of_date, engine_version, universe_size, params_json)
               VALUES (?,?,?,?,?)""",
            (datetime.now(timezone.utc).isoformat(), str(as_of), version,
             universe_size, json.dumps(params)))
        return int(cur.lastrowid)


def latest_unfinished(as_of, max_age_days: int = 3):
    """Resume support: a screen of thousands of names should survive a Ctrl-C,
    including one that is resumed the next morning."""
    from datetime import date as _date, timedelta
    init()
    oldest = str((as_of if isinstance(as_of, _date) else _date.fromisoformat(str(as_of)))
                 - timedelta(days=max_age_days))
    with connect() as conn:
        row = conn.execute(
            """SELECT * FROM screen_runs
               WHERE finished_at IS NULL AND as_of_date >= ?
               ORDER BY id DESC LIMIT 1""", (oldest,)).fetchone()
    return dict(row) if row else None


def already_done(run_id):
    with connect() as conn:
        rows = conn.execute(
            "SELECT ticker FROM screen_progress WHERE run_id = ?", (run_id,)).fetchall()
    return {r["ticker"] for r in rows}


def record(run_id, row=None, ticker=None, status="ok", note=None):
    with connect() as conn:
        if row is not None:
            conn.execute(
                """INSERT OR REPLACE INTO screen_results
                   (run_id, ticker, name, sector, price, dollar_volume, score,
                    coverage, confidence, valuation, fundamentals, growth,
                    technical, money_flow, red_flag_count, red_flags_text,
                    detail_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (run_id, row["ticker"], row.get("name"), row.get("sector"),
                 row.get("price"), row.get("dollar_volume"), row.get("score"),
                 row.get("coverage"), row.get("confidence"), row.get("valuation"),
                 row.get("fundamentals"), row.get("growth"), row.get("technical"),
                 row.get("money_flow"),
                 None if row.get("red_flags") is None else len(row["red_flags"]),
                 "; ".join(row.get("red_flags") or []) or None,
                 json.dumps(row.get("detail") or {})))
        conn.execute(
            "INSERT OR REPLACE INTO screen_progress (run_id, ticker, status, note) "
            "VALUES (?,?,?,?)",
            (run_id, ticker or (row or {}).get("ticker"), status, note))


def finalise(run_id):
    """Compute ranks once every name is in.

    Sector percentile is computed here rather than per-ticker because a
    percentile needs the whole cohort, and the whole point of screening widely
    is that the cohorts are finally large enough to mean something.
    """
    with connect() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT ticker, sector, score FROM screen_results "
            "WHERE run_id = ? AND score IS NOT NULL", (run_id,)).fetchall()]

        if rows:
            ordered = sorted(rows, key=lambda r: r["score"])
            n = len(ordered)
            for i, r in enumerate(ordered):
                conn.execute(
                    "UPDATE screen_results SET overall_percentile = ? "
                    "WHERE run_id = ? AND ticker = ?",
                    (round(100.0 * i / max(n - 1, 1), 2), run_id, r["ticker"]))

            by_sector = {}
            for r in rows:
                by_sector.setdefault(r["sector"] or "UNKNOWN", []).append(r)
            for _, members in by_sector.items():
                members.sort(key=lambda r: r["score"], reverse=True)
                m = len(members)
                for rank, r in enumerate(members, 1):
                    conn.execute(
                        "UPDATE screen_results SET sector_rank = ?, "
                        "sector_percentile = ? WHERE run_id = ? AND ticker = ?",
                        (rank, round(100.0 * (m - rank) / max(m - 1, 1), 2),
                         run_id, r["ticker"]))

        counts = conn.execute(
            "SELECT status, COUNT(*) c FROM screen_progress WHERE run_id = ? "
            "GROUP BY status", (run_id,)).fetchall()
        scored = sum(r["c"] for r in counts if r["status"] == "ok")
        skipped = sum(r["c"] for r in counts if r["status"] != "ok")
        conn.execute(
            "UPDATE screen_runs SET finished_at = ?, scored = ?, skipped = ? "
            "WHERE id = ?",
            (datetime.now(timezone.utc).isoformat(), scored, skipped, run_id))
    return {"run_id": run_id, "scored": scored, "skipped": skipped}


def cohort_sizes(run_id):
    with connect() as conn:
        rows = conn.execute(
            "SELECT COALESCE(sector,'UNKNOWN') s, COUNT(*) c FROM screen_results "
            "WHERE run_id = ? AND score IS NOT NULL GROUP BY s ORDER BY c DESC",
            (run_id,)).fetchall()
    return {r["s"]: r["c"] for r in rows}


def results(run_id=None, sector=None, limit=50, order="score", ascending=False,
            min_coverage=0.0, require_critical=True, exclude_red_flags=False,
            min_sector_percentile=None, min_dollar_volume=None, query=None,
            offset=0):
    init()
    with connect() as conn:
        if run_id is None:
            row = conn.execute(
                "SELECT id FROM screen_runs WHERE finished_at IS NOT NULL "
                "ORDER BY id DESC LIMIT 1").fetchone()
            if not row:
                return {"status": "no_completed_run"}
            run_id = row["id"]

        run_row = conn.execute(
            "SELECT * FROM screen_runs WHERE id = ?", (run_id,)).fetchone()
        if run_row is None:
            available = [r["id"] for r in conn.execute(
                "SELECT id FROM screen_runs ORDER BY id DESC LIMIT 10").fetchall()]
            return {
                "status": "run_not_found",
                "requested_run_id": run_id,
                "available_run_ids": available,
                "message": (
                    f"No screen run with id {run_id}. "
                    + (f"Available: {available}. " if available else
                       "No screens have been run yet. ")
                    + "Omit run_id to use the most recent completed run, or "
                      "populate one with `python scripts/screen_universe.py`."),
            }
        run = dict(run_row)

        col = {"score": "score", "valuation": "valuation",
               "sector_percentile": "sector_percentile",
               "fundamentals": "fundamentals", "growth": "growth",
               "dollar_volume": "dollar_volume"}.get(order, "score")
        sql = (f"SELECT * FROM screen_results WHERE run_id = ? "
               f"AND score IS NOT NULL AND coverage >= ?")
        params = [run_id, min_coverage]

        # Names missing the components the backtest found informative must not
        # head the list. A real run put AUGO, AU, ARIS and ARGX in the top four
        # on coverage 0.30-0.40 with valuation null — ranked on technical and
        # money_flow alone, the two components measured at -0.015 and -0.002.
        # A ranking led by the least-informed names is worse than no ranking.
        critical = [c.strip() for c in settings.critical_components.split(",")
                    if c.strip() and c in
                    ("valuation", "fundamentals", "growth", "technical", "money_flow")]
        if require_critical:
            for c in critical:
                sql += f" AND {c} IS NOT NULL"
        if sector:
            sql += " AND sector = ?"
            params.append(sector.upper())
        if exclude_red_flags:
            # Unknown (NULL) is kept: a failed lookup is not evidence of trouble.
            sql += " AND COALESCE(red_flag_count, 0) = 0"
        if min_sector_percentile is not None:
            sql += " AND sector_percentile >= ?"
            params.append(min_sector_percentile)
        if min_dollar_volume is not None:
            sql += " AND dollar_volume >= ?"
            params.append(min_dollar_volume)
        if query:
            sql += " AND (ticker LIKE ? OR name LIKE ?)"
            params += [f"{query.upper()}%", f"%{query}%"]
        count_sql = sql.replace("SELECT *", "SELECT COUNT(*) c", 1)
        matched = conn.execute(count_sql, params).fetchone()["c"]
        sql += (f" ORDER BY {col} IS NULL, {col} {'ASC' if ascending else 'DESC'}"
                " LIMIT ? OFFSET ?")
        params += [limit, offset]
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]

    for r in rows:
        detail = json.loads(r.pop("detail_json", None) or "{}")
        r["action"] = detail.get("action")

    # How many names the critical filter removed, and why.
    with connect() as conn:
        total_scored = conn.execute(
            "SELECT COUNT(*) c FROM screen_results WHERE run_id = ? "
            "AND score IS NOT NULL", (run_id,)).fetchone()["c"]
        missing_critical = 0
        if critical:
            cond = " OR ".join(f"{c} IS NULL" for c in critical)
            missing_critical = conn.execute(
                f"SELECT COUNT(*) c FROM screen_results WHERE run_id = ? "
                f"AND score IS NOT NULL AND ({cond})", (run_id,)).fetchone()["c"]
        skips = {r["status"]: r["c"] for r in conn.execute(
            "SELECT status, COUNT(*) c FROM screen_progress WHERE run_id = ? "
            "AND status != 'ok' GROUP BY status", (run_id,)).fetchall()}

    cohorts = cohort_sizes(run_id)
    median_cohort = sorted(cohorts.values())[len(cohorts) // 2] if cohorts else 0

    return {
        "status": "ok",
        "run": {k: run[k] for k in
                ("id", "started_at", "finished_at", "as_of_date",
                 "engine_version", "universe_size", "scored", "skipped")},
        "sector_cohorts": cohorts,
        "median_cohort_size": median_cohort,
        "cohort_note": (
            f"Median sector cohort is {median_cohort}. The 63-name backtest had 6, "
            "which was too few to test a within-sector effect. Above roughly 30 a "
            "sector percentile starts to mean something."
            if median_cohort else "No cohorts yet."
        ),
        "results": rows,
        "filtering": {
            "scored": total_scored,
            "excluded_missing_critical": missing_critical if require_critical else 0,
            "critical_components": critical,
            "matched": matched,
            "shown": len(rows),
            "skipped_during_screen": skips,
            "note": (
                f"{missing_critical} of {total_scored} scored names lack "
                f"{'/'.join(critical) or 'a critical component'} and are excluded "
                "from the ranking. They were scored on whatever remained — often "
                "technical and money flow, the two components measured closest to "
                "zero — so ranking them alongside fully-covered names would put "
                "the least-informed at the top. Pass require_critical=false to "
                "see them anyway."
                if require_critical and missing_critical else
                "No critical-component filter applied."
            ),
        },
        "health_warning": (
            "This ranking is produced by a composite whose measured information "
            "coefficient is indistinguishable from zero (-0.005 +/- 0.032), and "
            "whose only significant component is a between-sector effect. Use it "
            "to FIND candidates you had not heard of, then judge them yourself. Do "
            "not treat the order as a prediction."
        ),
    }

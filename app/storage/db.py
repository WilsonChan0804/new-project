"""Decision log + calibration.

This is the layer v1.4 did not have at all, and it is the only part of the
system that can eventually tell you whether any of the rest of it works.

Every analysis is written down with its horizon, entry price, stated
probability and action. When the horizon elapses, ``resolve_due`` fetches the
realised price and records the outcome. ``calibration_report`` then answers the
only question that matters: when this engine says 60%, does it happen 60% of
the time?

Until that report has a few hundred rows in it, every score this engine emits
is a hypothesis.
"""
import json
import sqlite3
from datetime import datetime, timedelta, timezone

from ..config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    ticker TEXT NOT NULL,
    horizon_days INTEGER NOT NULL,
    due_at TEXT NOT NULL,
    action TEXT NOT NULL,
    opportunity_score REAL,
    confidence REAL,
    coverage REAL,
    p_bull REAL,
    expected_return_net_pct REAL,
    entry_price REAL,
    invalidation_price REAL,
    components_json TEXT,
    engine_version TEXT
);

CREATE TABLE IF NOT EXISTS outcomes (
    decision_id INTEGER PRIMARY KEY,
    resolved_at TEXT NOT NULL,
    exit_price REAL NOT NULL,
    realised_return_pct REAL NOT NULL,
    bullish_outcome INTEGER NOT NULL,
    FOREIGN KEY (decision_id) REFERENCES decisions(id)
);

CREATE INDEX IF NOT EXISTS idx_due ON decisions(due_at);
"""


# Columns added after the first real logs existed. Added in place so an
# existing engine.db keeps its history.
_MIGRATIONS = {
    "outcomes": {
        "benchmark_return_pct": "REAL",
        "excess_return_pct": "REAL",
    },
}


def connect():
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    for table, cols in _MIGRATIONS.items():
        have = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        for col, typ in cols.items():
            if col not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
    return conn


def recent_decision(ticker: str, within_days: int):
    """Most recent decision on ``ticker`` inside the last ``within_days``, or None.

    Used to stop the same company being logged several times in one week. Three
    watchlist runs two minutes apart are one observation, not three, and every
    duplicate dilutes the forward test.
    """
    since = (datetime.now(timezone.utc) - timedelta(days=within_days)).isoformat()
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM decisions WHERE ticker = ? AND created_at >= ? "
            "ORDER BY created_at DESC LIMIT 1",
            (ticker.upper(), since),
        ).fetchone()
    return dict(row) if row else None


def log_decision(result: dict) -> int:
    """Persist one analysis. Returns the decision id."""
    now = datetime.now(timezone.utc)
    horizon = result["scenario_diagnostics"]["horizon_days"] if result.get("scenario_diagnostics") else settings.default_horizon_days
    due = now + timedelta(days=int(horizon * 1.45))  # trading days -> calendar

    p_bull = None
    for s in result.get("scenarios") or []:
        if s["name"] == "Bull":
            p_bull = s["probability"]

    diag = result.get("scenario_diagnostics") or {}

    with connect() as conn:
        cur = conn.execute(
            """INSERT INTO decisions (created_at, ticker, horizon_days, due_at,
                   action, opportunity_score, confidence, coverage, p_bull,
                   expected_return_net_pct, entry_price, invalidation_price,
                   components_json, engine_version)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                now.isoformat(), result["ticker"], horizon, due.isoformat(),
                result["action"], result.get("opportunity_score"),
                result.get("confidence"), result.get("coverage"), p_bull,
                diag.get("expected_return_pct_net"), result.get("price"),
                result.get("invalidation_price"),
                json.dumps(result.get("score_breakdown") or {}),
                result.get("engine_version"),
            ),
        )
        return int(cur.lastrowid)


def due_decisions():
    now = datetime.now(timezone.utc).isoformat()
    with connect() as conn:
        rows = conn.execute(
            """SELECT d.* FROM decisions d
               LEFT JOIN outcomes o ON o.decision_id = d.id
               WHERE o.decision_id IS NULL AND d.due_at <= ?
               ORDER BY d.due_at""",
            (now,),
        ).fetchall()
    return [dict(r) for r in rows]


def record_outcome(decision_id: int, exit_price: float, entry_price: float,
                   benchmark_return_pct: float | None = None):
    ret = 100.0 * (exit_price / entry_price - 1.0)
    excess = None if benchmark_return_pct is None else round(ret - benchmark_return_pct, 4)
    with connect() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO outcomes
               (decision_id, resolved_at, exit_price, realised_return_pct, bullish_outcome,
                benchmark_return_pct, excess_return_pct)
               VALUES (?,?,?,?,?,?,?)""",
            (
                decision_id, datetime.now(timezone.utc).isoformat(),
                exit_price, round(ret, 4), 1 if ret > 0 else 0,
                benchmark_return_pct, excess,
            ),
        )
    return round(ret, 4)


def _spearman(xs, ys):
    """Rank correlation without scipy. Ties get average ranks."""
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2.0
            i = j + 1
        return r
    rx, ry = ranks(xs), ranks(ys)
    n = len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    vx = sum((a - mx) ** 2 for a in rx)
    vy = sum((b - my) ** 2 for b in ry)
    return cov / (vx * vy) ** 0.5 if vx > 0 and vy > 0 else None


def forward_rank_ic(rows, min_names: int = 5):
    """Does the score rank the names *within* each weekly run?

    This is the live version of the backtest's IC, and with
    ``score_tilt_strength = 0`` it is the only test that can see the score at
    all: every logged p_bull is 1/3, so the Brier score is identical whatever
    the score said. Cohorts are ISO weeks, the ranked quantity is excess return
    over the benchmark when available, and each week counts once.
    """
    cohorts = {}
    for r in rows:
        if r.get("opportunity_score") is None:
            continue
        y, w, _ = datetime.fromisoformat(r["created_at"]).isocalendar()
        target = r.get("excess_return_pct")
        if target is None:
            target = r["realised_return_pct"]
        cohorts.setdefault(f"{y}-W{w:02d}", []).append((r["opportunity_score"], target))

    weekly = []
    for week, pts in sorted(cohorts.items()):
        if len(pts) < min_names:
            continue
        ic = _spearman([p[0] for p in pts], [p[1] for p in pts])
        if ic is not None:
            weekly.append({"week": week, "n": len(pts), "ic": round(ic, 4)})

    if not weekly:
        return {"weeks": 0, "mean_ic": None, "weekly": [],
                "note": f"No weekly run has {min_names}+ resolved names yet."}
    ics = [w["ic"] for w in weekly]
    mean = sum(ics) / len(ics)
    if len(ics) > 1:
        sd = (sum((x - mean) ** 2 for x in ics) / (len(ics) - 1)) ** 0.5
        # Weekly cohorts with a ~13-week horizon overlap heavily; deflate by the
        # overlap the same way the backtest does (horizon / spacing ~= 13).
        eff = max(1.0, len(ics) / 13.0)
        se = sd / eff ** 0.5
    else:
        se = None
    return {
        "weeks": len(ics),
        "mean_ic": round(mean, 4),
        "overlap_adjusted_se": None if se is None else round(se, 4),
        "t_stat": None if not se else round(mean / se, 2),
        "backtest_reference": "+0.008 +/- 0.014 over 15 years",
        "weekly": weekly,
    }


def calibration_report(bins: int = 5):
    """Reliability table + Brier score.

    Brier score is the mean squared error of the probability forecasts. Lower
    is better; 0.25 is what you get by always saying 50%. If the engine cannot
    beat 0.25, its probabilities are worse than useless and the tilt strength
    should go to zero.
    """
    with connect() as conn:
        rows = conn.execute(
            """SELECT d.ticker, d.created_at, d.p_bull, d.action, d.opportunity_score,
                      d.confidence, o.realised_return_pct, o.bullish_outcome,
                      o.benchmark_return_pct, o.excess_return_pct
               FROM decisions d JOIN outcomes o ON o.decision_id = d.id
               WHERE d.p_bull IS NOT NULL"""
        ).fetchall()

    rows = [dict(r) for r in rows]
    if not rows:
        return {
            "status": "no_resolved_decisions",
            "message": (
                "Nothing has been resolved yet. Run /analyze with log=true, wait "
                "one horizon, then POST /calibration/resolve. Treat all scores as "
                "unvalidated until this report has meaningful sample size."
            ),
            "sample_size": 0,
        }

    # Repeated decisions on the same company within one horizon resolve to
    # nearly the same outcome, so they are not independent observations. An
    # early real log held eight decisions across four days, all on one ticker:
    # a sample size of eight and an effective sample size of about one.
    distinct_tickers = len({r["ticker"] for r in rows})
    effective = max(distinct_tickers, 1)

    brier = sum((r["p_bull"] - r["bullish_outcome"]) ** 2 for r in rows) / len(rows)
    baseline = sum((0.5 - r["bullish_outcome"]) ** 2 for r in rows) / len(rows)

    table = []
    for i in range(bins):
        lo, hi = i / bins, (i + 1) / bins
        bucket = [r for r in rows if lo <= r["p_bull"] < hi or (i == bins - 1 and r["p_bull"] == 1.0)]
        if not bucket:
            continue
        table.append({
            "predicted_range": f"{lo:.0%}-{hi:.0%}",
            "mean_predicted": round(sum(r["p_bull"] for r in bucket) / len(bucket), 3),
            "actual_bullish_rate": round(sum(r["bullish_outcome"] for r in bucket) / len(bucket), 3),
            "mean_realised_return_pct": round(
                sum(r["realised_return_pct"] for r in bucket) / len(bucket), 2),
            "n": len(bucket),
        })

    by_action = {}
    for r in rows:
        b = by_action.setdefault(r["action"], {"n": 0, "sum_ret": 0.0, "wins": 0,
                                               "xs": []})
        b["n"] += 1
        b["sum_ret"] += r["realised_return_pct"]
        b["wins"] += r["bullish_outcome"]
        if r.get("excess_return_pct") is not None:
            b["xs"].append(r["excess_return_pct"])
    for a, b in by_action.items():
        b["mean_return_pct"] = round(b.pop("sum_ret") / b["n"], 2)
        b["hit_rate"] = round(b.pop("wins") / b["n"], 3)
        xs = b.pop("xs")
        b["mean_excess_vs_benchmark_pct"] = round(sum(xs) / len(xs), 2) if xs else None
        b["beat_benchmark_rate"] = (round(sum(1 for x in xs if x > 0) / len(xs), 3)
                                    if xs else None)

    return {
        "status": "ok",
        "sample_size": len(rows),
        "distinct_tickers": distinct_tickers,
        "effective_sample_size": effective,
        "independence_note": (
            f"{len(rows)} decisions across {distinct_tickers} companies. Repeats "
            "on one company inside a single horizon resolve to nearly the same "
            "outcome, so the count that matters is the number of distinct "
            "companies, not the number of rows."
        ),
        "brier_score": round(brier, 4),
        "brier_baseline_always_50pct": round(baseline, 4),
        "beats_coinflip": bool(brier < baseline),
        "reliability_table": table,
        "by_action": by_action,
        "forward_rank_ic": forward_rank_ic(rows),
        "interpretation": (
            "If mean_predicted and actual_bullish_rate diverge, the probabilities "
            "are miscalibrated. If brier_score is not below "
            "brier_baseline_always_50pct, set score_tilt_strength to 0 -- the "
            "score is adding noise, not signal. Sample sizes under ~100 per bin "
            "should not be read as evidence of anything. With score_tilt_strength "
            "at 0 every p_bull is 1/3, so the Brier score cannot see the score; "
            "forward_rank_ic and by_action excess returns are the tests that can."
        ),
    }

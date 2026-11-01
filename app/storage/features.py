"""Feature store — roadmap item #4.

Until now every ``/analyze`` computed a full feature vector and threw it away.
That is the difference between accumulating an asset and re-deriving nothing:
a probability model (#17) needs a history of feature states paired with what
happened next, and that history can only come from writing features down as
they are computed.

Cheap now, essential later. Run the engine on a watchlist daily and in three
months you have a training set nothing else can give you, because free
providers will not sell you historical point-in-time features.
"""
import json
from datetime import datetime, timezone

from .db import connect

SCHEMA = """
CREATE TABLE IF NOT EXISTS feature_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at TEXT NOT NULL,
    as_of_date TEXT NOT NULL,
    ticker TEXT NOT NULL,
    decision_id INTEGER,
    price REAL,
    engine_version TEXT,
    features_json TEXT NOT NULL,
    UNIQUE(ticker, as_of_date, engine_version)
);
CREATE INDEX IF NOT EXISTS idx_feat_ticker ON feature_snapshots(ticker, as_of_date);
"""


def _flatten(result: dict) -> dict:
    """The numeric state of the world at analysis time — nothing derived from it.

    Deliberately excludes the score, action and probabilities. Those are
    *outputs*; storing them here would let a future model train on its own
    predecessor's opinions instead of on evidence.
    """
    f = {}
    f.update({f"score.{k}": v for k, v in (result.get("score_breakdown") or {}).items()})

    tech = result.get("technical") or {}
    for k in ("vol_annualised", "vol_percentile", "pct_of_52w_range",
              "relative_volume", "volume_confirmation"):
        f[f"tech.{k}"] = tech.get(k)
    for name, block in (tech.get("horizons") or {}).items():
        f[f"tech.{name}.trend"] = block.get("trend")
        f[f"tech.{name}.momentum"] = block.get("momentum")

    f["flow.cmf"] = (result.get("money_flow") or {}).get("cmf")

    fund = result.get("fundamentals") or {}
    f["fund.beta"] = fund.get("beta")
    for k, v in (fund.get("inputs_used") or {}).items():
        f[f"fund.{k}"] = v

    fil = result.get("filings") or {}
    for k in ("cash_flow", "balance_sheet", "earnings_quality", "growth",
              "filing_lag_days"):
        f[f"filing.{k}"] = fil.get(k)
    for block_name, block in (fil.get("detail") or {}).items():
        for k, v in (block.get("inputs") or {}).items():
            if isinstance(v, (int, float)):
                f[f"filing.{block_name}.{k}"] = v

    news = result.get("news") or {}
    for k in ("news", "article_count", "unique_event_count", "freshness_pct",
              "concentration_pct"):
        f[f"news.{k}"] = news.get(k)

    macro = result.get("macro") or {}
    f["macro.risk_on"] = macro.get("risk_on_score")
    for name, block in (macro.get("components") or {}).items():
        f[f"macro.{name}"] = block.get("score")

    ctx = result.get("market_context") or {}
    f["ctx.market"] = ctx.get("market_score")
    f["ctx.sector"] = ctx.get("sector_score")

    return {k: v for k, v in f.items() if isinstance(v, (int, float))}


def save(result: dict, decision_id: int | None = None):
    """Persist one feature vector. Idempotent per ticker/day/version."""
    with connect() as conn:
        conn.executescript(SCHEMA)
        features = _flatten(result)
        as_of = (result.get("as_of") or "")[:10]
        try:
            cur = conn.execute(
                """INSERT OR REPLACE INTO feature_snapshots
                   (captured_at, as_of_date, ticker, decision_id, price,
                    engine_version, features_json)
                   VALUES (?,?,?,?,?,?,?)""",
                (
                    datetime.now(timezone.utc).isoformat(), as_of,
                    result["ticker"], decision_id, result.get("price"),
                    result.get("engine_version"), json.dumps(features),
                ),
            )
            return int(cur.lastrowid), len(features)
        except Exception:
            return None, 0


def history(ticker: str, limit: int = 250):
    with connect() as conn:
        conn.executescript(SCHEMA)
        rows = conn.execute(
            """SELECT as_of_date, price, engine_version, features_json
               FROM feature_snapshots WHERE ticker = ?
               ORDER BY as_of_date DESC LIMIT ?""",
            (ticker.upper(), limit),
        ).fetchall()
    return [{
        "as_of_date": r["as_of_date"], "price": r["price"],
        "engine_version": r["engine_version"],
        "features": json.loads(r["features_json"]),
    } for r in rows]


def summary():
    """How close is the store to being usable for training?"""
    with connect() as conn:
        conn.executescript(SCHEMA)
        total = conn.execute("SELECT COUNT(*) c FROM feature_snapshots").fetchone()["c"]
        tickers = conn.execute(
            "SELECT COUNT(DISTINCT ticker) c FROM feature_snapshots").fetchone()["c"]
        span = conn.execute(
            "SELECT MIN(as_of_date) a, MAX(as_of_date) b FROM feature_snapshots").fetchone()
        linked = conn.execute(
            """SELECT COUNT(*) c FROM feature_snapshots f
               JOIN outcomes o ON o.decision_id = f.decision_id""").fetchone()["c"]

    return {
        "snapshots": total,
        "tickers": tickers,
        "first_date": span["a"],
        "last_date": span["b"],
        "snapshots_with_known_outcome": linked,
        "ready_to_train": linked >= 200,
        "guidance": (
            "A probability model needs snapshots paired with resolved outcomes. "
            f"You have {linked}. Below roughly 200 any model you fit will be "
            "memorising noise. Keep running /analyze daily on a watchlist and "
            "/calibration/resolve weekly; the store fills itself."
        ),
    }

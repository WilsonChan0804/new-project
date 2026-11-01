"""Peer normalisation — blueprint item #12's missing half.

Every fundamental measure in this engine is scored against a global threshold.
`squash((20 - pe) / 15)` says a P/E of 20 is neutral whether the company is a
utility, a bank, a REIT or a chip designer. That is wrong in a specific,
directional way: it does not add noise evenly, it systematically marks whole
sectors as cheap or expensive for reasons that have nothing to do with their
prospects.

Banks trade on book value and rarely exceed a P/E in the teens, so under
absolute thresholds every bank looks cheap. Software trades on growth, so every
software company looks expensive. A score built that way is partly a sector bet
wearing a valuation label.

This matters more than usual here because **valuation was the only component
that measured a real effect** in the 63-name backtest (+0.078, t = +3.09) while
holding just 10% of the weight. Improving the one thing that works is worth
more than adjusting seven things that don't.

## What this does

Rank each raw metric against companies in the same sector, and score the
percentile rather than the level. A 28x P/E might be the 80th percentile among
software firms (relatively cheap) and the 5th percentile among utilities
(extremely expensive). Same number, opposite meaning.

## Where the cohort comes from

* **Backtest** — the cohort is the universe on that date, which is exactly
  right and costs nothing: every peer's figures are already loaded, and they
  are the figures that were public at the time.
* **Live** — a cached peer table built from a prior run. If none exists, the
  engine falls back to absolute thresholds and says so, rather than silently
  pretending.
"""
import json
import statistics
from datetime import datetime, timezone

from ..storage.db import connect

SCHEMA = """
CREATE TABLE IF NOT EXISTS peer_stats (
    sector TEXT NOT NULL,
    metric TEXT NOT NULL,
    built_at TEXT NOT NULL,
    n INTEGER NOT NULL,
    values_json TEXT NOT NULL,
    PRIMARY KEY (sector, metric)
);
"""

# metric -> higher_is_better. The direction is declared once, here, so a
# percentile can always be oriented as "higher score = more attractive".
METRICS = {
    # valuation
    "pe": False,
    "pb": False,
    "ev_ebitda": False,
    "fcf_yield": True,
    # quality and growth
    "fcf_margin": True,
    "profit_margin": True,
    "roe": True,
    "revenue_growth_yoy": True,
    "net_income_growth_yoy": True,
    "cash_conversion": True,
    # risk
    "net_debt_to_equity": False,
    "net_debt_to_ocf_years": False,
    "accrual_ratio": False,
    "share_count_change_yoy": False,
}

VALUATION_METRICS = ["pe", "pb", "ev_ebitda", "fcf_yield"]
QUALITY_METRICS = ["fcf_margin", "profit_margin", "roe", "cash_conversion"]
GROWTH_METRICS = ["revenue_growth_yoy", "net_income_growth_yoy"]
RISK_METRICS = ["net_debt_to_equity", "net_debt_to_ocf_years",
                "accrual_ratio", "share_count_change_yoy"]

MIN_COHORT = 5


def percentile(value, cohort, higher_is_better=True):
    """Where ``value`` sits in ``cohort``, as 0-100 oriented so higher is better.

    Ties are handled at the midpoint so that identical values do not receive
    systematically different scores depending on list order.
    """
    peers = [c for c in cohort if c is not None]
    if value is None or len(peers) < MIN_COHORT:
        return None
    below = sum(1 for c in peers if c < value)
    equal = sum(1 for c in peers if c == value)
    pct = 100.0 * (below + 0.5 * equal) / len(peers)
    return round(pct if higher_is_better else 100.0 - pct, 2)


def rank_within(metrics: dict, cohort_metrics: list, keys=None):
    """Percentile-rank one company's metrics against a cohort of peers.

    ``cohort_metrics`` is a list of dicts shaped like ``metrics``.
    Returns {metric: percentile}, omitting metrics with too few peers.
    """
    out = {}
    for key in (keys or METRICS):
        if key not in METRICS:
            continue
        value = metrics.get(key)
        if value is None:
            continue
        cohort = [m.get(key) for m in cohort_metrics if m.get(key) is not None]
        p = percentile(value, cohort, METRICS[key])
        if p is not None:
            out[key] = p
    return out


def _blend(ranked: dict, keys):
    vals = [ranked[k] for k in keys if k in ranked]
    return round(sum(vals) / len(vals), 2) if vals else None


def scores(metrics: dict, cohort_metrics: list):
    """Peer-relative valuation / quality / growth / risk scores.

    Each is None when the cohort is too small or the inputs are missing —
    the same discipline the rest of the engine uses.
    """
    ranked = rank_within(metrics, cohort_metrics)
    return {
        "valuation_peer": _blend(ranked, VALUATION_METRICS),
        "quality_peer": _blend(ranked, QUALITY_METRICS),
        "growth_peer": _blend(ranked, GROWTH_METRICS),
        "risk_peer": _blend(ranked, RISK_METRICS),
        "percentiles": ranked,
        "cohort_size": len(cohort_metrics),
    }


def extract_metrics(filings: dict, valuation_inputs: dict | None = None,
                    av_overview: dict | None = None):
    """Pull the raw, un-scored numbers out of whatever the engine has.

    Raw values, not scores: percentile ranking must happen on the underlying
    quantity, otherwise it ranks the shape of a tanh curve rather than the
    company.
    """
    detail = (filings or {}).get("detail") or {}
    cf = (detail.get("cash_flow") or {}).get("inputs") or {}
    bs = (detail.get("balance_sheet") or {}).get("inputs") or {}
    eq = (detail.get("earnings_quality") or {}).get("inputs") or {}
    gr = (detail.get("growth") or {}).get("inputs") or {}
    v = valuation_inputs or {}
    ov = av_overview or {}

    def num(d, k):
        x = d.get(k)
        return float(x) if isinstance(x, (int, float)) else None

    return {
        "pe": num(v, "pe"),
        "pb": num(v, "pb"),
        "ev_ebitda": num(ov, "EVToEBITDA"),
        "fcf_yield": num(v, "fcf_yield"),
        "fcf_margin": num(cf, "fcf_margin"),
        "cash_conversion": num(cf, "cash_conversion"),
        "profit_margin": num(ov, "ProfitMargin"),
        "roe": num(ov, "ReturnOnEquityTTM"),
        "revenue_growth_yoy": num(gr, "revenue_growth_yoy"),
        "net_income_growth_yoy": num(gr, "net_income_growth_yoy"),
        "net_debt_to_equity": num(bs, "net_debt_to_equity"),
        "net_debt_to_ocf_years": num(bs, "net_debt_to_ocf_years"),
        "accrual_ratio": num(eq, "accrual_ratio"),
        "share_count_change_yoy": num(eq, "share_count_change_yoy"),
    }


# ---------------------------------------------------------------------------
# Persisted peer table, so live analysis can rank against something
# ---------------------------------------------------------------------------

class PeerTable:
    """Sector metric distributions, cached so a single-ticker analysis can rank.

    Live mode looks at one company at a time and has no cohort in hand.
    Re-fetching sixty peers per request would exhaust every rate limit going,
    so the distribution is built once and stored.
    """

    def __init__(self, data=None, built_at=None):
        self.data = data or {}
        self.built_at = built_at

    @classmethod
    def build(cls, rows):
        """rows: [{"sector": str, "metrics": {...}}, ...]"""
        table = {}
        for row in rows:
            sector = (row.get("sector") or "UNKNOWN").upper()
            bucket = table.setdefault(sector, {})
            for key, value in (row.get("metrics") or {}).items():
                if key in METRICS and isinstance(value, (int, float)):
                    bucket.setdefault(key, []).append(float(value))
        for bucket in table.values():
            for key in bucket:
                bucket[key].sort()
        return cls(table, datetime.now(timezone.utc).isoformat())

    def save(self):
        with connect() as conn:
            conn.executescript(SCHEMA)
            conn.execute("DELETE FROM peer_stats")
            for sector, metrics in self.data.items():
                for metric, values in metrics.items():
                    conn.execute(
                        """INSERT INTO peer_stats
                           (sector, metric, built_at, n, values_json)
                           VALUES (?,?,?,?,?)""",
                        (sector, metric, self.built_at, len(values),
                         json.dumps(values)))
        return self.summary()

    @classmethod
    def load(cls):
        with connect() as conn:
            conn.executescript(SCHEMA)
            rows = conn.execute("SELECT * FROM peer_stats").fetchall()
        if not rows:
            return None
        data, built = {}, None
        for r in rows:
            data.setdefault(r["sector"], {})[r["metric"]] = json.loads(r["values_json"])
            built = r["built_at"]
        return cls(data, built)

    def cohort(self, sector, metric):
        return (self.data.get((sector or "UNKNOWN").upper()) or {}).get(metric, [])

    def rank(self, sector, metrics: dict):
        out = {}
        for key, value in metrics.items():
            if key not in METRICS or value is None:
                continue
            p = percentile(value, self.cohort(sector, key), METRICS[key])
            if p is not None:
                out[key] = p
        return out

    def scores(self, sector, metrics: dict):
        ranked = self.rank(sector, metrics)
        sizes = [len(self.cohort(sector, k)) for k in ranked] or [0]
        return {
            "valuation_peer": _blend(ranked, VALUATION_METRICS),
            "quality_peer": _blend(ranked, QUALITY_METRICS),
            "growth_peer": _blend(ranked, GROWTH_METRICS),
            "risk_peer": _blend(ranked, RISK_METRICS),
            "percentiles": ranked,
            "cohort_size": int(statistics.median(sizes)),
            "built_at": self.built_at,
        }

    def summary(self):
        return {
            "built_at": self.built_at,
            "sectors": len(self.data),
            "metrics_per_sector": {
                s: {"metrics": len(m),
                    "median_cohort": int(statistics.median([len(v) for v in m.values()]))}
                for s, m in sorted(self.data.items())
            },
        }

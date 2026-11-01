"""End-to-end run with stubbed providers. No API key, no network.

Run this first to see the shape of the output:

    python scripts/offline_demo.py
"""
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.analysis import analyzer as az  # noqa: E402
from app.analysis import context as ctx  # noqa: E402
from app.providers import prices  # noqa: E402


def synth(seed, drift, vol, n=700):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(drift, vol, n)))
    return pd.DataFrame({
        "date": pd.date_range("2023-01-02", periods=n, freq="B"),
        "open": close,
        "high": close * (1 + abs(rng.normal(0, 0.005, n))),
        "low": close * (1 - abs(rng.normal(0, 0.005, n))),
        "close": close,
        "volume": rng.integers(2e6, 9e6, n).astype(float),
    })


SERIES = {
    "AAPL": synth(1, 0.0009, 0.016),
    "SPY": synth(2, 0.0005, 0.009),
    "QQQ": synth(3, 0.0007, 0.012),
    "XLK": synth(4, 0.0008, 0.013),
}

_fake = lambda t, sources=None: (
    SERIES[t.upper()], {"source": "offline_stub", "adjusted": True, "rows": 700,
                        "from_cache": False, "attempts": {}})
prices.daily = _fake
ctx.prices.daily = _fake
az.prices.daily = _fake

OVERVIEW = {
    "Symbol": "AAPL", "Name": "Apple Inc", "Sector": "TECHNOLOGY",
    "QuarterlyRevenueGrowthYOY": "0.08", "QuarterlyEarningsGrowthYOY": "0.12",
    "ProfitMargin": "0.246", "OperatingMarginTTM": "0.31",
    "ReturnOnEquityTTM": "1.47", "ReturnOnAssetsTTM": "0.22",
    "TrailingPE": "31.2", "ForwardPE": "28.4", "PEGRatio": "2.6",
    "EVToEBITDA": "23.1", "PriceToBookRatio": "48.9", "Beta": "1.21",
}

NEWS = {"feed": (
    [{"title": "Apple beats quarterly earnings expectations on services strength",
      "source": f"Wire{i}", "time_published": "20260830T130000",
      "overall_sentiment_score": 0.42,
      "ticker_sentiment": [{"ticker": "AAPL", "ticker_sentiment_score": "0.42",
                            "relevance_score": "0.88"}]} for i in range(38)]
    + [{"title": "Regulators open antitrust probe into App Store fees",
        "source": "Reuters", "time_published": "20260829T090000",
        "overall_sentiment_score": -0.35,
        "ticker_sentiment": [{"ticker": "AAPL", "ticker_sentiment_score": "-0.35",
                              "relevance_score": "0.72"}]}]
    + [{"title": "Analyst raises price target on new hardware cycle",
        "source": "Barrons", "time_published": "20260828T140000",
        "overall_sentiment_score": 0.28,
        "ticker_sentiment": [{"ticker": "AAPL", "ticker_sentiment_score": "0.28",
                              "relevance_score": "0.65"}]}]
)}


# --- fake SEC filings so the point-in-time layer runs offline -------------
import datetime as _dt
from app.providers.edgar import Facts
from app.analysis import analyzer as _az


def _q(base, n=8, growth=1.03, start=_dt.date(2024, 3, 31)):
    rows = []
    for i in range(n):
        end = start + _dt.timedelta(days=91 * i)
        rows.append({"val": base * (growth ** i), "end": end.isoformat(),
                     "filed": (end + _dt.timedelta(days=35)).isoformat(),
                     "start": (end - _dt.timedelta(days=89)).isoformat(), "form": "10-Q"})
    return rows


def _inst(v):
    return [{"val": v, "end": "2026-03-31", "filed": "2026-05-01",
             "start": None, "form": "10-Q"}]


FACTS = Facts({"entityName": "Apple Inc.", "cik": 320193, "facts": {"us-gaap": {
    "Revenues": {"units": {"USD": _q(95e9)}},
    "NetIncomeLoss": {"units": {"USD": _q(24e9)}},
    "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": _q(28e9)}},
    "PaymentsToAcquirePropertyPlantAndEquipment": {"units": {"USD": _q(3e9, growth=1.0)}},
    "Assets": {"units": {"USD": _inst(350e9)}},
    "StockholdersEquity": {"units": {"USD": _inst(60e9)}},
    "LongTermDebt": {"units": {"USD": _inst(85e9)}},
    "CashAndCashEquivalentsAtCarryingValue": {"units": {"USD": _inst(30e9)}},
    "AssetsCurrent": {"units": {"USD": _inst(135e9)}},
    "LiabilitiesCurrent": {"units": {"USD": _inst(145e9)}},
    "CommonStockSharesOutstanding": {"units": {"shares": _q(15.2e9, growth=0.9925)}},
}}})

_az.edgar.load = lambda t: FACTS


class FakeAV:
    def overview(self, t):
        return OVERVIEW, True

    def news(self, t, limit=50):
        return NEWS, True


a = az.StockAnalyzer()
a.av = FakeAV()
res = a.analyze("AAPL", horizon_days=63)

slim = {k: res[k] for k in (
    "ticker", "name", "price", "invalidation_price", "action", "action_rationale",
    "opportunity_score", "confidence", "coverage", "signal_agreement",
    "score_breakdown", "missing_components", "horizon", "scenarios",
    "scenario_diagnostics", "reasons_for", "reasons_against", "caveats",
)}
slim["fundamental_sub_scores"] = res["fundamentals"]["sub_scores"]
slim["filings"] = {k: res["filings"][k] for k in
                   ("status", "cash_flow", "balance_sheet", "earnings_quality",
                    "growth", "filing_lag_days", "point_in_time")} if res.get("filings") else None
slim["filing_notes"] = (res.get("filings") or {}).get("notes")
slim["macro_status"] = (res.get("macro") or {}).get("status")
slim["technical_horizons"] = res["technical"]["horizons"]
slim["news_summary"] = {k: res["news"][k] for k in
                        ("article_count", "unique_event_count", "concentration_pct",
                         "catalyst_mix", "dominant_event", "news")}
slim["data_quality"] = res["data_quality"]

print(json.dumps(slim, indent=2, default=str))

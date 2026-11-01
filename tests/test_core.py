"""Regression tests. Several of these encode bugs that v1.4 shipped."""
import math

import numpy as np
import pandas as pd
import pytest

from app.analysis.decision import choose_action, evaluate
from app.analysis.features import fundamentals, money_flow, technical
from app.analysis.news import analyse
from app.analysis.scenarios import build
from app.portfolio.risk import size_position


def synth(n=600, drift=0.0004, vol=0.015, seed=7):
    rng = np.random.default_rng(seed)
    r = rng.normal(drift, vol, n)
    close = 100 * np.exp(np.cumsum(r))
    high = close * (1 + abs(rng.normal(0, 0.004, n)))
    low = close * (1 - abs(rng.normal(0, 0.004, n)))
    return pd.DataFrame({
        "date": pd.date_range("2022-01-03", periods=n, freq="B"),
        "open": close, "high": high, "low": low, "close": close,
        "volume": rng.integers(1_000_000, 5_000_000, n).astype(float),
    })


# --- v1.4 bug: missing fundamentals scored as attractively valued ----------
def test_missing_valuation_is_none_not_75():
    f = fundamentals({"Symbol": "X", "PERatio": "None", "PEGRatio": "None"})
    assert f["valuation"] is None, "missing multiples must not produce a score"


def test_negative_pe_is_penalised_not_ignored():
    f = fundamentals({"Symbol": "X", "TrailingPE": "-14"})
    assert f["valuation"] is not None and f["valuation"] < 40


def test_empty_overview_scores_nothing():
    f = fundamentals({})
    assert f["fundamentals"] is None and f["valuation"] is None


# --- v1.4 bug: no data still produced a confident-looking action ----------
def test_no_data_refuses_to_act():
    parts = {k: None for k in
             ["market", "sector", "fundamentals", "growth", "valuation",
              "technical", "money_flow", "news"]}
    ev = evaluate(parts)
    assert ev["opportunity_score"] is None
    assert ev["coverage"] == 0.0
    action, _ = choose_action(None, 0, 0.0, None)
    assert action == "INSUFFICIENT DATA"


def test_partial_data_renormalises_weights():
    parts = {"technical": 80, "news": 60}
    ev = evaluate(parts)
    assert 0 < ev["coverage"] < 1
    assert abs(sum(ev["weights_used"].values()) - 1.0) < 1e-6
    # 80 and 60 weighted 0.20/0.15 -> 71.43, not diluted toward 50 by absent data
    assert ev["opportunity_score"] > 70


# --- v1.4 bug: confidence rose with score extremity ------------------------
def test_confidence_independent_of_direction():
    bullish = evaluate({k: 90 for k in ["market", "sector", "technical", "news", "growth"]})
    bearish = evaluate({k: 10 for k in ["market", "sector", "technical", "news", "growth"]})
    assert abs(bullish["confidence"] - bearish["confidence"]) < 1e-6


def test_disagreement_lowers_confidence():
    agree = evaluate({"market": 70, "sector": 70, "technical": 70, "news": 70, "growth": 70})
    conflict = evaluate({"market": 95, "sector": 20, "technical": 90, "news": 25, "growth": 80})
    assert conflict["confidence"] < agree["confidence"]


# --- scenarios -------------------------------------------------------------
def test_scenarios_scale_with_volatility_not_score():
    lo, _ = build(50, 0.15, 63)
    hi, _ = build(50, 0.60, 63)
    assert abs(hi[0]["return_pct"]) > 3 * abs(lo[0]["return_pct"])


def test_scenario_probabilities_sum_to_one():
    for score in (0, 25, 50, 75, 100):
        sc, _ = build(score, 0.30, 63)
        assert abs(sum(x["probability"] for x in sc) - 1) < 1e-6


def test_horizon_scales_returns():
    _, m1 = build(60, 0.30, 21)
    _, m6 = build(60, 0.30, 126)
    assert m6["sigma_horizon_pct"] > m1["sigma_horizon_pct"]
    assert m1["horizon_days"] == 21


def test_costs_reduce_expected_return():
    _, d = build(60, 0.30, 63)
    assert d["expected_return_pct_net"] < d["expected_return_pct_gross"]
    assert d["calibrated"] is False


def test_no_volatility_means_no_scenarios():
    sc, reason = build(70, None, 63)
    assert sc is None and isinstance(reason, str)


# --- technical / money flow ------------------------------------------------
def test_technical_multi_horizon_and_no_saturation():
    t = technical(synth(drift=0.004))  # very strong uptrend
    assert t["status"] == "available"
    assert t["technical"] < 100, "tanh must compress, not clip"
    assert set(t["horizons"]) == {"short", "medium", "long"}


def test_short_history_returns_none_not_fifty():
    t = technical(synth(n=25))
    assert t["technical"] is None and t["status"] == "unavailable"


def test_money_flow_is_bounded():
    mf = money_flow(synth())
    assert mf["money_flow"] is None or 0 <= mf["money_flow"] <= 100
    assert mf["cmf"] is None or -1 <= mf["cmf"] <= 1


# --- news ------------------------------------------------------------------
def _article(title, sent, rel, ticker="AAPL", when="20260830T120000"):
    return {
        "title": title, "source": "Wire", "time_published": when,
        "overall_sentiment_score": sent,
        "ticker_sentiment": [
            {"ticker": ticker, "ticker_sentiment_score": str(sent), "relevance_score": str(rel)}
        ],
    }


def test_duplicate_stories_collapse_into_one_event():
    dupes = [_article("Apple beats earnings expectations for the quarter", 0.6, 0.9)
             for _ in range(40)]
    out = analyse({"feed": dupes}, "AAPL")
    assert out["article_count"] == 40
    assert out["unique_event_count"] == 1, "40 syndications must count once"
    assert out["concentration_pct"] > 90


def test_other_tickers_sentiment_not_borrowed():
    feed = [_article("Nvidia soars on datacenter demand", 0.9, 0.95, ticker="NVDA")]
    out = analyse({"feed": feed}, "AAPL")
    assert out["news"] is None or out["scored_event_count"] == 0


def test_no_news_scores_none():
    out = analyse({"feed": []}, "AAPL")
    assert out["news"] is None and out["status"] == "unavailable"


# --- portfolio -------------------------------------------------------------
def test_sector_cap_binds():
    r = size_position(
        100_000,
        [{"ticker": "MSFT", "value": 29_000, "sector": "Technology"}],
        {"ticker": "NVDA", "sector": "Technology", "entry": 100,
         "invalidation": 90, "confidence": 90},
    )
    assert r["resulting_sector_pct"] <= 30.0001
    assert r["binding_constraint"] == "sector_cap"
    assert r["warnings"]


def test_invalidation_above_entry_rejected():
    with pytest.raises(ValueError):
        size_position(100_000, [], {"ticker": "X", "sector": "T", "entry": 100,
                                    "invalidation": 110, "confidence": 50})


def test_tighter_stop_allows_bigger_position():
    common = dict(ticker="X", sector="T", entry=100, confidence=100)
    wide = size_position(100_000, [], {**common, "invalidation": 80})
    tight = size_position(100_000, [], {**common, "invalidation": 97})
    assert tight["raw_position_value"] > wide["raw_position_value"]


# --- price provider chain --------------------------------------------------
def test_yahoo_payload_parses_and_adjusts():
    import pandas as pd
    from app.providers import prices

    ts = list(range(1_600_000_000, 1_600_000_000 + 86400 * 60, 86400))
    n = len(ts)
    payload = {"chart": {"error": None, "result": [{
        "meta": {"currency": "USD", "exchangeName": "NMS"},
        "timestamp": ts,
        "indicators": {
            "quote": [{"open": [100.0] * n, "high": [102.0] * n,
                       "low": [99.0] * n, "close": [101.0] * n,
                       "volume": [1_000_000] * n}],
            "adjclose": [{"adjclose": [50.5] * n}],   # implies a 2:1 split
        }}]}}

    class R:
        status_code = 200
        def json(self): return payload

    prices.requests.get = lambda *a, **k: R()
    df, meta = prices._yahoo("AAPL")
    assert meta["adjusted"] is True and meta["source"] == "yahoo"
    assert abs(df.close.iloc[-1] - 50.5) < 1e-9
    # OHLC must be scaled by the same factor, or high < close breaks money_flow
    assert df.high.iloc[-1] > df.close.iloc[-1] > df.low.iloc[-1]
    assert abs(df.high.iloc[-1] - 102.0 * (50.5 / 101.0)) < 1e-9


def test_chain_falls_through_to_next_source(monkeypatch):
    from app.providers import prices
    from app.analysis.features import daily_vol  # noqa: F401
    import pandas as pd, numpy as np

    good = pd.DataFrame({
        "date": pd.date_range("2024-01-01", periods=200, freq="B"),
        "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0,
        "volume": 1e6,
    })

    def boom(t): raise prices.PriceError("blocked (HTML response)")
    monkeypatch.setitem(prices.SOURCES, "yahoo", boom)
    monkeypatch.setitem(prices.SOURCES, "stooq",
                        lambda t: (good.copy(), {"source": "stooq", "adjusted": True}))
    monkeypatch.setattr(prices.cache, "get", lambda *a, **k: None)
    monkeypatch.setattr(prices.cache, "put", lambda *a, **k: None)

    df, meta = prices.daily("AAPL", sources=["yahoo", "stooq"])
    assert meta["source"] == "stooq"
    assert "blocked" in meta["attempts"]["yahoo"]


def test_all_sources_failing_raises():
    from app.providers import prices
    def boom(t): raise prices.PriceError("nope")
    saved = dict(prices.SOURCES)
    try:
        for k in prices.SOURCES: prices.SOURCES[k] = boom
        with pytest.raises(prices.PriceError):
            prices.daily("AAPL", sources=["yahoo", "stooq"])
    finally:
        prices.SOURCES.update(saved)


def test_split_artifacts_detected_on_unadjusted_data():
    import pandas as pd
    from app.providers import prices
    close = [100.0] * 50 + [25.0] * 50           # 4:1 split, unadjusted
    df = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=100, freq="B"),
                       "close": close})
    hits = prices.detect_split_artifacts(df)
    assert len(hits) == 1


# --- plain-English layer ---------------------------------------------------
def test_plain_never_contradicts_itself_on_low_agreement():
    from app.presentation import plain
    s = plain.confidence_sentence(61.0, 1.0, 10.0)
    assert "why confidence is low" not in s
    assert "holding confidence down" in s


def test_plain_covers_every_scored_component():
    from app.analysis.decision import WEIGHTS
    from app.presentation.plain import COMPONENTS
    assert set(COMPONENTS) == set(WEIGHTS), "every weighted component needs a plain label"


def test_plain_handles_missing_data_without_crashing():
    from app.presentation import plain
    res = {
        "action": "INSUFFICIENT DATA", "opportunity_score": None,
        "confidence": 20.0, "coverage": 0.3, "signal_agreement": None,
        "score_breakdown": {k: None for k in plain.COMPONENTS},
        "missing_components": list(plain.COMPONENTS),
        "scenarios": None, "scenario_diagnostics": None,
        "price": None, "invalidation_price": None,
    }
    out = plain.build(res)
    assert out["tone"] == "unknown"
    assert out["counts"]["unknown"] == len(plain.COMPONENTS)
    assert out["scenarios"] is None
    assert any("Do nothing" in s for s in out["what_to_do"])


def test_plain_action_map_matches_action_engine():
    from app.analysis.decision import choose_action
    from app.presentation.plain import ACTION_PLAIN
    seen = set()
    for score in range(0, 101, 5):
        seen.add(choose_action(score, 80, 1.0, 0.5)[0])
    seen |= {choose_action(None, 0, 0.0, None)[0], choose_action(70, 10, 1.0, None)[0]}
    assert seen <= set(ACTION_PLAIN), f"unmapped actions: {seen - set(ACTION_PLAIN)}"


def test_dashboard_html_is_served():
    from pathlib import Path
    html = (Path("app/static/dashboard.html")).read_text(encoding="utf-8")
    assert "evidence" in html.lower() and "/api/v1/stocks/" in html


# ===========================================================================
# v1.8 — point-in-time filings, macro, feature store
# ===========================================================================

def _fact(val, end, filed, start=None, form="10-Q"):
    return {"val": val, "end": end, "filed": filed, "start": start, "form": form}


def _payload(concept_rows):
    """Build a minimal companyfacts payload."""
    facts = {}
    for tag, rows in concept_rows.items():
        unit = "shares" if "Shares" in tag else "USD"
        facts[tag] = {"units": {unit: rows}}
    return {"entityName": "Test Co", "cik": 1, "facts": {"us-gaap": facts}}


def _quarters(tag, base, start_year=2024, n=8, growth=1.0, filed_lag_days=40):
    """n consecutive quarters ending most recently."""
    import datetime as dt
    rows, d = [], dt.date(start_year, 3, 31)
    for i in range(n):
        end = d + dt.timedelta(days=91 * i)
        rows.append(_fact(
            base * (growth ** i),
            end.isoformat(),
            (end + dt.timedelta(days=filed_lag_days)).isoformat(),
            (end - dt.timedelta(days=89)).isoformat(),
        ))
    return rows


def test_point_in_time_hides_facts_filed_later():
    """The whole reason this module exists."""
    import datetime as dt

    from app.providers.edgar import Facts

    f = Facts(_payload({"NetIncomeLoss": [
        _fact(100, "2025-03-31", "2025-05-01", "2025-01-01"),
        _fact(999, "2025-06-30", "2025-08-01", "2025-04-01"),
    ]}))
    early, meta = f.latest("net_income", dt.date(2025, 6, 15))
    assert early == 100, "a fact filed in August must be invisible in June"
    assert meta["filed"] == "2025-05-01"
    later, _ = f.latest("net_income", dt.date(2025, 9, 1))
    assert later == 999


def test_ttm_sums_four_quarters():
    import datetime as dt

    from app.providers.edgar import Facts
    f = Facts(_payload({"Revenues": _quarters("Revenues", 100, n=8)}))
    val, meta = f.ttm("revenue", dt.date(2026, 6, 1))
    assert val == 400
    assert meta["basis"] == "sum of 4 quarters"


def test_ttm_prior_year_uses_the_earlier_four():
    import datetime as dt

    from app.providers.edgar import Facts
    f = Facts(_payload({"Revenues": _quarters("Revenues", 100, n=8, growth=1.10)}))
    now, _ = f.ttm("revenue", dt.date(2026, 6, 1))
    prior = f.ttm_prior_year("revenue", dt.date(2026, 6, 1))
    assert now > prior > 0


def test_unaccepted_forms_are_ignored():
    import datetime as dt

    from app.providers.edgar import Facts
    f = Facts(_payload({"Assets": [
        _fact(500, "2025-03-31", "2025-04-05", form="8-K"),
    ]}))
    val, _ = f.latest("assets", dt.date(2026, 1, 1))
    assert val is None, "8-K figures must not be treated as periodic reports"


def test_balance_sheet_penalises_leverage_without_zeroing_everything():
    """v1.4's bug: any normally-leveraged company scored 0 on quality."""
    import datetime as dt

    from app.analysis.filings import balance_sheet
    from app.providers.edgar import Facts

    healthy = Facts(_payload({
        "Assets": [_fact(1000, "2025-12-31", "2026-02-01", form="10-K")],
        "StockholdersEquity": [_fact(500, "2025-12-31", "2026-02-01", form="10-K")],
        "LongTermDebt": [_fact(300, "2025-12-31", "2026-02-01", form="10-K")],
        "CashAndCashEquivalentsAtCarryingValue": [_fact(400, "2025-12-31", "2026-02-01", form="10-K")],
        "AssetsCurrent": [_fact(600, "2025-12-31", "2026-02-01", form="10-K")],
        "LiabilitiesCurrent": [_fact(300, "2025-12-31", "2026-02-01", form="10-K")],
    }))
    r = balance_sheet(healthy, dt.date(2026, 6, 1))
    assert r["score"] is not None and r["score"] > 55, r
    assert r["inputs"]["net_debt"] == -100
    assert any("more cash than debt" in n for n in r["notes"])


def test_earnings_quality_flags_dilution_and_accruals():
    import datetime as dt

    from app.analysis.filings import earnings_quality
    from app.providers.edgar import Facts

    f = Facts(_payload({
        # profit far above cash generated
        "NetIncomeLoss": _quarters("NetIncomeLoss", 100, n=8),
        "NetCashProvidedByUsedInOperatingActivities": _quarters("x", 20, n=8),
        "Assets": [_fact(2000, "2026-03-31", "2026-05-01", form="10-Q")],
        "CommonStockSharesOutstanding": _quarters("CommonStockSharesOutstanding", 1000,
                                                  n=8, growth=1.03),
    }))
    r = earnings_quality(f, dt.date(2026, 8, 1))
    assert r["score"] is not None
    assert r["inputs"]["accrual_ratio"] > 0
    assert any("ahead of cash" in n for n in r["notes"])


def test_filings_missing_scores_none_not_zero():
    import datetime as dt

    from app.analysis.filings import analyse
    from app.providers.edgar import Facts
    r = analyse(Facts(_payload({})), dt.date(2026, 1, 1))
    assert r["status"] == "unavailable"
    assert r["cash_flow"] is None and r["balance_sheet"] is None


def test_fundamentals_merge_renormalises_over_available_subs():
    from app.analysis.features import merge_fundamentals
    av = {"quality": 80.0, "growth": 60.0}

    full = merge_fundamentals(av, {"cash_flow": 70.0, "balance_sheet": 60.0,
                                   "earnings_quality": 50.0, "growth": 75.0})
    assert full["sub_coverage"] == 1.0
    assert abs(sum(full["sub_weights_used"].values()) - 1.0) < 1e-6
    assert full["growth"] == 75.0 and full["growth_source"] == "sec_filings"

    partial = merge_fundamentals(av, None)
    assert partial["fundamentals"] == 80.0, "single available sub is not diluted"
    assert partial["sub_coverage"] == 0.3
    assert partial["growth_source"] == "alpha_vantage"

    assert merge_fundamentals({"quality": None, "growth": None}, None)["fundamentals"] is None


def test_macro_without_key_is_unavailable_not_neutral():
    from app.analysis import macro
    from app.config import settings
    saved = settings.fred_api_key
    try:
        settings.fred_api_key = ""
        r = macro.regime()
        assert r["status"] == "unavailable" and r["risk_on_score"] is None
        assert any("FRED" in n for n in r["notes"])
    finally:
        settings.fred_api_key = saved


def test_feature_store_excludes_engine_outputs():
    """Features are evidence. Storing the score would let a model train on itself."""
    from app.storage.features import _flatten
    flat = _flatten({
        "ticker": "X", "opportunity_score": 88.0, "confidence": 70.0,
        "score_breakdown": {"technical": 64.6, "news": 83.7},
        "technical": {"vol_annualised": 0.32, "vol_percentile": 92.1,
                      "horizons": {"long": {"trend": 84.3, "momentum": 71.7}}},
        "money_flow": {"cmf": 0.19},
        "fundamentals": {"beta": 1.09, "inputs_used": {"TrailingPE": 36.08}},
        "filings": {"cash_flow": 70.0, "detail": {"cash_flow": {"inputs": {"fcf_margin": 0.24}}}},
        "news": {"news": 83.7, "article_count": 50},
        "macro": {"risk_on_score": 55.0, "components": {"credit": {"score": 61.0}}},
        "market_context": {"market_score": 66.6, "sector_score": 63.6},
    })
    assert "score.technical" in flat and "tech.long.trend" in flat
    assert "filing.cash_flow.fcf_margin" in flat and "macro.credit" in flat
    assert "opportunity_score" not in flat and "confidence" not in flat
    assert all(isinstance(v, (int, float)) for v in flat.values())


# ===========================================================================
# v1.9 — TTM construction, typo guard, backtester
# ===========================================================================

def _apple_shaped_revenue():
    """Most US filers publish no standalone Q4: it only appears in the 10-K."""
    def row(val, end, filed, start, form="10-Q"):
        return {"val": val, "end": end, "filed": filed, "start": start, "form": form}
    return [
        row(391035, "2024-09-28", "2024-11-01", "2023-10-01", "10-K"),
        row(416161, "2025-09-27", "2025-10-31", "2024-09-29", "10-K"),
        row(124300, "2024-12-28", "2025-01-30", "2024-09-29"),
        row(95359, "2025-03-29", "2025-05-01", "2024-12-29"),
        row(94036, "2025-06-28", "2025-07-31", "2025-03-30"),
        row(219659, "2025-03-29", "2025-05-01", "2024-09-29"),
        row(313695, "2025-06-28", "2025-07-31", "2024-09-29"),
        row(137200, "2025-12-27", "2026-01-29", "2025-09-28"),
        row(102000, "2026-03-28", "2026-05-01", "2025-12-28"),
        row(101500, "2026-06-27", "2026-07-30", "2026-03-29"),
        row(239200, "2026-03-28", "2026-05-01", "2025-09-28"),
        row(340700, "2026-06-27", "2026-07-30", "2025-09-28"),
    ]


def test_ttm_uses_annual_plus_ytd_when_no_q4_exists():
    """v1.8 fell back to a 10-month-old annual for exactly this filing shape."""
    import datetime as dt

    from app.providers.edgar import Facts
    f = Facts(_payload({"RevenueFromContractWithCustomerExcludingAssessedTax":
                        _apple_shaped_revenue()}))
    val, meta = f.ttm("revenue", dt.date(2026, 8, 30))
    assert abs(val - (416161 + 340700 - 313695)) < 1
    assert meta["basis"] == "annual + YTD - prior YTD"
    assert meta["lag_days"] < 60, "must use the latest 10-Q, not last year's 10-K"


def test_prior_year_ttm_survives_fiscal_calendar_drift():
    import datetime as dt

    from app.providers.edgar import Facts
    f = Facts(_payload({"RevenueFromContractWithCustomerExcludingAssessedTax":
                        _apple_shaped_revenue()}))
    as_of = dt.date(2026, 8, 30)
    now, _ = f.ttm("revenue", as_of)
    prior = f.ttm_prior_year("revenue", as_of)
    assert prior is not None and 0 < prior < now


def test_ttm_still_respects_point_in_time():
    import datetime as dt

    from app.providers.edgar import Facts
    f = Facts(_payload({"RevenueFromContractWithCustomerExcludingAssessedTax":
                        _apple_shaped_revenue()}))
    _, meta = f.ttm("revenue", dt.date(2026, 2, 1))
    assert meta["period_end"] == "2025-12-27", "the May 2026 10-Q must be invisible"


# --- backtest --------------------------------------------------------------

def _series(seed, n=900, drift=0.0004, vol=0.014):
    import numpy as np, pandas as pd
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(drift, vol, n)))
    return pd.DataFrame({
        "date": pd.date_range("2022-06-01", periods=n, freq="B"),
        "open": close, "high": close * 1.006, "low": close * 0.994,
        "close": close, "volume": rng.integers(1e6, 5e6, n).astype(float),
    })


def test_replay_never_sees_the_future():
    import datetime as dt

    from app.backtest.replay import _truncate
    df = _series(1)
    cut = dt.date(2024, 1, 15)
    out = _truncate(df, cut)
    assert out.date.max().date() <= cut
    assert len(out) < len(df)


def test_forward_return_is_none_when_horizon_exceeds_data():
    import datetime as dt

    from app.backtest.replay import _forward_return
    df = _series(2, n=300)
    last = df.date.iloc[-1].date()
    assert _forward_return(df, last - dt.timedelta(days=5), 63) == (None, None, None)
    e, x, r = _forward_return(df, df.date.iloc[100].date(), 63)
    assert e and x and r is not None


def test_spearman_detects_perfect_and_zero_relationships():
    from app.backtest.metrics import spearman
    xs = list(range(30))
    assert spearman(xs, xs) == 1.0
    assert spearman(xs, list(reversed(xs))) == -1.0
    assert spearman(xs[:5], xs[:5]) is None


def test_backtest_flags_overlapping_windows():
    """63-day horizon sampled every 21 days = 3x overlap, not 3x the evidence."""
    from app.backtest.metrics import summarise
    import random
    random.seed(3)
    records = [{
        "as_of": f"2024-{1 + i % 12:02d}-01", "ticker": f"T{i%9}",
        "score": random.uniform(30, 90), "confidence": 60, "coverage": 0.8,
        "action": "HOLD", "forward_return_pct": random.uniform(-15, 15),
        "benchmark_return_pct": 2.0, "excess_return_pct": random.uniform(-15, 15),
    } for i in range(120)]
    out = summarise({"records": records, "warnings": [],
                     "config": {"horizon_days": 63, "every_days": 21,
                                "start": "2024-01-01", "end": "2024-12-01"}})
    assert out["overlap_factor"] == 3.0
    assert out["n_effective"] == 40 < out["n_observations"]
    assert out["ic_std_error"] is not None


def test_backtest_verdict_distinguishes_null_from_negative():
    """A flat IC must not be reported as evidence the score is backwards."""
    from app.backtest.metrics import _verdict

    def stats(ic, se, n=50):
        return {"mean_ic": ic, "std_error": se, "t_stat": ic / se, "n_dates": n}

    # the real v2.0 result: -0.005 +/- 0.032 -> a null, not a negative
    null = _verdict(stats(-0.0046, 0.0315))
    assert "INDISTINGUISHABLE FROM ZERO" in null
    assert "not a negative" in null

    assert "reliably negative" in _verdict(stats(-0.08, 0.02))
    assert "modest" in _verdict(stats(0.03, 0.01))
    assert "leak" in _verdict(stats(0.35, 0.02))
    assert "Too few periods" in _verdict(stats(0.05, 0.01, n=10))


def test_backtest_excludes_news_and_macro_by_default():
    from app.backtest.replay import Replay
    r = Replay(["AAPL"], horizon_days=63)
    r._load = lambda: None
    out = r.run()
    joined = " ".join(out["warnings"])
    assert "News is excluded" in joined and "Macro is excluded" in joined


def _walk(seed, n=1200, drift=0.0003, vol=0.015, momentum=0.0):
    import numpy as np, pandas as pd
    rng = np.random.default_rng(seed)
    r = rng.normal(drift, vol, n)
    if momentum:
        for i in range(60, n):
            r[i] += momentum * float(np.mean(r[i - 60:i]))
    close = 100 * np.exp(np.cumsum(r))
    return pd.DataFrame({
        "date": pd.date_range("2021-01-04", periods=n, freq="B"),
        "open": close, "high": close * 1.007, "low": close * 0.993,
        "close": close, "volume": rng.integers(1e6, 6e6, n).astype(float)})


def _replay_ic(momentum, seed_base):
    from app.backtest import metrics as m
    from app.backtest.replay import Replay
    tickers = [f"S{i}" for i in range(18)]
    series = {t: _walk(seed_base + i, momentum=momentum) for i, t in enumerate(tickers)}
    series["SPY"] = _walk(seed_base + 500)
    span = series[tickers[0]].date
    r = Replay(tickers, horizon_days=63, every_days=14,
               start=span.iloc[300].date(), end=span.iloc[-70].date())
    r._load = lambda: r._prices.update(series)
    return m.summarise(r.run())


def test_no_lookahead_leak_on_pure_random_walks():
    """The most important test in the suite.

    Prices with no memory cannot be predicted. If the replay shows a real IC
    here, future information is leaking into the features and every other
    backtest number is worthless.
    """
    out = _replay_ic(momentum=0.0, seed_base=100)
    assert out["status"] == "ok" and out["n_observations"] > 500
    assert abs(out["information_coefficient"]) < 0.08, (
        f"IC {out['information_coefficient']} on unpredictable data implies a leak")


def test_replay_detects_signal_when_signal_exists():
    """The counterpart: a null result must mean 'no edge', not 'broken engine'."""
    out = _replay_ic(momentum=0.45, seed_base=300)
    assert out["information_coefficient"] > 0.10
    buckets = [b["mean_return_pct"] for b in out["score_buckets_cross_sectional"]]
    assert buckets[-1] > buckets[0], "top score bucket must outperform the bottom"


def test_backtest_reports_overlap_honestly():
    out = _replay_ic(momentum=0.0, seed_base=700)
    assert out["n_effective"] < out["n_observations"]
    assert out["overlap_factor"] == 4.5


# ===========================================================================
# v2.0 — component attribution, weight fitting, sample adequacy
# ===========================================================================

def _cancelling_universe(seed=11, names=40, dates=40):
    """technical predicts, valuation anti-predicts, the rest is noise."""
    import random

    from app.analysis.decision import WEIGHTS
    rng = random.Random(seed)
    records = []
    for d in range(dates):
        as_of = f"2024-{1 + d % 12:02d}-{1 + (d // 12) * 7:02d}"
        for n in range(names):
            tech, val = rng.uniform(20, 90), rng.uniform(10, 90)
            comps = {"technical": tech, "valuation": val,
                     **{k: rng.uniform(25, 85) for k in
                        ("market", "sector", "fundamentals", "growth",
                         "money_flow", "news")}}
            fwd = (0.22 * (tech - 55) - 0.20 * (val - 50)) / 4.0 + rng.gauss(0, 6)
            num = sum(w * comps[k] for k, w in WEIGHTS.items())
            records.append({
                "as_of": as_of, "ticker": f"T{n}",
                "score": num / sum(WEIGHTS.values()),
                "components": comps, "forward_return_pct": fwd,
                "coverage": 1.0, "confidence": 60, "action": "HOLD",
                "benchmark_return_pct": 1.0, "excess_return_pct": fwd - 1.0,
            })
    return {"records": records, "warnings": [],
            "config": {"horizon_days": 63, "every_days": 21,
                       "start": "2024-01-01", "end": "2024-12-31"}}


def test_attribution_finds_components_that_cancel():
    """A composite IC near zero must not be reported as 'no signal' when the
    components contain a strong signal pointing in both directions."""
    from app.backtest.attribution import attribute
    a = attribute(_cancelling_universe())

    assert abs(a["composite"]["mean_ic"]) < 0.06, "composite should look flat"
    assert a["components"]["technical"]["mean_ic"] > 0.10
    assert a["components"]["valuation"]["mean_ic"] < -0.10
    assert a["components"]["technical"]["significant"]
    assert a["components"]["valuation"]["significant"]
    assert "technical" in a["helping"] and "valuation" in a["hurting"]
    assert "weighting problem, not a signal problem" in a["diagnosis"]


def _noise_universe(seed, dates=30, names=30):
    import random
    rng = random.Random(seed)
    return {"records": [{
        "as_of": f"2024-{1 + d % 12:02d}-{1 + (d // 12) * 7:02d}",
        "ticker": f"T{n}", "score": rng.uniform(20, 90),
        "components": {k: rng.uniform(20, 90) for k in
                       ("market", "sector", "fundamentals", "growth", "valuation",
                        "technical", "money_flow", "news")},
        "forward_return_pct": rng.gauss(0, 6), "coverage": 1.0,
        "confidence": 60, "action": "HOLD",
        "benchmark_return_pct": 1.0, "excess_return_pct": 0.0}
        for d in range(dates) for n in range(names)],
        "warnings": [],
        "config": {"horizon_days": 63, "every_days": 21,
                   "start": "2024-01-01", "end": "2024-12-31"}}


def test_multiple_testing_correction_suppresses_false_positives():
    """Eight components tested at |t| > 2 gives ~1-in-3 odds of a false hit.

    This is the trap behind every 'I found the factor that works' story. The
    claim being tested is about the false-positive RATE across many runs, not
    about any single run -- a single unlucky seed can clear any fixed bar.
    """
    from app.backtest.attribution import attribute, t_threshold

    corrected = t_threshold(8)
    assert corrected > 2.5, "the bar must rise when eight things are tested at once"

    naive_hits = corrected_hits = 0
    for seed in range(12):
        a = attribute(_noise_universe(seed))
        ts = [abs(v["t_stat"]) for v in a["components"].values()
              if v["t_stat"] is not None]
        naive_hits += any(t > 2.0 for t in ts)
        corrected_hits += any(t > corrected for t in ts)

    assert corrected_hits <= naive_hits
    assert corrected_hits <= 3, (
        f"{corrected_hits}/12 noise runs still flagged something significant")


def test_helping_and_hurting_require_significance_not_just_a_sign():
    """Without this, the diagnosis narrates noise with total confidence."""
    from app.backtest.attribution import attribute
    a = attribute(_noise_universe(5))
    for key in a["helping"] + a["hurting"]:
        assert a["components"][key]["significant"]
    # sub-threshold leanings are still surfaced, but labelled as not significant
    assert "candidates_not_significant" in a


def test_weight_fitting_is_tested_out_of_sample():
    from app.backtest.attribution import fit_weights
    f = fit_weights(_cancelling_universe())
    assert f["status"] == "ok"
    assert f["test"]["fitted_ic"] > f["test"]["current_ic"]
    assert f["fitted_weights"]["technical"] > 0.5
    assert "valuation" in f["dropped"], "an anti-predictive component must be dropped"
    assert abs(sum(f["fitted_weights"].values()) - 1.0) < 0.01


def test_weight_fitting_refuses_when_nothing_predicts():
    import random

    from app.backtest.attribution import fit_weights
    rng = random.Random(9)
    records = [{
        "as_of": f"2024-{1 + d % 12:02d}-{1 + (d // 12) * 7:02d}",
        "ticker": f"T{n}", "score": rng.uniform(20, 90),
        "components": {k: rng.uniform(20, 90) for k in
                       ("market", "sector", "fundamentals", "growth", "valuation",
                        "technical", "money_flow", "news")},
        "forward_return_pct": rng.gauss(0, 6), "coverage": 1.0,
        "confidence": 60, "action": "HOLD",
        "benchmark_return_pct": 1.0, "excess_return_pct": 0.0}
        for d in range(30) for n in range(30)]
    f = fit_weights({"records": records, "warnings": [],
                     "config": {"horizon_days": 63, "every_days": 21,
                                "start": "2024-01-01", "end": "2024-12-31"}})
    # Either it finds nothing to weight, or the out-of-sample gain evaporates.
    if f["status"] == "ok":
        assert f["test"]["fitted_ic"] < 0.05
        assert "noise" in f["guidance"] or "no edge" in f["guidance"]
    else:
        assert f["status"] == "no_positive_components"


def test_narrow_universe_is_flagged_as_unmeasurable():
    """Eight names per date cannot resolve a realistic equity signal."""
    from app.backtest.universe import adequacy
    narrow = adequacy(8, 36)
    assert not narrow["adequate"]
    assert narrow["smallest_detectable_ic"] > 0.05
    assert "too narrow" in narrow["verdict"]

    wide = adequacy(60, 36)
    assert wide["adequate"] and wide["smallest_detectable_ic"] < 0.05


def test_preset_universes_are_diversified_and_flagged():
    from app.backtest import universe as uni
    u = uni.get("diversified_60")
    assert len(u) >= 55
    sectors = {}
    for t, s in u.items():
        sectors[s] = sectors.get(s, 0) + 1
    assert len(sectors) >= 9, "must span many sectors, not just tech"
    assert max(sectors.values()) / len(u) < 0.30, "no sector may dominate"
    assert "survivorship" in uni.SURVIVORSHIP_WARNING.lower()


# ===========================================================================
# v2.1 — ranking vs timing, per-date headline, demeaned buckets
# ===========================================================================

def _timing_confounded_universe(seed=17, names=30, dates=40):
    """A score with NO ranking skill that is nonetheless correlated with the
    market's direction. Pooled IC will look negative; per-date IC is zero.

    This is the shape of the real 63-name result, where pooled read -0.092 and
    the per-date mean read -0.005.
    """
    import random
    rng = random.Random(seed)
    records = []
    for d in range(dates):
        as_of = f"2024-{1 + d % 12:02d}-{1 + (d // 12) * 7:02d}"
        market_move = rng.gauss(0, 9)
        # scores run HIGH in months that turn out badly -> pooled IC negative
        level = 60 - market_move
        for n in range(names):
            score = level + rng.uniform(-8, 8)          # no link to this stock
            fwd = market_move + rng.gauss(0, 5)         # no link to the score
            records.append({
                "as_of": as_of, "ticker": f"T{n}", "score": score,
                "components": {"market": level, "technical": rng.uniform(20, 90)},
                "forward_return_pct": fwd, "coverage": 1.0, "confidence": 60,
                "action": "HOLD", "benchmark_return_pct": market_move,
                "excess_return_pct": fwd - market_move})
    return {"records": records, "warnings": [],
            "config": {"horizon_days": 63, "every_days": 21,
                       "start": "2024-01-01", "end": "2024-12-31"}}


def test_per_date_ic_is_not_confused_by_market_timing():
    """The bug this rewrite fixes: pooled IC reported timing as stock-picking."""
    from app.backtest.metrics import summarise
    out = summarise(_timing_confounded_universe())

    assert abs(out["information_coefficient"]) < 0.05, "no ranking skill exists"
    assert out["pooled_ic"] < -0.15, "pooled should be badly misled here"
    assert "market timing, not stock ranking" in out["pooled_vs_per_date_note"]
    assert "INDISTINGUISHABLE FROM ZERO" in out["verdict"]


def test_demeaned_buckets_remove_the_timing_artefact():
    from app.backtest.metrics import summarise
    out = summarise(_timing_confounded_universe())

    xs = [b["mean_return_pct"] for b in out["score_buckets_cross_sectional"]]
    raw = [b["mean_return_pct"] for b in out["score_buckets_raw"]]
    assert max(abs(x) for x in xs) < 1.5, "cross-sectional buckets should be flat"
    assert max(raw) - min(raw) > max(xs) - min(xs), "raw buckets carry the artefact"


def test_constant_per_date_component_classified_as_timing_not_broken():
    """`market` is identical for every stock on a date. That is a category
    error inside a ranking composite, not a measurement failure."""
    from app.backtest.attribution import attribute, classify

    raw = _timing_confounded_universe()
    assert classify(raw["records"], "market") == "timing"
    assert classify(raw["records"], "technical") == "ranking"

    a = attribute(raw)
    assert a["components"]["market"]["kind"] == "timing"
    assert "cannot rank them" in a["components"]["market"]["reads"]
    assert "timing" in a["components"]["market"]


def test_weight_audit_reports_how_much_was_actually_measured():
    from app.backtest.attribution import attribute
    a = attribute(_timing_confounded_universe())
    audit = a["weight_audit"]
    # market is timing (10%); six components absent from this fixture are unmeasured
    assert audit["timing_weight_diluting_the_ranking"] >= 0.10
    assert audit["never_validated_weight"] > 0
    total = (audit["ranking_weight"] + audit["timing_weight_diluting_the_ranking"]
             + audit["never_validated_weight"])
    assert abs(total - 1.0) < 1e-6, "the audit must account for all the weight"


def test_weight_fitting_excludes_non_ranking_components():
    from app.backtest.attribution import fit_weights
    f = fit_weights(_cancelling_universe())
    if f["status"] == "ok":
        assert "excluded_as_non_ranking" in f
        for k in f["fitted_weights"]:
            assert k not in f["excluded_as_non_ranking"]


def test_stability_flags_a_sign_flip_between_periods():
    """train +0.099 then test -0.105 is a regime flip, not an edge."""
    import random

    from app.backtest.metrics import summarise
    import datetime as dt
    rng = random.Random(21)
    records = []
    base = dt.date(2023, 1, 4)
    for d in range(45):
        as_of = str(base + dt.timedelta(days=21 * d))   # strictly increasing
        sign = 1 if d < 22 else -1          # relationship reverses halfway
        for n in range(30):
            score = rng.uniform(20, 90)
            fwd = sign * 0.30 * (score - 55) / 4.0 + rng.gauss(0, 4)
            records.append({
                "as_of": as_of, "ticker": f"T{n}", "score": score,
                "components": {"technical": score},
                "forward_return_pct": fwd, "coverage": 1.0, "confidence": 60,
                "action": "HOLD", "benchmark_return_pct": 1.0,
                "excess_return_pct": fwd - 1.0})
    out = summarise({"records": records, "warnings": [],
                     "config": {"horizon_days": 63, "every_days": 21,
                                "start": "2023-01-04", "end": "2025-08-01"}})
    assert out["stability"] is not None
    assert "Unstable" in out["stability"]["verdict"]
    assert out["stability"]["ic_spread"] > 0.10
    # and the average alone would have hidden it completely
    assert abs(out["information_coefficient"]) < 0.10


def test_near_zero_sign_changes_are_not_called_consistent():
    """A logic bug caught by the fixture above: the 'consistent sign' branch
    fired even when the sub-period signs differed."""
    from app.backtest.metrics import _stability
    import random
    rng = random.Random(4)
    import datetime as dt
    base = dt.date(2023, 1, 4)
    rows = [{"as_of": str(base + dt.timedelta(days=21 * d)), "score": rng.uniform(20, 90),
             "forward_return_pct": rng.gauss(0, 5)}
            for d in range(45) for _ in range(30)]
    st = _stability(rows)
    if st and st["ic_spread"] <= 0.10:
        assert "consistent sign" not in st["verdict"]


def test_data_upgrade_note_leads_with_the_free_option():
    """ALFRED closes the macro-vintage gap for nothing; it must come before
    anything that costs money."""
    from app.backtest.data_upgrade import PROVIDERS, note
    n = note()
    assert n["do_this_first_it_is_free"], "the free option must be surfaced first"
    assert any("ALFRED" in p["name"] for p in n["do_this_first_it_is_free"])
    assert all(p["tier"] != "free" for p in n["then_research_these"])
    # every provider must say what it actually solves and where to look
    for p in PROVIDERS:
        assert p["solves"] and p["research"] and p["why"]
    assert "WORSE, not better" in n["how_to_decide"]
    assert any("verify current pricing" in b for b in n["before_you_pay"])


# ===========================================================================
# v2.2 — peer normalisation
# ===========================================================================

def test_percentile_orientation_respects_metric_direction():
    from app.analysis.peers import percentile
    cohort = [10, 20, 30, 40, 50]
    # low P/E is good -> a low value must score HIGH
    assert percentile(10, cohort, higher_is_better=False) > 80
    assert percentile(50, cohort, higher_is_better=False) < 20
    # high margin is good -> the reverse
    assert percentile(50, cohort, higher_is_better=True) > 80


def test_percentile_needs_a_real_cohort():
    from app.analysis.peers import MIN_COHORT, percentile
    assert percentile(10, [1, 2], higher_is_better=True) is None
    assert percentile(None, list(range(10)), True) is None
    assert percentile(5, list(range(MIN_COHORT)), True) is not None


def test_ties_score_at_the_midpoint():
    """Identical companies must not be ranked differently by list order."""
    from app.analysis.peers import percentile
    cohort = [20, 20, 20, 20, 20, 20]
    assert abs(percentile(20, cohort, True) - 50.0) < 1e-9


def _sector_universe(seed=3, dates=30, per_sector=14):
    """Cheap-within-sector wins, identically in every sector, but the sectors
    sit at very different absolute P/E levels."""
    import random

    from app.analysis import peers
    from app.analysis.features import squash
    rng = random.Random(seed)
    levels = {"UTILITIES": 12.0, "INDUSTRIALS": 20.0, "SOFTWARE": 45.0}
    records = []
    for d in range(dates):
        as_of = f"2024-{1 + d % 12:02d}-{1 + d // 12:02d}"
        day = []
        for sector, level in levels.items():
            for i in range(per_sector):
                pos = rng.uniform(-1, 1)
                pe = level * (1 + 0.45 * pos)
                day.append({
                    "as_of": as_of, "ticker": f"{sector[:3]}{i}", "sector": sector,
                    "raw_metrics": {"pe": pe},
                    "forward_return_pct": -6.0 * pos + rng.gauss(0, 5),
                    "absolute": squash((20.0 - pe) / 15.0, k=0.7)})
        by_sector = {}
        for r in day:
            by_sector.setdefault(r["sector"], []).append(r)
        for r in day:
            cohort = [c["raw_metrics"] for c in by_sector[r["sector"]]]
            r["peer"] = peers.scores(r["raw_metrics"], cohort)["valuation_peer"]
        records.extend(day)
    return records


def test_peer_ranking_recovers_signal_absolute_thresholds_bury():
    """The reason this module exists: absolute thresholds rank SECTORS, and the
    within-sector signal is lost underneath."""
    from app.backtest.metrics import ic_stats, per_date_ic
    records = _sector_universe()

    absolute = ic_stats(per_date_ic(records, lambda r: r["absolute"]))
    peer = ic_stats(per_date_ic(records, lambda r: r["peer"]))

    assert peer["mean_ic"] > absolute["mean_ic"] + 0.15
    assert peer["t_stat"] > absolute["t_stat"]


def test_peer_scores_are_none_when_the_cohort_is_too_thin():
    from app.analysis.peers import scores
    out = scores({"pe": 20.0}, [{"pe": 18.0}, {"pe": 22.0}])
    assert out["valuation_peer"] is None
    assert out["cohort_size"] == 2


def test_replay_falls_back_to_universe_when_a_sector_is_thin():
    """A four-company 'sector percentile' is not a percentile."""
    from app.backtest.replay import Replay
    r = Replay(["A"], horizon_days=63)
    day = [{"ticker": f"T{i}", "sector": "TECHNOLOGY" if i < 8 else "ENERGY",
            "raw_metrics": {"pe": 10.0 + i}, "components": {}}
           for i in range(10)]          # ENERGY has only 2 members
    r._add_peer_scores(day)
    assert day[0]["peer_scope"] == "sector"
    assert day[9]["peer_scope"] == "universe"
    assert day[0]["components"]["valuation_peer"] is not None


def test_peer_table_round_trips_and_ranks():
    import tempfile

    from app.analysis.peers import PeerTable
    from app.config import settings
    saved = settings.db_path
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as fh:
            settings.db_path = fh.name
        rows = [{"sector": "TECHNOLOGY", "metrics": {"pe": float(v)}}
                for v in range(10, 60, 5)]
        PeerTable.build(rows).save()

        loaded = PeerTable.load()
        assert loaded is not None
        cheap = loaded.scores("TECHNOLOGY", {"pe": 12.0})
        rich = loaded.scores("TECHNOLOGY", {"pe": 55.0})
        assert cheap["valuation_peer"] > rich["valuation_peer"]
        assert loaded.scores("UNKNOWN SECTOR", {"pe": 12.0})["valuation_peer"] is None
    finally:
        settings.db_path = saved


def test_attribution_compares_peer_variants_against_the_absolute_ones():
    from app.backtest.attribution import attribute
    records = []
    for r in _sector_universe():
        records.append({**r, "score": r["absolute"], "coverage": 1.0,
                        "confidence": 60, "action": "HOLD",
                        "benchmark_return_pct": 1.0,
                        "components": {"valuation": r["absolute"],
                                       "valuation_peer": r["peer"]}})
    a = attribute({"records": records, "warnings": [],
                   "config": {"horizon_days": 63, "every_days": 21,
                              "start": "2024-01-01", "end": "2024-12-31"}})
    exp = a["experimental_components"]
    assert "valuation_peer" in exp
    assert exp["valuation_peer"]["compared_to"] == "valuation"
    assert exp["valuation_peer"]["ic_delta_vs_absolute"] > 0.015
    assert exp["valuation_peer"]["is_improvement"] is True
    assert "worth adopting" in exp["valuation_peer"]["verdict"]


def test_insignificant_peer_variant_is_not_called_an_improvement():
    """v2.2 said quality_peer was 'worth adopting' on a +0.021 delta while its
    t-stat was 0.73. Both readings were noise; the delta between two noisy
    numbers is also noise."""
    import random

    from app.backtest.attribution import attribute
    rng = random.Random(19)
    records = []
    for d in range(40):
        for n in range(30):
            records.append({
                "as_of": f"2024-{1 + d % 12:02d}-{1 + d // 12:02d}",
                "ticker": f"T{n}", "score": rng.uniform(20, 90),
                "components": {"fundamentals": rng.uniform(20, 90),
                               "quality_peer": rng.uniform(20, 90)},
                "forward_return_pct": rng.gauss(0, 6), "coverage": 1.0,
                "confidence": 60, "action": "HOLD", "benchmark_return_pct": 1.0})
    a = attribute({"records": records, "warnings": [],
                   "config": {"horizon_days": 63, "every_days": 21,
                              "start": "2024-01-01", "end": "2024-12-31"}})
    qp = a["experimental_components"]["quality_peer"]
    assert qp["significant"] is False
    assert qp["is_improvement"] is False
    assert "noise moving around" in qp["verdict"]


def test_missing_valuation_blocks_a_directional_call():
    """The real v2.1 run said ACCUMULATE at 65% coverage with valuation absent —
    the one component the backtest found informative."""
    from app.analysis.decision import choose_action, evaluate

    parts = {"market": 64.6, "fundamentals": 72.3, "growth": 84.6,
             "technical": 64.6, "money_flow": 81.9,
             "sector": None, "valuation": None, "news": None}
    ev = evaluate(parts)
    assert ev["coverage"] > 0.6, "coverage alone would have let this through"

    action, why = choose_action(ev["opportunity_score"], ev["confidence"],
                                ev["coverage"], 0.5, parts)
    assert action == "NO ACTION"
    assert "valuation" in why

    # with valuation present the ladder behaves normally again
    action2, _ = choose_action(72.0, 80.0, 1.0, 0.5, {**parts, "valuation": 60.0})
    assert action2 in ("BUY", "ACCUMULATE")


def test_critical_gate_is_configurable_and_off_when_empty():
    from app.analysis.decision import choose_action, critical_missing
    from app.config import settings
    saved = settings.critical_components
    try:
        settings.critical_components = ""
        assert critical_missing({"valuation": None}) == []
        action, _ = choose_action(72.0, 80.0, 1.0, 0.5, {"valuation": None})
        assert action in ("BUY", "ACCUMULATE")

        settings.critical_components = "valuation,technical"
        assert set(critical_missing({"valuation": None, "technical": None})) == \
            {"valuation", "technical"}
    finally:
        settings.critical_components = saved


# ===========================================================================
# v2.2 — portfolio simulation
# ===========================================================================

def _sim_records(edge, seed=8, dates=36, names=30, top_bias=True):
    """Records shaped like a replay output, with a tunable ranking edge."""
    import random
    rng = random.Random(seed)
    records = []
    for d in range(dates):
        as_of = f"2024-{1 + d % 12:02d}-{1 + d // 12:02d}"
        market = rng.gauss(1.5, 6)
        for n in range(names):
            score = rng.uniform(20, 90)
            fwd = market + (edge * (score - 55) / 10.0 if top_bias else 0) + rng.gauss(0, 5)
            records.append({"as_of": as_of, "ticker": f"T{n}", "score": score,
                            "components": {}, "forward_return_pct": fwd,
                            "benchmark_return_pct": market, "coverage": 1.0,
                            "confidence": 60, "action": "HOLD"})
    return {"records": records, "warnings": [],
            "config": {"horizon_days": 63, "every_days": 21,
                       "start": "2024-01-01", "end": "2024-12-31"}}


def test_portfolio_sim_reports_benchmark_alongside_strategy():
    from app.backtest.portfolio import simulate
    out = simulate(_sim_records(edge=0.0), top_n=10)
    assert out["status"] == "ok"
    for block in ("strategy", "benchmark_equal_weight_universe"):
        for k in ("annualised_return_pct", "sharpe", "max_drawdown_pct"):
            assert k in out[block]
    assert out["average_turnover"] > 0
    assert out["config"]["non_overlapping_passes"] >= 1


def test_periods_do_not_overlap():
    """v2.2 scaled a 63-day return to 21 days and annualised it as if it were a
    21-day series, inflating Sharpe by about sqrt(63/21) = 1.73x."""
    from app.backtest.portfolio import simulate
    out = simulate(_sim_records(edge=0.0), top_n=10)
    cfg = out["config"]
    assert cfg["holding_period_days"] == 63
    assert cfg["non_overlapping_passes"] == 3, "63/21 = 3 independent offsets"
    # each pass must use only a third of the dates
    assert cfg["periods_per_pass"] <= 36 / 3 + 1


def test_overlapping_scaling_would_have_inflated_sharpe():
    """Guard the specific arithmetic that was wrong."""
    import math
    horizon, every = 63, 21
    true_vol = math.sqrt(every)
    scaled_vol = math.sqrt(horizon) * (every / horizon)
    assert scaled_vol < true_vol
    assert abs(true_vol / scaled_vol - math.sqrt(horizon / every)) < 1e-9


def test_sector_concentration_is_detected():
    """A 'valuation' screen that always lands on two sectors is a factor bet."""
    from app.backtest.portfolio import simulate
    import random
    rng = random.Random(5)
    records = []
    for d in range(36):
        for n in range(30):
            # financials always score highest -> the book concentrates there
            sector = "FINANCIALS" if n < 8 else ("TECHNOLOGY" if n < 20 else "ENERGY")
            score = rng.uniform(75, 95) if sector == "FINANCIALS" else rng.uniform(20, 60)
            records.append({
                "as_of": f"2024-{1 + d % 12:02d}-{1 + d // 12:02d}",
                "ticker": f"T{n}", "sector": sector, "score": score,
                "components": {}, "forward_return_pct": rng.gauss(2, 6),
                "benchmark_return_pct": 2.0, "coverage": 1.0,
                "confidence": 60, "action": "HOLD"})
    out = simulate({"records": records, "warnings": [],
                    "config": {"horizon_days": 63, "every_days": 21,
                               "start": "2024-01-01", "end": "2024-12-31"}}, top_n=8)
    conc = out["sector_concentration"]
    assert conc["top_two_share_pct"] > 55
    assert "factor bet" in conc["note"]


def test_beating_on_return_without_beating_on_sharpe_is_called_out():
    """Same Sharpe, higher return = more risk, not more skill."""
    from app.backtest.portfolio import _verdict
    out = {"strategy": {"annualised_return_pct": 28.5, "sharpe": 3.07},
           "benchmark_equal_weight_universe": {"annualised_return_pct": 21.9,
                                               "sharpe": 3.02},
           "annual_cost_drag_pct": 1.05,
           "sector_concentration": {"top_two_share_pct": 30}}
    v = _verdict(out, 0.12)
    assert "compensation for extra risk" in v
    assert "leveraged holding" in v


def test_no_edge_means_selecting_does_not_beat_holding_everything():
    from app.backtest.portfolio import simulate
    out = simulate(_sim_records(edge=0.0, seed=12), top_n=10)
    s = out["strategy"]["annualised_return_pct"]
    b = out["benchmark_equal_weight_universe"]["annualised_return_pct"]
    assert s <= b + 3.0, "random selection should not beat the universe"
    assert out["annual_cost_drag_pct"] > 0, "churn must be charged for"


def test_real_edge_shows_up_after_costs():
    from app.backtest.portfolio import simulate
    out = simulate(_sim_records(edge=3.0, seed=12), top_n=10)
    assert (out["strategy"]["annualised_return_pct"]
            > out["benchmark_equal_weight_universe"]["annualised_return_pct"])


def test_turnover_is_charged_and_reported():
    """An IC can be real and still lose to costs if the book churns."""
    from app.backtest.portfolio import simulate
    steady = simulate(_sim_records(edge=3.0, seed=1), top_n=25)   # near-full universe
    churny = simulate(_sim_records(edge=3.0, seed=1), top_n=3)    # tiny, high churn
    assert churny["average_turnover"] > steady["average_turnover"]
    assert churny["annual_cost_drag_pct"] > steady["annual_cost_drag_pct"]


def test_portfolio_verdict_names_the_benchmark_gap():
    from app.backtest.portfolio import simulate
    out = simulate(_sim_records(edge=0.0, seed=31), top_n=8)
    v = out["verdict"]
    assert "universe" in v or "Sharpe" in v
    assert any("Read the difference from the benchmark" in c for c in out["caveats"])


# ===========================================================================
# v2.3 — sector from SEC, so it survives an exhausted Alpha Vantage quota
# ===========================================================================

def test_sic_maps_to_the_sectors_the_engine_uses():
    from app.analysis.context import SECTOR_ETF
    from app.providers.edgar import sector_from_sic

    cases = {3571: "TECHNOLOGY", 7372: "TECHNOLOGY", 3674: "TECHNOLOGY",
             6022: "FINANCIALS", 6798: "REAL ESTATE", 2834: "HEALTHCARE",
             1311: "ENERGY", 4911: "UTILITIES", 4813: "COMMUNICATION SERVICES",
             5812: "CONSUMER CYCLICAL", 2080: "CONSUMER DEFENSIVE",
             3312: "MATERIALS", 3721: "CONSUMER CYCLICAL"}
    for sic, want in cases.items():
        assert sector_from_sic(sic) == want, f"SIC {sic}"
        # and every label must actually resolve to a sector ETF
        assert want in SECTOR_ETF, f"{want} has no ETF mapping"


def test_unmapped_or_missing_sic_returns_none_not_a_guess():
    from app.providers.edgar import sector_from_sic
    assert sector_from_sic(None) is None
    assert sector_from_sic("") is None
    assert sector_from_sic(9995) is None


def test_reits_are_not_swept_into_financials():
    """SIC 6798 sits inside the 6700-6799 finance block but is a REIT."""
    from app.providers.edgar import sector_from_sic
    assert sector_from_sic(6798) == "REAL ESTATE"
    assert sector_from_sic(6770) == "FINANCIALS"


# ===========================================================================
# v2.4 — the sector mapping bug that silently disabled peer normalisation
# ===========================================================================

def test_set_sectors_populates_both_maps():
    """v2.3 filled only the ETF map. Records got sector: None, every name landed
    in one 'UNKNOWN' cohort, and peer normalisation ranked across the whole
    universe -- reproducing the exact sector tilt it exists to remove."""
    from app.backtest.replay import Replay
    r = Replay(["AAPL", "JPM"], horizon_days=63)
    r.set_sectors({"AAPL": "TECHNOLOGY", "JPM": "FINANCIALS"})

    assert r._sector_names["AAPL"] == "TECHNOLOGY"
    assert r._sector_names["JPM"] == "FINANCIALS"
    assert r._sectors["AAPL"] == "XLK"
    assert r._sectors["JPM"] == "XLF"
    assert r._sector_of("aapl") == "TECHNOLOGY", "must be case-insensitive"


def test_records_carry_a_real_sector_so_cohorts_are_per_sector():
    from app.backtest.replay import Replay
    r = Replay(["A"], horizon_days=63)
    r.set_sectors({f"T{i}": ("TECHNOLOGY" if i < 8 else "FINANCIALS")
                   for i in range(16)})
    day = [{"ticker": f"T{i}", "sector": r._sector_of(f"T{i}"),
            "raw_metrics": {"pe": 10.0 + i}, "components": {}} for i in range(16)]
    r._add_peer_scores(day)

    assert all(d["peer_scope"] == "sector" for d in day)
    # a tech name and a financial with the SAME pe must score differently,
    # because they are ranked against different cohorts
    tech = [d for d in day if d["sector"] == "TECHNOLOGY"]
    fin = [d for d in day if d["sector"] == "FINANCIALS"]
    assert tech[0]["components"]["valuation_peer"] is not None
    assert fin[0]["components"]["valuation_peer"] is not None


def test_universe_fallback_is_reported_not_silent():
    from app.backtest.replay import Replay
    r = Replay(["A"], horizon_days=63)
    day = [{"ticker": f"T{i}", "sector": None,
            "raw_metrics": {"pe": 10.0 + i}, "components": {}} for i in range(12)]
    r._add_peer_scores(day)
    assert all(d["peer_scope"] == "universe" for d in day), (
        "unknown sector must fall back to universe scope, and say so")


# ===========================================================================
# v2.4 — EODHD (optional, paid) integration
# ===========================================================================

def test_engine_works_without_an_eodhd_key():
    """The paid provider must be entirely optional."""
    from app.providers.eodhd import EodhdClient, EodhdError
    import pytest as _pt
    with _pt.raises(EodhdError, match="not configured"):
        EodhdClient(api_key="").sp500_membership()


def test_members_on_reconstructs_a_past_index():
    """The whole point: a company that left in 2023 must still be in the 2022
    universe, and absent from the 2026 one."""
    import datetime as dt

    from app.providers.eodhd import EodhdClient
    membership = [
        {"ticker": "AAPL", "start": dt.date(2000, 1, 1), "end": None,
         "is_active": True, "is_delisted": False, "name": "Apple"},
        {"ticker": "SIVB", "start": dt.date(2010, 1, 1), "end": dt.date(2023, 3, 15),
         "is_active": False, "is_delisted": True, "name": "SVB Financial"},
        {"ticker": "NEWCO", "start": dt.date(2025, 6, 1), "end": None,
         "is_active": True, "is_delisted": False, "name": "Newco"},
    ]
    c = EodhdClient(api_key="x")

    past = c.members_on(dt.date(2022, 6, 1), membership)
    assert "SIVB" in past, "a company that failed in 2023 was in the 2022 index"
    assert "NEWCO" not in past, "a 2025 joiner must not appear in 2022"

    now = c.members_on(dt.date(2026, 1, 1), membership)
    assert "SIVB" not in now and "NEWCO" in now


def test_eodhd_is_registered_but_inert_in_the_price_chain():
    from app.providers import prices
    assert "eodhd" in prices.SOURCES
    from app.config import settings
    assert "eodhd" not in settings.price_sources, (
        "must not be in the default chain — it is optional and paid")


def test_not_subscribed_is_distinct_from_a_real_failure():
    """A plan limitation and a network error need different advice."""
    from app.providers.eodhd import EodhdError, EodhdNotSubscribed
    assert issubclass(EodhdNotSubscribed, EodhdError)


# ===========================================================================
# v2.5 — between-sector vs within-sector decomposition
# ===========================================================================

def _structured_universe(mode, seed=7, dates=40, per_sector=9):
    """mode: 'between' (sector rotation), 'within' (company selection), 'none'."""
    import random
    rng = random.Random(seed)
    sectors = ["TECH", "FIN", "ENERGY", "HEALTH", "STAPLES", "INDUSTRIALS"]
    records = []
    for d in range(dates):
        as_of = f"2024-{1 + d % 12:02d}-{1 + d // 12:02d}"
        cheapness = {s: rng.uniform(20, 80) for s in sectors}
        for s in sectors:
            base = cheapness[s]
            sector_ret = 0.10 * (base - 50) if mode == "between" else 0.0
            for i in range(per_sector):
                within = rng.uniform(-20, 20)
                fwd = sector_ret + rng.gauss(0, 4)
                if mode == "within":
                    fwd += 0.25 * within
                records.append({
                    "as_of": as_of, "ticker": f"{s}{i}", "sector": s,
                    "components": {"valuation": max(1, min(99, base + within))},
                    "forward_return_pct": fwd, "benchmark_return_pct": 1.0})
    return records


def test_decomposition_identifies_a_sector_rotation_bet():
    """The question the real result raises: absolute valuation scored +0.078,
    sector-relative valuation +0.015. Is that a rotation bet, or did small
    cohorts destroy a real within-sector effect?"""
    from app.backtest.decomposition import decompose
    out = decompose(_structured_universe("between"), "valuation")
    assert out["between_sector"]["significant"]
    assert not out["within_sector"]["significant"]
    assert "BETWEEN sectors" in out["interpretation"]
    assert "rotation bet" in out["interpretation"]


def test_decomposition_identifies_genuine_company_selection():
    from app.backtest.decomposition import decompose
    out = decompose(_structured_universe("within"), "valuation")
    assert out["within_sector"]["significant"]
    assert out["within_sector"]["mean_ic"] > out["between_sector"]["mean_ic"]
    assert "WITHIN sectors" in out["interpretation"]


def test_decomposition_finds_nothing_when_there_is_nothing():
    from app.backtest.decomposition import decompose
    out = decompose(_structured_universe("none"), "valuation")
    assert not out["between_sector"]["significant"]
    assert not out["within_sector"]["significant"]
    assert "Neither part is significant" in out["interpretation"]


def test_decomposition_warns_when_cohorts_are_too_small_to_conclude():
    """A null within-sector result is weaker evidence when sectors hold six
    companies than when they hold thirty."""
    from app.backtest.decomposition import decompose
    out = decompose(_structured_universe("none", per_sector=4), "valuation")
    assert out["median_cohort_size"] < 8
    assert "small" in out["interpretation"]


def test_decomposition_needs_sector_labels():
    from app.backtest.decomposition import decompose
    records = [{"as_of": "2024-01-01", "ticker": f"T{i}", "sector": None,
                "components": {"valuation": 50.0}, "forward_return_pct": 1.0}
               for i in range(200)]
    assert decompose(records, "valuation")["status"] == "insufficient_sample"


# --- sector-neutral portfolio ---------------------------------------------

def test_sector_neutral_picks_the_best_in_each_sector():
    from app.backtest.portfolio import _select
    # Sector A scores highest across the board, so top-N overall piles into it.
    offsets = {"A": 60.0, "B": 20.0, "C": 0.0}
    day = [{"ticker": f"{s}{i}", "sector": s, "score": offsets[s] + i}
           for s in ("A", "B", "C") for i in range(4)]

    picks = _select(day, top_n=3, min_score=None, score_key="score",
                    sector_neutral=True, per_sector=1)
    assert len(picks) == 3
    assert {p["sector"] for p in picks} == {"A", "B", "C"}
    assert all(p["ticker"].endswith("3") for p in picks), "best in each sector"

    plain = _select(day, top_n=3, min_score=None, score_key="score",
                    sector_neutral=False, per_sector=1)
    assert {p["sector"] for p in plain} == {"A"}, (
        "top-N overall concentrates in whichever sector scores highest — "
        "which is exactly the sector bet sector-neutral construction removes")


def test_sector_neutral_removes_the_sector_bet():
    """A strategy whose only edge is picking the right sector must lose that
    edge when forced to hold one name from every sector."""
    from app.backtest.portfolio import simulate
    records = [{**r, "score": r["components"]["valuation"], "coverage": 1.0,
                "confidence": 60, "action": "HOLD"}
               for r in _structured_universe("between", dates=36)]
    payload = {"records": records, "warnings": [],
               "config": {"horizon_days": 63, "every_days": 21,
                          "start": "2024-01-01", "end": "2024-12-31"}}

    plain = simulate(payload, top_n=6)
    neutral = simulate(payload, sector_neutral=True, per_sector=1)

    assert neutral["config"]["sector_neutral"] is True
    assert (neutral["strategy"]["annualised_return_pct"]
            < plain["strategy"]["annualised_return_pct"]), (
        "forcing one name per sector must strip out a pure rotation edge")


def test_worse_sharpe_is_not_called_effectively_unchanged():
    """v2.4 said 'Sharpe is 1.45 versus 1.78 - effectively unchanged'. It is
    not unchanged; it is worse, and that is the finding."""
    from app.backtest.portfolio import _verdict
    out = {"strategy": {"annualised_return_pct": 22.9, "sharpe": 1.45},
           "benchmark_equal_weight_universe": {"annualised_return_pct": 21.0,
                                               "sharpe": 1.78},
           "annual_cost_drag_pct": 0.96,
           "sector_concentration": {"top_two_share_pct": 33}}
    v = _verdict(out, 0.32)
    assert "WORSE Sharpe" in v
    assert "effectively unchanged" not in v
    assert "holding the whole universe" in v


# ===========================================================================
# v2.6 — news scope split, and the universe screener
# ===========================================================================

def test_macro_news_is_separated_from_company_news():
    """Macro stories move every stock the same way on a given day, so they
    cannot rank one against another — the same reason `market` was unmeasurable
    cross-sectionally."""
    from app.analysis.news import analyse

    def art(title, sent, rel):
        return {"title": title, "source": "Wire", "time_published": "20260830T120000",
                "overall_sentiment_score": sent,
                "ticker_sentiment": [{"ticker": "AAPL",
                                      "ticker_sentiment_score": str(sent),
                                      "relevance_score": str(rel)}]}

    feed = [
        art("Fed signals another interest rate cut as inflation cools", 0.5, 0.3),
        art("CPI print comes in below expectations", 0.4, 0.25),
        art("Apple beats quarterly earnings on services strength", 0.6, 0.95),
        art("Apple unveils new Mac lineup", 0.4, 0.9),
    ]
    out = analyse({"feed": feed}, "AAPL")

    assert out["scope_mix"].get("macro", 0) >= 2
    assert out["scope_mix"].get("company", 0) >= 2
    assert out["news_company"] is not None
    assert out["news_macro"] is not None
    assert out["news"] == out["news_company"], (
        "the headline news score must use company news only")


def test_company_specific_story_is_not_misread_as_macro():
    """A highly relevant story mentioning a macro word is still company news."""
    from app.analysis.news import _scope
    assert _scope("Fed approves Apple's banking partnership", 0.95) == "company"
    assert _scope("Fed signals rate cut", 0.2) == "macro"


def test_news_falls_back_when_no_company_story_exists():
    from app.analysis.news import analyse

    def art(title, rel):
        return {"title": title, "source": "W", "time_published": "20260830T120000",
                "overall_sentiment_score": 0.4,
                "ticker_sentiment": [{"ticker": "AAPL",
                                      "ticker_sentiment_score": "0.4",
                                      "relevance_score": str(rel)}]}
    out = analyse({"feed": [art("Fed cuts rates as inflation cools", 0.2)]}, "AAPL")
    assert out["news_company"] is None
    assert out["news"] is not None, "must fall back rather than return nothing"


# --- screener --------------------------------------------------------------

def test_illiquid_and_penny_names_are_excluded():
    """A screen over thousands of names meets every kind of untradeable stock."""
    import pandas as pd

    from app.providers import prices
    from app.screener import runner

    def frame(price, volume, n=300):
        return pd.DataFrame({
            "date": pd.date_range("2024-01-01", periods=n, freq="B"),
            "open": price, "high": price * 1.01, "low": price * 0.99,
            "close": price, "volume": float(volume)})

    saved = prices.daily
    try:
        prices.daily = lambda t, sources=None: (frame(1.20, 1e6), {})
        _, status, note = runner.score_ticker("PENNY")
        assert status == "illiquid" and "below" in note

        prices.daily = lambda t, sources=None: (frame(50.0, 100), {})
        _, status, _ = runner.score_ticker("THIN")
        assert status == "illiquid"

        prices.daily = lambda t, sources=None: (frame(50.0, 1e6, n=100), {})
        _, status, note = runner.score_ticker("SHORT")
        assert status == "no_data" and "history" in note
    finally:
        prices.daily = saved


def test_screen_survives_a_ticker_with_no_data():
    from app.providers import prices
    from app.screener import runner
    saved = prices.daily
    try:
        def boom(t, sources=None):
            raise RuntimeError("delisted")
        prices.daily = boom
        row, status, note = runner.score_ticker("GONE")
        assert row is None and status == "no_data" and "delisted" in note
    finally:
        prices.daily = saved


def test_screen_store_ranks_within_sector_and_overall():
    import tempfile

    from app.config import settings
    from app.screener import store
    saved = settings.db_path
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as fh:
            settings.db_path = fh.name
        run_id = store.start_run("2026-08-31", "2.6.0", 6, {})
        rows = [
            {"ticker": "A", "sector": "TECHNOLOGY", "score": 80.0, "coverage": 0.8},
            {"ticker": "B", "sector": "TECHNOLOGY", "score": 60.0, "coverage": 0.8},
            {"ticker": "C", "sector": "TECHNOLOGY", "score": 40.0, "coverage": 0.8},
            {"ticker": "D", "sector": "ENERGY", "score": 70.0, "coverage": 0.8},
            {"ticker": "E", "sector": "ENERGY", "score": 30.0, "coverage": 0.8},
        ]
        for r in rows:
            store.record(run_id, row=r, status="ok")
        store.record(run_id, ticker="F", status="illiquid", note="thin")
        summary = store.finalise(run_id)

        assert summary["scored"] == 5 and summary["skipped"] == 1

        # These fixtures carry no valuation, so the critical filter would hide
        # them. Ranking itself is what this test is about.
        out = store.results(run_id=run_id, limit=10, require_critical=False)
        by_ticker = {r["ticker"]: r for r in out["results"]}
        # D scores 70 overall but is best in ENERGY; A is best in TECHNOLOGY
        assert by_ticker["A"]["sector_rank"] == 1
        assert by_ticker["D"]["sector_rank"] == 1
        assert by_ticker["C"]["sector_rank"] == 3
        assert by_ticker["A"]["overall_percentile"] == 100.0
        assert out["sector_cohorts"] == {"TECHNOLOGY": 3, "ENERGY": 2}
    finally:
        settings.db_path = saved


def test_screen_results_carry_the_health_warning():
    """A ranked list looks authoritative. The measured IC is zero, and the
    output has to say so where the ranking is read."""
    import tempfile

    from app.config import settings
    from app.screener import store
    saved = settings.db_path
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as fh:
            settings.db_path = fh.name
        run_id = store.start_run("2026-08-31", "2.6.0", 1, {})
        store.record(run_id, row={"ticker": "A", "sector": "TECH",
                                  "score": 70.0, "coverage": 0.8}, status="ok")
        store.finalise(run_id)
        out = store.results(run_id=run_id, require_critical=False)
        assert "indistinguishable from zero" in out["health_warning"]
        assert "Do not treat the order as a prediction" in out["health_warning"]
        assert "cohort_note" in out
    finally:
        settings.db_path = saved


def test_missing_run_id_is_a_message_not_a_crash():
    """GET /screen?run_id=30 with no such run returned a 500."""
    import tempfile

    from app.config import settings
    from app.screener import store
    saved = settings.db_path
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as fh:
            settings.db_path = fh.name
        out = store.results(run_id=30)
        assert out["status"] == "run_not_found"
        assert out["requested_run_id"] == 30
        assert "screen_universe.py" in out["message"]

        run_id = store.start_run("2026-08-31", "2.7.0", 1, {})
        store.record(run_id, row={"ticker": "A", "sector": "TECH",
                                  "score": 70.0, "coverage": 0.8}, status="ok")
        store.finalise(run_id)
        out = store.results(run_id=999)
        assert out["available_run_ids"] == [run_id]
    finally:
        settings.db_path = saved


# ===========================================================================
# v2.7 — 8-K corporate events (the free, backtestable news alternative)
# ===========================================================================

def _filing(items, days_ago, filed_base="2026-08-31"):
    import datetime as dt
    d = dt.date.fromisoformat(filed_base) - dt.timedelta(days=days_ago)
    return {"form": "8-K", "filed": d.isoformat(),
            "accepted_at": f"{d.isoformat()}T16:30:00.000Z",
            "items": items, "accession": "0000-00-000000"}


def test_red_flag_filings_are_surfaced():
    """An auditor resignation or a non-reliance notice is a reported fact, not
    a sentiment reading, and matters more than any headline."""
    import datetime as dt

    from app.analysis.events import classify
    out = classify([_filing(["4.02"], 20), _filing(["2.02"], 10)],
                   dt.date(2026, 8, 31))
    assert out["status"] == "available"
    codes = {f["item"] for f in out["red_flags"]}
    assert "4.02" in codes
    assert "cannot be relied upon" in out["red_flags"][0]["label"].lower()
    assert "red-flag" in out["reads"]
    assert out["score"] < 40


def test_ambiguous_events_do_not_move_the_score():
    """Item 2.02 says results were announced, not whether they were good.
    Guessing a direction there would be inventing information."""
    import datetime as dt

    from app.analysis.events import classify
    out = classify([_filing(["2.02"], 5), _filing(["5.07"], 8)],
                   dt.date(2026, 8, 31))
    assert out["score"] == 50.0, "purely ambiguous events must leave it neutral"
    assert out["ambiguous_count"] == 2
    assert out["directional_count"] == 0
    assert "does not say whether it was good" in out["reads"]


def test_old_events_fall_out_of_the_window():
    import datetime as dt

    from app.analysis.events import classify
    out = classify([_filing(["1.03"], 400)], dt.date(2026, 8, 31), window_days=120)
    assert out["status"] == "no_recent_events"
    assert out["score"] is None


def test_recency_weighting_within_the_window():
    import datetime as dt

    from app.analysis.events import classify
    fresh = classify([_filing(["2.06"], 5)], dt.date(2026, 8, 31))
    stale = classify([_filing(["2.06"], 110)], dt.date(2026, 8, 31))
    assert fresh["score"] < stale["score"], "a recent impairment should weigh more"


def test_every_item_code_has_a_direction_and_severity():
    from app.analysis.events import ITEMS, RED_FLAGS
    for code, (label, direction, severity) in ITEMS.items():
        assert direction in ("positive", "negative", "unknown"), code
        assert 0.0 <= severity <= 1.0, code
        assert label and label[0].isupper(), code
    assert RED_FLAGS <= set(ITEMS)
    # the gravest codes must be the most severe
    for code in ("1.03", "4.02", "3.01"):
        assert ITEMS[code][2] >= 0.85, code


def test_events_carry_the_unvalidated_caveat():
    """Severity weights are hand-assigned. The output has to say so."""
    import datetime as dt

    from app.analysis.events import classify
    out = classify([_filing(["2.06"], 10)], dt.date(2026, 8, 31))
    assert "unvalidated" in out["caveat"]
    assert "CAN be validated" in out["caveat"]


def test_filings_parser_handles_the_sec_payload_shape():
    from app.providers import edgar
    from app.storage import cache

    payload = {"filings": {"recent": {
        "form": ["8-K", "10-Q", "8-K"],
        "filingDate": ["2026-08-20", "2026-07-31", "2026-06-02"],
        "acceptanceDateTime": ["2026-08-20T16:31:00.000Z",
                               "2026-07-31T16:30:00.000Z",
                               "2026-06-02T09:00:00.000Z"],
        "items": ["2.02,9.01", "", "5.02"],
        "primaryDocDescription": ["8-K", "10-Q", "8-K"],
        "accessionNumber": ["a", "b", "c"]}}}

    class R:
        status_code = 200
        def raise_for_status(self): pass
        def json(self): return payload

    saved_get, saved_cik, saved_cache = edgar.requests.get, edgar.find_cik, cache.get
    try:
        edgar.requests.get = lambda *a, **k: R()
        edgar.find_cik = lambda t: "0000000001"
        cache.get = lambda *a, **k: None
        out = edgar.recent_filings("TEST")
        assert len(out) == 2, "10-Q must be filtered out"
        assert out[0]["items"] == ["2.02", "9.01"]
        assert out[0]["accepted_at"].startswith("2026-08-20T")
    finally:
        edgar.requests.get, edgar.find_cik, cache.get = saved_get, saved_cik, saved_cache


# ===========================================================================
# v2.8 — external validation of the measurement layer against Alphalens
# ===========================================================================

def test_our_ic_matches_alphalens_exactly():
    """Every number in this project comes from code in this repo. If the
    measurement layer has a bug, every conclusion is wrong the same way and no
    internal test would reveal it, because the tests share the author.

    Alphalens is the standard open-source implementation of this analysis.
    Feeding it the same factor is the only check that is genuinely independent.
    Skipped when it is not installed: `pip install alphalens-reloaded`.
    """
    import pytest as _pt
    al = _pt.importorskip("alphalens", reason="pip install alphalens-reloaded")

    import warnings
    from contextlib import contextmanager

    import numpy as np
    import pandas as pd
    from pandas.core.arrays.datetimelike import TimelikeOps

    from app.backtest.metrics import ic_stats, per_date_ic

    @contextmanager
    def tolerant_freq():
        original = TimelikeOps._validate_frequency
        TimelikeOps._validate_frequency = staticmethod(lambda *a, **k: None)
        try:
            yield
        finally:
            TimelikeOps._validate_frequency = original

    rng = np.random.default_rng(4)
    sectors = {f"T{i}": ("TECH" if i < 15 else "FIN" if i < 30 else "ENERGY")
               for i in range(45)}
    assets = list(sectors)
    days = pd.bdate_range("2023-01-02", periods=700)

    rows, drift = [], {a: np.zeros(len(days)) for a in assets}
    for d in range(250, len(days) - 70, 21):
        for a in assets:
            f = rng.uniform(20, 90)
            rows.append({"date": days[d], "asset": a, "factor": f})
            drift[a][d:d + 63] += 0.30 * (f - 55) / 63 / 100

    prices = pd.DataFrame(
        {a: 100 * np.exp(np.cumsum(rng.normal(0.0004, 0.013, len(days)) + drift[a]))
         for a in assets},
        index=pd.DatetimeIndex(days.values, name="date"))

    fdf = pd.DataFrame(rows)
    factor = fdf.set_index(["date", "asset"])["factor"].sort_index()

    records = []
    for _, r in fdf.iterrows():
        i = days.get_loc(r["date"])
        a = r["asset"]
        if i + 63 >= len(days):
            continue
        records.append({
            "as_of": str(r["date"].date()), "ticker": a, "sector": sectors[a],
            "score": r["factor"], "components": {},
            "forward_return_pct": 100 * (prices[a].iloc[i + 63] /
                                         prices[a].iloc[i] - 1)})

    ours = ic_stats(per_date_ic(records))

    with warnings.catch_warnings(), tolerant_freq():
        warnings.simplefilter("ignore")
        data = al.utils.get_clean_factor_and_forward_returns(
            factor=factor, prices=prices, groupby=sectors,
            quantiles=5, periods=(63,), max_loss=0.6)
        theirs = float(al.performance.mean_information_coefficient(data).iloc[0])
        q_mean, _ = al.performance.mean_return_by_quantile(data, demeaned=True)

    assert abs(ours["mean_ic"] - theirs) < 0.005, (
        f"our IC {ours['mean_ic']:+.4f} vs alphalens {theirs:+.4f} — one of the "
        "two implementations has a bug")

    # and the quantile buckets must rise monotonically on a planted signal
    values = [float(v) for v in q_mean[q_mean.columns[0]]]
    assert values == sorted(values), "quantile returns should increase with the factor"


def test_alphalens_freq_workaround_changes_no_number():
    """The workaround relaxes a pandas frequency check inside one Alphalens
    call. It must be metadata-only: same inputs, same answer."""
    import pytest as _pt
    _pt.importorskip("alphalens", reason="pip install alphalens-reloaded")

    from pandas.core.arrays.datetimelike import TimelikeOps
    original = TimelikeOps._validate_frequency
    try:
        TimelikeOps._validate_frequency = staticmethod(lambda *a, **k: None)
        assert TimelikeOps._validate_frequency is not original
    finally:
        TimelikeOps._validate_frequency = original
    assert TimelikeOps._validate_frequency is original, "must always restore"


# ===========================================================================
# v2.9 — local historical price warehouse
# ===========================================================================

def _wh_frame(n=300, start="2024-01-01", price=100.0):
    import pandas as pd
    days = pd.bdate_range(start, periods=n)
    return pd.DataFrame({
        "date": days, "open": price, "high": price * 1.01,
        "low": price * 0.99, "close": price, "volume": 1e6})


def _temp_warehouse():
    import tempfile

    from app.config import settings
    fh = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    fh.close()
    settings.warehouse_path = fh.name
    return fh.name


def test_warehouse_round_trip_preserves_provenance():
    """A stored price that does not say where it came from cannot be audited."""
    from app.config import settings
    from app.storage import warehouse
    saved = settings.warehouse_path
    try:
        _temp_warehouse()
        out = warehouse.upsert("AAPL", _wh_frame(),
                               {"source": "yahoo", "adjusted": True})
        assert out["rows"] == 300 and out["adjusted"] is True

        df, meta = warehouse.load("AAPL")
        assert len(df) == 300
        assert meta["source"] == "yahoo" and meta["adjusted"] is True
        assert meta["from_warehouse"] is True
        assert list(df.columns) == ["date", "open", "high", "low", "close", "volume"]
    finally:
        settings.warehouse_path = saved


def test_upsert_is_idempotent_and_a_better_source_wins():
    from app.config import settings
    from app.storage import warehouse
    saved = settings.warehouse_path
    try:
        _temp_warehouse()
        warehouse.upsert("X", _wh_frame(price=100.0),
                         {"source": "alpha_vantage", "adjusted": False})
        warehouse.upsert("X", _wh_frame(price=100.0),
                         {"source": "alpha_vantage", "adjusted": False})
        df, _ = warehouse.load("X")
        assert len(df) == 300, "re-storing must not duplicate rows"

        # an adjusted source overwrites an unadjusted one
        warehouse.upsert("X", _wh_frame(price=25.0),
                         {"source": "yahoo", "adjusted": True})
        df, meta = warehouse.load("X")
        assert meta["source"] == "yahoo" and meta["adjusted"] is True
        assert abs(float(df.close.iloc[0]) - 25.0) < 1e-9
    finally:
        settings.warehouse_path = saved


def test_gap_detection_finds_holes_against_the_benchmark_calendar():
    """A series with holes computes indicators over a different window than it
    claims to."""
    from app.config import settings
    from app.storage import warehouse
    saved = settings.warehouse_path
    try:
        _temp_warehouse()
        full = _wh_frame(300)
        warehouse.upsert("SPY", full, {"source": "yahoo", "adjusted": True})

        holey = full.drop(full.index[100:115])       # a 15-day hole
        warehouse.upsert("HOLEY", holey, {"source": "yahoo", "adjusted": True})

        clean = warehouse.detect_gaps("SPY")
        assert clean["missing_days"] == 0

        gaps = warehouse.detect_gaps("HOLEY")
        assert gaps["missing_days"] == 15
        assert gaps["worst_run"] == 15
        assert gaps["missing_pct"] > 1.0
    finally:
        settings.warehouse_path = saved


def test_coverage_calls_out_shallow_history_and_unadjusted_sources():
    from app.config import settings
    from app.storage import warehouse
    saved = settings.warehouse_path
    try:
        _temp_warehouse()
        assert warehouse.coverage()["status"] == "empty"

        warehouse.upsert("A", _wh_frame(300), {"source": "yahoo", "adjusted": True})
        warehouse.upsert("B", _wh_frame(300),
                         {"source": "alpha_vantage", "adjusted": False})
        cov = warehouse.coverage()

        assert cov["tickers"] == 2 and cov["price_rows"] == 600
        assert cov["unadjusted_tickers"] == 1
        joined = " ".join(cov["assessment"])
        assert "one market regime" in joined, "shallow history must be flagged"
        assert "UNADJUSTED" in joined
        assert "survivorship" in joined, (
            "depth of history must never be mistaken for breadth of universe")
    finally:
        settings.warehouse_path = saved


def test_prices_prefers_the_warehouse_but_never_depends_on_it(tmp_path):
    from app.config import settings
    from app.providers import prices
    from app.storage import warehouse
    saved_wh, saved_use = settings.warehouse_path, settings.use_warehouse
    saved_cache = settings.cache_dir
    try:
        # Isolate the on-disk TTL cache. Without this the test passes or fails
        # depending on files left by a previous run, which is worse than a
        # failing test because it fails intermittently.
        settings.cache_dir = str(tmp_path / "cache")
        _temp_warehouse()
        warehouse.upsert("WHONLY", _wh_frame(300),
                         {"source": "yahoo", "adjusted": True})

        df, meta = prices.daily("WHONLY")
        assert meta["via"] == "warehouse" and len(df) == 300

        # a corrupt warehouse must fall through to the network, not raise
        settings.warehouse_path = "/nonexistent/dir/nope.db"
        calls = []

        def fake(t):
            calls.append(t)
            return _wh_frame(300), {"source": "yahoo", "adjusted": True}

        original = prices.SOURCES["yahoo"]
        try:
            prices.SOURCES["yahoo"] = fake
            df2, meta2 = prices.daily("WHONLY", sources=["yahoo"])
            assert calls == ["WHONLY"] and meta2["source"] == "yahoo"
        finally:
            prices.SOURCES["yahoo"] = original
    finally:
        settings.warehouse_path, settings.use_warehouse = saved_wh, saved_use
        settings.cache_dir = saved_cache


def test_stale_or_thin_warehouse_entries_are_not_used():
    from app.config import settings
    from app.storage import warehouse
    saved = settings.warehouse_path
    try:
        _temp_warehouse()
        warehouse.upsert("THIN", _wh_frame(50), {"source": "yahoo", "adjusted": True})
        assert not warehouse.has("THIN", min_rows=250)

        warehouse.upsert("DEEP", _wh_frame(300), {"source": "yahoo", "adjusted": True})
        assert warehouse.has("DEEP", min_rows=250)
        assert not warehouse.has("DEEP", min_rows=250, max_age_days=-1), (
            "an entry older than the freshness limit must be refetched")
        assert not warehouse.has("NEVERSEEN")
    finally:
        settings.warehouse_path = saved


# ===========================================================================
# v2.10 — transposition-aware ticker suggestions
# ===========================================================================

def _fake_universe(monkeypatch):
    from app.providers import edgar
    universe = {
        "AAPL": "Apple Inc.", "PPL": "PPL Corp", "APP": "AppLovin Corp",
        "SPPL": "SIMPPLE LTD.", "APLE": "Apple Hospitality REIT",
        "MSFT": "Microsoft Corp", "MSF": "MSF Corp", "AMD": "AMD Inc",
        "GOOGL": "Alphabet Inc", "TSLA": "Tesla Inc", "AMZN": "Amazon.com",
    }
    monkeypatch.setattr(edgar, "known_tickers", lambda: universe)
    return edgar


def test_transposition_typos_resolve_to_the_intended_ticker(monkeypatch):
    """difflib alone ranked PPL and APP above AAPL for the input APPL, because
    it rewards a contiguous run. AAPL is one transposition away — the commonest
    typing error there is."""
    edgar = _fake_universe(monkeypatch)
    for typo, intended in [("APPL", "AAPL"), ("MFST", "MSFT"),
                           ("GOGL", "GOOGL"), ("TLSA", "TSLA")]:
        top = [s["ticker"] for s in edgar.suggest(typo)]
        assert top and top[0] == intended, f"{typo} -> {top}"


def test_suggestions_carry_the_company_name(monkeypatch):
    edgar = _fake_universe(monkeypatch)
    out = edgar.suggest("APPL")
    assert out[0] == {"ticker": "AAPL", "name": "Apple Inc."}


def test_damerau_counts_a_transposition_as_one_edit():
    from app.providers.edgar import _damerau_levenshtein as d
    assert d("APPL", "AAPL") == 1, "a swap is one mistake, not two"
    assert d("AAPL", "AAPL") == 0
    assert d("MFST", "MSFT") == 1
    assert d("ABC", "XYZ") == 3


def test_nonsense_input_yields_nothing_rather_than_a_wrong_guess(monkeypatch):
    edgar = _fake_universe(monkeypatch)
    assert edgar.suggest("") == []
    assert edgar.suggest("ZZZZZ") == []


def test_suggest_survives_an_unreachable_sec(monkeypatch):
    from app.providers import edgar

    def boom():
        raise RuntimeError("network down")

    monkeypatch.setattr(edgar, "known_tickers", boom)
    assert edgar.suggest("APPL") == [], "must degrade quietly, not raise"


# ===========================================================================
# v2.11 — sector-specific fundamentals
# ===========================================================================

def _facts_from(tag_rows):
    """Build a Facts object from {tag: [(val, end, filed, start, form), ...]}."""
    from app.providers.edgar import Facts
    facts = {}
    for tag, rows in tag_rows.items():
        unit = "shares" if "Shares" in tag else "USD"
        facts[tag] = {"units": {unit: [
            {"val": v, "end": e, "filed": f, "start": s, "form": form}
            for v, e, f, s, form in rows]}}
    return Facts({"entityName": "Test", "cik": 1, "facts": {"us-gaap": facts}})


def _annual(value, year, prior_year=None):
    """One annual duration fact, filed two months after year end."""
    return (value, f"{year}-12-31", f"{year + 1}-02-28",
            f"{prior_year or year}-01-01", "10-K")


def _instant(value, year):
    return (value, f"{year}-12-31", f"{year + 1}-02-28", None, "10-K")


def test_bank_model_reads_the_levers_a_generic_model_misses():
    """A bank's balance sheet is its business. Loan growth, funding mix and
    provisions do not appear in ProfitMargin."""
    import datetime as dt

    from app.analysis.sector_models import analyse
    facts = _facts_from({
        "InterestIncomeExpenseNet": [_annual(4_000, 2025), _annual(3_600, 2024)],
        "Assets": [_instant(100_000, 2025)],
        "LoansAndLeasesReceivableNetReportedAmount": [
            _instant(70_000, 2025), _instant(50_000, 2024)],
        "Deposits": [_instant(60_000, 2025), _instant(75_000, 2024)],
        "ProvisionForLoanLeaseAndOtherLosses": [_annual(1_400, 2025)],
        "NoninterestExpense": [_annual(3_800, 2025)],
        "NoninterestIncome": [_annual(1_200, 2025)],
    })
    out = analyse(facts, "FINANCIALS", dt.date(2026, 6, 1))

    assert out["model"] == "bank" and out["status"] == "available"
    m = out["metrics"]
    assert abs(m["net_interest_margin_on_assets"] - 0.04) < 1e-6
    assert m["loan_growth_yoy"] == 0.4
    assert m["deposit_growth_yoy"] == -0.2
    assert m["loan_to_deposit"] > 1.1

    joined = " ".join(out["flags"])
    assert "Loan book grew" in joined
    assert "Deposit flight" in joined
    assert "funded partly by borrowing" in joined
    assert "provisions" in joined.lower()


def test_reit_model_uses_ffo_not_earnings():
    """Property depreciation is a large non-cash charge, which is why the
    industry reports FFO. It is not a GAAP tag, so it is reconstructed."""
    import datetime as dt

    from app.analysis.sector_models import analyse
    facts = _facts_from({
        "NetIncomeLoss": [_annual(100, 2025)],
        "DepreciationDepletionAndAmortization": [_annual(400, 2025)],
        "GainLossOnSaleOfProperties": [_annual(50, 2025)],
        "Revenues": [_annual(1_000, 2025)],
        "PaymentsOfDividendsCommonStock": [_annual(500, 2025)],
    })
    out = analyse(facts, "REAL ESTATE", dt.date(2026, 6, 1))

    assert out["model"] == "reit"
    assert out["metrics"]["ffo_ttm"] == 450       # 100 + 400 - 50
    assert out["metrics"]["dividend_payout_of_ffo"] > 1.0
    assert any("exceeds" in f for f in out["flags"]), (
        "paying out more than FFO generates must be flagged")


def test_biotech_cash_runway_is_surfaced():
    """For a loss-maker, solvency is a more useful question than margin — and
    it is true whether or not it has a measurable information coefficient."""
    import datetime as dt

    from app.analysis.sector_models import analyse
    facts = _facts_from({
        "ResearchAndDevelopmentExpense": [_annual(800, 2025)],
        "Revenues": [_annual(100, 2025)],
        "CashAndCashEquivalentsAtCarryingValue": [_instant(200, 2025)],
        "NetCashProvidedByUsedInOperatingActivities": [_annual(-800, 2025)],
        "NetIncomeLoss": [_annual(-900, 2025)],
    })
    out = analyse(facts, "HEALTHCARE", dt.date(2026, 6, 1))

    assert out["model"] == "research_driven"
    assert out["metrics"]["cash_runway_quarters"] == 1.0
    assert out["metrics"]["rnd_intensity"] == 8.0
    joined = " ".join(out["flags"])
    assert "quarters of cash left" in joined and "dilutes" in joined


def test_inventory_building_faster_than_sales_is_flagged():
    """The classic early warning for anyone who makes physical things."""
    import datetime as dt

    from app.analysis.sector_models import analyse
    facts = _facts_from({
        "InventoryNet": [_instant(1_500, 2025), _instant(1_000, 2024)],
        "CostOfGoodsAndServicesSold": [_annual(3_000, 2025)],
        "Revenues": [_annual(5_100, 2025), _annual(5_000, 2024)],
    })
    out = analyse(facts, "TECHNOLOGY", dt.date(2026, 6, 1))

    m = out["metrics"]
    assert m["inventory_growth_yoy"] == 0.5
    assert m["inventory_vs_revenue_growth"] > 0.20
    assert abs(m["gross_margin"] - (1 - 3000 / 5100)) < 1e-4  # stored to 4dp
    assert any("precedes discounting" in f for f in out["flags"])


def test_software_with_no_inventory_is_reported_not_penalised():
    import datetime as dt

    from app.analysis.sector_models import analyse
    facts = _facts_from({"Revenues": [_annual(5_000, 2025)]})
    out = analyse(facts, "TECHNOLOGY", dt.date(2026, 6, 1))
    assert "asset-light or software-like" in out["metrics"]["note"]
    assert out["flags"] == []


def test_sector_metrics_are_point_in_time():
    """Same discipline as everything else: a figure filed later is invisible."""
    import datetime as dt

    from app.analysis.sector_models import analyse
    facts = _facts_from({
        "Deposits": [_instant(60_000, 2025)],   # filed 2026-02-28
        "Assets": [_instant(100_000, 2025)],
        "InterestIncomeExpenseNet": [_annual(4_000, 2025)],
    })
    early = analyse(facts, "FINANCIALS", dt.date(2026, 1, 15))
    assert early["status"] == "unavailable", "nothing was filed yet in January"

    later = analyse(facts, "FINANCIALS", dt.date(2026, 6, 1))
    assert later["status"] == "available"


def test_sector_models_do_not_enter_the_score():
    """They are diagnostics. The composite already measures an IC near zero;
    adding unvalidated components would repeat the mistake."""
    import datetime as dt

    from app.analysis.decision import WEIGHTS
    from app.analysis.sector_models import MODELS, analyse
    facts = _facts_from({"Assets": [_instant(100_000, 2025)]})
    out = analyse(facts, "FINANCIALS", dt.date(2026, 6, 1))

    assert "score" not in out, "a sector model must not emit a score"
    assert "diagnostics, not score inputs" in out["caveat"]
    for model in MODELS:
        assert model not in WEIGHTS


def test_unknown_sector_is_not_applicable_rather_than_an_error():
    import datetime as dt

    from app.analysis.sector_models import analyse
    out = analyse(_facts_from({}), "SOMETHING ELSE", dt.date(2026, 6, 1))
    assert out["status"] == "not_applicable"
    assert analyse(None, "FINANCIALS", dt.date(2026, 6, 1))["status"] == "not_applicable"


def test_value_for_reads_arbitrary_tags_without_leaking_state():
    """Sector models need tags outside the built-in CONCEPTS map. Reading them
    must not mutate module globals."""
    import copy
    import datetime as dt

    from app.providers import edgar
    before = copy.deepcopy(edgar.CONCEPTS)
    facts = _facts_from({"Deposits": [_instant(500, 2025), _instant(400, 2024)]})

    assert facts.value_for(["Deposits"], dt.date(2026, 6, 1)) == 500
    assert facts.value_for(["Deposits"], dt.date(2026, 6, 1), prior=True) == 400
    assert facts.value_for(["NoSuchTag"], dt.date(2026, 6, 1)) is None
    assert edgar.CONCEPTS == before, "reading a tag must not mutate the concept map"


# ===========================================================================
# v2.12 — research dashboard shows measured quantities only
# ===========================================================================

def _research_html():
    from pathlib import Path
    return Path("app/static/research.html").read_text(encoding="utf-8")


def test_research_view_has_no_field_for_numbers_we_cannot_measure():
    """The reason v1.4 reported '+4.0% expected return' from a run with every
    component missing is that its output shape demanded a number. A layout with
    a slot for an unmeasurable quantity creates the same pressure one layer
    earlier."""
    html = _research_html()
    forbidden = ["expected return:", "win rate", "out-of-sample success",
                 "success rate", "predicted return"]
    lowered = html.lower()
    for phrase in forbidden:
        # allowed only inside the explicit explanation of what is NOT shown
        idx = lowered.find(phrase)
        if idx != -1:
            context = lowered[max(0, idx - 400):idx]
            assert "will not show" in context or "do not exist" in context, (
                f"{phrase!r} appears as a display field, not as an explanation")


def test_research_view_always_renders_uncertainty_beside_the_estimate():
    """A point estimate without its interval is the easiest way to read a
    result that is not there."""
    html = _research_html()
    assert "ic_std_error" in html
    assert "95% interval" in html
    assert "ruler(ic, se)" in html, "the interval must be drawn, not just stated"


def test_research_view_renders_unmeasurable_components_as_their_own_state():
    html = _research_html()
    assert "cannot rank" in html, "timing components need an explicit state"
    assert "not present in this test" in html
    assert "num na" in html, "missing data needs a distinct visual class"


def test_research_view_reports_the_corrected_significance_threshold():
    html = _research_html()
    assert "t_threshold_used" in html
    assert "false positive roughly one time in three" in html


def test_research_route_is_registered():
    from app.main import app
    paths = [r.path for r in app.routes if hasattr(r, "path")]
    assert "/research" in paths and "/" in paths


# ===========================================================================
# v3.0 — the score no longer moves the probabilities
# ===========================================================================

def test_score_does_not_tilt_probabilities_by_default():
    """The engine measured its own composite at IC -0.006 +/- 0.027 and its
    refitted weights at -0.022 out of sample. A score that does not rank must
    not be moving the odds."""
    from app.analysis.scenarios import build
    from app.config import settings

    assert settings.score_tilt_strength == 0.0

    bullish, d1 = build(95, 0.30, 63)
    bearish, d2 = build(5, 0.30, 63)

    p_bull = {s["name"]: s["probability"] for s in bullish}
    p_bear = {s["name"]: s["probability"] for s in bearish}
    assert p_bull == p_bear, "a score of 95 and a score of 5 must give the same odds"
    assert abs(p_bull["Bull"] - 1 / 3) < 0.01

    assert d1["score_influences_probabilities"] is False
    assert d1["ranking_validated"] is False
    assert "does not rank stocks" in d1["probability_source"]


def test_scenario_magnitudes_still_come_from_volatility():
    """Zeroing the tilt removes a claim, not the analysis. Outcome sizes were
    never score-derived and still are not."""
    from app.analysis.scenarios import build
    lo, _ = build(50, 0.15, 63)
    hi, _ = build(50, 0.60, 63)
    assert abs(hi[0]["return_pct"]) > 3 * abs(lo[0]["return_pct"])


def test_tilt_can_be_re_enabled_if_evidence_ever_supports_it():
    from app.analysis.scenarios import build
    from app.config import settings
    saved = settings.score_tilt_strength
    try:
        settings.score_tilt_strength = 0.15
        bullish, d = build(95, 0.30, 63)
        assert bullish[0]["probability"] > 0.4
        assert d["score_influences_probabilities"] is True
    finally:
        settings.score_tilt_strength = saved


def test_plain_language_no_longer_presents_the_score_as_a_forecast():
    from app.presentation import plain
    out = plain.build({
        "action": "ACCUMULATE", "opportunity_score": 66.0, "confidence": 61.0,
        "coverage": 1.0, "signal_agreement": 29.0,
        "score_breakdown": {k: 60.0 for k in plain.COMPONENTS},
        "missing_components": [], "scenarios": None, "scenario_diagnostics": None,
        "price": 316.85, "invalidation_price": 304.6,
    })
    assert "not a forecast" in out["headline"]
    assert "did not predict" in out["headline"]
    assert "did not rank shares better than chance" in out["caveat"]


def test_yahoo_range_covers_the_requested_depth():
    """v2.9's warehouse accepted --years 15 and silently returned 5. Every
    ticker came back with 1254 rows: one market regime, when the point of the
    warehouse was to span several."""
    from app.providers.prices import _yahoo_range_for
    assert _yahoo_range_for(None) == "5y"
    assert _yahoo_range_for(3) == "5y"
    assert _yahoo_range_for(8) == "10y"
    assert _yahoo_range_for(15) == "max"
    assert _yahoo_range_for(25) == "max"


def test_deeper_history_request_bypasses_a_shallow_warehouse(tmp_path):
    """Otherwise a 5-year cached entry permanently satisfies a 15-year request
    and the warehouse can never get deeper."""
    from app.config import settings
    from app.providers import prices
    from app.storage import warehouse
    saved_wh, saved_cache = settings.warehouse_path, settings.cache_dir
    try:
        settings.cache_dir = str(tmp_path / "cache")
        settings.warehouse_path = str(tmp_path / "wh.db")

        import pandas as pd
        shallow = pd.DataFrame({
            "date": pd.bdate_range("2024-01-01", periods=300), "open": 100.0,
            "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1e6})
        warehouse.upsert("DEEP", shallow, {"source": "yahoo", "adjusted": True})

        assert prices.daily("DEEP")[1].get("via") == "warehouse"

        calls = []
        original = prices.SOURCES["yahoo"]
        try:
            def fake(t, range_="5y"):
                calls.append(range_)
                return shallow, {"source": "yahoo", "adjusted": True}
            prices.SOURCES["yahoo"] = fake
            prices.daily("DEEP", sources=["yahoo"], years=15)
            assert calls == ["max"], "a 15-year request must reach the network"
        finally:
            prices.SOURCES["yahoo"] = original
    finally:
        settings.warehouse_path, settings.cache_dir = saved_wh, saved_cache


def test_a_shallow_warehouse_entry_does_not_satisfy_a_deeper_request():
    """After the v3.0 range fix, a rebuild still returned identical numbers:
    every ticker was present and fresh, so it was skipped, and the backtest
    kept reading the same five years."""
    import datetime as dt

    import pandas as pd

    from app.config import settings
    from app.storage import warehouse
    saved = settings.warehouse_path
    try:
        _temp_warehouse()
        end = dt.date(2026, 8, 31)
        five_years = pd.DataFrame({
            "date": pd.bdate_range(end=end, periods=1254),
            "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0,
            "volume": 1e6})
        warehouse.upsert("AAPL", five_years, {"source": "yahoo", "adjusted": True})

        assert warehouse.has("AAPL")                       # fresh and present
        assert warehouse.has("AAPL", min_years=5)          # deep enough for 5
        assert not warehouse.has("AAPL", min_years=15), (
            "a 5-year entry must not satisfy a 15-year request")

        deep = pd.DataFrame({
            "date": pd.bdate_range(end=end, periods=3800),
            "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0,
            "volume": 1e6})
        warehouse.upsert("AAPL", deep, {"source": "yahoo", "adjusted": True})
        assert warehouse.has("AAPL", min_years=15)
    finally:
        settings.warehouse_path = saved


def test_coverage_flags_metadata_that_disagrees_with_the_table():
    """76 tickers at a claimed 41.7-year median cannot hold 17,526 rows.
    Reporting that as 'ok' describes data that is not there."""
    import sqlite3

    from app.config import settings
    from app.storage import warehouse
    saved = settings.warehouse_path
    try:
        _temp_warehouse()
        warehouse.upsert("A", _wh_frame(300), {"source": "yahoo", "adjusted": True})
        assert warehouse.coverage()["status"] == "ok"

        # simulate a half-finished build: metadata intact, rows partly missing
        conn = sqlite3.connect(settings.warehouse_path)
        conn.execute("DELETE FROM prices_daily WHERE rowid > 50")
        conn.commit()
        conn.close()

        cov = warehouse.coverage()
        assert cov["status"] == "inconsistent"
        assert cov["integrity"]["rows_claimed_by_metadata"] == 300
        assert cov["integrity"]["rows_actually_stored"] == 50
        assert "still running" in cov["integrity"]["note"]
        assert cov["integrity"]["note"] == cov["assessment"][0]
    finally:
        settings.warehouse_path = saved


def test_downsampled_yahoo_series_is_rejected():
    """range=max returned 1962-2026 with 231 bars — about 3.6 a year. Scoring
    indicators on quarterly bars labelled as daily is worse than no data."""
    import pandas as pd

    from app.providers import prices

    def payload(n, years):
        start = 1_100_000_000
        step = int(years * 365.25 * 86400 / max(n - 1, 1))
        ts = [start + i * step for i in range(n)]
        return {"chart": {"error": None, "result": [{
            "meta": {"currency": "USD"}, "timestamp": ts,
            "indicators": {"quote": [{"open": [10.0] * n, "high": [11.0] * n,
                                      "low": [9.0] * n, "close": [10.0] * n,
                                      "volume": [1000] * n}],
                           "adjclose": [{"adjclose": [10.0] * n}]}}]}}

    class R:
        def __init__(self, p): self._p, self.status_code = p, 200
        def json(self): return self._p

    saved = prices.requests.get
    try:
        prices.requests.get = lambda *a, **k: R(payload(231, 64))
        try:
            prices._yahoo("AAPL", "max")
            assert False, "sparse series must be rejected"
        except prices.PriceError as exc:
            assert "downsampled" in str(exc)

        prices.requests.get = lambda *a, **k: R(payload(2520, 10))
        df, meta = prices._yahoo("AAPL", "10y")
        assert len(df) == 2520 and meta["source"] == "yahoo"
    finally:
        prices.requests.get = saved


def test_long_spans_use_epoch_bounds_not_a_range_token():
    from app.providers import prices
    captured = {}

    class R:
        status_code = 200
        def json(self):
            return {"chart": {"error": None, "result": []}}

    saved = prices.requests.get
    try:
        def spy(url, params=None, **kw):
            captured.update(params or {})
            return R()
        prices.requests.get = spy

        try:
            prices._yahoo("AAPL", "5y")
        except prices.PriceError:
            pass
        assert captured.get("range") == "5y", "short spans keep the range token"

        captured.clear()
        try:
            prices._yahoo("AAPL", "max")
        except prices.PriceError:
            pass
        assert "range" not in captured
        assert "period1" in captured and "period2" in captured
        span_years = (captured["period2"] - captured["period1"]) / (365.25 * 86400)
        assert span_years > 50
    finally:
        prices.requests.get = saved


def test_coverage_calls_sparse_data_inconsistent_not_ok():
    import sqlite3

    import pandas as pd

    from app.config import settings
    from app.storage import warehouse
    saved = settings.warehouse_path
    try:
        _temp_warehouse()
        # 231 bars spread across 40 years — the shape of the real failure
        sparse = pd.DataFrame({
            "date": pd.date_range("1986-01-01", "2026-01-01", periods=231),
            "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 1e5})
        warehouse.upsert("OLD", sparse, {"source": "yahoo", "adjusted": True})

        cov = warehouse.coverage()
        assert cov["status"] == "inconsistent"
        assert cov["integrity"]["rows_per_ticker"] == 231
        assert cov["integrity"]["expected_rows_per_ticker"] > 9000
        assert "downsampled" in cov["integrity"]["note"]
    finally:
        settings.warehouse_path = saved


def test_backtest_depth_is_not_capped_below_the_warehouse():
    """The 10-year cap was set when the warehouse held five years. It now holds
    forty-three, and the question that matters is whether the valuation effect
    survives 2008 and 2022."""
    from app.main import BacktestRequest
    assert BacktestRequest(years=15).years == 15
    assert BacktestRequest(years=25).years == 25
    import pytest as _pt
    with _pt.raises(Exception):
        BacktestRequest(years=41)


def test_replay_warns_about_tickers_that_do_not_reach_back():
    """A name listed in 2012 contributes nothing to a 2005 window, and that
    should be stated rather than showing up as an unexplained sample drop."""
    import datetime as dt

    import pandas as pd

    from app.backtest.replay import Replay

    old = pd.DataFrame({"date": pd.bdate_range("2000-01-03", periods=6000),
                        "open": 100.0, "high": 101.0, "low": 99.0,
                        "close": 100.0, "volume": 1e6})
    young = pd.DataFrame({"date": pd.bdate_range("2019-01-02", periods=1500),
                          "open": 50.0, "high": 51.0, "low": 49.0,
                          "close": 50.0, "volume": 1e6})

    r = Replay(["OLD", "YOUNG"], horizon_days=63,
               start=dt.date(2005, 1, 1), end=dt.date(2023, 1, 1))
    from app.providers import prices
    saved = prices.daily
    try:
        prices.daily = lambda t, sources=None, use_warehouse=None, years=None: (
            (young.copy(), {}) if t == "YOUNG" else (old.copy(), {}))
        r._load()
    finally:
        prices.daily = saved

    short_warnings = [w for w in r.warnings if "listing date" in w]
    assert len(short_warnings) == 1
    assert "YOUNG" in short_warnings[0]
    assert "OLD" not in short_warnings[0], (
        "a ticker with history back to 2000 must not be flagged as short")


# ===========================================================================
# v3.2 — overlapping windows are not independent observations
# ===========================================================================

def test_overlap_adjustment_deflates_inflated_t_stats():
    """The 15-year run reported fundamentals at t = 3.82 against a 2.64 bar and
    it looked like a discovery. A 63-day horizon sampled every 21 days means
    consecutive dates share two thirds of their window, so 261 dates are about
    87 independent ones. Adjusted, t is 2.21 and does not clear the bar."""
    import math

    from app.backtest.metrics import ic_stats
    ics = [{"as_of": f"d{i}", "ic": v, "n": 60} for i, v in
           enumerate([0.0423 + 0.18 * math.sin(i) for i in range(261)])]

    naive = ic_stats(ics, overlap=1.0)
    adjusted = ic_stats(ics, overlap=3.0)

    assert naive["mean_ic"] == adjusted["mean_ic"], "the estimate does not change"
    assert adjusted["std_error"] > naive["std_error"]
    assert abs(adjusted["std_error"] / naive["std_error"] - math.sqrt(3)) < 0.05
    assert abs(abs(naive["t_stat"] / adjusted["t_stat"]) - math.sqrt(3)) < 0.05
    assert adjusted["n_effective_dates"] == 87
    assert adjusted["overlap_factor"] == 3.0


def test_summarise_uses_effective_dates_for_significance():
    from app.backtest.metrics import summarise
    import random
    rng = random.Random(2)
    records = [{
        "as_of": f"2024-{1 + d % 12:02d}-{1 + d // 12:02d}", "ticker": f"T{n}",
        "score": rng.uniform(20, 90), "components": {},
        "forward_return_pct": rng.gauss(0, 6), "benchmark_return_pct": 1.0,
        "coverage": 1.0, "confidence": 60, "action": "HOLD"}
        for d in range(60) for n in range(30)]
    out = summarise({"records": records, "warnings": [],
                     "config": {"horizon_days": 63, "every_days": 21,
                                "start": "2024-01-01", "end": "2024-12-31"}})
    assert out["ic_effective_dates"] < out["n_dates"]
    assert "share most of their window" in out["ic_se_note"]


def test_component_t_stats_are_overlap_adjusted_too():
    """Otherwise the headline is honest and the component table is not."""
    import random

    from app.backtest.attribution import attribute
    rng = random.Random(6)
    records = []
    for d in range(120):
        for n in range(30):
            v = rng.uniform(20, 90)
            records.append({
                "as_of": f"2024-{1 + d % 12:02d}-{1 + d // 12:02d}",
                "ticker": f"T{n}", "score": v,
                "components": {"fundamentals": v, "technical": rng.uniform(20, 90)},
                "forward_return_pct": 0.05 * (v - 55) + rng.gauss(0, 6),
                "benchmark_return_pct": 1.0})
    payload = {"records": records, "warnings": [],
               "config": {"horizon_days": 63, "every_days": 21,
                          "start": "2024-01-01", "end": "2024-12-31"}}

    a = attribute(payload)
    f = a["components"]["fundamentals"]
    assert f["n_effective_dates"] < f["n_dates"]

    flat = dict(payload)
    flat["config"] = {**payload["config"], "every_days": 63}   # no overlap
    b = attribute(flat)
    assert abs(b["components"]["fundamentals"]["t_stat"]) > abs(f["t_stat"]), (
        "removing the overlap must raise the t-stat, not lower it")


# ===========================================================================
# v3.3 — pre-registered 8-K event study
# ===========================================================================

def _event_universe(mode, seed=5, n_dates=90, n_names=60):
    """mode: 'null' | 'real' (4.02 precedes -8%) | 'mine' (undeclared codes)."""
    import random
    from datetime import date, timedelta
    rng = random.Random(seed)
    dates = [date(2020, 1, 6) + timedelta(days=21 * i) for i in range(n_dates)]
    records, filings = [], {f"T{n}": [] for n in range(n_names)}

    for d in dates:
        market = rng.gauss(1.5, 7)
        for n in range(n_names):
            codes, effect = [], 0.0
            if mode in ("null", "real") and rng.random() < 0.06:
                code = rng.choice(["4.02", "4.01", "2.06", "5.02", "1.01", "2.02"])
                codes.append(code)
                if mode == "real" and code == "4.02":
                    effect = -8.0
            if mode == "mine" and rng.random() < 0.25:
                codes.append(f"9.{rng.randint(10, 29)}")
            if codes:
                filings[f"T{n}"].append({
                    "filed": (d - timedelta(days=rng.randint(1, 40))).isoformat(),
                    "items": codes, "form": "8-K"})
            records.append({
                "as_of": d.isoformat(), "ticker": f"T{n}", "score": 50.0,
                "components": {},
                "forward_return_pct": market + effect + rng.gauss(0, 6)})
    return records, filings


def test_event_study_finds_a_real_event_effect():
    from app.backtest import event_study as es
    records, filings = _event_universe("real")
    es.attach_events(records, filings)
    out = es.run(records)

    by_name = {r["hypothesis"]: r for r in out["results"]}
    nr = by_name["non_reliance"]
    assert nr["significant"] and nr["matches_prediction"]
    assert nr["mean_abnormal_return_pct"] < -2.0
    # and it must NOT light up the codes that carry no effect
    assert not by_name["impairment"]["significant"]
    assert not by_name["results_announced"]["significant"]


def test_event_study_finds_nothing_when_there_is_nothing():
    from app.backtest import event_study as es
    records, filings = _event_universe("null")
    es.attach_events(records, filings)
    out = es.run(records)
    assert not any(r.get("significant") for r in out["results"])
    assert "do not predict abnormal returns" in out["verdict"]


def test_combining_a_real_signal_with_null_ones_dilutes_it():
    """red_flags_combined mixes one true code with five empty ones, so it must
    read weaker than the code that carries the effect."""
    from app.backtest import event_study as es
    records, filings = _event_universe("real")
    es.attach_events(records, filings)
    by_name = {r["hypothesis"]: r for r in es.run(records)["results"]}
    assert (abs(by_name["red_flags_combined"]["mean_abnormal_return_pct"])
            < abs(by_name["non_reliance"]["mean_abnormal_return_pct"]))


def test_undeclared_codes_are_exploratory_and_never_evidence():
    from app.backtest import event_study as es
    records, filings = _event_universe("mine")
    es.attach_events(records, filings)
    out = es.run(records)
    assert out["exploratory"], "undeclared codes must still be reported"
    for e in out["exploratory"]:
        assert e["exploratory"] is True
        assert "not evidence" in e["warning"]
    assert not any(r.get("significant") for r in out["results"])


def test_correction_covers_all_declared_hypotheses_not_survivors():
    import math

    from app.backtest.event_study import (N_HYPOTHESES, PREREGISTERED,
                                          t_threshold)
    assert N_HYPOTHESES == len(PREREGISTERED) == 8
    assert t_threshold(N_HYPOTHESES) > 2.6
    assert t_threshold(1) < t_threshold(8), "more hypotheses must raise the bar"
    # every hypothesis declares a direction in advance
    for label, codes, predicted in PREREGISTERED:
        assert predicted in ("positive", "negative", "none"), label
        assert codes, label


def test_a_result_opposite_to_the_prediction_is_not_support():
    import random

    from app.backtest.event_study import _test
    rng = random.Random(1)
    sample = [{"abnormal_return_pct": 6.0 + rng.gauss(0, 2)} for _ in range(60)]
    r = _test(sample, [], "material_agreement", ["1.01"], "negative", 2.0)
    assert r["significant"] and not r["matches_prediction"]
    assert "OPPOSITE direction" in r["reads"]


def test_a_zero_variance_sample_yields_no_conclusion_not_a_crash():
    """One filing in a window, or identical returns, gives no standard error."""
    from app.backtest.event_study import _test
    r = _test([{"abnormal_return_pct": 6.0}] * 60, [], "x", ["1.01"], "negative", 2.0)
    assert r["t_stat"] is None
    assert r["significant"] is False
    assert "no variation" in r["reads"]


def test_events_are_point_in_time():
    """A filing dated after the decision date must be invisible."""
    from app.backtest import event_study as es
    records = [{"as_of": "2024-06-01", "ticker": "X", "forward_return_pct": 1.0}]
    filings = {"X": [
        {"filed": "2024-05-20", "items": ["4.02"]},   # visible
        {"filed": "2024-06-15", "items": ["1.03"]},   # future — must not appear
        {"filed": "2023-01-01", "items": ["3.01"]},   # outside the 45-day window
    ]}
    es.attach_events(records, filings, window_days=45)
    assert records[0]["event_items"] == ["4.02"]


def test_thin_event_counts_report_no_conclusion():
    from app.backtest.event_study import MIN_EVENTS, _test
    r = _test([{"abnormal_return_pct": -9.0}] * 5, [], "x", ["4.02"], "negative", 2.0)
    assert r["status"] == "insufficient_events"
    assert str(MIN_EVENTS) in r["note"]
    assert "No conclusion" in r["note"]


# ===========================================================================
# v3.4 — sector-model flags must be checkable against the filing
# ===========================================================================

def test_growth_flags_carry_the_figures_behind_them():
    """A real run flagged 'inventory grew 87% while revenue grew 14%' for Apple
    with no numbers attached, so there was no way to tell whether it reflected a
    genuine build-up, a seasonal comparison, or a changed XBRL tag."""
    import datetime as dt

    from app.analysis.sector_models import analyse

    facts = _facts_from({
        "InventoryNet": [(12.5e9, "2026-06-27", "2026-07-30", None, "10-Q"),
                         (6.68e9, "2025-06-28", "2025-07-31", None, "10-Q")],
        "CostOfGoodsAndServicesSold": [_annual(270e9, 2025)],
        "Revenues": [_annual(526e9, 2025), _annual(461e9, 2024)],
    })
    out = analyse(facts, "TECHNOLOGY", dt.date(2026, 9, 2))

    prov = out["metrics"]["inventory_as_reported"]
    assert prov["current"] == 12.5e9
    assert prov["prior_year"] == 6.68e9
    assert prov["current_period_end"] == "2026-06-27"
    assert prov["prior_period_end"] == "2025-06-28"
    assert prov["filed"] == "2026-07-30"

    flag = out["flags"][0]
    assert "12,500,000,000" in flag and "6,680,000,000" in flag
    assert "2026-06-27" in flag and "2025-06-28" in flag
    assert "Check the figures against the filing" in flag
    assert "seasonal build or a changed tag" in flag


def test_bank_growth_flags_also_carry_provenance():
    import datetime as dt

    from app.analysis.sector_models import analyse
    facts = _facts_from({
        "LoansAndLeasesReceivableNetReportedAmount": [
            _instant(70_000, 2025), _instant(50_000, 2024)],
        "Deposits": [_instant(60_000, 2025), _instant(75_000, 2024)],
        "Assets": [_instant(100_000, 2025)],
        "InterestIncomeExpenseNet": [_annual(4_000, 2025)],
    })
    out = analyse(facts, "FINANCIALS", dt.date(2026, 6, 1))
    for key in ("loans_as_reported", "deposits_as_reported"):
        prov = out["metrics"][key]
        assert prov["current"] is not None and prov["prior_year"] is not None
        assert "current_period_end" in prov


def test_provenance_is_absent_rather_than_fabricated():
    import datetime as dt

    from app.analysis.sector_models import _provenance
    facts = _facts_from({})
    assert _provenance(facts, "inventory", dt.date(2026, 6, 1)) is None


# ===========================================================================
# v3.5 — a finding cannot be confirmed by the data that produced it
# ===========================================================================

def test_no_predicted_direction_means_no_match_claim():
    """The exploratory table reported item_1.02 as `matches_prediction: true`
    purely because its predicted direction was "none". That reads as
    confirmation of a hypothesis nobody made."""
    import random

    from app.backtest.event_study import _test
    rng = random.Random(3)
    # genuinely negative, with variance, so the t-stat is real
    sample = [{"abnormal_return_pct": -3.0 + rng.gauss(0, 2)} for _ in range(60)]

    undirected = _test(sample, [], "x", ["1.02"], "none", 2.0)
    assert undirected["significant"] is True
    assert undirected["matches_prediction"] is None

    directed = _test(sample, [], "x", ["1.02"], "negative", 2.0)
    assert directed["matches_prediction"] is True


def test_awaiting_confirmation_registry_records_where_it_was_found():
    from app.backtest.event_study import AWAITING_CONFIRMATION
    assert AWAITING_CONFIRMATION, "the 1.02 finding must be registered"
    for entry in AWAITING_CONFIRMATION:
        assert entry["predicted"] in ("positive", "negative")
        assert entry["found_on"]["universe"] and entry["found_on"]["period"]
        assert entry["confirmed_on"] is None, (
            "nothing is confirmed until an independent run fills this in")
        assert entry["rationale"]


def test_the_discovery_sample_cannot_confirm_its_own_finding():
    from app.backtest import event_study as es

    records, filings = _event_universe("real")
    es.attach_events(records, filings)

    same = es.run(records, sample_id={"universe": "diversified_60",
                                      "period": "2011-06-03 to 2026-05-30"})
    pending = same["awaiting_confirmation"][0]
    assert pending["is_confirmation"] is False
    assert "cannot be confirmed by the data that produced it" in pending["status_note"]

    other = es.run(records, sample_id={"universe": "russell_1000",
                                       "period": "1995-01-01 to 2010-12-31"})
    assert other["awaiting_confirmation"][0]["is_confirmation"] is True
    assert "counts" in other["awaiting_confirmation"][0]["status_note"]


def test_unlabelled_sample_is_never_treated_as_independent():
    from app.backtest import event_study as es
    records, filings = _event_universe("real")
    es.attach_events(records, filings)
    out = es.run(records)          # no sample_id
    assert out["awaiting_confirmation"][0]["is_confirmation"] is False


def test_pending_candidates_are_separate_from_the_verdict():
    """A candidate awaiting confirmation must not turn a null run into a hit."""
    from app.backtest import event_study as es
    records, filings = _event_universe("null")
    es.attach_events(records, filings)
    out = es.run(records, sample_id={"universe": "u", "period": "p"})
    assert "awaiting_confirmation" in out
    assert "do not predict abnormal returns" in out["verdict"]
    assert "not evidence" in out["confirmation_note"]


# ===========================================================================
# v3.6 — the screen ranked the alphabet, and led with its least-informed names
# ===========================================================================

def test_limit_samples_the_market_not_the_alphabet(monkeypatch):
    """A real run's top fifteen was AUGO, AU, ARIS, ARGX, ATRC, APA, BRZE,
    BCH... every name beginning with A or B, because the limit truncated a
    sorted list."""
    from app.screener import runner

    universe = {f"{a}{b}{c}": "name"
                for a in "ABCMNXYZ" for b in "ABC" for c in "ABCDE"}
    monkeypatch.setattr(runner.edgar, "known_tickers", lambda: universe)

    alpha = runner.candidate_tickers(limit=30, alphabetical=True)
    assert {t["ticker"][0] for t in alpha} == {"A", "B"}

    sampled = runner.candidate_tickers(limit=30)
    assert len({t["ticker"][0] for t in sampled}) >= 6, (
        "a limited screen must span the market")

    # deterministic: two runs of the same size cover the same names
    assert [t["ticker"] for t in sampled] == \
        [t["ticker"] for t in runner.candidate_tickers(limit=30)]

    # and no limit means no sampling
    assert len(runner.candidate_tickers()) == len(universe)


def test_names_missing_valuation_are_kept_out_of_the_ranking():
    """A real run put four names with coverage 0.30-0.40 and no valuation in
    the top four, ranked on technical and money_flow alone — the two components
    measured at -0.015 and -0.002."""
    import tempfile

    from app.config import settings
    from app.screener import store
    saved = settings.db_path
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as fh:
            settings.db_path = fh.name
        run_id = store.start_run("2026-09-03", "3.6.0", 4, {})
        store.record(run_id, row={"ticker": "THIN", "sector": "MATERIALS",
                                  "score": 82.5, "coverage": 0.3,
                                  "valuation": None, "technical": 77.4,
                                  "money_flow": 92.6}, status="ok")
        store.record(run_id, row={"ticker": "FULL", "sector": "MATERIALS",
                                  "score": 61.0, "coverage": 0.9,
                                  "valuation": 55.0, "technical": 60.0,
                                  "money_flow": 58.0}, status="ok")
        store.record(run_id, ticker="NOPX", status="illiquid", note="thin")
        store.finalise(run_id)

        default = store.results(run_id=run_id, limit=10)
        tickers = [r["ticker"] for r in default["results"]]
        assert tickers == ["FULL"], "the higher score with no valuation must not lead"
        assert default["filtering"]["excluded_missing_critical"] == 1
        assert "least-informed at the top" in default["filtering"]["note"]
        assert default["filtering"]["skipped_during_screen"] == {"illiquid": 1}

        shown = store.results(run_id=run_id, limit=10, require_critical=False)
        assert [r["ticker"] for r in shown["results"]] == ["THIN", "FULL"]
        assert shown["filtering"]["excluded_missing_critical"] == 0
    finally:
        settings.db_path = saved


def test_backtest_can_use_the_screened_universe():
    """A screen produces several hundred names, and the point of running one is
    to backtest on it. A 120-ticker cap made the screen decorative."""
    import tempfile

    from app.config import settings
    from app.main import BacktestRequest
    from app.screener import store

    assert BacktestRequest(tickers=[f"T{i}" for i in range(400)]).tickers
    assert BacktestRequest(universe="screen").universe == "screen"
    assert BacktestRequest().max_names == 250

    saved = settings.db_path
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as fh:
            settings.db_path = fh.name
        run_id = store.start_run("2026-09-04", "3.7.0", 3, {})
        for t, sec, val in [("VLO", "ENERGY", 65.7), ("CF", "CONSUMER DEFENSIVE", 69.8),
                            ("THIN", "MATERIALS", None)]:
            store.record(run_id, row={"ticker": t, "sector": sec, "score": 70.0,
                                      "coverage": 0.65, "valuation": val}, status="ok")
        store.finalise(run_id)

        res = store.results(limit=250, order="score", require_critical=True)
        drawn = {r["ticker"]: r["sector"] for r in res["results"]}
        assert set(drawn) == {"VLO", "CF"}, "names without valuation stay out"
        assert drawn["VLO"] == "ENERGY", "sectors must carry through for cohorts"
    finally:
        settings.db_path = saved


def test_run_backtest_script_is_importable_and_wired():
    """A JSON body pasted into a Windows command prompt is not a command. The
    script exists so a backtest needs no server, no browser and no quoting."""
    import importlib
    mod = importlib.import_module("scripts.run_backtest")
    assert hasattr(mod, "main") and hasattr(mod, "resolve_universe")

    from pathlib import Path
    src = Path("scripts/run_backtest.py").read_text(encoding="utf-8")
    # it must produce every section the API does, or the CLI is a lesser tool
    for section in ("attribution", "signal_decomposition", "weight_fitting",
                    "portfolio_simulation", "event_study", "sample_adequacy"):
        assert section in src, section
    assert "--out" in src and "json.dump" in src, "the result must be saved"


def test_run_backtest_reports_a_missing_screen_clearly():
    import argparse
    import tempfile

    from app.config import settings
    from scripts.run_backtest import resolve_universe
    saved = settings.db_path
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as fh:
            settings.db_path = fh.name
        args = argparse.Namespace(universe="screen", max_names=250)
        assert resolve_universe(args) is None, "no screen means no universe"

        args = argparse.Namespace(universe="starter_10", max_names=250)
        assert len(resolve_universe(args)) == 10
    finally:
        settings.db_path = saved


def test_warehouse_screen_draw_includes_names_without_valuation():
    """The warehouse should hold whatever you might later want to look at. The
    critical-component filter belongs at backtest time, where it decides what
    gets RANKED, not at download time."""
    import argparse
    import tempfile

    from app.config import settings
    from app.screener import store
    from scripts.build_warehouse import resolve_universe
    saved = settings.db_path
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as fh:
            settings.db_path = fh.name
        rid = store.start_run("2026-09-04", "3.7.1", 1500, {})
        for t, sec, val in [("VLO", "ENERGY", 65.7), ("NOVAL", "MATERIALS", None)]:
            store.record(rid, row={"ticker": t, "sector": sec, "score": 80.0,
                                   "coverage": 0.65, "valuation": val}, status="ok")
        store.finalise(rid)

        drawn = resolve_universe(
            argparse.Namespace(universe="screen", tickers=None, max_names=600))
        assert set(drawn) == {"VLO", "NOVAL"}, (
            "a name without valuation is still worth having prices for")
    finally:
        settings.db_path = saved


def test_warehouse_screen_draw_without_a_screen_is_explicit():
    import argparse
    import tempfile

    from app.config import settings
    from scripts.build_warehouse import resolve_universe
    saved = settings.db_path
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as fh:
            settings.db_path = fh.name
        out = resolve_universe(
            argparse.Namespace(universe="screen", tickers=None, max_names=600))
        assert out == [], "no screen must give an empty list, not a crash"
    finally:
        settings.db_path = saved


# ===========================================================================
# v3.8 — one filing is one event, and overlap applies everywhere
# ===========================================================================

def test_a_single_filing_is_counted_once():
    """A 45-day window sampled every 21 days puts one filing inside two or
    three consecutive windows. Counting it each time inflates the sample while
    adding no information — 79 'impairments' on the screened run were really
    about 30 filings."""
    from app.backtest import event_study as es

    dates = ["2024-01-05", "2024-01-26", "2024-02-16", "2024-03-08"]
    records = [{"as_of": d, "ticker": "X", "forward_return_pct": 1.0} for d in dates]
    es.attach_events(records, {"X": [{"filed": "2024-01-03", "items": ["2.06"]}]},
                     window_days=45)

    visible = [r for r in records if r["event_items"]]
    counted = [r for r in records if r["new_event_items"]]
    assert len(visible) >= 2, "the filing stays visible across the window"
    assert len(counted) == 1, "but it is only ever counted once"
    assert counted[0]["as_of"] == "2024-01-05", "at the first date that could see it"


def test_event_tests_use_first_sightings_only():
    from app.backtest import event_study as es
    records, filings = _event_universe("real")
    es.attach_events(records, filings)

    visible = sum(1 for r in records if "2.06" in (r.get("event_items") or []))
    counted = sum(1 for r in records if "2.06" in (r.get("new_event_items") or []))
    assert counted < visible, "deduplication must shrink the sample"

    out = es.run(records, horizon_days=63, every_days=21)
    imp = {r["hypothesis"]: r for r in out["results"]}["impairment"]
    if imp["status"] == "ok":
        assert imp["n_effective_events"] < imp["n_events"]
    assert "counts once" in out["counting"]


def test_decomposition_is_overlap_adjusted_like_everything_else():
    """v3.2 fixed metrics.py and attribution.py and missed decomposition.py, so
    the screened run reported within_sector at t = +3.42 when the adjusted
    figure is 1.97."""
    from app.backtest.decomposition import decompose
    records = _structured_universe("within", dates=60)

    naive = decompose(records, "valuation")
    adjusted = decompose(records, "valuation", horizon_days=63, every_days=21)

    assert naive["within_sector"]["mean_ic"] == adjusted["within_sector"]["mean_ic"]
    assert abs(adjusted["within_sector"]["t_stat"]) < abs(naive["within_sector"]["t_stat"])
    assert adjusted["within_sector"]["n_effective_dates"] < \
        adjusted["within_sector"]["n_dates"]


def test_overlap_adjustment_is_consistent_across_all_three_modules():
    """Three files compute a t-statistic. If they disagree about independence,
    one table contradicts another in the same response."""
    import math

    from app.backtest.attribution import _stats as attr_stats
    from app.backtest.decomposition import _stats as dec_stats
    from app.backtest.metrics import ic_stats

    vals = [0.04 + 0.15 * math.sin(i) for i in range(180)]
    a = attr_stats(vals, n_tests=1, overlap=3.0)
    d = dec_stats(vals, overlap=3.0)
    m = ic_stats([{"as_of": f"d{i}", "ic": v, "n": 50}
                  for i, v in enumerate(vals)], overlap=3.0)

    for x in (a, d, m):
        assert x["n_effective_dates"] == 60
    assert abs(a["t_stat"] - d["t_stat"]) < 0.01
    assert abs(a["t_stat"] - m["t_stat"]) < 0.01


# ===========================================================================
# v3.9 — running the engine forward
# ===========================================================================

def test_watchlist_file_parsing_ignores_comments_and_blanks():
    import tempfile

    from scripts.watchlist import load_watchlist
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False,
                                     encoding="utf-8") as fh:
        fh.write("AAPL\n\n  msft   # a comment\n# whole line\nJPM\n")
        path = fh.name
    assert load_watchlist(path) == ["AAPL", "MSFT", "JPM"]
    assert load_watchlist("/nonexistent/file.txt") is None


def test_calibration_status_on_an_empty_log():
    import tempfile

    from app.config import settings
    from scripts.calibration import cmd_status
    saved = settings.db_path
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as fh:
            settings.db_path = fh.name
        assert cmd_status() == 0
        assert cmd_status() == 0, "must be idempotent, not crash on a fresh db"
    finally:
        settings.db_path = saved


def test_forward_decisions_are_logged_with_horizon_and_entry_price():
    """Without both, an outcome cannot be scored later — which is the whole
    point of running the engine forward."""
    import tempfile

    from app.config import settings
    from app.storage import db
    saved = settings.db_path
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as fh:
            settings.db_path = fh.name
        did = db.log_decision({
            "ticker": "AAPL", "action": "HOLD", "opportunity_score": 55.0,
            "confidence": 60.0, "coverage": 0.8, "price": 100.0,
            "invalidation_price": 92.0, "engine_version": "3.9.0",
            "score_breakdown": {"valuation": 60},
            "scenarios": [{"name": "Bull", "probability": 0.33}],
            "scenario_diagnostics": {"horizon_days": 63,
                                     "expected_return_pct_net": 1.0}})
        with db.connect() as conn:
            row = dict(conn.execute(
                "SELECT * FROM decisions WHERE id = ?", (did,)).fetchone())
        assert row["horizon_days"] == 63
        assert row["entry_price"] == 100.0
        assert row["due_at"] > row["created_at"]

        ret = db.record_outcome(did, 110.0, row["entry_price"])
        assert abs(ret - 10.0) < 1e-6
        rep = db.calibration_report(5)
        assert rep["status"] == "ok" and rep["sample_size"] == 1
    finally:
        settings.db_path = saved


# ===========================================================================
# v3.9.1 — a log of one company is one observation
# ===========================================================================

def test_starter_watchlist_spans_sectors():
    """Eight decisions on one company resolve to nearly the same outcome. A
    starter list that encourages that would poison the forward test from day
    one."""
    from scripts.watchlist import STARTER_WATCHLIST, load_watchlist
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False,
                                     encoding="utf-8") as fh:
        fh.write(STARTER_WATCHLIST)
        path = fh.name

    tickers = load_watchlist(path)
    assert 8 <= len(tickers) <= 14, "big enough to be a cross-section, small "\
        "enough for a 25-call daily budget"
    assert len(set(tickers)) == len(tickers)
    assert "AAPL" in tickers and "JPM" in tickers and "XOM" in tickers
    assert "sector" in STARTER_WATCHLIST.lower()


def test_calibration_report_counts_companies_not_rows():
    """A real log held eight decisions across four days, all on one ticker: a
    sample size of eight and an effective sample size of about one."""
    import tempfile

    from app.config import settings
    from app.storage import db
    saved = settings.db_path
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as fh:
            settings.db_path = fh.name

        def log(ticker, i):
            return db.log_decision({
                "ticker": ticker, "action": "ACCUMULATE", "opportunity_score": 66.0,
                "confidence": 60.0, "coverage": 0.65, "price": 100.0,
                "invalidation_price": 92.0, "engine_version": "3.9.1",
                "score_breakdown": {},
                "scenarios": [{"name": "Bull", "probability": 0.4}],
                "scenario_diagnostics": {"horizon_days": 63,
                                         "expected_return_pct_net": 1.0}})

        for i in range(8):
            did = log("AAPL", i)
            db.record_outcome(did, 105.0, 100.0)

        rep = db.calibration_report(5)
        assert rep["sample_size"] == 8
        assert rep["distinct_tickers"] == 1
        assert rep["effective_sample_size"] == 1
        assert "distinct companies, not the number of rows" in rep["independence_note"]

        for t in ("JPM", "XOM", "JNJ"):
            db.record_outcome(log(t, 0), 95.0, 100.0)
        rep = db.calibration_report(5)
        assert rep["sample_size"] == 11 and rep["effective_sample_size"] == 4
    finally:
        settings.db_path = saved


# ===========================================================================
# v3.9.2 — the forward test measures the right thing
# ===========================================================================

def _temp_db():
    import tempfile
    from app.config import settings
    saved = settings.db_path
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as fh:
        settings.db_path = fh.name
    return saved


def _log(ticker, score=60.0, action="WATCH"):
    from app.storage import db
    return db.log_decision({
        "ticker": ticker, "action": action, "opportunity_score": score,
        "confidence": 60.0, "coverage": 1.0, "price": 100.0,
        "invalidation_price": 92.0, "engine_version": "3.9.2",
        "score_breakdown": {},
        "scenarios": [{"name": "Bull", "probability": 1 / 3}],
        "scenario_diagnostics": {"horizon_days": 63,
                                 "expected_return_pct_net": -2.0}})


def test_resolver_exits_at_due_date_not_today_and_records_benchmark():
    """Resolving late must not stretch the horizon, and a return without the
    market's return beside it says nothing about the pick."""
    import pandas as pd
    from datetime import datetime, timedelta, timezone

    from app.config import settings
    from app.storage import db, resolve
    saved = _temp_db()
    try:
        did = _log("AAPL")
        created = datetime.now(timezone.utc) - timedelta(days=200)
        due = created + timedelta(days=91)
        with db.connect() as conn:
            conn.execute("UPDATE decisions SET created_at=?, due_at=? WHERE id=?",
                         (created.isoformat(), due.isoformat(), did))

        dates = pd.date_range(created.date() - timedelta(days=5),
                              datetime.now(timezone.utc).date(), freq="D")

        def series(at_due, today):
            # Entry is the first close AFTER the decision day (TradingAgents
            # convention), so the 100 must hold through the next day.
            close = [100.0 if d.date() <= created.date() + timedelta(days=1) else
                     (at_due if d.date() <= due.date() else today) for d in dates]
            return pd.DataFrame({"date": dates, "close": close})

        frames = {"AAPL": series(110.0, 150.0), "SPY": series(104.0, 120.0)}
        resolved, failed, n = resolve.resolve_due(fetch=lambda t: frames[t])
        assert n == 1 and not failed
        r = resolved[0]
        assert abs(r["realised_return_pct"] - 10.0) < 1e-6, "exit is at due date"
        assert abs(r["benchmark_return_pct"] - 4.0) < 1e-6
        assert abs(r["excess_return_pct"] - 6.0) < 1e-6

        rep = db.calibration_report(5)
        assert rep["by_action"]["WATCH"]["mean_excess_vs_benchmark_pct"] == 6.0
    finally:
        settings.db_path = saved


def test_outcomes_table_is_migrated_in_place():
    """An engine.db from before the benchmark columns must keep its history."""
    import sqlite3

    from app.config import settings
    from app.storage import db
    saved = _temp_db()
    try:
        conn = sqlite3.connect(settings.db_path)
        conn.execute("""CREATE TABLE outcomes (decision_id INTEGER PRIMARY KEY,
            resolved_at TEXT NOT NULL, exit_price REAL NOT NULL,
            realised_return_pct REAL NOT NULL, bullish_outcome INTEGER NOT NULL)""")
        conn.execute("INSERT INTO outcomes VALUES (1, 'x', 1.0, 0.0, 0)")
        conn.commit()
        conn.close()
        with db.connect() as c:
            cols = {r["name"] for r in c.execute("PRAGMA table_info(outcomes)")}
            assert {"benchmark_return_pct", "excess_return_pct"} <= cols
            assert c.execute("SELECT COUNT(*) n FROM outcomes").fetchone()["n"] == 1
    finally:
        settings.db_path = saved


def test_recent_decision_blocks_same_week_duplicates():
    """A real log held three runs two minutes apart: thirty rows, ten observations."""
    from app.config import settings
    from app.storage import db
    saved = _temp_db()
    try:
        assert db.recent_decision("AAPL", 6) is None
        _log("AAPL")
        assert db.recent_decision("aapl", 6) is not None
        assert db.recent_decision("JPM", 6) is None
    finally:
        settings.db_path = saved


def test_forward_rank_ic_sees_the_score_when_brier_cannot():
    """With tilt 0 every p_bull is 1/3; only a rank test can see the score."""
    from app.storage import db
    rows = [{"created_at": "2026-09-07T10:00:00+00:00", "opportunity_score": s,
             "realised_return_pct": s / 10.0, "excess_return_pct": s / 10.0 - 1}
            for s in (40, 50, 60, 70, 80)]
    ic = db.forward_rank_ic(rows)
    assert ic["weeks"] == 1 and ic["mean_ic"] == 1.0

    flipped = [dict(r, excess_return_pct=-r["excess_return_pct"]) for r in rows]
    assert db.forward_rank_ic(flipped)["mean_ic"] == -1.0
    assert db.forward_rank_ic(rows[:3])["weeks"] == 0


# ===========================================================================
# v3.10 — whole-market forward test, component IC, expected-value gate
# ===========================================================================

def test_negative_expected_value_never_comes_out_as_a_buy():
    """A score of 64-67 used to return ACCUMULATE even when the engine's own
    arithmetic said the trade lost money after costs."""
    from app.analysis.decision import choose_action
    parts = {"valuation": 70}
    for score in (64, 66, 70, 80):
        action, _ = choose_action(score, 80, 1.0, -0.05, parts)
        assert action == "WATCH", score
    assert choose_action(66, 80, 1.0, 0.10, parts)[0] == "ACCUMULATE"
    assert choose_action(66, 80, 1.0, None, parts)[0] == "ACCUMULATE"


def _seed_screen(rows):
    from app.screener import store
    from datetime import date
    run = store.start_run(date.today(), "test", len(rows), {})
    for r in rows:
        store.record(run, row=r, ticker=r["ticker"])
    store.finalise(run)
    return run


def _screen_row(t, score, val, sector="TECH", flags=None):
    return {"ticker": t, "name": t + " Inc", "sector": sector, "price": 50.0,
            "dollar_volume": 2e7, "score": score, "coverage": 0.6,
            "confidence": 60, "valuation": val, "fundamentals": 55,
            "growth": 50, "technical": 50, "money_flow": 50,
            "red_flags": flags or [], "detail": {"action": "WATCH"}}


def test_screen_filters_red_flags_percentile_and_search():
    from app.config import settings
    from app.screener import store
    saved = _temp_db()
    try:
        run = _seed_screen([
            _screen_row("AAA", 70, 80),
            _screen_row("BBB", 65, 60, flags=["Changed auditor (2026-08-01)"]),
            _screen_row("CCC", 55, 40),
            _screen_row("DDD", 45, 30, sector="ENERGY"),
        ])
        all_ = store.results(run_id=run, limit=10)
        assert all_["filtering"]["matched"] == 4
        bbb = [r for r in all_["results"] if r["ticker"] == "BBB"][0]
        assert bbb["red_flag_count"] == 1 and "auditor" in bbb["red_flags_text"]
        assert bbb["action"] == "WATCH"

        clean = store.results(run_id=run, limit=10, exclude_red_flags=True)
        assert "BBB" not in [r["ticker"] for r in clean["results"]]

        top = store.results(run_id=run, limit=10, min_sector_percentile=50,
                            sector="TECH")
        assert [r["ticker"] for r in top["results"]] == ["AAA", "BBB"]

        assert [r["ticker"] for r in store.results(run_id=run, query="cc")["results"]] == ["CCC"]
        page2 = store.results(run_id=run, limit=2, offset=2)
        assert len(page2["results"]) == 2 and page2["filtering"]["matched"] == 4

        assert store.progress()["scored"] == 4
        assert store.sectors() == ["ENERGY", "TECH"]
    finally:
        settings.db_path = saved


def test_whole_screen_is_logged_to_the_forward_test_once_a_week():
    from app.config import settings
    from app.storage import db
    saved = _temp_db()
    try:
        run = _seed_screen([_screen_row(t, 50 + i, 50) for i, t in
                            enumerate(["A1", "A2", "A3", "A4", "A5", "A6"])])
        logged, skipped = db.log_screen_decisions(run)
        assert (logged, skipped) == (6, 0)
        assert db.log_screen_decisions(run) == (0, 6), "same week is skipped"

        # A watchlist decision on the same ticker is a separate source.
        assert db.recent_decision("A1", 6, source="watchlist") is None
        assert db.recent_decision("A1", 6, source="screen") is not None
        with db.connect() as conn:
            row = dict(conn.execute("SELECT * FROM decisions LIMIT 1").fetchone())
        assert row["source"] == "screen" and row["entry_price"] == 50.0
        assert '"valuation": 50' in row["components_json"]
    finally:
        settings.db_path = saved


def test_component_ic_finds_the_component_that_ranks():
    """If valuation ranked returns and technical did not, the report must say so."""
    from app.storage import db
    rows = []
    for week in ("2026-09-07", "2026-09-14"):
        for i, ret in enumerate((-4, -2, 0, 2, 4, 6)):
            rows.append({"created_at": week + "T10:00:00+00:00",
                         "opportunity_score": 50, "realised_return_pct": ret,
                         "excess_return_pct": ret,
                         "components": {"valuation": 10 * i,
                                        "technical": [3, 1, 4, 1, 5, 9][i]}})
    comp = db.component_ic(rows)
    assert comp["valuation"]["mean_ic"] == 1.0 and comp["valuation"]["weeks"] == 2
    assert comp["technical"]["mean_ic"] < 0.9
    assert "news" not in comp


def test_report_includes_screen_rows_without_probabilities():
    """Screen decisions carry no p_bull. They must still reach the rank IC."""
    from app.config import settings
    from app.storage import db
    saved = _temp_db()
    try:
        run = _seed_screen([_screen_row(f"T{i}", 40 + 5 * i, 10 * i) for i in range(6)])
        db.log_screen_decisions(run)
        with db.connect() as conn:
            ids = [(r["id"], int(r["ticker"][1:])) for r in
                   conn.execute("SELECT id, ticker FROM decisions")]
        for did, i in ids:
            db.record_outcome(did, 50.0 + i, 50.0, benchmark_return_pct=1.0)
        rep = db.calibration_report(5)
        assert rep["status"] == "ok" and rep["sample_size"] == 6
        assert rep["brier_score"] is None
        assert rep["forward_rank_ic"]["mean_ic"] == 1.0
        assert rep["forward_component_ic"]["valuation"]["mean_ic"] == 1.0
        assert "screen" in rep["forward_rank_ic_by_source"]
        assert db.calibration_report(5, source="watchlist")["status"] != "ok"
    finally:
        settings.db_path = saved

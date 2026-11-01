"""Build a wide universe and score it.

Two jobs:

**Universe.** SEC's ticker file lists every registered filer — roughly ten
thousand names, most of which are untradeable shells, tiny caps, or funds. The
filter is liquidity, applied from price data rather than guessed: a name needs
enough history for the technical measures and enough daily dollar volume that
you could actually buy it.

**Scoring.** The same feature engines the live analyzer uses, minus Alpha
Vantage. A free AV key allows 25 requests a day, which cannot screen anything,
and everything needed comes from SEC filings and prices. The consequence is
that `news` and AV profitability are absent for every name, which the coverage
figure reports honestly.
"""
import time
from datetime import date

from ..analysis import events as events_mod
from ..analysis import filings as filings_mod
from ..analysis import scenarios as scenarios_mod
from ..analysis.decision import choose_action, evaluate
from ..analysis.features import merge_fundamentals, money_flow, technical
from ..backtest.replay import valuation_pit
from ..config import VERSION
from ..providers import edgar, prices

MIN_HISTORY_DAYS = 250
DEFAULT_MIN_DOLLAR_VOLUME = 5_000_000.0
DEFAULT_MIN_PRICE = 3.0

# Share classes and non-operating vehicles that add rows without adding names.
SKIP_SUFFIXES = ("-W", "-U", "-R", ".WS", ".U", ".RT")


def candidate_tickers(limit=None, seed: int = 20260903, alphabetical: bool = False):
    """Every SEC-registered ticker, lightly cleaned and then SAMPLED.

    The first version sorted alphabetically and took ``out[:limit]``, so
    ``--limit 1500`` screened the front of the alphabet rather than the market.
    A real run produced a top fifteen of AUGO, AU, ARIS, ARGX, ATRC, APA, BRZE,
    BCH... every name beginning with A or B. That is not a universe, it is a
    filing cabinet drawer.

    The limit now takes a deterministic random sample, so a partial screen is a
    slice of the market rather than a slice of the alphabet. The seed is fixed
    so two runs of the same size cover the same names and can be compared.
    """
    universe = edgar.known_tickers()
    out = []
    for ticker, name in universe.items():
        if not ticker or not ticker.isascii():
            continue
        if any(ticker.endswith(sfx) for sfx in SKIP_SUFFIXES):
            continue
        if len(ticker) > 5:
            continue
        out.append({"ticker": ticker, "name": name})
    out.sort(key=lambda r: r["ticker"])
    if not limit or limit >= len(out):
        return out
    if alphabetical:
        return out[:limit]

    import random
    sample = random.Random(seed).sample(out, limit)
    sample.sort(key=lambda r: r["ticker"])
    return sample


def liquidity(df):
    """Median daily dollar volume over the last quarter."""
    if df is None or len(df) < 60:
        return None
    tail = df.tail(63)
    dv = (tail["close"] * tail["volume"]).dropna()
    if dv.empty:
        return None
    return float(dv.median())


def score_ticker(ticker, as_of=None, min_dollar_volume=DEFAULT_MIN_DOLLAR_VOLUME,
                 min_price=DEFAULT_MIN_PRICE):
    """Score one name. Returns (row, status, note).

    status is 'ok', 'illiquid', or 'no_data' — a screen over thousands of names
    hits every kind of missing data, and the run must survive all of it.
    """
    as_of = as_of or date.today()

    try:
        df, _meta = prices.daily(ticker)
    except Exception as exc:
        return None, "no_data", f"price: {str(exc)[:80]}"

    if len(df) < MIN_HISTORY_DAYS:
        return None, "no_data", f"only {len(df)} days of history"

    price = float(df.close.iloc[-1])
    if price < min_price:
        return None, "illiquid", f"price {price:.2f} below {min_price}"

    dv = liquidity(df)
    if dv is None or dv < min_dollar_volume:
        return None, "illiquid", (f"median daily turnover "
                                  f"{(dv or 0) / 1e6:.2f}M below "
                                  f"{min_dollar_volume / 1e6:.1f}M")

    profile, facts, fil = {}, None, None
    try:
        profile = edgar.company_profile(ticker)
    except Exception:
        pass
    try:
        facts = edgar.load(ticker)
        fil = filings_mod.analyse(facts, as_of)
    except Exception:
        pass

    # 8-K red flags: auditor change, restatement, impairment, delisting notice,
    # bankruptcy, accelerated debt. One extra SEC request per liquid name. These
    # are facts, not forecasts, which makes them the most useful whole-market
    # filter this engine has.
    red_flags = []
    try:
        ev = events_mod.classify(edgar.recent_filings(ticker), as_of)
        red_flags = [f"{f['label']} ({f['filed']})" for f in ev.get("red_flags", [])]
    except Exception:
        red_flags = None   # unknown, not clean

    t = technical(df)
    mf = money_flow(df)
    val_score, val_inputs = (valuation_pit(facts, as_of, price)
                             if facts is not None else (None, {}))
    merged = merge_fundamentals({"quality": None, "growth": None}, fil)

    parts = {
        "market": None, "sector": None,
        "fundamentals": merged["fundamentals"],
        "growth": merged["growth"],
        "valuation": val_score,
        "technical": t.get("technical"),
        "money_flow": mf.get("money_flow"),
        "news": None,
    }
    ev = evaluate(parts)
    if ev["opportunity_score"] is None:
        return None, "no_data", "no scorable components"

    # Same expected-value gate as the single-stock analysis, so the screen and
    # the stock page never disagree on whether something is a buy.
    _, diag = scenarios_mod.build(ev["opportunity_score"], t.get("vol_annualised"), 63)
    rr = diag.get("reward_to_risk") if isinstance(diag, dict) else None
    action, _ = choose_action(ev["opportunity_score"], ev["confidence"],
                              ev["coverage"], rr, parts)

    return ({
        "ticker": ticker,
        "name": profile.get("name"),
        "sector": profile.get("sector"),
        "price": round(price, 4),
        "dollar_volume": round(dv, 0),
        "score": ev["opportunity_score"],
        "coverage": ev["coverage"],
        "confidence": ev["confidence"],
        "valuation": val_score,
        "fundamentals": merged["fundamentals"],
        "growth": merged["growth"],
        "technical": t.get("technical"),
        "money_flow": mf.get("money_flow"),
        "red_flags": red_flags,
        "detail": {
            "action": action,
            "sic": profile.get("sic_description"),
            "filing_lag_days": (fil or {}).get("filing_lag_days"),
            "vol_annualised": t.get("vol_annualised"),
            "pct_of_52w_range": t.get("pct_of_52w_range"),
            "valuation_inputs": val_inputs,
        },
    }, "ok", None)


def throttle(seconds=0.12):
    """SEC asks for roughly ten requests a second at most. Be a good citizen."""
    time.sleep(seconds)


ENGINE_VERSION = VERSION

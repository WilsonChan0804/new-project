"""Feature engines.

Design rules, all of which v1.4 broke somewhere:

* Every function returns ``None`` for a score it cannot compute. A neutral 50
  is a claim about the world; absence is not.
* Scores are volatility-normalised, not scaled by hand-picked constants. A 6%
  move means something different for a utility than for a small-cap biotech,
  so raw percentage thresholds saturate on some names and never fire on
  others.
* Squashing uses ``tanh``, so extreme inputs compress instead of clipping a
  whole cohort of stocks to exactly 100.
"""
import math

import numpy as np
import pandas as pd

TRADING_DAYS = 252


def squash(z: float, k: float = 1.0) -> float:
    """Map an unbounded z-score to 0-100, centred on 50, never saturating."""
    return float(50.0 + 50.0 * math.tanh(k * z))


def daily_vol(close: pd.Series, window: int = 60):
    """Annualised realised volatility. None if not enough history."""
    rets = close.pct_change().dropna()
    if len(rets) < 20:
        return None
    w = rets.tail(window)
    sd = float(w.std())
    if not np.isfinite(sd) or sd <= 0:
        return None
    return sd


def atr(df: pd.DataFrame, window: int = 14):
    """Average true range, used for invalidation levels."""
    if len(df) < window + 1:
        return None
    h, l, c = df.high, df.low, df.close
    prev = c.shift(1)
    tr = pd.concat([h - l, (h - prev).abs(), (l - prev).abs()], axis=1).max(axis=1)
    v = float(tr.tail(window).mean())
    return v if np.isfinite(v) and v > 0 else None


# --------------------------------------------------------------------------
# Technical
# --------------------------------------------------------------------------

def _trend_score(close: pd.Series, sd: float, window: int):
    """How far price sits above/below its own moving average, in sigmas."""
    if len(close) < window + 1 or sd is None:
        return None
    ma = float(close.rolling(window).mean().iloc[-1])
    last = float(close.iloc[-1])
    if not (np.isfinite(ma) and np.isfinite(last)) or ma <= 0:
        return None
    gap = last / ma - 1.0
    # Expected dispersion of price around an N-day mean.
    expected = sd * math.sqrt(window) * 0.5
    if expected <= 0:
        return None
    return squash(gap / expected, k=0.9)


def _momentum_score(close: pd.Series, sd: float, window: int):
    """Return over a window, expressed in sigmas of that same window."""
    if len(close) < window + 1 or sd is None:
        return None
    now, then = float(close.iloc[-1]), float(close.iloc[-(window + 1)])
    # Degenerate or non-finite prices produce a meaningless ratio; say nothing
    # rather than crash or emit a fabricated number.
    if not (np.isfinite(now) and np.isfinite(then)) or then <= 0:
        return None
    r = now / then - 1.0
    expected = sd * math.sqrt(window)
    if expected <= 0:
        return None
    return squash(r / expected, k=0.7)


def technical(df: pd.DataFrame):
    """Multi-horizon technical picture.

    Returns per-horizon sub-scores so the engine can say 'long-term
    constructive, short-term stretched' instead of blending them into one
    number that hides the disagreement.
    """
    out = {
        "status": "unavailable",
        "technical": None,
        "horizons": {},
        "vol_annualised": None,
        "vol_percentile": None,
        "pct_of_52w_range": None,
        "observations": int(len(df)),
    }
    if len(df) < 40:
        return out

    close = df.close
    sd = daily_vol(close)
    if sd is None:
        return out

    out["vol_annualised"] = round(sd * math.sqrt(TRADING_DAYS), 4)

    # Where does current vol sit against this stock's own history?
    roll = close.pct_change().rolling(60).std().dropna()
    if len(roll) >= 120:
        out["vol_percentile"] = round(
            100.0 * float((roll.tail(TRADING_DAYS) < roll.iloc[-1]).mean()), 1
        )

    if len(close) >= TRADING_DAYS:
        w = close.tail(TRADING_DAYS)
        lo, hi = float(w.min()), float(w.max())
        if hi > lo:
            out["pct_of_52w_range"] = round(
                100.0 * (float(close.iloc[-1]) - lo) / (hi - lo), 1
            )

    horizons = {"short": 21, "medium": 63, "long": 200}
    blended = []
    for name, win in horizons.items():
        t = _trend_score(close, sd, win)
        m = _momentum_score(close, sd, win)
        parts = [x for x in (t, m) if x is not None]
        h = round(sum(parts) / len(parts), 2) if parts else None
        out["horizons"][name] = {
            "lookback_days": win,
            "trend": round(t, 2) if t is not None else None,
            "momentum": round(m, 2) if m is not None else None,
            "score": h,
        }
        if h is not None:
            blended.append(h)

    if not blended:
        return out

    # Volume confirmation: today's volume vs its own 20-day mean, log-scaled.
    vol_score = None
    if "volume" in df and df.volume.tail(21).notna().all() and len(df) >= 21:
        mean_v = float(df.volume.rolling(20).mean().iloc[-1])
        if mean_v > 0:
            ratio = float(df.volume.iloc[-1]) / mean_v
            vol_score = squash(math.log(max(ratio, 0.05)), k=0.8)
            out["relative_volume"] = round(ratio, 2)

    # Long horizon dominates; short horizon is a timing overlay, not a thesis.
    weights = {"long": 0.45, "medium": 0.35, "short": 0.20}
    num = den = 0.0
    for name, w in weights.items():
        h = out["horizons"][name]["score"]
        if h is not None:
            num += w * h
            den += w
    core = num / den

    if vol_score is not None:
        core = 0.85 * core + 0.15 * vol_score
        out["volume_confirmation"] = round(vol_score, 2)

    out["technical"] = round(core, 2)
    out["status"] = "available"
    return out


# --------------------------------------------------------------------------
# Money flow
# --------------------------------------------------------------------------

def money_flow(df: pd.DataFrame, window: int = 21):
    """Chaikin Money Flow.

    v1.4 used sign(close.diff()) * volume and divided by the previous
    period's sum -- which blows up whenever the prior period happened to net
    out near zero, pinning the score at 0 or 100 on noise. CMF is bounded in
    [-1, 1] by construction and uses where the close sits inside each day's
    range, which is the actual accumulation/distribution idea.
    """
    out = {"status": "unavailable", "money_flow": None, "cmf": None}
    if len(df) < window + 1:
        return out
    if not {"high", "low", "volume"}.issubset(df.columns):
        return out

    d = df.tail(window)
    rng = (d.high - d.low).replace(0, np.nan)
    mult = ((d.close - d.low) - (d.high - d.close)) / rng
    mfv = (mult * d.volume).dropna()
    vol_sum = float(d.volume.loc[mfv.index].sum())

    if len(mfv) < window * 0.6 or vol_sum <= 0:
        return out

    cmf = float(mfv.sum() / vol_sum)
    if not np.isfinite(cmf):
        return out

    out["cmf"] = round(cmf, 4)
    # CMF beyond +/-0.20 is generally considered a strong reading.
    out["money_flow"] = round(squash(cmf / 0.20, k=0.8), 2)
    out["status"] = "available"
    return out


# --------------------------------------------------------------------------
# Fundamentals
# --------------------------------------------------------------------------

def _num(overview: dict, key: str):
    """Parse an Alpha Vantage OVERVIEW field.

    AV returns the literal string 'None' (and '-') for missing fields. v1.4
    coerced all of those to 0.0, which is why a company with no P/E scored
    *better* on valuation than a reasonably priced one.
    """
    raw = overview.get(key)
    if raw in (None, "", "None", "-", "NaN"):
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return v if np.isfinite(v) else None


def fundamentals(overview: dict):
    """Growth / quality / valuation, each None when unsupported by data."""
    out = {
        "status": "unavailable",
        "growth": None,
        "quality": None,
        "valuation": None,
        "fundamentals": None,
        "inputs_used": {},
        "notes": [],
    }
    if not overview or not overview.get("Symbol"):
        return out

    used = out["inputs_used"]

    # --- growth ------------------------------------------------------------
    rg = _num(overview, "QuarterlyRevenueGrowthYOY")
    eg = _num(overview, "QuarterlyEarningsGrowthYOY")
    growth_parts = []
    if rg is not None:
        used["QuarterlyRevenueGrowthYOY"] = rg
        growth_parts.append(squash(rg / 0.15, k=0.8))
    if eg is not None:
        used["QuarterlyEarningsGrowthYOY"] = eg
        growth_parts.append(squash(eg / 0.25, k=0.8))
    if growth_parts:
        out["growth"] = round(sum(growth_parts) / len(growth_parts), 2)

    # --- quality -----------------------------------------------------------
    # Note: OVERVIEW does not reliably return DebtToEquity, so v1.4's
    # `- 2 * debt` term either never fired (field absent -> 0) or annihilated
    # the score (field present as a percentage). Leverage is dropped here
    # rather than faked; add it from a real balance-sheet source if you want it.
    pm = _num(overview, "ProfitMargin")
    om = _num(overview, "OperatingMarginTTM")
    roe = _num(overview, "ReturnOnEquityTTM")
    roa = _num(overview, "ReturnOnAssetsTTM")
    q_parts = []
    for key, val, scale in (
        ("ProfitMargin", pm, 0.12),
        ("OperatingMarginTTM", om, 0.15),
        ("ReturnOnEquityTTM", roe, 0.20),
        ("ReturnOnAssetsTTM", roa, 0.08),
    ):
        if val is not None:
            used[key] = val
            q_parts.append(squash(val / scale, k=0.7))
    if q_parts:
        out["quality"] = round(sum(q_parts) / len(q_parts), 2)
    else:
        out["notes"].append("No profitability data returned; quality not scored.")

    # --- valuation ---------------------------------------------------------
    pe = _num(overview, "TrailingPE") or _num(overview, "PERatio")
    fpe = _num(overview, "ForwardPE")
    peg = _num(overview, "PEGRatio")
    ev_ebitda = _num(overview, "EVToEBITDA")
    pb = _num(overview, "PriceToBookRatio")

    v_parts = []
    if pe is not None:
        used["TrailingPE"] = pe
        if pe <= 0:
            # Negative P/E means no earnings. That is information, not a gap.
            v_parts.append(20.0)
            out["notes"].append("Negative or zero trailing P/E (no earnings).")
        else:
            v_parts.append(squash((20.0 - pe) / 15.0, k=0.7))
    if fpe is not None and fpe > 0:
        used["ForwardPE"] = fpe
        v_parts.append(squash((18.0 - fpe) / 12.0, k=0.7))
    if peg is not None and peg > 0:
        used["PEGRatio"] = peg
        v_parts.append(squash((1.5 - peg) / 1.0, k=0.7))
    if ev_ebitda is not None and ev_ebitda > 0:
        used["EVToEBITDA"] = ev_ebitda
        v_parts.append(squash((14.0 - ev_ebitda) / 8.0, k=0.7))
    if pb is not None and pb > 0:
        used["PriceToBookRatio"] = pb
        v_parts.append(squash((4.0 - pb) / 4.0, k=0.6))

    if v_parts:
        out["valuation"] = round(sum(v_parts) / len(v_parts), 2)
    else:
        out["notes"].append(
            "No usable valuation multiples returned; valuation not scored "
            "(v1.4 would have reported 75/100 here)."
        )

    core = [x for x in (out["growth"], out["quality"]) if x is not None]
    if core:
        out["fundamentals"] = round(sum(core) / len(core), 2)

    if any(v is not None for v in (out["growth"], out["quality"], out["valuation"])):
        out["status"] = "available"

    out["beta"] = _num(overview, "Beta")
    out["sector"] = overview.get("Sector") or None
    out["name"] = overview.get("Name") or None
    return out


def merge_fundamentals(av: dict, filings: dict | None):
    """Blend Alpha Vantage profitability with filing-based measures.

    The blueprint wanted business quality to be growth + profitability + cash
    flow + balance sheet + earnings quality. v1.7 had the first two. The rest
    come from SEC filings, which are also point-in-time, so the growth figure
    from filings is preferred over the snapshot one when both exist.

    Sub-scores that are absent are excluded and the weights renormalise --
    the same rule the top-level composite uses.
    """
    weights = {
        "profitability": 0.30,
        "cash_flow": 0.25,
        "balance_sheet": 0.25,
        "earnings_quality": 0.20,
    }
    subs = {
        "profitability": av.get("quality"),
        "cash_flow": (filings or {}).get("cash_flow"),
        "balance_sheet": (filings or {}).get("balance_sheet"),
        "earnings_quality": (filings or {}).get("earnings_quality"),
    }

    num = den = 0.0
    for key, w in weights.items():
        if subs[key] is None:
            continue
        num += w * subs[key]
        den += w

    composite = round(num / den, 2) if den > 0 else None

    # Filing-based growth is point-in-time; prefer it when available.
    filing_growth = (filings or {}).get("growth")
    growth = filing_growth if filing_growth is not None else av.get("growth")

    return {
        "fundamentals": composite,
        "growth": growth,
        "growth_source": "sec_filings" if filing_growth is not None else "alpha_vantage",
        "sub_scores": subs,
        "sub_coverage": round(den / sum(weights.values()), 3),
        "sub_weights_used": {
            k: round(w / den, 3) for k, w in weights.items() if subs[k] is not None
        } if den > 0 else {},
    }

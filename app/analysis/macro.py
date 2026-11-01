"""Macro regime from FRED — roadmap item #10.

Until now "market regime" meant "is SPY above its moving average", which is a
price signal wearing a macro label. This adds the actual conditions: rates,
the yield curve, inflation, credit spreads, volatility and the dollar.

Needs a free FRED API key in ``FRED_API_KEY``. Without one the whole layer
reports ``unavailable`` and the market score falls back to price regime alone —
it never invents a number to fill the gap.

Series were chosen so that each says something the others do not, and so that
each has a well-understood risk direction. Credit spreads in particular tend to
move before equity prices do.
"""
import math
from datetime import date, timedelta

import numpy as np
import requests

from ..config import settings
from ..storage import cache

BASE = "https://api.stlouisfed.org/fred/series/observations"

SERIES = {
    "ten_year": ("DGS10", "10-year Treasury yield"),
    "curve": ("T10Y2Y", "10-year minus 2-year spread"),
    "inflation": ("CPIAUCSL", "Consumer price index"),
    "credit_spread": ("BAMLH0A0HYM2", "High-yield credit spread"),
    "volatility": ("VIXCLS", "VIX"),
    "dollar": ("DTWEXBGS", "Trade-weighted dollar"),
    "unemployment": ("UNRATE", "Unemployment rate"),
}


class FredError(RuntimeError):
    pass


def observations(series_id: str, years: int = 5):
    """Recent observations as a list of (date, value), missing values dropped."""
    if not settings.fred_api_key:
        raise FredError("FRED_API_KEY is not configured")

    start = (date.today() - timedelta(days=365 * years)).isoformat()
    key = f"fred:{series_id}:{start}"
    data = cache.get(key, settings.cache_ttl_macro_hours)
    if data is None:
        r = requests.get(
            BASE,
            params={
                "series_id": series_id, "api_key": settings.fred_api_key,
                "file_type": "json", "observation_start": start,
            },
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        if "error_message" in data:
            raise FredError(data["error_message"])
        cache.put(key, data)

    out = []
    for row in data.get("observations", []):
        if row.get("value") in (None, ".", ""):
            continue
        try:
            out.append((row["date"], float(row["value"])))
        except ValueError:
            continue
    if not out:
        raise FredError(f"No usable observations for {series_id}")
    return out


def _percentile(values, current):
    arr = np.asarray(values, dtype=float)
    return float(100.0 * (arr < current).mean())


def _change(values, lookback: int):
    if len(values) <= lookback:
        return None
    return values[-1] - values[-1 - lookback]


def _score(z, k=0.7):
    return float(50.0 + 50.0 * math.tanh(k * z))


def regime():
    """Risk-on / risk-off reading from macro conditions.

    Every sub-score is oriented the same way: higher means more supportive of
    owning equities.
    """
    out = {"status": "unavailable", "risk_on_score": None, "components": {},
           "notes": [], "errors": {}}

    if not settings.fred_api_key:
        out["notes"].append(
            "No FRED key configured, so macro conditions are not part of the "
            "result. Get a free key at fred.stlouisfed.org and set FRED_API_KEY."
        )
        return out

    data = {}
    for name, (sid, label) in SERIES.items():
        try:
            obs = observations(sid)
            data[name] = {"values": [v for _, v in obs], "last": obs[-1][1],
                          "last_date": obs[-1][0], "label": label}
        except Exception as exc:
            out["errors"][name] = str(exc)

    comps = {}

    # Yield curve: inversion has historically preceded slowdowns.
    if "curve" in data:
        level = data["curve"]["last"]
        comps["yield_curve"] = {
            "value": round(level, 2),
            "score": round(_score(level / 1.0), 2),
            "reads": "inverted — historically a slowdown signal" if level < 0
                     else "normal upward slope",
        }

    # Credit spreads: widening is the cleanest early risk-off tell.
    if "credit_spread" in data:
        vals = data["credit_spread"]["values"]
        level, chg = vals[-1], _change(vals, 60)
        pct = _percentile(vals, level)
        s = 0.6 * _score((6.0 - level) / 2.5) + 0.4 * _score(-(chg or 0) / 0.7)
        comps["credit"] = {
            "value": round(level, 2), "percentile": round(pct, 1),
            "change_60d": round(chg, 2) if chg is not None else None,
            "score": round(s, 2),
            "reads": "spreads widening — lenders pricing more risk" if (chg or 0) > 0.4
                     else "credit conditions calm",
        }

    # Volatility: high VIX means larger swings, not necessarily lower returns.
    if "volatility" in data:
        vals = data["volatility"]["values"]
        level = vals[-1]
        comps["volatility"] = {
            "value": round(level, 2),
            "percentile": round(_percentile(vals, level), 1),
            "score": round(_score((20.0 - level) / 8.0), 2),
            "reads": "elevated — expect larger daily swings" if level > 25
                     else "subdued",
        }

    # Rates: the level matters less than the direction of travel.
    if "ten_year" in data:
        vals = data["ten_year"]["values"]
        chg = _change(vals, 60)
        comps["rates"] = {
            "value": round(vals[-1], 2),
            "change_60d": round(chg, 2) if chg is not None else None,
            "score": round(_score(-(chg or 0) / 0.5), 2),
            "reads": "yields rising — a headwind for expensive shares"
                     if (chg or 0) > 0.3 else "yields stable or falling",
        }

    # Inflation trend, year over year.
    if "inflation" in data:
        vals = data["inflation"]["values"]
        if len(vals) >= 13:
            yoy = vals[-1] / vals[-13] - 1.0
            comps["inflation"] = {
                "value": round(100 * yoy, 2),
                "score": round(_score((0.03 - yoy) / 0.02), 2),
                "reads": "above the 2% target" if yoy > 0.025 else "contained",
            }

    # Dollar strength: a strong dollar squeezes US multinationals' earnings and
    # also cuts a sterling investor's returns when converting back.
    if "dollar" in data:
        vals = data["dollar"]["values"]
        chg = _change(vals, 60)
        pct_chg = (chg / vals[-1 - 60]) if chg is not None and len(vals) > 60 else None
        comps["dollar"] = {
            "value": round(vals[-1], 2),
            "change_60d_pct": round(100 * pct_chg, 2) if pct_chg is not None else None,
            "score": round(_score(-(pct_chg or 0) / 0.03), 2),
            "reads": "dollar strengthening" if (pct_chg or 0) > 0.02
                     else "dollar stable or weakening",
        }

    if not comps:
        out["notes"].append("FRED reachable but no series returned usable data.")
        return out

    # Credit and the curve get more weight; they lead, the others describe.
    weights = {"credit": 0.28, "yield_curve": 0.22, "volatility": 0.18,
               "rates": 0.14, "inflation": 0.10, "dollar": 0.08}
    num = den = 0.0
    for name, block in comps.items():
        w = weights.get(name, 0.1)
        num += w * block["score"]
        den += w

    out.update({
        "status": "available",
        "risk_on_score": round(num / den, 2),
        "coverage": round(den / sum(weights.values()), 3),
        "components": comps,
    })
    if out["errors"]:
        out["notes"].append(
            f"{len(out['errors'])} macro series unavailable; the rest were still used."
        )
    return out

"""EODHD — the survivorship fix, if you subscribe.

This is the only paid provider the engine supports, and it is here for exactly
one reason: **historical index membership plus price history for delisted
companies.** Every backtest so far has run on a universe chosen in 2026 from
companies that still exist in 2026, and that flatters everything.

## What is actually needed, and what is not

| Gap | Needed? | Why |
|---|---|---|
| S&P 500 historical constituents | **Yes** | The whole point. Reconstructs the index as it stood on a past date. |
| EOD prices for delisted tickers | **Yes** | A constituent list is useless without prices for the names that vanished. |
| Fundamentals | No | SEC EDGAR already provides these, point-in-time and free. Do not pay twice. |
| News archive | No | The news component has never measured anything. Paying for an unvalidated input is backwards. |

Run `python scripts/check_eodhd.py` with a free key before subscribing — it
probes each endpoint and reports which of the gaps above your key actually
unlocks. That is a better answer than any pricing page, because it tests the
thing you will use.

Nothing here is required. Without a key the engine behaves exactly as before
and says so.
"""
import time
from datetime import date, datetime

import pandas as pd
import requests

from ..config import settings
from ..storage import cache

BASE = "https://eodhd.com/api"
SP500 = "GSPC.INDX"


class EodhdError(RuntimeError):
    pass


class EodhdNotSubscribed(EodhdError):
    """The key works but the plan does not cover this endpoint."""


class EodhdClient:
    _last_call = 0.0

    def __init__(self, api_key=None):
        self.api_key = api_key or settings.eodhd_api_key

    def _get(self, path: str, ttl_hours: float, **params):
        if not self.api_key:
            raise EodhdError("EODHD_API_KEY is not configured")

        key = f"eodhd:{path}:" + ":".join(f"{k}={v}" for k, v in sorted(params.items()))
        hit = cache.get(key, ttl_hours)
        if hit is not None:
            return hit

        wait = 0.15 - (time.monotonic() - EodhdClient._last_call)
        if wait > 0:
            time.sleep(wait)

        r = requests.get(f"{BASE}/{path}",
                         params={"api_token": self.api_key, "fmt": "json", **params},
                         timeout=60)
        EodhdClient._last_call = time.monotonic()

        if r.status_code in (401, 403):
            raise EodhdNotSubscribed(
                f"HTTP {r.status_code} for {path} — the key is valid but this plan "
                "does not include this endpoint.")
        if r.status_code == 402:
            raise EodhdNotSubscribed(f"HTTP 402 for {path} — payment required.")
        if r.status_code == 429:
            raise EodhdError("Daily API call limit reached.")
        r.raise_for_status()

        try:
            data = r.json()
        except ValueError:
            raise EodhdError(f"Non-JSON response from {path}")
        cache.put(key, data)
        return data

    # -- survivorship-free universe ----------------------------------------

    def sp500_membership(self):
        """Every ticker that has been in the S&P 500, with join and leave dates.

        Returns [{ticker, name, start, end, is_active, is_delisted}, ...].
        ``end`` is None for current members. This is what makes a
        point-in-time universe possible.
        """
        data = self._get(f"fundamentals/{SP500}", 24 * 7,
                         filter="HistoricalTickerComponents")
        if not isinstance(data, dict) or not data:
            raise EodhdNotSubscribed(
                "No historical constituents returned. This dataset comes with the "
                "Fundamental Data API — the EOD-only plan does not include it.")

        out = []
        for row in data.values():
            if not isinstance(row, dict):
                continue
            code = row.get("Code")
            if not code:
                continue
            out.append({
                "ticker": code.upper(),
                "name": row.get("Name"),
                "start": _as_date(row.get("StartDate")),
                "end": _as_date(row.get("EndDate")),
                "is_active": bool(row.get("IsActiveNow")),
                "is_delisted": bool(row.get("IsDelisted")),
            })
        if not out:
            raise EodhdNotSubscribed("Constituent payload was empty.")
        return out

    def members_on(self, as_of: date, membership=None):
        """The index as it stood on a date — including names since delisted."""
        rows = membership if membership is not None else self.sp500_membership()
        return sorted(
            r["ticker"] for r in rows
            if (r["start"] is None or r["start"] <= as_of)
            and (r["end"] is None or r["end"] >= as_of)
        )

    # -- prices, including for companies that no longer exist ---------------

    def daily(self, ticker: str, start="2015-01-01"):
        suffix = ticker if "." in ticker else f"{ticker}.US"
        rows = self._get(f"eod/{suffix}", settings.cache_ttl_prices_hours,
                         from_=start, period="d")
        if not isinstance(rows, list) or not rows:
            raise EodhdError(f"No EOD data for {suffix}")

        df = pd.DataFrame(rows)
        if "adjusted_close" not in df.columns:
            raise EodhdError(f"EOD payload for {suffix} has no adjusted_close")

        # adjusted_close handles splits and dividends; scale the rest of the bar
        # by the same factor so intraday ranges stay internally consistent.
        df["date"] = pd.to_datetime(df["date"])
        for col in ("open", "high", "low", "close", "adjusted_close", "volume"):
            df[col] = pd.to_numeric(df.get(col), errors="coerce")
        factor = df["adjusted_close"] / df["close"]
        for col in ("open", "high", "low"):
            df[col] = df[col] * factor
        df["close"] = df["adjusted_close"]

        df = (df.dropna(subset=["close"])
                .sort_values("date")
                .reset_index(drop=True))
        return df[["date", "open", "high", "low", "close", "volume"]]


def _as_date(value):
    if not value or value in ("0000-00-00", "-"):
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _daily_for_prices(ticker: str, start: str = "2015-01-01"):
    """Adapter so EODHD can slot into the existing price source chain."""
    df = EodhdClient().daily(ticker, start=start.replace("-", "")[:4] + "-01-01"
                             if "-" not in start else start)
    return df, {"source": "eodhd", "adjusted": True, "currency": None}

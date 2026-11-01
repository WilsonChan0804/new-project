"""Price history with a source chain.

Stooq turned out to block some networks outright (it serves an HTML page
instead of CSV, which is what ``Stooq returned HTML (blocked?)`` means). One
free provider being unreachable should not leave the engine with 50% coverage
and nothing to say, so prices now come from a chain and the engine records
which link answered.

Order is configurable via ``PRICE_SOURCES``. Default:

    yahoo -> stooq -> alpha_vantage

* **yahoo** - the v8 chart endpoint. No key, full history, and it returns
  ``adjclose`` so splits and dividends are handled. This is the primary.
* **stooq** - kept as a backup with a plain browser User-Agent and a .pl host
  retry, since it works fine from some networks.
* **alpha_vantage** - last resort only. Its free daily series is *unadjusted*,
  so it is flagged ``adjusted: False`` and run through split detection.

Every source returns the same OHLCV frame plus a metadata dict, so the rest of
the engine does not care which one answered -- but ``data_quality`` tells you.
"""
import io

import numpy as np
import pandas as pd
import requests

from ..config import settings
from ..storage import cache

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

COLUMNS = ["date", "open", "high", "low", "close", "volume"]


class PriceError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Yahoo Finance (primary)
# ---------------------------------------------------------------------------

YAHOO_HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]


# Yahoo accepts these range tokens. Anything longer than the listing history
# simply returns the listing history, so asking for more is safe.
YAHOO_RANGES = ["1y", "2y", "5y", "10y", "max"]


def _yahoo_range_for(years: int | None) -> str:
    """Smallest Yahoo range token that covers the requested depth.

    v2.9's warehouse accepted `--years 15` and then silently discarded it,
    because this function did not exist and the range was hardcoded to "5y".
    Every ticker came back with exactly 1254 rows, which is five years — one
    market regime, when the whole point of the warehouse was to span several.
    """
    if years is None:
        return "5y"
    for token in YAHOO_RANGES:
        if token != "max" and int(token[:-1]) >= years:
            return token
    return "max"


def _yahoo(ticker: str, range_: str = "5y") -> tuple[pd.DataFrame, dict]:
    """Daily bars from Yahoo's v8 chart endpoint.

    Long spans use explicit epoch bounds rather than a range token. Asking for
    ``range=max`` returned 1962-2026 with only 231 bars — roughly 3.6 a year,
    neither daily nor monthly, because the endpoint quietly reduces granularity
    on very long ranges. ``period1``/``period2`` do not do that.
    """
    import time as _time

    last_err = None
    long_span = range_ == "max" or (
        range_.endswith("y") and range_[:-1].isdigit() and int(range_[:-1]) > 5)

    if long_span:
        years = 60 if range_ == "max" else int(range_[:-1])
        now = int(_time.time())
        params = {
            "period1": now - int(years * 365.25 * 86400),
            "period2": now,
            "interval": "1d",
            "events": "div,split",
        }
    else:
        params = {"range": range_, "interval": "1d", "events": "div,split"}

    for host in YAHOO_HOSTS:
        url = f"{host}/v8/finance/chart/{ticker.upper()}"
        try:
            r = requests.get(
                url,
                params=params,
                headers={"User-Agent": BROWSER_UA, "Accept": "application/json"},
                timeout=30,
            )
            if r.status_code != 200:
                last_err = f"HTTP {r.status_code}"
                continue
            payload = r.json()
        except Exception as exc:
            last_err = str(exc)
            continue

        chart = (payload or {}).get("chart") or {}
        if chart.get("error"):
            last_err = str(chart["error"])
            continue
        results = chart.get("result") or []
        if not results:
            last_err = "empty result"
            continue

        res = results[0]
        ts = res.get("timestamp") or []
        quote = ((res.get("indicators") or {}).get("quote") or [{}])[0]
        adj = ((res.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose")
        if not ts or not quote.get("close"):
            last_err = "no price series"
            continue

        df = pd.DataFrame({
            "date": pd.to_datetime(ts, unit="s", utc=True).tz_localize(None),
            "open": quote.get("open"),
            "high": quote.get("high"),
            "low": quote.get("low"),
            "close": quote.get("close"),
            "volume": quote.get("volume"),
        })
        if adj:
            # adjclose handles splits AND dividends. Scale the rest of the OHLC
            # bar by the same factor so intraday ranges stay internally
            # consistent -- money_flow uses high/low, so a raw high with an
            # adjusted close would corrupt it.
            df["adjclose"] = adj
            factor = df["adjclose"] / df["close"]
            for col in ("open", "high", "low"):
                df[col] = df[col] * factor
            df["close"] = df["adjclose"]
            df = df.drop(columns=["adjclose"])

        df = _clean(df)
        if df.empty:
            last_err = "unparseable series"
            continue

        # A daily series must actually be daily. Roughly 252 bars a year is the
        # expectation; anything under 150 means the endpoint downsampled, and
        # scoring indicators on quarterly bars labelled as daily would be worse
        # than having no data at all.
        span_years = (df.date.iloc[-1] - df.date.iloc[0]).days / 365.25
        if span_years > 1.5:
            per_year = len(df) / span_years
            if per_year < 150:
                last_err = (f"downsampled: {len(df)} bars over "
                            f"{span_years:.1f}y ({per_year:.0f}/yr, expected ~252)")
                continue

        meta = {
            "source": "yahoo",
            "adjusted": bool(adj),
            "currency": (res.get("meta") or {}).get("currency"),
            "exchange": (res.get("meta") or {}).get("exchangeName"),
        }
        return df, meta

    raise PriceError(f"Yahoo unavailable ({last_err})")


# ---------------------------------------------------------------------------
# Stooq (secondary)
# ---------------------------------------------------------------------------

STOOQ_HOSTS = ["https://stooq.com/q/d/l/", "https://stooq.pl/q/d/l/"]


def _stooq_symbol(ticker: str) -> str:
    t = ticker.lower().strip()
    return t if "." in t else f"{t}.us"


def _stooq(ticker: str, start: str = "20150101") -> tuple[pd.DataFrame, dict]:
    sym = _stooq_symbol(ticker)
    last_err = None
    for host in STOOQ_HOSTS:
        try:
            r = requests.get(
                host,
                params={"s": sym, "d1": start, "i": "d"},
                headers={"User-Agent": BROWSER_UA, "Accept": "text/csv,*/*"},
                timeout=30,
            )
        except Exception as exc:
            last_err = str(exc)
            continue

        body = r.text or ""
        low = body[:400].lower()
        if r.status_code != 200:
            last_err = f"HTTP {r.status_code}"
            continue
        if "<html" in low or "<!doctype" in low:
            last_err = "blocked (HTML response)"
            continue
        if "exceeded" in low:
            last_err = "rate limited"
            continue
        if "no data" in low or not body.strip():
            last_err = "no data"
            continue

        try:
            df = pd.read_csv(io.StringIO(body))
        except Exception as exc:
            last_err = f"unparseable CSV: {exc}"
            continue

        df = df.rename(columns={
            "Date": "date", "Open": "open", "High": "high",
            "Low": "low", "Close": "close", "Volume": "volume",
        })
        df = _clean(df)
        if df.empty:
            last_err = "empty after parse"
            continue
        return df, {"source": "stooq", "adjusted": True, "currency": None}

    raise PriceError(f"Stooq unavailable ({last_err})")


# ---------------------------------------------------------------------------
# Alpha Vantage (last resort - UNADJUSTED)
# ---------------------------------------------------------------------------

def _alpha_vantage(ticker: str) -> tuple[pd.DataFrame, dict]:
    from .alpha_vantage import AlphaVantageClient

    client = AlphaVantageClient()
    data, _cached = client._get(
        "TIME_SERIES_DAILY",
        settings.cache_ttl_prices_hours,
        symbol=ticker,
        outputsize="compact",   # 'full' became a premium feature; compact = 100 days
    )
    series = data.get("Time Series (Daily)") or {}
    if not series:
        raise PriceError("Alpha Vantage returned no daily series")

    rows = [{
        "date": pd.Timestamp(d),
        "open": float(v["1. open"]), "high": float(v["2. high"]),
        "low": float(v["3. low"]), "close": float(v["4. close"]),
        "volume": float(v["5. volume"]),
    } for d, v in series.items()]

    df = _clean(pd.DataFrame(rows))
    if df.empty:
        raise PriceError("Alpha Vantage series unparseable")
    return df, {
        "source": "alpha_vantage", "adjusted": False, "currency": None,
        "note": "Only 100 days available on the free tier, and unadjusted. "
                "Long-horizon trend scores will be missing or unreliable.",
    }


# ---------------------------------------------------------------------------

def _eodhd(ticker: str):
    """Optional paid source. Its value is delisted tickers, not live ones."""
    from .eodhd import _daily_for_prices
    return _daily_for_prices(ticker)


SOURCES = {"yahoo": _yahoo, "stooq": _stooq,
           "alpha_vantage": _alpha_vantage, "eodhd": _eodhd}


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty or "close" not in df.columns:
        return pd.DataFrame(columns=COLUMNS)
    for col in COLUMNS:
        if col not in df.columns:
            df[col] = np.nan
    # Normalise to midnight. Yahoo returns epoch seconds at market OPEN, so a
    # daily bar arrives stamped 2023-05-30 12:00:00 rather than 2023-05-30.
    # Two consequences, both bad:
    #   * `df.date <= Timestamp(as_of)` silently excluded the as-of day's own
    #     bar, so the replay quietly used the previous close;
    #   * any external tool matching on dates (Alphalens, a spreadsheet) found
    #     zero overlap between price dates and decision dates.
    # A daily bar is a date, not a moment, so it is stored as one.
    df["date"] = pd.to_datetime(df["date"]).dt.normalize()
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["close"])
    df = df[df["close"] > 0]
    # Some feeds omit intraday bars; fall back to close so range-based
    # indicators degrade rather than crash.
    for col in ("open", "high", "low"):
        df[col] = df[col].fillna(df["close"])
    df = df.sort_values("date").drop_duplicates("date").reset_index(drop=True)
    return df[COLUMNS]


def detect_split_artifacts(df: pd.DataFrame, threshold: float = 0.35):
    """Flag single-day moves large enough to be an unhandled corporate action.

    Only meaningful on unadjusted sources. A 4:1 split reads as a -75% day and
    will wreck every trend and volatility calculation downstream, so the engine
    needs to know rather than quietly score the wreckage.
    """
    if len(df) < 2:
        return []
    r = df.close.pct_change()
    hits = df.loc[r.abs() > threshold, "date"]
    return [str(d.date()) for d in hits]


def daily(ticker: str, sources: list[str] | None = None, use_warehouse=None,
          years: int | None = None):
    """Try the local warehouse, then each network source in order.

    The warehouse comes first because a backtest over thousands of names asks
    for the same series repeatedly, and going to the network each time caps the
    research at whatever one run can pull.
    """
    if use_warehouse is None:
        use_warehouse = settings.use_warehouse
    # A request for more history than the warehouse holds must go to the
    # network, otherwise a deeper download can never happen.
    if use_warehouse and years is None:
        try:
            from ..storage import warehouse
            if warehouse.has(ticker):
                df, meta = warehouse.load(ticker)
                if df is not None and len(df) >= 40:
                    meta = dict(meta or {})
                    meta.update({"rows": len(df), "from_cache": True,
                                 "attempts": {}, "source": meta.get("source", "warehouse"),
                                 "via": "warehouse"})
                    return df, meta
        except Exception:
            pass   # warehouse problems must never block a live request

    order = sources or [s.strip() for s in settings.price_sources.split(",") if s.strip()]
    attempts = {}

    for name in order:
        fn = SOURCES.get(name)
        if fn is None:
            attempts[name] = "unknown source"
            continue

        key = f"px:{name}:{ticker.upper()}:{years or 'default'}"
        cached = cache.get(key, settings.cache_ttl_prices_hours)
        if cached is not None:
            df = pd.read_json(io.StringIO(cached["frame"]), orient="split")
            df["date"] = pd.to_datetime(df["date"])
            meta = dict(cached["meta"])
            meta["from_cache"] = True
            meta["attempts"] = attempts
            return df, meta

        try:
            if name == "yahoo" and years is not None:
                df, meta = fn(ticker, _yahoo_range_for(years))
            else:
                df, meta = fn(ticker)
        except Exception as exc:
            attempts[name] = str(exc)
            continue

        if len(df) < 40:
            attempts[name] = f"only {len(df)} rows"
            continue

        meta["rows"] = int(len(df))
        meta["first"] = str(df.date.iloc[0].date())
        meta["last"] = str(df.date.iloc[-1].date())
        meta["from_cache"] = False
        meta["attempts"] = attempts

        if not meta.get("adjusted"):
            artifacts = detect_split_artifacts(df)
            meta["possible_split_artifacts"] = artifacts
            if artifacts:
                meta["warning"] = (
                    f"Unadjusted source with {len(artifacts)} suspicious single-day "
                    "moves. These are probably splits, not crashes. Trend and "
                    "volatility scores from this data are unreliable."
                )

        try:
            cache.put(key, {"frame": df.to_json(orient="split", date_format="iso"), "meta": meta})
        except Exception:
            pass
        return df, meta

    raise PriceError(f"All price sources failed for {ticker}: {attempts}")


def probe(ticker: str = "AAPL"):
    """Test every source independently. Use this to see what works from your network."""
    out = {}
    for name, fn in SOURCES.items():
        try:
            df, meta = fn(ticker)
            out[name] = {
                "ok": len(df) >= 40,
                "rows": int(len(df)),
                "first": str(df.date.iloc[0].date()) if len(df) else None,
                "last": str(df.date.iloc[-1].date()) if len(df) else None,
                "last_close": round(float(df.close.iloc[-1]), 4) if len(df) else None,
                "adjusted": meta.get("adjusted"),
                "error": None,
            }
        except Exception as exc:
            out[name] = {"ok": False, "rows": 0, "error": str(exc)}
    return out

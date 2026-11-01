"""Alpha Vantage: fundamentals + news only.

Price history has moved to Stooq (adjusted, no key, no daily budget), which
frees the whole free-tier request budget for OVERVIEW and NEWS_SENTIMENT.
With the TTL cache on top, a repeat /analyze of the same ticker costs zero
requests.
"""
import time

import requests

from ..config import settings
from ..storage import cache

BASE_URL = "https://www.alphavantage.co/query"


class AlphaVantageError(RuntimeError):
    pass


class AlphaVantageClient:
    _last_request = 0.0

    def __init__(self, api_key=None):
        self.api_key = api_key or settings.alpha_vantage_api_key

    def _get(self, function: str, ttl_hours: float, **params):
        key = f"av:{function}:" + ":".join(f"{k}={v}" for k, v in sorted(params.items()))
        hit = cache.get(key, ttl_hours)
        if hit is not None:
            return hit, True  # (payload, from_cache)

        if not self.api_key:
            raise AlphaVantageError("ALPHA_VANTAGE_API_KEY is not configured")

        wait = 1.05 - (time.monotonic() - AlphaVantageClient._last_request)
        if wait > 0:
            time.sleep(wait)

        r = requests.get(
            BASE_URL,
            params={"function": function, "apikey": self.api_key, **params},
            timeout=30,
        )
        AlphaVantageClient._last_request = time.monotonic()
        r.raise_for_status()
        data = r.json()

        for field, label in (
            ("Error Message", "error"),
            ("Note", "rate limit"),
            ("Information", "information"),
        ):
            if field in data:
                raise AlphaVantageError(f"Alpha Vantage {label}: {data[field]}")

        cache.put(key, data)
        return data, False

    def overview(self, ticker: str):
        return self._get("OVERVIEW", settings.cache_ttl_overview_hours, symbol=ticker)

    def news(self, ticker: str, limit: int = 50):
        return self._get(
            "NEWS_SENTIMENT",
            settings.cache_ttl_news_hours,
            tickers=ticker,
            sort="LATEST",
            limit=limit,
        )

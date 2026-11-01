"""Market and sector regime.

v1.4 bug fixed here: ``_score`` returned None only when the frame was
completely empty. With 1-29 rows it fell into ``technical()``'s hardcoded
all-50 branch, so a fabricated 50 was published as ``status: available``.
Now a regime is either genuinely computed or explicitly unavailable.
"""
from ..providers import prices
from .features import technical

MARKET_PROXIES = ["SPY", "QQQ"]

SECTOR_ETF = {
    "TECHNOLOGY": "XLK",
    "INFORMATION TECHNOLOGY": "XLK",
    "HEALTHCARE": "XLV",
    "HEALTH CARE": "XLV",
    "FINANCIALS": "XLF",
    "FINANCIAL SERVICES": "XLF",
    "ENERGY": "XLE",
    "CONSUMER CYCLICAL": "XLY",
    "CONSUMER DISCRETIONARY": "XLY",
    "CONSUMER DEFENSIVE": "XLP",
    "CONSUMER STAPLES": "XLP",
    "INDUSTRIALS": "XLI",
    "COMMUNICATION SERVICES": "XLC",
    "REAL ESTATE": "XLRE",
    "UTILITIES": "XLU",
    "MATERIALS": "XLB",
    "BASIC MATERIALS": "XLB",
}


def _regime(symbol):
    try:
        df, meta = prices.daily(symbol)
    except Exception as exc:
        return None, f"unavailable: {exc}"
    t = technical(df)
    if t["status"] != "available" or t["technical"] is None:
        return None, f"unavailable: insufficient history ({t['observations']} rows)"
    return t, meta.get("source", "unknown")


def get(sector: str | None):
    market_scores, sources = [], {}

    for sym in MARKET_PROXIES:
        t, src = _regime(sym)
        sources[sym] = src
        if t:
            market_scores.append(t["technical"])

    market = round(sum(market_scores) / len(market_scores), 2) if market_scores else None

    etf = SECTOR_ETF.get((sector or "").upper().strip())
    sector_score = None
    if etf:
        t, src = _regime(etf)
        sources[etf] = src
        if t:
            sector_score = t["technical"]
    else:
        sources["sector"] = f"unavailable: no ETF mapped for sector {sector!r}"

    return {
        "status": "available" if (market is not None or sector_score is not None) else "unavailable",
        "market_score": market,
        "sector_score": sector_score,
        "market_proxy": "/".join(MARKET_PROXIES),
        "sector_proxy": etf,
        "sources": sources,
    }

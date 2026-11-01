"""Preset universes for backtesting.

**Read this before trusting any result these produce.**

Every list below was written in 2026 from names that exist in 2026. That is
survivorship bias, and it is not a small effect: the companies that failed,
were acquired, or fell out of the index between 2021 and 2026 are silently
absent, and they are exactly the ones a scoring engine most needs to have
ranked correctly. A backtest on survivors will flatter almost any strategy,
because the universe itself already encodes the answer.

The lists are still worth having for one specific reason: **width**. Ranking
eight names per date cannot resolve an information coefficient of 0.03 — the
cross-sectional noise is an order of magnitude larger than the effect. Going
from 8 names to 60 shrinks the standard error of each date's IC by roughly
two and a half times, which is the difference between a measurement and a
coin flip.

So use these to get a readable signal-to-noise ratio, and treat the *level* of
any return figure as unreliable. Rank correlation is far less damaged by
survivorship than mean return is, which is another reason IC is the headline
metric rather than performance.

For a genuinely unbiased test you need historical index membership — the S&P
500 constituent list as it stood on each rebalance date. That data is not free.
Until you have it, read these results as "is there a signal here at all",
never as "this is what I would have earned".
"""

# ~60 large US names spread across every sector, so no single industry's run
# can drive the result the way NVDA drives an 8-stock tech-heavy list.
DIVERSIFIED_60 = {
    # Technology
    "AAPL": "TECHNOLOGY", "MSFT": "TECHNOLOGY", "NVDA": "TECHNOLOGY",
    "AVGO": "TECHNOLOGY", "ORCL": "TECHNOLOGY", "CRM": "TECHNOLOGY",
    "AMD": "TECHNOLOGY", "INTC": "TECHNOLOGY", "TXN": "TECHNOLOGY",
    "QCOM": "TECHNOLOGY", "IBM": "TECHNOLOGY", "ADBE": "TECHNOLOGY",
    # Communication services
    "GOOGL": "COMMUNICATION SERVICES", "META": "COMMUNICATION SERVICES",
    "NFLX": "COMMUNICATION SERVICES", "DIS": "COMMUNICATION SERVICES",
    "T": "COMMUNICATION SERVICES", "VZ": "COMMUNICATION SERVICES",
    # Consumer discretionary
    "AMZN": "CONSUMER CYCLICAL", "TSLA": "CONSUMER CYCLICAL",
    "HD": "CONSUMER CYCLICAL", "MCD": "CONSUMER CYCLICAL",
    "NKE": "CONSUMER CYCLICAL", "SBUX": "CONSUMER CYCLICAL",
    "LOW": "CONSUMER CYCLICAL",
    # Consumer staples
    "PG": "CONSUMER DEFENSIVE", "KO": "CONSUMER DEFENSIVE",
    "PEP": "CONSUMER DEFENSIVE", "WMT": "CONSUMER DEFENSIVE",
    "COST": "CONSUMER DEFENSIVE", "MDLZ": "CONSUMER DEFENSIVE",
    # Healthcare
    "JNJ": "HEALTHCARE", "UNH": "HEALTHCARE", "LLY": "HEALTHCARE",
    "ABBV": "HEALTHCARE", "MRK": "HEALTHCARE", "PFE": "HEALTHCARE",
    "TMO": "HEALTHCARE", "AMGN": "HEALTHCARE",
    # Financials
    "JPM": "FINANCIALS", "BAC": "FINANCIALS", "WFC": "FINANCIALS",
    "GS": "FINANCIALS", "MS": "FINANCIALS", "AXP": "FINANCIALS",
    "SCHW": "FINANCIALS",
    # Energy
    "XOM": "ENERGY", "CVX": "ENERGY", "COP": "ENERGY", "SLB": "ENERGY",
    # Industrials
    "CAT": "INDUSTRIALS", "HON": "INDUSTRIALS", "UNP": "INDUSTRIALS",
    "GE": "INDUSTRIALS", "RTX": "INDUSTRIALS", "DE": "INDUSTRIALS",
    # Defensives and rate-sensitives
    "NEE": "UTILITIES", "DUK": "UTILITIES", "SO": "UTILITIES",
    "LIN": "MATERIALS", "SHW": "MATERIALS",
    "AMT": "REAL ESTATE", "PLD": "REAL ESTATE",
}

# Small starter set. Fast to run, but too narrow to conclude anything from.
STARTER_10 = {
    "AAPL": "TECHNOLOGY", "MSFT": "TECHNOLOGY", "GOOGL": "COMMUNICATION SERVICES",
    "JNJ": "HEALTHCARE", "UNH": "HEALTHCARE", "JPM": "FINANCIALS",
    "XOM": "ENERGY", "PG": "CONSUMER DEFENSIVE", "CAT": "INDUSTRIALS",
    "NEE": "UTILITIES",
}

PRESETS = {"diversified_60": DIVERSIFIED_60, "starter_10": STARTER_10}

SURVIVORSHIP_WARNING = (
    "Survivorship bias: universe chosen in 2026 from companies that still exist in 2026. Firms that "
    "failed, were acquired, or dropped out of the index are absent, which flatters "
    "returns. Read the information coefficient, not the return figures. A clean "
    "test needs historical index membership, which is not free."
)


def get(name: str):
    if name not in PRESETS:
        raise KeyError(f"Unknown universe {name!r}. Options: {list(PRESETS)}")
    return dict(PRESETS[name])


def adequacy(n_names: int, n_dates: int):
    """Is this sample wide enough to measure a realistic effect?

    Cross-sectional IC has a standard error of roughly 1/sqrt(n-3) per date.
    With 8 names that is about 0.45 — twenty times a realistic signal of 0.03.
    Averaging over dates helps, but it cannot rescue a universe that narrow.
    """
    import math

    per_date_se = 1.0 / math.sqrt(max(n_names - 3, 1))
    overall_se = per_date_se / math.sqrt(max(n_dates, 1))
    detectable = round(2 * overall_se, 4)

    if n_names < 15:
        verdict = (
            f"{n_names} names per date is too narrow. The smallest effect you could "
            f"distinguish from zero here is about {detectable:.3f}, and real equity "
            "signals live around 0.02-0.05. Any result — positive or negative — is "
            "noise. Use the diversified_60 universe."
        )
    elif detectable > 0.05:
        verdict = (
            f"Detectable floor is about {detectable:.3f}, which is at the top of the "
            "range real signals occupy. A null result here does not rule out a "
            "modest edge. Add names or extend the period."
        )
    else:
        verdict = (
            f"Wide enough to detect an effect down to about {detectable:.3f}, which "
            "covers the range real equity signals occupy. A null result here is "
            "meaningful."
        )

    return {
        "names_per_date": n_names,
        "n_dates": n_dates,
        "smallest_detectable_ic": detectable,
        "adequate": bool(n_names >= 15 and detectable <= 0.05),
        "verdict": verdict,
    }

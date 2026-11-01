"""The last remaining limit: data you cannot get for free.

Everything else in this engine has been built and measured. What is left is not
a coding problem — it is a data problem, and no amount of further engineering
will move it.

## What free data cannot give you

**Survivorship-free universes.** Every preset here was written in 2026 from
companies that exist in 2026. The firms that failed, were acquired, or dropped
out of the index between 2021 and 2026 are silently absent, and they are
precisely the ones a scoring engine most needs to have ranked correctly. This
inflates returns and — more subtly — hides whatever the engine would have said
about the losers.

**Historical index membership.** To test honestly you need the S&P 500
constituent list *as it stood on each rebalance date*, not as it stands today.

**Point-in-time analyst estimates.** Earnings revisions were in the original
blueprint (#12) and remain unbuilt, because knowing what analysts expected on a
past date requires a paid archive.

**Historical news.** Blueprint items #6-#9 — event clustering, source
weighting, and the news-to-price reaction model — need an article archive with
timestamps. No free tier serves one.

**Macro vintages.** FRED gives revised data; the CPI print for March 2024 as it
reads today is not the number published in April 2024. ALFRED has vintages and
is free, so this one is a coding task rather than a purchase.

## How to judge whether it is worth paying

Only pay once the free-data result justifies it. The engine currently measures
an IC indistinguishable from zero on a survivor-only universe. Buying cleaner
data would most likely make that result *worse*, not better, because
survivorship flatters. That is a reason to buy — you would be replacing a
flattering test with an honest one — but it is not a reason to expect good news.

The honest sequence: exhaust ALFRED (free), then buy one dataset, re-run, and
see whether the answer changes. Do not buy four at once.
"""

PROVIDERS = [
    {
        "name": "Norgate Data",
        "solves": ["survivorship-free universes", "historical index membership",
                   "delisted tickers"],
        "tier": "low monthly subscription",
        "why": (
            "Purpose-built for exactly this problem: US equities including delisted "
            "companies, with index constituents as they stood on each historical "
            "date. If you buy one thing, this is the one that fixes the caveat that "
            "has been attached to every backtest so far."
        ),
        "research": "norgatedata.com",
    },
    {
        "name": "Sharadar Core US Equities (via Nasdaq Data Link)",
        "solves": ["point-in-time fundamentals", "survivorship-free tickers",
                   "as-reported vs restated figures"],
        "tier": "low-to-mid monthly subscription",
        "why": (
            "Widely used by individual quantitative investors. Fundamentals are "
            "dated by when they were reported, which is what the EDGAR layer here "
            "already does — so this is more a convenience and coverage upgrade than "
            "a capability you lack."
        ),
        "research": "data.nasdaq.com — search Sharadar",
    },
    {
        "name": "EOD Historical Data (EODHD)",
        "solves": ["historical index constituents", "fundamentals",
                   "news archive", "delisted tickers"],
        "tier": "low-to-mid monthly subscription",
        "why": (
            "Broad coverage at a modest price, and one of the few affordable "
            "sources with both historical index membership and a news archive. "
            "Good value if you want to attack several gaps with one subscription."
        ),
        "research": "eodhd.com",
    },
    {
        "name": "Polygon.io",
        "solves": ["delisted tickers", "corporate actions", "news archive",
                   "tick and minute history"],
        "tier": "free tier available; paid tiers for history depth",
        "why": (
            "Strong on market data and corporate actions. Less strong on "
            "fundamentals. Worth a look if you later want intraday or a cleaner "
            "corporate-actions feed."
        ),
        "research": "polygon.io",
    },
    {
        "name": "Financial Modeling Prep",
        "solves": ["historical S&P 500 constituents", "fundamentals",
                   "analyst estimates"],
        "tier": "low monthly subscription",
        "why": (
            "Has a historical index constituent endpoint, which is the specific "
            "thing missing here. Data quality reviews are mixed, so validate a few "
            "known figures against EDGAR before relying on it."
        ),
        "research": "financialmodelingprep.com",
    },
    {
        "name": "CRSP / Compustat (via WRDS)",
        "solves": ["the academic gold standard for survivorship-free history",
                   "point-in-time fundamentals"],
        "tier": "institutional or university access",
        "why": (
            "What published research uses. Not realistically purchasable by an "
            "individual, but if you have any university affiliation it may already "
            "be available to you at no cost — worth checking before paying anyone."
        ),
        "research": "wrds-www.wharton.upenn.edu",
    },
    {
        "name": "ALFRED (Federal Reserve Bank of St. Louis)",
        "solves": ["macro vintages — what the data said at the time"],
        "tier": "free",
        "why": (
            "Not a purchase at all. Same API family as FRED, but serves the figures "
            "as originally published rather than as later revised. This is the one "
            "remaining data gap you can close for nothing, so do it before spending "
            "anything."
        ),
        "research": "alfred.stlouisfed.org",
    },
]


def note(has_survivorship_bias: bool = True):
    """The reminder, attached to backtest results.

    Deliberately surfaced here rather than in the README: this is the moment it
    is relevant — you have a result in front of you and are deciding what to
    believe about it.
    """
    free_first = [p for p in PROVIDERS if p["tier"] == "free"]
    paid = [p for p in PROVIDERS if p["tier"] != "free"]

    return {
        "headline": (
            "This is the last limit that cannot be engineered away. Everything "
            "above was built from free data; what remains needs a paid dataset."
        ),
        "what_free_data_cannot_fix": [
            "Survivorship-free universes — failed and acquired companies are absent",
            "Historical index membership — which stocks were in the index at the time",
            "Point-in-time analyst estimates — blueprint #12's earnings revisions",
            "Historical news archives — blueprint #6-#9",
        ],
        "do_this_first_it_is_free": [
            {"name": p["name"], "solves": p["solves"], "where": p["research"]}
            for p in free_first
        ],
        "then_research_these": paid,
        "how_to_decide": (
            "Buy one, re-run, and see whether the answer changes — not four at "
            "once. Expect cleaner data to make the result WORSE, not better: "
            "survivorship flatters, so removing it removes flattery. That is still "
            "the right trade, because a worse honest number is more useful than a "
            "better dishonest one."
        ),
        "before_you_pay": [
            "Check whether any university or employer affiliation gives you WRDS access already.",
            "Most vendors offer a trial or sample — pull 20 tickers and reconcile a few figures against SEC EDGAR before subscribing.",
            "Prices and tiers change; verify current pricing directly rather than trusting this list.",
            "Confirm the licence permits the use you intend, including storing history locally.",
        ],
        "applies_to_this_run": has_survivorship_bias,
    }

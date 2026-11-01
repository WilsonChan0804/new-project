"""SEC EDGAR company facts — point-in-time fundamentals.

This is roadmap item #3, and it is the one that unblocks everything else.

Alpha Vantage's OVERVIEW gives you today's numbers with no indication of when
they became public. That makes an honest backtest impossible: asking "what
would the engine have said in March 2024" would answer using figures filed in
2026. EDGAR's `companyfacts` tags every reported value with the date it was
filed, so this module can answer "what did investors actually know on date X".

Every accessor takes an ``as_of`` date and refuses to look at anything filed
after it. That constraint is the entire point of the module — if you relax it
for convenience, the backtester silently becomes a fiction.

Free, no key, no meaningful rate limit. SEC asks for a contactable
User-Agent, which comes from ``settings.sec_user_agent``.
"""
from datetime import date, datetime, timedelta

import requests

from ..config import settings
from ..storage import cache

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"

# XBRL tag names vary by filer and change over time, so each logical concept
# lists candidates in preference order.
CONCEPTS = {
    # flows (duration facts — have start and end)
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax",
    ],
    "net_income": ["NetIncomeLoss", "ProfitLoss"],
    "operating_cash_flow": [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
    "capex": [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
    ],
    "buybacks": ["PaymentsForRepurchaseOfCommonStock"],
    "dividends": ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
    # stocks (instant facts — end only)
    "assets": ["Assets"],
    "liabilities": ["Liabilities"],
    "equity": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "cash": [
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
    "current_assets": ["AssetsCurrent"],
    "current_liabilities": ["LiabilitiesCurrent"],
    "long_term_debt": ["LongTermDebtNoncurrent", "LongTermDebt"],
    "short_term_debt": ["LongTermDebtCurrent", "ShortTermBorrowings"],
    "shares": [
        "CommonStockSharesOutstanding",
        "WeightedAverageNumberOfDilutedSharesOutstanding",
    ],
}

FLOW_CONCEPTS = {"revenue", "net_income", "operating_cash_flow", "capex",
                 "buybacks", "dividends"}

# Only periodic reports. 8-Ks and amendments carry restated or partial figures.
ACCEPTED_FORMS = {"10-K", "10-Q", "20-F", "40-F"}


class EdgarError(RuntimeError):
    pass


def _headers():
    return {"User-Agent": settings.sec_user_agent, "Accept-Encoding": "gzip, deflate"}


def _as_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def find_cik(ticker: str):
    data = cache.get("sec:tickers", 24 * 7)
    if data is None:
        r = requests.get(TICKERS_URL, headers=_headers(), timeout=30)
        r.raise_for_status()
        data = r.json()
        cache.put("sec:tickers", data)
    for row in data.values():
        if (row.get("ticker") or "").upper() == ticker.upper():
            return str(row["cik_str"]).zfill(10)
    return None


def company_facts(ticker: str):
    cik = find_cik(ticker)
    if not cik:
        raise EdgarError(f"No SEC CIK found for {ticker} (non-US listing?)")

    key = f"edgar:facts:{cik}"
    data = cache.get(key, 24.0)
    if data is None:
        r = requests.get(FACTS_URL.format(cik=cik), headers=_headers(), timeout=60)
        if r.status_code == 404:
            raise EdgarError(f"No XBRL facts published for CIK {cik}")
        r.raise_for_status()
        data = r.json()
        cache.put(key, data)
    return data


class Facts:
    """Point-in-time view over one company's XBRL history."""

    def __init__(self, payload: dict):
        self.entity = payload.get("entityName")
        self.cik = payload.get("cik")
        self._raw = payload.get("facts", {})
        self._index = {}
        for logical, tags in CONCEPTS.items():
            self._index[logical] = self._collect(tags)

    def _collect(self, tags):
        """Flatten every reported observation for the first tag that has data."""
        for namespace in ("us-gaap", "ifrs-full", "dei"):
            ns = self._raw.get(namespace) or {}
            for tag in tags:
                node = ns.get(tag)
                if not node:
                    continue
                rows = []
                for unit, entries in (node.get("units") or {}).items():
                    if unit not in ("USD", "shares", "USD/shares"):
                        continue
                    for e in entries:
                        if e.get("form") not in ACCEPTED_FORMS:
                            continue
                        if e.get("val") is None or not e.get("filed") or not e.get("end"):
                            continue
                        try:
                            rows.append({
                                "val": float(e["val"]),
                                "start": _as_date(e["start"]) if e.get("start") else None,
                                "end": _as_date(e["end"]),
                                "filed": _as_date(e["filed"]),
                                "form": e["form"],
                                "unit": unit,
                            })
                        except (ValueError, TypeError):
                            continue
                if rows:
                    rows.sort(key=lambda r: (r["end"], r["filed"]))
                    return rows
        return []

    # -- point-in-time accessors -------------------------------------------

    def _visible(self, concept, as_of: date):
        """Only facts an investor could actually have seen by ``as_of``."""
        return [r for r in self._index.get(concept, []) if r["filed"] <= as_of]

    def latest(self, concept: str, as_of: date):
        """Most recent reported value as of a date. Returns (value, meta) or (None, None)."""
        rows = self._visible(concept, as_of)
        if not rows:
            return None, None
        # Latest period end; among restatements of the same period, latest filing.
        best = max(rows, key=lambda r: (r["end"], r["filed"]))
        return best["val"], {
            "period_end": str(best["end"]), "filed": str(best["filed"]),
            "form": best["form"], "lag_days": (as_of - best["filed"]).days,
        }

    # -- TTM construction ---------------------------------------------------

    def _periods(self, concept: str, as_of: date):
        """Deduplicated duration facts, newest first."""
        rows = [r for r in self._visible(concept, as_of) if r["start"]]
        by_period = {}
        for r in rows:
            key = (r["start"], r["end"])
            if key not in by_period or r["filed"] > by_period[key]["filed"]:
                by_period[key] = r
        return sorted(by_period.values(), key=lambda r: r["end"], reverse=True)

    @staticmethod
    def _days(r):
        return (r["end"] - r["start"]).days

    def _ttm_ending_by(self, periods, anchor: date):
        """Trailing twelve months ending at or before ``anchor``.

        Three routes, in order of preference. The second is the one that
        matters: most US filers never publish a standalone Q4, because the
        fourth quarter only appears inside the 10-K as part of the annual
        figure. Naively summing "the last four quarterly facts" therefore
        reaches back roughly fifteen months and fails, which is why v1.8 kept
        falling through to a ten-month-old annual report.

        The standard construction is:

            TTM = last full year + year-to-date - same year-to-date a year ago
        """
        periods = [p for p in periods if p["end"] <= anchor]
        if not periods:
            return None, None

        quarters = [p for p in periods if 60 <= self._days(p) <= 100]
        annuals = [p for p in periods if 330 <= self._days(p) <= 400]

        # 1. Four discrete quarters that genuinely cover about a year.
        if len(quarters) >= 4:
            w = quarters[:4]
            if 330 <= (w[0]["end"] - w[-1]["start"]).days <= 400:
                return sum(p["val"] for p in w), {
                    "basis": "sum of 4 quarters",
                    "period_end": str(w[0]["end"]),
                    "filed": str(max(p["filed"] for p in w)),
                }

        # 2. Annual + year-to-date - prior-year year-to-date.
        if annuals:
            fy = annuals[0]
            ytds = [p for p in periods
                    if p["end"] > fy["end"] and 80 <= self._days(p) <= 320]
            if ytds:
                cur = max(ytds, key=lambda p: (p["end"], self._days(p)))
                target_len, target_end = self._days(cur), cur["end"]
                prior = None
                for p in periods:
                    if abs(self._days(p) - target_len) > 12:
                        continue
                    gap = (target_end - p["end"]).days
                    if 350 <= gap <= 380:
                        prior = p
                        break
                if prior is not None:
                    return fy["val"] + cur["val"] - prior["val"], {
                        "basis": "annual + YTD - prior YTD",
                        "period_end": str(cur["end"]),
                        "filed": str(max(fy["filed"], cur["filed"], prior["filed"])),
                        "ytd_months": round(target_len / 30.4),
                    }

        # 3. Last resort: the annual figure on its own.
        if annuals:
            a = annuals[0]
            return a["val"], {
                "basis": "annual report (no newer interim data)",
                "period_end": str(a["end"]), "filed": str(a["filed"]),
            }
        return None, None

    def ttm(self, concept: str, as_of: date):
        """Trailing twelve months for a flow concept. Returns (value, meta)."""
        if concept not in FLOW_CONCEPTS:
            return self.latest(concept, as_of)

        periods = self._periods(concept, as_of)
        if not periods:
            return None, None

        val, meta = self._ttm_ending_by(periods, periods[0]["end"])
        if meta:
            meta["lag_days"] = (as_of - _as_date(meta["filed"])).days
        return val, meta

    def ttm_prior_year(self, concept: str, as_of: date):
        """The same TTM measure one year earlier, for a like-for-like growth rate.

        Still respects ``as_of``: this is last year's figure as reported by now,
        not as reported back then. That is the right comparison for a growth
        rate and contains no future information.
        """
        if concept not in FLOW_CONCEPTS:
            rows = self._visible(concept, as_of)
            if not rows:
                return None
            anchor = max(r["end"] for r in rows)
            older = [r for r in rows if (anchor - r["end"]).days >= 300]
            return max(older, key=lambda r: r["end"])["val"] if older else None

        periods = self._periods(concept, as_of)
        if not periods:
            return None
        anchor = periods[0]["end"]
        target = anchor - timedelta(days=365)

        # Anchor on the reported period end nearest to a year ago rather than on
        # the calendar date. Fiscal calendars drift by a few days each year, so
        # a hard cutoff can fall one day short and drop a whole quarter.
        candidates = [p["end"] for p in periods if abs((p["end"] - target).days) <= 45]
        prior_anchor = min(candidates, key=lambda d: abs((d - target).days)) if candidates else target

        val, _ = self._ttm_ending_by(periods, prior_anchor)
        return val

    def value_for(self, tags, as_of: date, flow: bool = False, prior: bool = False):
        """Read an arbitrary XBRL tag list, outside the built-in CONCEPTS map.

        Sector-specific models need tags the generic model never asks for —
        `Deposits`, `ProvisionForLoanLeaseAndOtherLosses`, `InventoryNet`. This
        exposes the same point-in-time machinery for them without mutating the
        module-level concept map, which would not be thread-safe and would leak
        state between calls.
        """
        rows = self._collect(list(tags))
        if not rows:
            return None
        visible = [r for r in rows if r["filed"] <= as_of]
        if not visible:
            return None

        if not flow:
            if prior:
                anchor = max(r["end"] for r in visible)
                older = [r for r in visible if (anchor - r["end"]).days >= 300]
                if not older:
                    return None
                return max(older, key=lambda r: r["end"])["val"]
            return max(visible, key=lambda r: (r["end"], r["filed"]))["val"]

        periods = [r for r in visible if r["start"]]
        if not periods:
            return None
        by_period = {}
        for r in periods:
            key = (r["start"], r["end"])
            if key not in by_period or r["filed"] > by_period[key]["filed"]:
                by_period[key] = r
        periods = sorted(by_period.values(), key=lambda r: r["end"], reverse=True)

        anchor = periods[0]["end"]
        if prior:
            target = anchor - timedelta(days=365)
            near = [p["end"] for p in periods if abs((p["end"] - target).days) <= 45]
            anchor = min(near, key=lambda d: abs((d - target).days)) if near else target

        value, _meta = self._ttm_ending_by(periods, anchor)
        return value

    def coverage(self, as_of: date):
        """Which concepts we actually have, for honest reporting downstream."""
        return {c: bool(self._visible(c, as_of)) for c in CONCEPTS}


def load(ticker: str) -> Facts:
    return Facts(company_facts(ticker))


def known_tickers():
    """The SEC's ticker→CIK map, cached for a week. Free and keyless."""
    data = cache.get("sec:tickers", 24 * 7)
    if data is None:
        r = requests.get(TICKERS_URL, headers=_headers(), timeout=30)
        r.raise_for_status()
        data = r.json()
        cache.put("sec:tickers", data)
    return {(row.get("ticker") or "").upper(): row.get("title") for row in data.values()}


def _damerau_levenshtein(a: str, b: str) -> int:
    """Edit distance that counts a transposition as ONE mistake.

    Plain difflib scores PPL above AAPL for the input APPL, because it rewards
    a long contiguous run and AAPL shares no run longer than two characters.
    But AAPL is a single transposition from APPL, which is the commonest typing
    error there is — you hit the right keys in the wrong order.
    """
    if a == b:
        return 0
    la, lb = len(a), len(b)
    prev2, prev = None, list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        for j in range(1, lb + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
            if (i > 1 and j > 1 and a[i - 1] == b[j - 2]
                    and a[i - 2] == b[j - 1]):
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        prev2, prev = prev, cur
    return prev[lb]


def suggest(ticker: str, n: int = 3):
    """Close matches for a mistyped ticker.

    Worth the round trip because a typo like APPL otherwise spends three Alpha
    Vantage requests out of a 25/day budget before failing.

    Candidates are ranked by edit distance first (with transpositions counted
    as one), then by difflib similarity as a tie-break. Same-length candidates
    win ties, since a typo rarely changes the length of a ticker.
    """
    import difflib

    query = (ticker or "").upper().strip()
    if not query:
        return []
    try:
        universe = known_tickers()
    except Exception:
        return []

    # Only score plausible candidates; edit distance over ten thousand tickers
    # is wasteful, and anything sharing no characters is not a typo.
    query_chars = set(query)
    pool = [t for t in universe
            if abs(len(t) - len(query)) <= 1 and len(query_chars & set(t)) >= 2]

    scored = []
    for cand in pool:
        distance = _damerau_levenshtein(query, cand)
        if distance > 2:
            continue
        scored.append((
            distance,
            0 if len(cand) == len(query) else 1,
            -difflib.SequenceMatcher(None, query, cand).ratio(),
            cand,
        ))

    scored.sort()
    if not scored:
        matches = difflib.get_close_matches(query, list(universe), n=n, cutoff=0.6)
        return [{"ticker": m, "name": universe[m]} for m in matches]

    return [{"ticker": c, "name": universe[c]} for *_, c in scored[:n]]


# ---------------------------------------------------------------------------
# Sector from SEC, so it survives an exhausted Alpha Vantage quota
# ---------------------------------------------------------------------------

SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"

# SIC division ranges -> the sector labels the rest of the engine uses.
# Coarse by design: it only has to be right enough to pick a sector ETF and a
# peer cohort, and a coarse-but-present sector beats an exact-but-missing one.
_SIC_RANGES = [
    ((100, 999), "CONSUMER DEFENSIVE"),
    ((1000, 1119), "MATERIALS"),
    ((1200, 1399), "ENERGY"),
    ((1400, 1499), "MATERIALS"),
    ((1500, 1799), "INDUSTRIALS"),
    ((2000, 2199), "CONSUMER DEFENSIVE"),
    ((2200, 2399), "CONSUMER CYCLICAL"),
    ((2400, 2599), "INDUSTRIALS"),
    ((2600, 2699), "MATERIALS"),
    ((2700, 2799), "COMMUNICATION SERVICES"),
    ((2800, 2829), "MATERIALS"),
    ((2830, 2836), "HEALTHCARE"),
    ((2840, 2899), "CONSUMER DEFENSIVE"),
    ((2900, 2999), "ENERGY"),
    ((3000, 3299), "INDUSTRIALS"),
    ((3300, 3399), "MATERIALS"),
    ((3400, 3569), "INDUSTRIALS"),
    ((3570, 3579), "TECHNOLOGY"),
    ((3580, 3599), "INDUSTRIALS"),
    ((3600, 3629), "INDUSTRIALS"),
    ((3630, 3669), "TECHNOLOGY"),
    ((3670, 3699), "TECHNOLOGY"),
    ((3700, 3799), "CONSUMER CYCLICAL"),
    ((3800, 3851), "HEALTHCARE"),
    ((3860, 3999), "INDUSTRIALS"),
    ((4000, 4499), "INDUSTRIALS"),
    ((4500, 4599), "INDUSTRIALS"),
    ((4600, 4699), "ENERGY"),
    ((4700, 4799), "INDUSTRIALS"),
    ((4800, 4899), "COMMUNICATION SERVICES"),
    ((4900, 4999), "UTILITIES"),
    ((5000, 5199), "INDUSTRIALS"),
    ((5200, 5599), "CONSUMER CYCLICAL"),
    ((5600, 5699), "CONSUMER CYCLICAL"),
    ((5700, 5799), "CONSUMER CYCLICAL"),
    ((5800, 5899), "CONSUMER CYCLICAL"),
    ((5900, 5911), "CONSUMER CYCLICAL"),
    ((5912, 5912), "CONSUMER DEFENSIVE"),
    ((5913, 5999), "CONSUMER CYCLICAL"),
    ((6000, 6199), "FINANCIALS"),
    ((6200, 6299), "FINANCIALS"),
    ((6300, 6411), "FINANCIALS"),
    ((6500, 6599), "REAL ESTATE"),
    ((6798, 6798), "REAL ESTATE"),
    ((6700, 6799), "FINANCIALS"),
    ((7000, 7099), "CONSUMER CYCLICAL"),
    ((7200, 7299), "CONSUMER CYCLICAL"),
    ((7300, 7359), "INDUSTRIALS"),
    ((7370, 7379), "TECHNOLOGY"),
    ((7380, 7399), "INDUSTRIALS"),
    ((7800, 7999), "COMMUNICATION SERVICES"),
    ((8000, 8099), "HEALTHCARE"),
    ((8200, 8299), "CONSUMER DEFENSIVE"),
    ((8700, 8799), "INDUSTRIALS"),
]


def sector_from_sic(sic) -> str | None:
    try:
        code = int(sic)
    except (TypeError, ValueError):
        return None
    # Narrow ranges are listed before the broad blocks they sit inside, so the
    # first match wins: SIC 6798 is a REIT, not a generic finance company.
    for (lo, hi), sector in _SIC_RANGES:
        if lo <= code <= hi:
            return sector
    return None


def company_profile(ticker: str):
    """Name, SIC code and a derived sector — free, keyless, and cached.

    Alpha Vantage's free tier allows 25 requests a day, so an exhausted quota
    previously left `sector` null, which in turn disabled both the sector regime
    AND the peer cohort. Both now survive on SEC data alone.
    """
    cik = find_cik(ticker)
    if not cik:
        raise EdgarError(f"No SEC CIK found for {ticker}")

    key = f"edgar:submissions:{cik}"
    data = cache.get(key, 24 * 7)
    if data is None:
        r = requests.get(SUBMISSIONS_URL.format(cik=cik), headers=_headers(), timeout=30)
        r.raise_for_status()
        payload = r.json()
        data = {k: payload.get(k) for k in
                ("name", "sic", "sicDescription", "tickers", "exchanges", "cik")}
        cache.put(key, data)

    sic = data.get("sic")
    return {
        "name": data.get("name"),
        "sic": sic,
        "sic_description": data.get("sicDescription"),
        "sector": sector_from_sic(sic),
        "source": "sec_submissions",
    }


# ---------------------------------------------------------------------------
# 8-K filings: a free, timestamped, point-in-time event feed
# ---------------------------------------------------------------------------

def recent_filings(ticker: str, forms=("8-K",), limit: int = 60):
    """Recent filings with their exact filing timestamps.

    This is the answer to a problem the news layer cannot solve on free data.
    Alpha Vantage's news feed has no historical archive, so the news component
    could never be backtested — it held 15% of the composite's weight and was
    never validated once.

    8-K filings do not have that problem: free and unlimited, exactly
    timestamped via `acceptanceDateTime`, complete across every US registrant
    rather than only names with press coverage, and classified at source by
    item code so no keyword guessing is involved.

    What it does not give you is tone. It reports events, not narrative — which
    for a scoring engine is a feature: an auditor resignation is a fact,
    "analysts are cautious" is not.
    """
    cik = find_cik(ticker)
    if not cik:
        raise EdgarError(f"No SEC CIK found for {ticker}")

    key = f"edgar:filings:{cik}"
    data = cache.get(key, 6.0)
    if data is None:
        r = requests.get(SUBMISSIONS_URL.format(cik=cik), headers=_headers(), timeout=30)
        r.raise_for_status()
        recent = (r.json().get("filings") or {}).get("recent") or {}
        data = {k: recent.get(k, []) for k in
                ("form", "filingDate", "acceptanceDateTime", "items",
                 "primaryDocDescription", "accessionNumber")}
        cache.put(key, data)

    n = len(data.get("form", []))
    out = []
    for i in range(n):
        form = data["form"][i]
        if forms and form not in forms:
            continue
        out.append({
            "form": form,
            "filed": data["filingDate"][i],
            "accepted_at": (data.get("acceptanceDateTime") or [None] * n)[i],
            "items": [x.strip() for x in
                      ((data.get("items") or [""] * n)[i] or "").split(",") if x.strip()],
            "description": (data.get("primaryDocDescription") or [None] * n)[i],
            "accession": (data.get("accessionNumber") or [None] * n)[i],
        })
        if len(out) >= limit:
            break
    return out

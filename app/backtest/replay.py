"""Backtest replay — roadmap item #27.

This was blocked until v1.8 gave the engine point-in-time fundamentals. It is
the only thing that can answer the question the whole project rests on:
**does the opportunity score have any relationship to what happens next?**

## The rules this engine obeys

At each historical date the replay reconstructs only what an investor could
have known that morning:

* **Prices** are truncated to that date. No bar from the future is visible.
* **Fundamentals** come from `edgar.Facts` with `as_of` set to the replay date,
  so a figure filed the following week is invisible.
* **Valuation** is computed from the price on that date and earnings reported
  by that date — not from today's P/E, which is where most home-made
  backtests quietly cheat.

## What is deliberately excluded, and why

* **News** — no free provider serves historical article archives. Including
  today's news in a 2024 decision would be pure look-ahead. Excluded, and the
  coverage figure reflects its absence honestly.
* **Macro** — FRED serves *revised* data. The CPI print for March 2024 as it
  reads today is not the number published in April 2024. ALFRED has the
  vintages; until that is wired up, macro is off by default. Enable it with
  ``include_macro=True`` only if you accept the revision bias.

A backtest that quietly includes either would look far better than the live
engine ever will, which is the specific failure this module exists to avoid.
"""
from datetime import date, timedelta

import pandas as pd

from ..analysis import filings as filings_mod
from ..analysis import peers as peers_mod
from ..analysis.decision import choose_action, evaluate
from ..analysis.features import merge_fundamentals, money_flow, technical
from ..config import VERSION
from ..providers import edgar, prices

BENCHMARK = "SPY"
SECTOR_ETFS = {
    "TECHNOLOGY": "XLK", "INFORMATION TECHNOLOGY": "XLK", "HEALTHCARE": "XLV",
    "HEALTH CARE": "XLV", "FINANCIALS": "XLF", "FINANCIAL SERVICES": "XLF",
    "ENERGY": "XLE", "CONSUMER CYCLICAL": "XLY", "CONSUMER DISCRETIONARY": "XLY",
    "CONSUMER DEFENSIVE": "XLP", "CONSUMER STAPLES": "XLP", "INDUSTRIALS": "XLI",
    "COMMUNICATION SERVICES": "XLC", "REAL ESTATE": "XLRE", "UTILITIES": "XLU",
    "MATERIALS": "XLB", "BASIC MATERIALS": "XLB",
}


def _truncate(df: pd.DataFrame, as_of: date) -> pd.DataFrame:
    """Everything up to and including ``as_of``. The core discipline."""
    return df[df.date <= pd.Timestamp(as_of)]


def _price_on(df: pd.DataFrame, when: date):
    """Last close at or before a date, or None if the series doesn't reach it."""
    sub = df[df.date <= pd.Timestamp(when)]
    return float(sub.close.iloc[-1]) if len(sub) else None


def _forward_return(df: pd.DataFrame, start: date, horizon_days: int):
    """Realised return over the horizon, or None if the future isn't in the data."""
    entry = _price_on(df, start)
    if entry is None or entry <= 0:
        return None, None, None
    future = df[df.date > pd.Timestamp(start)]
    if len(future) < horizon_days:
        return None, None, None   # horizon extends past the data: not resolvable
    exit_row = future.iloc[horizon_days - 1]
    exit_price = float(exit_row.close)
    return entry, exit_price, 100.0 * (exit_price / entry - 1.0)


def valuation_pit(facts, as_of: date, price: float):
    """Point-in-time valuation from filings plus the price on the day.

    This is better than the live engine's Alpha Vantage multiples in one
    important way: the earnings figure is the one that had actually been
    reported by ``as_of``, so the P/E is the P/E an investor could have
    computed that morning.
    """
    from ..analysis.features import squash

    net_income, _ = facts.ttm("net_income", as_of)
    equity, _ = facts.latest("equity", as_of)
    shares, _ = facts.latest("shares", as_of)
    ocf, _ = facts.ttm("operating_cash_flow", as_of)
    capex, _ = facts.ttm("capex", as_of)

    if not shares or shares <= 0 or not price:
        return None, {}

    market_cap = price * shares
    parts, inputs = [], {"market_cap": market_cap, "shares": shares}

    if net_income:
        pe = market_cap / net_income
        inputs["pe"] = round(pe, 2)
        parts.append(20.0 if pe <= 0 else squash((20.0 - pe) / 15.0, k=0.7))

    if equity and equity > 0:
        pb = market_cap / equity
        inputs["pb"] = round(pb, 2)
        parts.append(squash((4.0 - pb) / 4.0, k=0.6))

    if ocf is not None and capex is not None:
        fcf = ocf - abs(capex)
        yield_pct = fcf / market_cap
        inputs["fcf_yield"] = round(yield_pct, 4)
        parts.append(squash((yield_pct - 0.04) / 0.03, k=0.7))

    if not parts:
        return None, inputs
    return round(sum(parts) / len(parts), 2), inputs


def _schedule(start: date, end: date, every_days: int):
    out, d = [], start
    while d <= end:
        out.append(d)
        d += timedelta(days=every_days)
    return out


class Replay:
    def __init__(self, tickers, horizon_days=63, every_days=21,
                 start=None, end=None, include_macro=False):
        self.tickers = [t.upper() for t in tickers]
        self.horizon_days = horizon_days
        self.every_days = every_days
        self.include_macro = include_macro
        self.end = end or (date.today() - timedelta(days=int(horizon_days * 1.5)))
        self.start = start or (self.end - timedelta(days=730))
        self._prices, self._facts, self._sectors = {}, {}, {}
        self._filings = {}
        self._sector_names = {}
        self.warnings = []

    def _load(self):
        shallow = []
        for sym in set(self.tickers) | {BENCHMARK} | set(SECTOR_ETFS.values()):
            try:
                df, _ = prices.daily(sym)
                self._prices[sym] = df
                # A ticker whose history starts after the requested window
                # silently shortens the test for that name. Better said than
                # discovered later in an unexplained sample-size drop.
                if len(df) and df.date.iloc[0].date() > self.start:
                    shallow.append(sym)
            except Exception:
                continue

        if shallow:
            self.warnings.append(
                f"{len(shallow)} ticker(s) have no price history back to "
                f"{self.start} and contribute only from their listing date: "
                f"{', '.join(sorted(shallow)[:8])}"
                f"{'...' if len(shallow) > 8 else ''}.")

        filled = self._resolve_missing_sectors()
        if filled:
            self.warnings.append(
                f"Sector resolved from SEC SIC codes for {filled} ticker(s).")
        missing = [t for t in self.tickers if not self._sector_names.get(t)]
        if missing:
            self.warnings.append(
                f"No sector for {len(missing)} ticker(s) ({', '.join(missing[:6])}"
                f"{'...' if len(missing) > 6 else ''}). They rank against the whole "
                "universe rather than their sector, which weakens peer normalisation."
            )

        for t in self.tickers:
            try:
                # 8-K filings, for the event study. Same cached submissions
                # payload the sector lookup already uses, so no extra requests.
                self._filings[t] = edgar.recent_filings(t, forms=("8-K",), limit=400)
            except Exception:
                self._filings[t] = []
            try:
                facts = edgar.load(t)
                self._facts[t] = facts
            except Exception as exc:
                self.warnings.append(f"{t}: no SEC filings ({exc}); fundamentals excluded.")

    def _sector_of(self, ticker):
        return self._sector_names.get(ticker.upper())

    def _sector_etf(self, ticker):
        # Sector comes from filings metadata where available; otherwise skip
        # rather than guess. A wrong sector ETF is worse than none.
        return self._sectors.get(ticker)

    def set_sectors(self, mapping: dict):
        """Ticker -> sector map. EDGAR carries SIC codes, not GICS labels.

        Two dictionaries, and they are not the same thing:
          * ``_sectors``       ticker -> sector ETF, for the sector regime score
          * ``_sector_names``  ticker -> sector label, for the peer cohort

        v2.3 populated only the first. Every record therefore had
        ``sector: None``, all 63 names landed in one "UNKNOWN" cohort, and
        "peer normalisation" silently ranked across the whole universe instead
        of within sector -- which is precisely the sector bet it exists to
        remove. The all-banks portfolio was the symptom.
        """
        mapping = {k.upper(): (v or "").upper() for k, v in (mapping or {}).items()}
        self._sector_names = dict(mapping)
        self._sectors = {k: SECTOR_ETFS.get(v) for k, v in mapping.items()}

    def _resolve_missing_sectors(self):
        """Fill any gaps from the SEC's SIC classification. Free and keyless."""
        filled = 0
        for t in self.tickers:
            if self._sector_names.get(t):
                continue
            try:
                sector = (edgar.company_profile(t) or {}).get("sector")
            except Exception:
                sector = None
            if sector:
                self._sector_names[t] = sector
                self._sectors[t] = SECTOR_ETFS.get(sector)
                filled += 1
        return filled

    def _decision_at(self, ticker, as_of: date):
        px = self._prices.get(ticker)
        if px is None:
            return None
        hist = _truncate(px, as_of)
        if len(hist) < 250:
            return None

        price = float(hist.close.iloc[-1])
        t = technical(hist)
        mf = money_flow(hist)

        bench = self._prices.get(BENCHMARK)
        market = None
        if bench is not None:
            bt = technical(_truncate(bench, as_of))
            market = bt.get("technical")

        sector_score = None
        etf = self._sector_etf(ticker)
        if etf and etf in self._prices:
            st = technical(_truncate(self._prices[etf], as_of))
            sector_score = st.get("technical")

        facts = self._facts.get(ticker)
        fil, val_score, val_inputs = None, None, {}
        if facts is not None:
            fil = filings_mod.analyse(facts, as_of)
            val_score, val_inputs = valuation_pit(facts, as_of, price)

        merged = merge_fundamentals({"quality": None, "growth": None}, fil)

        parts = {
            "market": market,
            "sector": sector_score,
            "fundamentals": merged["fundamentals"],
            "growth": merged["growth"],
            "valuation": val_score,
            "technical": t.get("technical"),
            "money_flow": mf.get("money_flow"),
            "news": None,   # no historical archive; excluded honestly
        }

        ev = evaluate(parts, freshness_pct=None, news_events=None)
        action, _ = choose_action(
            ev["opportunity_score"], ev["confidence"], ev["coverage"], None, parts)

        entry, exit_price, fwd = _forward_return(px, as_of, self.horizon_days)
        if fwd is None:
            return None

        bench_fwd = None
        if bench is not None:
            _, _, bench_fwd = _forward_return(bench, as_of, self.horizon_days)

        raw_metrics = peers_mod.extract_metrics(fil, val_inputs)

        return {
            "as_of": str(as_of),
            "ticker": ticker,
            "sector": self._sector_of(ticker),
            "raw_metrics": raw_metrics,
            "score": ev["opportunity_score"],
            "valuation": val_score,
            "confidence": ev["confidence"],
            "coverage": ev["coverage"],
            "action": action,
            "components": parts,
            "entry_price": round(entry, 4),
            "exit_price": round(exit_price, 4),
            "forward_return_pct": round(fwd, 3),
            "benchmark_return_pct": round(bench_fwd, 3) if bench_fwd is not None else None,
            "excess_return_pct": round(fwd - bench_fwd, 3) if bench_fwd is not None else None,
            "filing_lag_days": (fil or {}).get("filing_lag_days"),
            "valuation_inputs": val_inputs,
        }

    def _add_peer_scores(self, day_records):
        """Percentile-rank each company against its sector peers, that morning.

        The cohort is the rest of the universe on the same date, using only
        figures that were public then. This is the one place peer normalisation
        is free and exactly correct -- every peer's data is already loaded.

        Peer scores are added ALONGSIDE the absolute ones rather than replacing
        them, so the attribution table measures both and the comparison is
        visible rather than assumed.
        """
        if len(day_records) < peers_mod.MIN_COHORT:
            return

        by_sector = {}
        for r in day_records:
            by_sector.setdefault(r.get("sector") or "UNKNOWN", []).append(r)

        for r in day_records:
            sector = r.get("sector") or "UNKNOWN"
            cohort = by_sector.get(sector, [])
            # Fall back to the whole universe when a sector is too thin to rank
            # within. A four-company "sector percentile" is not a percentile.
            scope = "sector"
            if sector == "UNKNOWN" or len(cohort) < peers_mod.MIN_COHORT:
                # Ranking against the whole universe is NOT peer normalisation:
                # it reproduces the sector tilt the exercise is meant to strip out.
                cohort, scope = day_records, "universe"

            peer = peers_mod.scores(
                r["raw_metrics"], [c["raw_metrics"] for c in cohort])
            r["peer_scope"] = scope
            r["peer_detail"] = peer
            comps = r["components"]
            for key in ("valuation_peer", "quality_peer", "growth_peer", "risk_peer"):
                comps[key] = peer[key]
            # Flat top-level key so the portfolio simulator can rank on the one
            # component the backtest found informative, in isolation.
            r["__valuation_peer"] = peer["valuation_peer"]

    def run(self):
        self._load()
        records = []
        for as_of in _schedule(self.start, self.end, self.every_days):
            day = []
            for t in self.tickers:
                rec = self._decision_at(t, as_of)
                if rec:
                    day.append(rec)
            self._add_peer_scores(day)
            records.extend(day)

        scopes = [r.get("peer_scope") for r in records if r.get("peer_scope")]
        if scopes:
            uni = sum(1 for x in scopes if x == "universe") / len(scopes)
            if uni > 0.2:
                self.warnings.insert(0,
                    f"{uni:.0%} of peer rankings fell back to the whole universe "
                    "rather than a sector cohort. Those are not sector-relative "
                    "scores, and any *_peer result is diluted accordingly.")

        self.warnings.insert(0,
            "News is excluded: no free provider offers historical archives, so "
            "including it would be look-ahead bias.")
        if not self.include_macro:
            self.warnings.insert(1,
                "Macro is excluded: FRED serves revised data, and the CPI print for "
                "a past month is not the number published at the time. Use ALFRED "
                "vintages before enabling it.")

        return {
            "engine_version": VERSION,
            "filings_by_ticker": self._filings,
            "config": {
                "tickers": self.tickers, "start": str(self.start), "end": str(self.end),
                "horizon_days": self.horizon_days, "every_days": self.every_days,
                "benchmark": BENCHMARK,
            },
            "records": records,
            "warnings": self.warnings,
        }

"""Fundamentals from filings — the three components the blueprint wanted and
v1.7 did not have: cash flow, balance sheet, and earnings quality.

Each returns ``None`` when the underlying filing data is absent, so
``fundamentals`` becomes a sub-composite renormalised over whatever is
available — the same discipline the top-level score already uses.

Everything here is point-in-time. Pass ``as_of`` and nothing filed after that
date is consulted.
"""
from datetime import date

from .features import squash


def _ratio(num, den, floor=None):
    if num is None or den in (None, 0):
        return None
    if floor is not None and abs(den) < floor:
        return None
    return num / den


def cash_flow(facts, as_of: date):
    """Does the business actually generate cash, and how much of it is free?"""
    out = {"score": None, "inputs": {}, "notes": []}

    ocf, ocf_meta = facts.ttm("operating_cash_flow", as_of)
    capex, _ = facts.ttm("capex", as_of)
    revenue, _ = facts.ttm("revenue", as_of)
    net_income, _ = facts.ttm("net_income", as_of)

    if ocf is None:
        out["notes"].append("No operating cash flow reported.")
        return out

    # capex is filed as a positive outflow
    fcf = ocf - abs(capex) if capex is not None else None
    out["inputs"] = {
        "operating_cash_flow_ttm": ocf,
        "capex_ttm": abs(capex) if capex is not None else None,
        "free_cash_flow_ttm": fcf,
        "as_reported": ocf_meta,
    }

    parts = []
    fcf_margin = _ratio(fcf, revenue, floor=1.0)
    if fcf_margin is not None:
        out["inputs"]["fcf_margin"] = round(fcf_margin, 4)
        parts.append(squash(fcf_margin / 0.12, k=0.8))

    # Cash conversion: is reported profit turning into real cash?
    conversion = _ratio(ocf, net_income, floor=1.0)
    if conversion is not None and net_income and net_income > 0:
        out["inputs"]["cash_conversion"] = round(conversion, 3)
        parts.append(squash((conversion - 1.0) / 0.4, k=0.7))
        if conversion < 0.7:
            out["notes"].append(
                "Operating cash flow is well below reported profit — earnings are "
                "not converting into cash."
            )

    prior_ocf = facts.ttm_prior_year("operating_cash_flow", as_of)
    growth = _ratio((ocf - prior_ocf) if prior_ocf else None, abs(prior_ocf) if prior_ocf else None)
    if growth is not None:
        out["inputs"]["ocf_growth_yoy"] = round(growth, 4)
        parts.append(squash(growth / 0.15, k=0.7))

    if parts:
        out["score"] = round(sum(parts) / len(parts), 2)
    return out


def balance_sheet(facts, as_of: date):
    """Could this company survive a bad year? Leverage and liquidity.

    This replaces v1.4's `- 2 * debt` term, which used an Alpha Vantage field
    that either did not exist (no penalty ever applied) or arrived as a
    percentage (quality collapsed to zero for every normally-leveraged firm).
    Debt now comes from the filings themselves.
    """
    out = {"score": None, "inputs": {}, "notes": []}

    equity, _ = facts.latest("equity", as_of)
    assets, _ = facts.latest("assets", as_of)
    cash, _ = facts.latest("cash", as_of)
    ltd, _ = facts.latest("long_term_debt", as_of)
    std, _ = facts.latest("short_term_debt", as_of)
    ca, _ = facts.latest("current_assets", as_of)
    cl, _ = facts.latest("current_liabilities", as_of)
    ocf, _ = facts.ttm("operating_cash_flow", as_of)

    total_debt = None
    if ltd is not None or std is not None:
        total_debt = (ltd or 0.0) + (std or 0.0)
    net_debt = (total_debt - (cash or 0.0)) if total_debt is not None else None

    out["inputs"] = {
        "total_debt": total_debt, "cash": cash, "net_debt": net_debt,
        "equity": equity, "total_assets": assets,
    }

    parts = []

    # Net debt to equity. Negative net debt (net cash) is a strength.
    nde = _ratio(net_debt, equity, floor=1.0)
    if nde is not None and equity and equity > 0:
        out["inputs"]["net_debt_to_equity"] = round(nde, 3)
        parts.append(squash((0.5 - nde) / 0.8, k=0.7))
        if nde > 2.0:
            out["notes"].append("Net debt is more than twice shareholders' equity.")
        elif nde < 0:
            out["notes"].append("Holds more cash than debt.")

    # Can operating cash flow service the debt?
    if net_debt is not None and ocf and ocf > 0:
        years = net_debt / ocf
        out["inputs"]["net_debt_to_ocf_years"] = round(years, 2)
        parts.append(squash((2.5 - years) / 2.5, k=0.7))

    # Short-term liquidity.
    current_ratio = _ratio(ca, cl, floor=1.0)
    if current_ratio is not None:
        out["inputs"]["current_ratio"] = round(current_ratio, 3)
        parts.append(squash((current_ratio - 1.2) / 0.8, k=0.6))
        if current_ratio < 1.0:
            out["notes"].append(
                "Current liabilities exceed current assets — near-term obligations "
                "depend on refinancing or incoming cash."
            )

    if parts:
        out["score"] = round(sum(parts) / len(parts), 2)
    else:
        out["notes"].append("No balance-sheet items reported in a usable form.")
    return out


def earnings_quality(facts, as_of: date):
    """Is the reported profit believable, and is it being diluted away?

    Two checks that catch different problems:

    * **Accruals.** Profit far above cash flow means earnings rest on
      estimates rather than money received. High accruals have a long history
      of preceding disappointment.
    * **Share count.** Growth in earnings means nothing if the share count grew
      faster. This is the difference between the company doing well and *you*
      doing well.
    """
    out = {"score": None, "inputs": {}, "notes": []}

    net_income, _ = facts.ttm("net_income", as_of)
    ocf, _ = facts.ttm("operating_cash_flow", as_of)
    assets, _ = facts.latest("assets", as_of)
    shares, shares_meta = facts.latest("shares", as_of)
    prior_shares = facts.ttm_prior_year("shares", as_of)

    parts = []

    if net_income is not None and ocf is not None and assets:
        accrual_ratio = (net_income - ocf) / assets
        out["inputs"]["accrual_ratio"] = round(accrual_ratio, 4)
        # Lower is better; ~0 means profit equals cash generated.
        parts.append(squash(-accrual_ratio / 0.05, k=0.7))
        if accrual_ratio > 0.05:
            out["notes"].append(
                "Reported profit runs well ahead of cash generated — worth checking why."
            )

    if shares and prior_shares:
        change = shares / prior_shares - 1.0
        out["inputs"]["share_count_change_yoy"] = round(change, 4)
        out["inputs"]["shares_as_reported"] = shares_meta
        # Buybacks (negative change) are mildly positive; dilution is negative.
        parts.append(squash(-change / 0.03, k=0.7))
        if change > 0.03:
            out["notes"].append(
                f"Share count grew {change:.1%} over the year — your slice of the "
                "company is shrinking."
            )

    if parts:
        out["score"] = round(sum(parts) / len(parts), 2)
    else:
        out["notes"].append("Not enough filing history to judge earnings quality.")
    return out


def growth_pit(facts, as_of: date):
    """Revenue and profit growth from filings, with the filing date attached."""
    out = {"score": None, "inputs": {}, "notes": []}

    rev, rev_meta = facts.ttm("revenue", as_of)
    prior_rev = facts.ttm_prior_year("revenue", as_of)
    ni, _ = facts.ttm("net_income", as_of)
    prior_ni = facts.ttm_prior_year("net_income", as_of)

    parts = []
    if rev and prior_rev and prior_rev > 0:
        g = rev / prior_rev - 1.0
        out["inputs"]["revenue_growth_yoy"] = round(g, 4)
        out["inputs"]["revenue_ttm"] = rev
        out["inputs"]["as_reported"] = rev_meta
        parts.append(squash(g / 0.15, k=0.8))
    if ni is not None and prior_ni and prior_ni > 0:
        g = ni / prior_ni - 1.0
        out["inputs"]["net_income_growth_yoy"] = round(g, 4)
        parts.append(squash(g / 0.25, k=0.8))

    if parts:
        out["score"] = round(sum(parts) / len(parts), 2)
    else:
        out["notes"].append("Insufficient filing history for a like-for-like growth rate.")
    return out


def analyse(facts, as_of: date):
    """All four filing-based measures, plus a data-lag warning."""
    cf = cash_flow(facts, as_of)
    bs = balance_sheet(facts, as_of)
    eq = earnings_quality(facts, as_of)
    gr = growth_pit(facts, as_of)

    lag = None
    for block in (gr, cf):
        meta = (block["inputs"].get("as_reported") or {})
        if meta.get("lag_days") is not None:
            lag = meta["lag_days"] if lag is None else min(lag, meta["lag_days"])

    notes = cf["notes"] + bs["notes"] + eq["notes"]
    if lag is not None and lag > 120:
        notes.append(
            f"The most recent filing is {lag} days old. These figures describe a "
            "period that ended some time ago."
        )

    available = [b["score"] for b in (cf, bs, eq, gr) if b["score"] is not None]
    return {
        "status": "available" if available else "unavailable",
        "entity": facts.entity,
        "as_of": str(as_of),
        "cash_flow": cf["score"],
        "balance_sheet": bs["score"],
        "earnings_quality": eq["score"],
        "growth": gr["score"],
        "filing_lag_days": lag,
        "point_in_time": True,
        "detail": {"cash_flow": cf, "balance_sheet": bs,
                   "earnings_quality": eq, "growth": gr},
        "notes": notes,
    }

"""Sector-specific fundamentals from SEC filings.

## Why this and not thirty more indicators

The generic model asks every company the same questions: margin, growth, debt,
cash conversion. For a bank that is close to meaningless — a bank's balance
sheet *is* its business, its "inventory" is loans, and its margin is the spread
between what it pays for deposits and earns on lending. None of that appears in
`ProfitMargin`.

This is the one part of the expanded plan that adds **genuinely new
information** rather than re-arithmetic on the same price series. RSI, MACD and
Stochastic are three views of one number; net interest margin and loan-loss
provisions are facts about a company that nothing else in this engine knows.

It is also free: every figure below is an XBRL tag in filings already being
downloaded, and every one carries a filing date, so it is point-in-time by
construction and can be backtested later.

## These do NOT enter the score

Deliberately. The composite already measures an information coefficient
indistinguishable from zero, and adding unvalidated components to it repeats
the mistake this project exists to avoid. Sector metrics are reported as
**diagnostics and flags** — things a human should look at — until a backtest
says whether they predict anything.

Several are genuine red flags on their own terms regardless of predictive
power: a biotech with two quarters of cash left is in trouble whether or not
that fact has a measurable information coefficient.
"""
from datetime import date

TAGS = {
    # --- banking ---------------------------------------------------------
    "interest_income": ["InterestAndDividendIncomeOperating",
                        "InterestIncomeExpenseNet"],
    "interest_expense": ["InterestExpense"],
    "net_interest_income": ["InterestIncomeExpenseNet",
                            "InterestIncomeExpenseAfterProvisionForLoanLoss"],
    "loans": ["LoansAndLeasesReceivableNetReportedAmount",
              "NotesReceivableNet", "FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLoss"],
    "deposits": ["Deposits", "InterestBearingDepositLiabilities"],
    "loan_provision": ["ProvisionForLoanLeaseAndOtherLosses",
                       "ProvisionForLoanAndLeaseLosses",
                       "ProvisionForCreditLosses"],
    "noninterest_expense": ["NoninterestExpense"],
    "noninterest_income": ["NoninterestIncome"],
    # --- real estate -----------------------------------------------------
    "depreciation": ["DepreciationDepletionAndAmortization",
                     "DepreciationAndAmortization"],
    "property_gains": ["GainLossOnSaleOfProperties",
                       "GainsLossesOnSalesOfInvestmentRealEstate"],
    "dividends_paid": ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
    # --- research-driven -------------------------------------------------
    "rnd": ["ResearchAndDevelopmentExpense"],
    "operating_expenses": ["OperatingExpenses", "CostsAndExpenses"],
    # --- goods-producing -------------------------------------------------
    "inventory": ["InventoryNet"],
    "cogs": ["CostOfGoodsAndServicesSold", "CostOfRevenue"],
    # --- shared ----------------------------------------------------------
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax",
                "Revenues", "SalesRevenueNet"],
    "net_income": ["NetIncomeLoss"],
    "assets": ["Assets"],
    "equity": ["StockholdersEquity"],
    "cash": ["CashAndCashEquivalentsAtCarryingValue"],
    "operating_cash_flow": ["NetCashProvidedByUsedInOperatingActivities"],
}

FLOWS = {"interest_income", "interest_expense", "net_interest_income",
         "loan_provision", "noninterest_expense", "noninterest_income",
         "depreciation", "property_gains", "dividends_paid", "rnd",
         "operating_expenses", "cogs", "revenue", "net_income",
         "operating_cash_flow"}

SECTOR_MODEL = {
    "FINANCIALS": "bank",
    "REAL ESTATE": "reit",
    "HEALTHCARE": "research_driven",
    "TECHNOLOGY": "goods_or_software",
    "CONSUMER CYCLICAL": "goods_or_software",
    "CONSUMER DEFENSIVE": "goods_or_software",
    "INDUSTRIALS": "goods_or_software",
    "MATERIALS": "goods_or_software",
    "ENERGY": "capital_intensive",
    "UTILITIES": "capital_intensive",
}


def _provenance(facts, key, as_of):
    """The raw figures and period ends behind a ratio.

    A flag reading "inventory grew 87% while revenue grew 14%" is not checkable
    without the underlying numbers. Apple's real filings produced exactly that,
    and there was no way to tell from the response whether it reflected a
    genuine build-up, a seasonal comparison, or a tag that changed meaning
    between filings. Every derived metric now carries what it was derived from.
    """
    tags = TAGS.get(key, [])
    flow = key in FLOWS
    now = facts.value_for(tags, as_of, flow=flow)
    prior = facts.value_for(tags, as_of, flow=flow, prior=True)
    if now is None and prior is None:
        return None
    meta = {"current": now, "prior_year": prior}
    if not flow:
        _v, detail = facts.latest("assets", as_of)   # any instant, for the date shape
    try:
        rows = facts._collect(list(tags))
        visible = [r for r in rows if r["filed"] <= as_of]
        if visible:
            latest = max(visible, key=lambda r: (r["end"], r["filed"]))
            meta["current_period_end"] = str(latest["end"])
            meta["filed"] = str(latest["filed"])
            older = [r for r in visible
                     if (latest["end"] - r["end"]).days >= 300]
            if older:
                meta["prior_period_end"] = str(
                    max(older, key=lambda r: r["end"])["end"])
    except Exception:
        pass
    return meta


def _get(facts, key, as_of, prior=False):
    """Fetch a logical concept, trying each candidate XBRL tag in turn.

    Tag names vary between filers and change across years, so each concept
    lists alternatives and the first that returns data wins.
    """
    value = facts.value_for(TAGS.get(key, []), as_of,
                            flow=(key in FLOWS), prior=prior)
    return None if value is None else float(value)


def _pct(num, den, floor=1.0):
    if num is None or den is None or abs(den) < floor:
        return None
    return num / den


def _growth(now, prior):
    if now is None or prior is None or prior == 0:
        return None
    return now / abs(prior) - 1.0


# ---------------------------------------------------------------------------

def bank(facts, as_of):
    """A bank's balance sheet is its business, so the generic model misses it.

    Net interest margin, loan growth, deposit funding and credit provisions are
    the levers. `ProfitMargin` says nothing about any of them.
    """
    nii = _get(facts, "net_interest_income", as_of)
    if nii is None:
        ii, ie = _get(facts, "interest_income", as_of), _get(facts, "interest_expense", as_of)
        nii = (ii - ie) if (ii is not None and ie is not None) else None

    assets = _get(facts, "assets", as_of)
    loans = _get(facts, "loans", as_of)
    deposits = _get(facts, "deposits", as_of)
    provision = _get(facts, "loan_provision", as_of)
    nonint_exp = _get(facts, "noninterest_expense", as_of)
    nonint_inc = _get(facts, "noninterest_income", as_of)

    metrics, flags = {}, []

    nim = _pct(nii, assets)
    if nim is not None:
        metrics["net_interest_margin_on_assets"] = round(nim, 4)

    loan_growth = _growth(loans, _get(facts, "loans", as_of, prior=True))
    if loan_growth is not None:
        metrics["loan_growth_yoy"] = round(loan_growth, 4)
        metrics["loans_as_reported"] = _provenance(facts, "loans", as_of)
        if loan_growth > 0.25:
            flags.append(
                f"Loan book grew {loan_growth:.0%} in a year. Rapid lending growth "
                "is the classic precursor to a credit problem — the losses arrive "
                "two to three years after the loans do.")

    dep_growth = _growth(deposits, _get(facts, "deposits", as_of, prior=True))
    if dep_growth is not None:
        metrics["deposit_growth_yoy"] = round(dep_growth, 4)
        metrics["deposits_as_reported"] = _provenance(facts, "deposits", as_of)
        if dep_growth < -0.10:
            flags.append(
                f"Deposits fell {abs(dep_growth):.0%} over the year. Deposit flight "
                "is how bank problems become bank failures.")

    ltd = _pct(loans, deposits)
    if ltd is not None:
        metrics["loan_to_deposit"] = round(ltd, 3)
        if ltd > 1.1:
            flags.append(
                f"Loans are {ltd:.0%} of deposits, so lending is funded partly by "
                "borrowing rather than by depositors — more fragile if funding costs rise.")

    prov = _pct(provision, loans)
    if prov is not None:
        metrics["provision_to_loans"] = round(prov, 4)
        if prov > 0.015:
            flags.append(
                f"Loan-loss provisions are {prov:.2%} of the loan book, which is "
                "elevated. The bank expects borrowers to default.")

    if nonint_exp is not None and nii is not None and nonint_inc is not None:
        revenue = nii + nonint_inc
        eff = _pct(nonint_exp, revenue)
        if eff is not None:
            metrics["efficiency_ratio"] = round(eff, 3)
            if eff > 0.70:
                flags.append(
                    f"Efficiency ratio {eff:.0%} — it costs {eff:.0f}c of expense to "
                    "earn a dollar of revenue. Below 60% is considered good.")

    return _pack("bank", "Banks and lenders", metrics, flags,
                 "Margin, loan growth, funding mix and credit quality — none of "
                 "which appear in a generic profitability score.")


def reit(facts, as_of):
    """REITs are judged on FFO, not earnings.

    Property depreciation is a large non-cash charge that makes GAAP net income
    a poor guide, which is why the industry reports funds from operations
    instead. FFO is not a GAAP tag, so it is reconstructed from ones that are.
    """
    ni = _get(facts, "net_income", as_of)
    dep = _get(facts, "depreciation", as_of)
    gains = _get(facts, "property_gains", as_of) or 0.0
    revenue = _get(facts, "revenue", as_of)
    dividends = _get(facts, "dividends_paid", as_of)
    ocf = _get(facts, "operating_cash_flow", as_of)

    metrics, flags = {}, []
    ffo = None
    if ni is not None and dep is not None:
        ffo = ni + dep - gains
        metrics["ffo_ttm"] = round(ffo, 0)
        metrics["ffo_basis"] = "net income + depreciation - property gains"

        margin = _pct(ffo, revenue)
        if margin is not None:
            metrics["ffo_margin"] = round(margin, 4)

        if ni is not None and ffo != 0:
            metrics["ffo_to_net_income"] = round(ffo / ni, 2) if ni else None

    if dividends is not None and ffo:
        payout = abs(dividends) / ffo if ffo > 0 else None
        if payout is not None:
            metrics["dividend_payout_of_ffo"] = round(payout, 3)
            if payout > 1.0:
                flags.append(
                    f"Dividends are {payout:.0%} of FFO — the distribution exceeds "
                    "what the properties generate, so it is being funded from "
                    "borrowing, asset sales or new equity.")
            elif payout > 0.9:
                flags.append(
                    f"Dividends consume {payout:.0%} of FFO, leaving little room "
                    "if occupancy or rents soften.")

    if ocf is not None and dividends is not None and ocf > 0:
        metrics["dividend_cover_from_operations"] = round(ocf / abs(dividends), 2)

    return _pack("reit", "Real estate investment trusts", metrics, flags,
                 "FFO rather than earnings, because property depreciation is a "
                 "large non-cash charge that makes GAAP profit misleading here.")


def research_driven(facts, as_of):
    """Pharma and biotech: the question is often survival, not margin.

    A pre-revenue company's most important number is how many quarters of cash
    it has left. That is a fact about solvency, and it matters whether or not it
    has a measurable information coefficient.
    """
    rnd = _get(facts, "rnd", as_of)
    revenue = _get(facts, "revenue", as_of)
    cash = _get(facts, "cash", as_of)
    ocf = _get(facts, "operating_cash_flow", as_of)
    ni = _get(facts, "net_income", as_of)

    metrics, flags = {}, []

    intensity = _pct(rnd, revenue)
    if intensity is not None:
        metrics["rnd_intensity"] = round(intensity, 4)
        if intensity > 0.40:
            flags.append(
                f"R&D is {intensity:.0%} of revenue — the value here is in the "
                "pipeline rather than in current sales, which the generic quality "
                "score cannot see.")

    # Cash runway, the number that matters most for a loss-maker.
    if cash is not None and ocf is not None and ocf < 0:
        quarters = cash / (abs(ocf) / 4.0)
        metrics["cash_runway_quarters"] = round(quarters, 1)
        metrics["quarterly_burn"] = round(abs(ocf) / 4.0, 0)
        if quarters < 4:
            flags.append(
                f"About {quarters:.1f} quarters of cash left at the current burn "
                "rate. Financing is likely, and it usually dilutes existing "
                "shareholders.")
        elif quarters < 8:
            flags.append(
                f"Roughly {quarters:.1f} quarters of cash at the current burn rate — "
                "a raise within two years is probable.")

    if ni is not None and ni < 0 and revenue is not None and revenue > 0:
        metrics["loss_to_revenue"] = round(ni / revenue, 3)

    return _pack("research_driven", "Pharmaceuticals, biotech and research-led",
                 metrics, flags,
                 "R&D intensity and cash runway. For a loss-making company, "
                 "solvency is a more useful question than margin.")


def goods_or_software(facts, as_of):
    """Inventory versus revenue is the classic early warning for anyone who
    makes physical things.

    Inventory rising much faster than sales means goods are not moving, and
    write-downs tend to follow. Companies with no inventory (software) are
    simply reported as such rather than scored on an absent number.
    """
    inventory = _get(facts, "inventory", as_of)
    cogs = _get(facts, "cogs", as_of)
    revenue = _get(facts, "revenue", as_of)

    metrics, flags = {}, []

    if inventory is None:
        metrics["inventory"] = None
        metrics["note"] = "No inventory reported — asset-light or software-like."
        return _pack("goods_or_software", "Goods producers and software",
                     metrics, flags,
                     "Inventory behaviour, where there is inventory to observe.")

    turns = _pct(cogs, inventory)
    if turns is not None:
        metrics["inventory_turns"] = round(turns, 2)

    inv_growth = _growth(inventory, _get(facts, "inventory", as_of, prior=True))
    rev_growth = _growth(revenue, _get(facts, "revenue", as_of, prior=True))
    if inv_growth is not None:
        metrics["inventory_as_reported"] = _provenance(facts, "inventory", as_of)
        metrics["revenue_as_reported"] = _provenance(facts, "revenue", as_of)
        metrics["inventory_growth_yoy"] = round(inv_growth, 4)
    if inv_growth is not None and rev_growth is not None:
        divergence = inv_growth - rev_growth
        metrics["inventory_vs_revenue_growth"] = round(divergence, 4)
        if divergence > 0.20:
            prov = metrics.get("inventory_as_reported") or {}
            detail = ""
            if prov.get("current") and prov.get("prior_year"):
                detail = (f" ({prov['current']:,.0f} at "
                          f"{prov.get('current_period_end', '?')} versus "
                          f"{prov['prior_year']:,.0f} at "
                          f"{prov.get('prior_period_end', '?')})")
            flags.append(
                f"Inventory grew {inv_growth:.0%} while revenue grew "
                f"{rev_growth:.0%}{detail}. Stock is building faster than it "
                "sells, which typically precedes discounting or write-downs. "
                "Check the figures against the filing before acting on this — a "
                "large swing can also be a seasonal build or a changed tag.")

    if cogs is not None and revenue:
        gross = 1.0 - (cogs / revenue)
        metrics["gross_margin"] = round(gross, 4)

    return _pack("goods_or_software", "Goods producers and software",
                 metrics, flags,
                 "Inventory turns and the gap between inventory and revenue "
                 "growth — a warning the generic model cannot give.")


def capital_intensive(facts, as_of):
    """Energy and utilities: the question is whether the capex is funded.

    These businesses spend heavily and continuously. Whether that spending is
    covered by operations or by borrowing is the thing to watch.
    """
    ocf = _get(facts, "operating_cash_flow", as_of)
    assets = _get(facts, "assets", as_of)
    revenue = _get(facts, "revenue", as_of)
    dep = _get(facts, "depreciation", as_of)

    metrics, flags = {}, []

    intensity = _pct(revenue, assets)
    if intensity is not None:
        metrics["asset_turnover"] = round(intensity, 3)

    if dep is not None and revenue:
        metrics["depreciation_to_revenue"] = round(dep / revenue, 4)

    if ocf is not None and assets:
        metrics["operating_cash_return_on_assets"] = round(ocf / assets, 4)
        if ocf < 0:
            flags.append(
                "Operations consumed cash over the last twelve months. For an "
                "asset-heavy business that means capex and dividends are being "
                "funded by borrowing.")

    return _pack("capital_intensive", "Energy, utilities and asset-heavy",
                 metrics, flags,
                 "Whether heavy, continuous capital spending is funded by the "
                 "business or by borrowing.")


def _pack(model, label, metrics, flags, rationale):
    usable = {k: v for k, v in metrics.items() if v is not None}
    return {
        "model": model,
        "label": label,
        "status": "available" if usable else "unavailable",
        "metrics": metrics,
        "flags": flags,
        "why_this_model": rationale,
        "caveat": (
            "These are diagnostics, not score inputs. Nothing here has been "
            "backtested, and the composite already measures an information "
            "coefficient near zero — adding unvalidated components to it would "
            "repeat the mistake this engine exists to avoid. They come from "
            "dated filings, so they CAN be validated later."
        ),
    }


MODELS = {
    "bank": bank,
    "reit": reit,
    "research_driven": research_driven,
    "goods_or_software": goods_or_software,
    "capital_intensive": capital_intensive,
}


def analyse(facts, sector: str | None, as_of: date | None = None):
    """Run whichever sector model applies. Returns None when none does."""
    as_of = as_of or date.today()
    model = SECTOR_MODEL.get((sector or "").upper())
    if not model or facts is None:
        return {
            "status": "not_applicable",
            "sector": sector,
            "note": ("No sector-specific model for this sector, so only the "
                     "generic fundamentals apply."),
        }
    try:
        out = MODELS[model](facts, as_of)
    except Exception as exc:
        return {"status": "error", "sector": sector, "note": str(exc)[:120]}
    out["sector"] = sector
    return out

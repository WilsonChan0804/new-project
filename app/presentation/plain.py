"""Plain-English translation.

The JSON is accurate but unreadable unless you already know what CMF and
EV/EBITDA are. This module turns every number the engine produces into a
sentence someone without a finance background can act on.

Rule for every string in here: name the thing the reader recognises, not the
thing the system computes. "Buying vs selling pressure", not "Chaikin Money
Flow". And never state more certainty than the number carries.
"""

# label, the question it answers, and what a high score actually means
COMPONENTS = {
    "market": (
        "The market overall",
        "Is the whole stock market rising or falling?",
        "Most shares are going up",
        "Most shares are going down",
    ),
    "sector": (
        "This industry",
        "Is this company's industry doing well right now?",
        "The industry is outperforming",
        "The industry is struggling",
    ),
    "fundamentals": (
        "Business quality",
        "Is this a well-run, profitable business?",
        "Strongly profitable and efficient",
        "Weak profitability",
    ),
    "growth": (
        "Growth",
        "Is the company selling more and earning more than last year?",
        "Sales and earnings are growing well",
        "Sales and earnings are shrinking or flat",
    ),
    "valuation": (
        "Price vs value",
        "Are you paying a fair price for what you get?",
        "Cheap relative to what it earns",
        "Expensive relative to what it earns",
    ),
    "technical": (
        "Price trend",
        "Which way has the share price actually been moving?",
        "Trending upward and holding it",
        "Trending downward",
    ),
    "money_flow": (
        "Buying vs selling pressure",
        "Are buyers or sellers in control day to day?",
        "Buyers are in control",
        "Sellers are in control",
    ),
    "news": (
        "Recent news",
        "What has been written about the company lately?",
        "Coverage is mostly positive",
        "Coverage is mostly negative",
    ),
}

ACTION_PLAIN = {
    "BUY": "The evidence points positive and it is well supported.",
    "ACCUMULATE": "Leaning positive. If you buy, buy a little at a time rather than all at once.",
    "WATCH": "Something interesting here, but not enough to act on yet.",
    "HOLD": "No clear edge in either direction. Nothing to do.",
    "REDUCE": "The evidence leans negative.",
    "AVOID": "The evidence is clearly negative.",
    "NO ACTION": "The information available is too weak to justify a view. That is a real answer, not a failure.",
    "INSUFFICIENT DATA": "Too much information is missing to say anything useful. Fix the data first.",
    "UNKNOWN TICKER": "That symbol was not recognised by any data source.",
}

ACTION_TONE = {
    "BUY": "positive", "ACCUMULATE": "positive", "WATCH": "neutral",
    "HOLD": "neutral", "REDUCE": "negative", "AVOID": "negative",
    "NO ACTION": "unknown", "INSUFFICIENT DATA": "unknown",
    "UNKNOWN TICKER": "unknown",
}


def band(score):
    """Four bands. Deliberately coarse — these numbers are not precise."""
    if score is None:
        return "unknown"
    if score >= 65:
        return "strong"
    if score >= 55:
        return "mild"
    if score > 45:
        return "neutral"
    if score > 35:
        return "mild_weak"
    return "weak"


BAND_WORD = {
    "strong": "Good", "mild": "Slightly good", "neutral": "Middling",
    "mild_weak": "Slightly poor", "weak": "Poor", "unknown": "No data",
}


SUB_LABELS = {
    "profitability": "Profit margins",
    "cash_flow": "Cash generation",
    "balance_sheet": "Debt and liquidity",
    "earnings_quality": "Are the profits real?",
}


def describe_component(key, score, subs=None):
    label, question, high, low = COMPONENTS[key]
    b = band(score)
    if b == "unknown":
        meaning = "We could not measure this, so it was left out of the result entirely."
    elif b in ("strong", "mild"):
        meaning = high + ("." if b == "strong" else ", but only mildly.")
    elif b == "neutral":
        meaning = "Neither clearly good nor clearly bad."
    else:
        meaning = low + ("." if b == "weak" else ", but only mildly.")
    detail = []
    for sub_key, sub_score in (subs or {}).items():
        detail.append({
            "label": SUB_LABELS.get(sub_key, sub_key),
            "score": sub_score,
            "verdict": BAND_WORD[band(sub_score)],
            "band": band(sub_score),
        })

    return {
        "key": key, "label": label, "question": question,
        "score": score, "band": b, "verdict": BAND_WORD[b], "meaning": meaning,
        "detail": detail,
    }


def confidence_sentence(conf, coverage, agreement):
    pct = round(100 * (coverage or 0))
    if conf is None:
        return "We cannot say how reliable this is."
    if conf >= 70:
        head = "Reasonably reliable."
    elif conf >= 55:
        head = "Moderately reliable."
    elif conf >= 40:
        head = "Weak. Treat this as a starting point, not an answer."
    else:
        head = "Very weak. Do not act on this."
    bits = [head, f"We had {pct}% of the information we look for."]
    if agreement is not None and agreement < 45:
        bits.append("The different measures disagree with each other, which is holding confidence down.")
    elif agreement is not None and agreement >= 70:
        bits.append("The different measures broadly agree with each other.")
    return " ".join(bits)


def scenarios_plain(scenarios, diag):
    """Three outcomes in ordinary language, with the odds stated as 'about X in 100'."""
    if not scenarios or not diag:
        return None
    horizon = diag.get("horizon_label", "the period")
    names = {
        "Bull": ("If things go well", "The share price rises by roughly"),
        "Base": ("If nothing much changes", "The share price moves by roughly"),
        "Bear": ("If things go badly", "The share price falls by roughly"),
    }
    rows = []
    for s in scenarios:
        title, phrasing = names.get(s["name"], (s["name"], "Return of roughly"))
        rows.append({
            "title": title,
            "odds_pct": round(100 * s["probability"]),
            "odds_text": f"about {round(100 * s['probability'])} times in 100",
            "return_pct": s["return_pct"],
            "sentence": f"{phrasing} {abs(s['return_pct']):.0f}% over {horizon}.",
        })

    ev = diag.get("expected_return_pct_net")
    down = diag.get("expected_downside_pct")
    if ev is None:
        summary = "Not enough price history to estimate outcomes."
    elif ev > 1.5:
        summary = (
            f"Averaging those three outcomes and taking off dealing costs leaves "
            f"about {ev:+.1f}% over {horizon}. The bad case is around -{down:.0f}%."
        )
    elif ev > -1.5:
        summary = (
            f"Averaging the three outcomes leaves roughly {ev:+.1f}% after costs — "
            f"essentially nothing, while risking about -{down:.0f}% if it goes wrong."
        )
    else:
        summary = (
            f"Averaging the three outcomes gives {ev:+.1f}% after costs. You would be "
            f"taking about -{down:.0f}% of downside risk to earn less than nothing."
        )

    fx = diag.get("fx_uncertainty_pct")
    fx_note = None
    if fx:
        fx_note = (
            f"These figures are in {diag.get('quote_currency', 'USD')}. The "
            f"{diag.get('base_currency')} exchange rate alone could move your actual "
            f"result by roughly ±{fx:.0f}% over this period, in either direction."
        )
    return {"rows": rows, "summary": summary, "fx_note": fx_note, "horizon": horizon}


def what_to_do(result):
    """The single most useful paragraph on the page."""
    action = result.get("action")
    price = result.get("price")
    inval = result.get("invalidation_price")
    steps = []

    if action in ("INSUFFICIENT DATA", "NO ACTION"):
        steps.append("Do nothing based on this. The engine does not have enough to work with.")
        missing = result.get("missing_components") or []
        if missing:
            labels = [COMPONENTS[m][0] for m in missing if m in COMPONENTS]
            steps.append("Missing: " + ", ".join(labels) + ". Check the data sources panel below.")
        return steps

    if action in ("BUY", "ACCUMULATE"):
        steps.append(
            "If you decide to buy, decide your maximum loss first, not your target price."
        )
        if price and inval:
            drop = 100 * (1 - inval / price)
            steps.append(
                f"A sensible 'I was wrong' level is around {inval:.2f} "
                f"({drop:.0f}% below today's {price:.2f}). If it closes below that, the reason "
                f"you bought no longer holds."
            )
        steps.append(
            "Use the position size tool to convert that into a number of shares, so one bad "
            "call cannot damage the whole portfolio."
        )
        if action == "ACCUMULATE":
            steps.append("Buy part of your intended amount now and the rest only if it behaves as expected.")
    elif action in ("REDUCE", "AVOID"):
        steps.append("If you already own this, the evidence argues for owning less of it, not more.")
    else:
        steps.append("No action needed. Add it to a watchlist and look again in a few weeks.")

    fil = result.get("filings") or {}
    if fil.get("status") != "available":
        steps.append(
            "Company accounts could not be read from SEC filings, so debt, cash flow "
            "and profit quality are unchecked here. Worth looking at manually."
        )
    elif (fil.get("filing_lag_days") or 0) > 120:
        steps.append(
            f"The newest accounts are {fil['filing_lag_days']} days old. A lot can "
            "change in that time — check whether results are due soon."
        )

    steps.append(
        "The engine has not yet been checked against real outcomes, so treat this as one "
        "opinion among several, not a recommendation."
    )
    return steps


def build(result: dict) -> dict:
    """Attach a plain-English view to an analysis result."""
    action = result.get("action", "")
    parts = result.get("score_breakdown") or {}
    diag = result.get("scenario_diagnostics")

    subs_by_key = {"fundamentals": (result.get("fundamentals") or {}).get("sub_scores")}
    components = [
        describe_component(k, parts.get(k), subs_by_key.get(k))
        for k in COMPONENTS if k in parts
    ]
    supportive = [c for c in components if c["band"] in ("strong", "mild")]
    against = [c for c in components if c["band"] in ("weak", "mild_weak")]
    unknown = [c for c in components if c["band"] == "unknown"]

    headline = ACTION_PLAIN.get(action, "")
    if result.get("opportunity_score") is not None and action not in ("INSUFFICIENT DATA",):
        headline += (
            f" It scores {result['opportunity_score']:.0f} out of 100 — a summary of "
            "the evidence below, not a forecast. Tested against three years of "
            "history, this score did not predict which shares went up."
        )

    return {
        "action": action,
        "tone": ACTION_TONE.get(action, "unknown"),
        "headline": headline,
        "confidence_sentence": confidence_sentence(
            result.get("confidence"), result.get("coverage"), result.get("signal_agreement")
        ),
        "components": components,
        "counts": {
            "supportive": len(supportive),
            "against": len(against),
            "unknown": len(unknown),
        },
        "scenarios": scenarios_plain(result.get("scenarios"), diag),
        "what_to_do": what_to_do(result),
        "caveat": (
            "This score HAS been tested against what actually happened, and it did "
            "not rank shares better than chance. Use the evidence below — the "
            "filings, the flags, the case against — and treat the number as a "
            "summary of that evidence rather than a prediction."
        ),
    }

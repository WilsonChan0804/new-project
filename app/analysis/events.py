"""Corporate events from 8-K item codes.

## Why this exists

The news component held 15% of the composite's weight and was **never
validated once**. Not because it was skipped, but because it could not be: no
free provider serves a historical news archive, so a backtest could never see
what the news said at the time. Every backtest reported `news` coverage 0.

8-K filings close that hole. The SEC requires a registrant to file one within
four business days of a material event, tagged with an item code that says what
happened. The result is a free, complete, exactly-timestamped, machine-readable
event feed — and because `acceptanceDateTime` records the moment it became
public, point-in-time discipline is automatic rather than promised.

## What this is not

It is not sentiment. An 8-K says an auditor resigned; it does not say whether
the market will care. Several item codes are directionally ambiguous by
design — Item 2.02 announces results without saying whether they were good.

Those are marked `direction: "unknown"` rather than guessed at. A feed that
reports "earnings were announced" honestly is more useful than one that
pretends to know how they landed, and unlike the sentiment score this one can
actually be tested.

## Severity, and what it is for

Severity is a hand-assigned prior, exactly like the scoring constants
elsewhere, and it carries the same warning: **it has not been validated
against outcomes.** The difference is that it *can* be, because the filing
dates are exact. That is the whole point of building this rather than adding
another sentiment feature.
"""
from datetime import date, datetime, timezone

# code -> (label, direction, severity 0-1)
# Direction is "unknown" wherever the code genuinely does not imply one.
ITEMS = {
    "1.01": ("Entered a material agreement", "positive", 0.35),
    "1.02": ("Terminated a material agreement", "negative", 0.45),
    "1.03": ("Bankruptcy or receivership", "negative", 1.00),
    "2.01": ("Completed an acquisition or disposal", "unknown", 0.50),
    "2.02": ("Announced results of operations", "unknown", 0.55),
    "2.03": ("Took on a material financial obligation", "negative", 0.30),
    "2.04": ("Triggering event accelerating an obligation", "negative", 0.75),
    "2.05": ("Costs from exit or disposal activities", "negative", 0.40),
    "2.06": ("Material asset impairment", "negative", 0.70),
    "3.01": ("Delisting notice or listing rule failure", "negative", 0.90),
    "3.02": ("Unregistered sale of equity", "negative", 0.35),
    "3.03": ("Material change to security holder rights", "unknown", 0.40),
    "4.01": ("Changed auditor", "negative", 0.65),
    "4.02": ("Prior financial statements cannot be relied upon", "negative", 0.95),
    "5.01": ("Change in control", "unknown", 0.70),
    "5.02": ("Director or senior officer departure or appointment", "unknown", 0.45),
    "5.03": ("Amended articles or changed fiscal year", "unknown", 0.15),
    "5.07": ("Shareholder vote results", "unknown", 0.15),
    "7.01": ("Regulation FD disclosure", "unknown", 0.20),
    "8.01": ("Other material event", "unknown", 0.25),
    "9.01": ("Financial statements and exhibits", "unknown", 0.05),
}

# Codes that describe something going wrong rather than something happening.
RED_FLAGS = {"1.03", "2.04", "2.06", "3.01", "4.01", "4.02"}


def _age_days(stamp, as_of):
    if not stamp:
        return None
    try:
        d = datetime.strptime(str(stamp)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None
    return (as_of - d).days


def classify(filings, as_of: date | None = None, window_days: int = 120):
    """Turn raw 8-K filings into scored events.

    Only filings inside ``window_days`` count toward the score; older ones are
    returned for context but a two-year-old officer change is not news.
    """
    as_of = as_of or datetime.now(timezone.utc).date()
    events, flags = [], []

    for f in filings:
        age = _age_days(f.get("filed"), as_of)
        if age is None or age < 0:
            continue
        codes = [c for c in f.get("items", []) if c in ITEMS]
        if not codes:
            codes = ["8.01"]

        for code in codes:
            label, direction, severity = ITEMS[code]
            ev = {
                "item": code, "label": label, "direction": direction,
                "severity": severity, "filed": f.get("filed"),
                "accepted_at": f.get("accepted_at"), "age_days": age,
                "in_window": age <= window_days,
                "accession": f.get("accession"),
            }
            events.append(ev)
            if code in RED_FLAGS and age <= 365:
                flags.append(ev)

    recent = [e for e in events if e["in_window"]]
    if not recent:
        return {
            "status": "no_recent_events",
            "score": None,
            "events": events[:15],
            "red_flags": flags,
            "window_days": window_days,
            "note": ("No 8-K filings in the window. That is common and is not "
                     "itself informative."),
        }

    # Score: start neutral, move on directional events weighted by severity and
    # recency. Ambiguous events do not move the score — they raise attention.
    score, weight = 50.0, 0.0
    for e in recent:
        if e["direction"] == "unknown":
            continue
        recency = max(0.2, 1.0 - e["age_days"] / window_days)
        w = e["severity"] * recency
        score += (18.0 if e["direction"] == "positive" else -22.0) * w
        weight += w

    score = round(max(0.0, min(100.0, score)), 2)
    ambiguous = [e for e in recent if e["direction"] == "unknown"]

    return {
        "status": "available",
        "score": score,
        "event_count": len(recent),
        "directional_count": len(recent) - len(ambiguous),
        "ambiguous_count": len(ambiguous),
        "red_flags": flags,
        "events": sorted(recent, key=lambda e: e["age_days"])[:15],
        "window_days": window_days,
        "reads": _reads(score, flags, ambiguous),
        "caveat": (
            "Severity weights are hand-assigned and unvalidated, like every "
            "other scoring constant here. Unlike the news sentiment score, this "
            "one CAN be validated — filing timestamps are exact, so it can be "
            "replayed through the backtester. Until that is done, treat it as a "
            "flag list rather than a score."
        ),
    }


def _reads(score, flags, ambiguous):
    if flags:
        worst = max(flags, key=lambda e: e["severity"])
        return (f"{len(flags)} red-flag filing(s) in the past year, the most "
                f"serious being: {worst['label'].lower()} "
                f"({worst['age_days']} days ago). Worth reading the filing itself "
                "before anything else in this report.")
    if score >= 62:
        return "Recent filings lean constructive."
    if score <= 38:
        return "Recent filings lean negative."
    if ambiguous:
        return (f"{len(ambiguous)} material event(s) filed recently with no "
                "inherent direction — results announcements, officer changes and "
                "the like. Something happened; the filing does not say whether it "
                "was good.")
    return "Nothing notable in recent filings."

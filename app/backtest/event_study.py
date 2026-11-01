"""Event study: do 8-K filings predict anything?

## Why this is the last hypothesis worth testing

Everything cross-sectional has been settled. No component ranks stocks over
fifteen years, and the two that briefly looked significant — valuation, then
fundamentals — each held up in one window and failed in another.

8-K events are a different kind of claim. They are not a factor that scores
every stock every day; they are discrete facts that happen to a few companies
at a time. An auditor resigning is not a percentile, and there is published
literature suggesting such events carry information. It has never been tested
here, and unlike news sentiment it *can* be: `acceptanceDateTime` records the
exact moment a filing became public.

## Pre-registration

The hypothesis list below is fixed **before** looking at any result, and the
correction is applied to its full length rather than to whatever survives.

This matters more here than anywhere else in the project. There are twenty-odd
item codes; testing all of them and reporting the best is how you manufacture a
discovery. Earlier work in this repo already showed the mechanism — six
components at the usual bar gave a 26% chance of a false positive somewhere in
the table.

Anything not on this list is reported as **exploratory** and does not count as
evidence, no matter how good it looks.

## What is measured, and what is not

Abnormal return: the stock's forward return minus the average forward return of
every other name on the same date. That removes the market and whatever the
sector was doing, leaving the part attributable to the company. A raw return
after an event mostly measures what month it was.

The window is deliberately **after** the filing. An event is tagged if it was
filed in the 45 days before the decision date, and the return is measured over
the horizon that follows. So this tests **post-event drift** — whether the
information is still exploitable once it is public — not the announcement-day
reaction, which is long gone by the time a monthly rebalance sees it.

That is the honest formulation for this engine. A drift result is tradeable at
a 63-day horizon; an announcement-day result would not be, and measuring it
here would flatter the strategy by pretending you could act on a filing before
anyone else read it.
"""
import math
import statistics
from datetime import date, datetime, timedelta

# ---------------------------------------------------------------------------
# PRE-REGISTERED HYPOTHESES — do not extend after seeing results
# ---------------------------------------------------------------------------
# Each entry is (label, item codes, predicted direction). Direction is declared
# in advance so that a "significant" result in the opposite direction counts
# against the hypothesis rather than for it.
PREREGISTERED = [
    ("red_flags_combined",
     ["1.03", "2.04", "2.06", "3.01", "4.01", "4.02"], "negative"),
    ("non_reliance", ["4.02"], "negative"),
    ("auditor_change", ["4.01"], "negative"),
    ("impairment", ["2.06"], "negative"),
    ("delisting_notice", ["3.01"], "negative"),
    ("officer_departure", ["5.02"], "negative"),
    ("results_announced", ["2.02"], "none"),
    ("material_agreement", ["1.01"], "positive"),
]

N_HYPOTHESES = len(PREREGISTERED)
MIN_EVENTS = 25

# ---------------------------------------------------------------------------
# AWAITING CONFIRMATION — found by exploration, not yet evidence
# ---------------------------------------------------------------------------
# A result found by looking cannot be confirmed by the data it was found in.
# Testing twenty codes and reporting the best one is how a discovery gets
# manufactured, and the only honest remedy is to declare it in advance and
# re-test on a sample that had no part in finding it.
#
# Entries record WHERE they were found, so any later run can be checked against
# that: if the universe and period match the discovery sample, the result is a
# restatement, not a confirmation.
#
# Nothing here counts as evidence until `confirmed_on` is filled in.
AWAITING_CONFIRMATION = [
    {
        "hypothesis": "terminated_material_agreement",
        "items": ["1.02"],
        "predicted": "negative",
        "rationale": ("Losing a material contract is an economically sensible "
                      "negative. The engine's own item map already classifies "
                      "1.02 as negative — it was simply omitted from the "
                      "pre-registered list, which is an oversight in the "
                      "declaration rather than a finding."),
        "found_on": {
            "universe": "diversified_60",
            "period": "2011-06-03 to 2026-05-30",
            "horizon_days": 63,
            "result": "-2.94% abnormal, t = -3.08, n = 189",
        },
        "confirmed_on": None,
    },
]


def t_threshold(n_tests: int) -> float:
    """Bonferroni-corrected |t| for ``n_tests`` pre-declared hypotheses."""
    if n_tests <= 1:
        return 2.0
    alpha = 0.05 / n_tests
    p = 1.0 - alpha / 2.0
    t = math.sqrt(-2.0 * math.log(1.0 - p))
    z = t - ((2.515517 + 0.802853 * t + 0.010328 * t * t) /
             (1.0 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t ** 3))
    return round(max(2.0, z), 2)


def _as_date(value):
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def attach_events(records, filings_by_ticker, window_days: int = 45):
    """Tag each record with item codes filed in the window before it.

    Two fields are attached, and the difference matters:

    * ``event_items`` — every code visible in the window. Useful for display.
    * ``new_event_items`` — codes whose filing is being seen for the FIRST
      time at this date. This is what the tests use.

    A 45-day window sampled every 21 days means one filing falls inside two or
    three consecutive windows, and counting it each time inflates the sample by
    the same factor while adding no information. On the screened universe that
    turned 79 real impairments into 79 "observations" that were really about 30
    filings, and a t-statistic of -2.86 that should not have cleared any bar.

    Point-in-time throughout: only filings dated at or before ``as_of`` are
    visible, so this cannot see an event that had not happened yet.
    """
    by_ticker = {}
    for r in records:
        by_ticker.setdefault(r.get("ticker"), []).append(r)

    for ticker, rows in by_ticker.items():
        rows.sort(key=lambda r: str(r.get("as_of")))
        filings = filings_by_ticker.get(ticker, [])
        # For each filing, the first rebalance date at or after it. That date
        # owns the event; later dates still see it but do not re-count it.
        first_seen = {}
        for f in filings:
            filed = _as_date(f.get("filed"))
            if not filed:
                continue
            for r in rows:
                as_of = _as_date(r.get("as_of"))
                if as_of and as_of >= filed:
                    key = (filed, tuple(sorted(f.get("items") or [])))
                    first_seen.setdefault(key, str(r.get("as_of")))
                    break

        for r in rows:
            as_of = _as_date(r.get("as_of"))
            codes, fresh = set(), set()
            if as_of:
                cutoff = as_of - timedelta(days=window_days)
                for f in filings:
                    filed = _as_date(f.get("filed"))
                    if not (filed and cutoff <= filed <= as_of):
                        continue
                    items = f.get("items") or []
                    codes.update(items)
                    key = (filed, tuple(sorted(items)))
                    if first_seen.get(key) == str(r.get("as_of")):
                        fresh.update(items)
            r["event_items"] = sorted(codes)
            r["new_event_items"] = sorted(fresh)
    return records


def _abnormal(records):
    """Forward return minus the same date's cross-sectional mean."""
    by_date = {}
    for r in records:
        if r.get("forward_return_pct") is not None:
            by_date.setdefault(r["as_of"], []).append(r)

    out = []
    for _, group in by_date.items():
        if len(group) < 5:
            continue
        avg = statistics.mean(g["forward_return_pct"] for g in group)
        for g in group:
            out.append({**g, "abnormal_return_pct": g["forward_return_pct"] - avg})
    return out


def _test(sample, baseline, label, codes, predicted, threshold, overlap=1.0):
    n = len(sample)
    if n < MIN_EVENTS:
        return {
            "hypothesis": label, "items": codes, "predicted": predicted,
            "n_events": n, "status": "insufficient_events",
            "note": (f"Only {n} occurrences; {MIN_EVENTS} is the pre-declared "
                     "minimum. No conclusion either way."),
        }

    vals = [s["abnormal_return_pct"] for s in sample]
    mean = statistics.mean(vals)
    sd = statistics.pstdev(vals) if n > 1 else 0.0
    # Forward-return windows overlap even after deduplicating the filings, so
    # the effective sample is smaller than the event count.
    effective = max(n / max(overlap, 1.0), 2.0)
    se = sd / math.sqrt(effective) if sd > 0 else None
    t = mean / se if se else None

    base_mean = (statistics.mean([b["abnormal_return_pct"] for b in baseline])
                 if baseline else 0.0)

    significant = bool(t is not None and abs(t) > threshold)
    direction = "negative" if mean < 0 else "positive"
    # When no direction was predicted there is nothing to match, and reporting
    # `true` reads as confirmation of a hypothesis that was never made. The
    # exploratory table showed item_1.02 as "matches_prediction: true" purely
    # because its predicted direction was "none".
    as_predicted = None if predicted == "none" else (
        significant and direction == predicted)

    return {
        "hypothesis": label,
        "items": codes,
        "predicted": predicted,
        "n_events": n,
        "n_effective_events": round(effective),
        "mean_abnormal_return_pct": round(mean, 3),
        "median_abnormal_return_pct": round(statistics.median(vals), 3),
        "baseline_abnormal_return_pct": round(base_mean, 3),
        "std_error": round(se, 3) if se else None,
        "t_stat": round(t, 2) if t is not None else None,
        "t_threshold": threshold,
        "significant": significant,
        "matches_prediction": as_predicted,
        "status": "ok",
        "reads": _reads(label, mean, t, significant, predicted, direction, n),
    }


def _reads(label, mean, t, significant, predicted, direction, n):
    # A sample with no variance yields no standard error and therefore no
    # t-statistic. Rare with real returns, routine in tests and in a window
    # where one filing is the only event. Say so rather than crashing on the
    # formatter, and never call it significant.
    if t is None:
        return (f"Mean abnormal return {mean:+.2f}% over {n} occurrences, but the "
                "sample has no variation, so no standard error can be computed "
                "and no conclusion follows.")
    if not significant:
        return (f"Mean abnormal return {mean:+.2f}% over {n} occurrences "
                f"(t = {t:+.2f}). Not distinguishable from the rest of the "
                "universe on the same dates.")
    if predicted != "none" and direction != predicted:
        return (f"Significant at {mean:+.2f}% (t = {t:+.2f}) but in the OPPOSITE "
                f"direction to the pre-registered prediction ({predicted}). A "
                "result that contradicts the hypothesis is not support for it.")
    return (f"Mean abnormal return {mean:+.2f}% over {n} occurrences "
            f"(t = {t:+.2f}), clearing the corrected bar and matching the "
            "pre-registered direction. Worth a second period before acting on it.")


def _is_independent(found_on, sample_id):
    """Is the current sample different from the one a hypothesis was found in?"""
    if not sample_id:
        return False
    return not (
        sample_id.get("universe") == found_on.get("universe")
        and sample_id.get("period") == found_on.get("period")
    )


def run(records, exploratory: bool = True, sample_id: dict | None = None,
        horizon_days: int | None = None, every_days: int | None = None):
    """Run the pre-registered event study over replay records.

    ``sample_id`` should carry ``universe`` and ``period`` so that a hypothesis
    awaiting confirmation can tell whether this run is independent of the one
    that produced it.
    """
    tagged = [r for r in records if "event_items" in r]
    if not tagged:
        return {"status": "no_events_attached",
                "note": ("Records carry no `event_items`. Call attach_events() "
                         "with filings before running the study.")}

    data = _abnormal(tagged)
    if len(data) < 200:
        return {"status": "insufficient_sample", "n": len(data)}

    overlap = max(1.0, (horizon_days or 1) / max(every_days or 1, 1))
    threshold = t_threshold(N_HYPOTHESES)

    # Count each filing once, at its first sighting.
    def codes_of(d):
        return set(d.get("new_event_items") or [])

    with_any = {id(d) for d in data if codes_of(d)}
    baseline = [d for d in data if not (d.get("event_items") or [])]

    results = []
    for label, codes, predicted in PREREGISTERED:
        wanted = set(codes)
        sample = [d for d in data if wanted & codes_of(d)]
        results.append(_test(sample, baseline, label, codes, predicted,
                             threshold, overlap))

    explored = []
    if exploratory:
        declared = {c for _, codes, _ in PREREGISTERED for c in codes}
        seen = {}
        for d in data:
            for code in codes_of(d):
                if code not in declared:
                    seen.setdefault(code, []).append(d)
        for code, sample in sorted(seen.items()):
            if len(sample) >= MIN_EVENTS:
                r = _test(sample, baseline, f"item_{code}", [code], "none",
                          threshold, overlap)
                r["exploratory"] = True
                r["warning"] = (
                    "Not pre-registered. Reported for completeness only — a "
                    "significant result here is what testing many things looks "
                    "like, not evidence."
                )
                explored.append(r)

    # Candidates awaiting an independent test. Reported separately from both
    # the pre-registered results and the exploratory table.
    pending = []
    for entry in AWAITING_CONFIRMATION:
        wanted = set(entry["items"])
        sample = [d for d in data if wanted & codes_of(d)]
        r = _test(sample, baseline, entry["hypothesis"], entry["items"],
                  entry["predicted"], threshold, overlap)
        r["found_on"] = entry["found_on"]
        r["rationale"] = entry["rationale"]
        r["is_confirmation"] = _is_independent(entry["found_on"], sample_id)
        r["status_note"] = (
            "Independent sample — this result counts."
            if r["is_confirmation"] else
            "This is the sample the hypothesis was found in, or an unlabelled "
            "one. A finding cannot be confirmed by the data that produced it. "
            "Re-run on a different universe or period."
        )
        pending.append(r)

    tested = [r for r in results if r["status"] == "ok"]
    hits = [r for r in tested if r["significant"] and r["matches_prediction"]]

    return {
        "status": "ok",
        "n_observations": len(data),
        "n_with_any_event": len(with_any),
        "counting": (
            "Each filing counts once, at the first rebalance date that could "
            "see it. A 45-day window sampled every 21 days otherwise counts one "
            "filing two or three times."
        ),
        "n_baseline": len(baseline),
        "hypotheses_declared": N_HYPOTHESES,
        "hypotheses_testable": len(tested),
        "t_threshold": threshold,
        "measure": ("abnormal return = forward return minus the mean forward "
                    "return of every other name on the same date"),
        "results": results,
        "awaiting_confirmation": pending,
        "exploratory": explored,
        "verdict": _verdict(tested, hits, threshold),
        "confirmation_note": (
            "`awaiting_confirmation` holds hypotheses found by exploration in an "
            "earlier run. They are not evidence, and cannot become evidence on "
            "the sample that produced them. Check `is_confirmation` on each: "
            "false means this run is a restatement, not a test."
        ),
        "preregistration_note": (
            f"{N_HYPOTHESES} hypotheses were declared in code before any result "
            "was seen, and the correction is applied to all of them rather than "
            "to the survivors. Anything under `exploratory` was not declared and "
            "does not count as evidence."
        ),
    }


def _verdict(tested, hits, threshold):
    if not tested:
        return ("No hypothesis had enough occurrences to test. That is a sample "
                "problem, not a finding — widen the universe or the date range.")
    if not hits:
        return (
            f"None of the {len(tested)} testable hypotheses cleared |t| > "
            f"{threshold}. 8-K events do not predict abnormal returns on this "
            "sample. They remain useful as facts — an auditor resignation is "
            "worth reading about whether or not it is tradeable — but they should "
            "not enter a score."
        )
    names = ", ".join(h["hypothesis"] for h in hits)
    return (
        f"{len(hits)} of {len(tested)} pre-registered hypotheses cleared the "
        f"corrected bar in the predicted direction: {names}. This is the first "
        "positive result in the project, so treat it accordingly — re-run on a "
        "different period and a different universe before it changes anything. "
        "Two components have already looked significant in one window and failed "
        "in another."
    )

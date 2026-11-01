"""Component attribution — which parts of the score carry information?

A composite IC near zero has two very different explanations:

1. No component predicts anything.
2. Several components predict things, and they cancel each other out.

These call for opposite responses, and the headline IC cannot tell them apart.
This module scores each component separately against the same forward returns,
so the answer is visible.

The weight fitting here is deliberately conservative. Weights are derived on
the first half of the period and tested on the second half, and the test result
is what gets reported. Fitting and evaluating on the same data will always
produce an improvement, and that improvement is worth nothing.
"""
import math
import statistics

from ..analysis.decision import WEIGHTS
from .metrics import spearman


def classify(records, key, tolerance=1e-6):
    """Is this a RANKING signal or a TIMING signal?

    `market` came back with ``n_dates: 0`` in the first 63-name run, reported as
    "never enough names to measure". That was misleading. The market regime is
    the *same value for every stock on a given date* -- it is derived from
    SPY/QQQ, not from the company. It therefore has no cross-sectional variance
    and rank correlation against it is undefined, no matter how many names are
    in the universe.

    That is not a measurement failure, it is a category error. Market and macro
    answer "should I be invested at all this month?", not "which of these
    stocks is best?". Inside a cross-sectional composite they contribute
    nothing but dilution: every candidate gets the same 64.63, so the ranking
    is unchanged and the weight is simply removed from the components that do
    vary.
    """
    by_date = {}
    for r in records:
        v = (r.get("components") or {}).get(key)
        if v is not None:
            by_date.setdefault(r["as_of"], []).append(v)
    if not by_date:
        return "unmeasured"
    varying = sum(1 for vals in by_date.values()
                  if len(vals) > 1 and (max(vals) - min(vals)) > tolerance)
    return "ranking" if varying > 0.5 * len(by_date) else "timing"


def timing_ic(records, key, horizon_days=None, every_days=None):
    """Does a constant-per-date component predict the MARKET's next move?

    The right question for market and macro. One observation per date: the
    component's value against the benchmark's forward return.

    The caveat matters more here than anywhere else in this file. Timing tests
    have one observation per date, not one per stock, so the sample is tiny to
    begin with. Overlapping windows shrink it further, and three years of data
    contains roughly one market cycle -- which is, in effect, a single
    observation of the thing being tested. v2.1 reported a timing IC of -0.51
    for `market` and called it "suggestive". With about eighteen independent
    dates drawn from one cycle, it is not suggestive of anything.
    """
    import math

    per_date = {}
    for r in records:
        v = (r.get("components") or {}).get(key)
        b = r.get("benchmark_return_pct")
        if v is not None and b is not None:
            per_date[r["as_of"]] = (v, b)

    n = len(per_date)
    if n < 12:
        return {"n_dates": n, "effective_n": None, "ic": None,
                "reads": "Too few dates to test as a timing signal."}

    overlap = max(1.0, (horizon_days or 1) / max(every_days or 1, 1))
    eff = max(int(n / overlap), 2)

    ic = spearman([v for v, _ in per_date.values()],
                  [b for _, b in per_date.values()])
    if ic is None:
        return {"n_dates": n, "effective_n": eff, "ic": None,
                "reads": "Not computable."}

    # Spearman's standard error is roughly 1/sqrt(n-1) under the null.
    se = 1.0 / math.sqrt(max(eff - 1, 1))
    t = ic / se

    if eff < 30:
        reads = (
            f"Timing IC {ic:+.3f} over {n} dates, but only about {eff} of them are "
            f"independent once overlapping windows are accounted for (se ~{se:.2f}, "
            f"t~{t:+.1f}). Three years is roughly one market cycle, so this is close "
            "to a single observation. Not evidence of anything in either direction."
        )
    elif abs(t) < 2:
        reads = (f"Timing IC {ic:+.3f} (effective n~{eff}, t~{t:+.1f}) -- no useful "
                 "relationship with the market's own next move.")
    else:
        reads = (
            f"Timing IC {ic:+.3f} (effective n~{eff}, t~{t:+.1f}). Worth a proper "
            "test on a longer history covering several distinct market cycles "
            "before believing it."
        )
    return {"n_dates": n, "effective_n": eff, "ic": ic,
            "std_error": round(se, 3), "t_stat": round(t, 2), "reads": reads}


def _per_date_ic(records, value_fn):
    """Cross-sectional IC per date, which is how signals are properly measured.

    A pooled IC across all dates mixes cross-sectional ranking with market
    timing. Measuring within each date isolates the question that matters:
    on a given morning, did this measure order that day's candidates correctly?
    """
    by_date = {}
    for r in records:
        v = value_fn(r)
        if v is None or r.get("forward_return_pct") is None:
            continue
        by_date.setdefault(r["as_of"], []).append((v, r["forward_return_pct"]))

    ics = []
    for _, pairs in sorted(by_date.items()):
        if len(pairs) < 8:
            continue
        ic = spearman([p[0] for p in pairs], [p[1] for p in pairs])
        if ic is not None:
            ics.append(ic)
    return ics


# Testing several components at the usual |t| > 2 bar gives a high chance
# chance that at least one fires purely by luck. Anyone hunting through
# components for "the one that works" will therefore find one in pure noise.
# The bar is raised in proportion to the number of comparisons being made
# (Bonferroni), so a component has to clear a threshold that accounts for how
# many others were tried alongside it.
def t_threshold(n_tests: int) -> float:
    """|t| a single component must clear when ``n_tests`` are examined together."""
    import math
    if n_tests <= 1:
        return 2.0
    # Normal-approximation inverse CDF for a two-sided alpha of 0.05 / n_tests.
    alpha = 0.05 / n_tests
    p = 1.0 - alpha / 2.0
    # Beasley-Springer-Moro style rational approximation, adequate in this range.
    t = math.sqrt(-2.0 * math.log(1.0 - p))
    z = t - ((2.515517 + 0.802853 * t + 0.010328 * t * t) /
             (1.0 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t ** 3))
    return round(max(2.0, z), 2)


def _stats(ics, n_tests: int = 1, overlap: float = 1.0):
    thr = t_threshold(n_tests)
    if not ics:
        return {"n_dates": 0, "mean_ic": None, "sd": None, "t_stat": None,
                "significant": False, "t_threshold": thr}
    mean = statistics.mean(ics)
    sd = statistics.pstdev(ics) if len(ics) > 1 else 0.0
    # Overlapping windows are not independent observations. Without this the
    # 15-year run reported fundamentals at t = 3.82 against a 2.64 bar; the
    # honest figure is 2.21, which does not clear it.
    effective = max(len(ics) / max(overlap, 1.0), 2.0)
    se = sd / math.sqrt(effective) if sd > 0 else None
    t = mean / se if se else None
    return {
        "n_dates": len(ics),
        "n_effective_dates": round(effective),
        "mean_ic": round(mean, 4),
        "sd": round(sd, 4),
        "t_stat": round(t, 2) if t is not None else None,
        # |t| > 2 is the usual rough bar. With overlapping windows even that is
        # generous, so it is reported as a hint rather than a conclusion.
        "t_threshold": thr,
        "significant": bool(t is not None and abs(t) > thr),
        "share_of_dates_positive": round(sum(1 for x in ics if x > 0) / len(ics), 3),
    }


def _read(name, s):
    if s["n_dates"] == 0:
        return "Never enough names on a single date to measure."
    m, t = s["mean_ic"], s["t_stat"]
    if s["significant"]:
        direction = "helps" if m > 0 else "actively hurts"
        return (f"Mean IC {m:+.3f} (t={t:+.1f}) — {direction}, and the effect is "
                "consistent enough across dates to take seriously.")
    if m is not None and abs(m) > 0.04:
        return (f"Mean IC {m:+.3f} but t={t:+.1f}, short of the {s['t_threshold']} "
                "needed once you account for testing every component at once. "
                "The sign is interesting; the evidence is not.")
    return f"Mean IC {m:+.3f} — no measurable relationship with what happened next."


def attribute(result: dict):
    """Per-component IC, plus how correlated the components are with each other."""
    records = [r for r in (result.get("records") or []) if r.get("components")]
    cfg = result.get("config") or {}
    horizon_days, every_days = cfg.get("horizon_days"), cfg.get("every_days")
    if len(records) < 30:
        return {"status": "insufficient_sample", "n": len(records)}

    # The composite is one pre-specified hypothesis, so it is judged at |t| > 2.
    # The components are a search across eight candidates and are judged harder.
    overlap_all = max(1.0, (horizon_days or 1) / max(every_days or 1, 1))
    composite = _stats(_per_date_ic(records, lambda r: r.get("score")),
                       n_tests=1, overlap=overlap_all)

    # Any component present in the records but absent from WEIGHTS is an
    # experiment (currently the peer-normalised variants). Measured with the
    # same rigour, reported separately so they cannot be mistaken for part of
    # the live score.
    present = set()
    for r in records[:400]:
        present.update((r.get("components") or {}).keys())
    experimental = sorted(present - set(WEIGHTS))

    kinds = {key: classify(records, key) for key in WEIGHTS}
    ranking_keys = [k for k, v in kinds.items() if v == "ranking"]

    # Only cross-sectional components are part of the search, so only they
    # count toward the multiple-testing correction.
    n_tests = max(len(ranking_keys), 1)
    components = {}
    for key in WEIGHTS:
        overlap = max(1.0, (horizon_days or 1) / max(every_days or 1, 1))
        s = _stats(_per_date_ic(records, lambda r, k=key: (r["components"] or {}).get(k)),
                   n_tests=n_tests, overlap=overlap)
        s["kind"] = kinds[key]
        s["current_weight"] = WEIGHTS[key]
        s["coverage"] = round(
            sum(1 for r in records if (r["components"] or {}).get(key) is not None)
            / len(records), 3)
        if kinds[key] == "timing":
            s["timing"] = timing_ic(records, key, horizon_days, every_days)
            s["reads"] = (
                "Constant across stocks on any given date, so it cannot rank them — "
                "inside the composite this weight is pure dilution. "
                + s["timing"]["reads"]
            )
        elif kinds[key] == "unmeasured":
            s["reads"] = (
                "Never present in this backtest, so its weight has never been "
                "validated at all."
            )
        else:
            s["reads"] = _read(key, s)
        components[key] = s

    # Which components duplicate each other? Two measures with an IC of 0.03
    # each are worth twice as much if independent and nothing extra if they are
    # the same signal wearing two names.
    overlaps = []
    keys = list(WEIGHTS)
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            pairs = [((r["components"] or {}).get(a), (r["components"] or {}).get(b))
                     for r in records]
            pairs = [(x, y) for x, y in pairs if x is not None and y is not None]
            if len(pairs) < 30:
                continue
            rho = spearman([p[0] for p in pairs], [p[1] for p in pairs])
            if rho is not None and abs(rho) > 0.5:
                overlaps.append({"pair": [a, b], "rank_correlation": rho})

    # "Helping" and "hurting" require statistical significance at the corrected
    # threshold, not merely a mean IC above 0.02. Without that requirement the
    # diagnosis below would confidently narrate pure noise, which is precisely
    # the failure this whole module is meant to prevent.
    helping = [k for k, v in components.items()
               if v["significant"] and (v["mean_ic"] or 0) > 0]
    hurting = [k for k, v in components.items()
               if v["significant"] and (v["mean_ic"] or 0) < 0]

    # Sub-threshold leanings, reported separately and clearly labelled so they
    # are not mistaken for findings.
    candidates = [
        {"component": k, "mean_ic": v["mean_ic"], "t_stat": v["t_stat"]}
        for k, v in components.items()
        if not v["significant"] and v["mean_ic"] is not None and abs(v["mean_ic"]) > 0.02
    ]

    # --- experimental components, judged at the same bar -------------------
    experiments = {}
    for key in experimental:
        e = _stats(_per_date_ic(records, lambda r, k=key: (r["components"] or {}).get(k)),
                   n_tests=max(len(experimental), 1), overlap=overlap_all)
        e["coverage"] = round(
            sum(1 for r in records if (r["components"] or {}).get(key) is not None)
            / len(records), 3)
        e["reads"] = _read(key, e)
        # Compare each experiment against the live component it would replace.
        base = key.replace("_peer", "")
        base = {"quality": "fundamentals"}.get(base, base)
        if base in components and components[base]["mean_ic"] is not None \
                and e["mean_ic"] is not None:
            delta = e["mean_ic"] - components[base]["mean_ic"]
            e["compared_to"] = base
            e["ic_delta_vs_absolute"] = round(delta, 4)
            # A move from one insignificant number to another insignificant
            # number is not an improvement, however large the delta looks.
            # v2.2 called quality_peer "worth adopting" on a +0.021 delta while
            # its t-stat was 0.73 -- both readings were noise.
            head = (f"Peer-normalising {base} moves its IC from "
                    f"{components[base]['mean_ic']:+.3f} to {e['mean_ic']:+.3f} "
                    f"({delta:+.3f}), t {components[base]['t_stat']:+.2f} -> "
                    f"{e['t_stat']:+.2f}. ")
            if not e["significant"]:
                tail = ("Neither version is significant, so this is noise moving "
                        "around. Not a reason to change anything.")
            elif delta > 0.015:
                tail = "Significant and a real improvement — worth adopting."
            elif delta < -0.015:
                tail = "Significant but worse than the absolute version."
            else:
                tail = ("Significant, but the peer version is no better than the "
                        "absolute one. Adopt it only if you prefer it on reasoning "
                        "rather than on this evidence.")
            e["verdict"] = head + tail
            e["is_improvement"] = bool(e["significant"] and delta > 0.015)
        experiments[key] = e

    # How much of the live engine's weight rests on something this test could
    # not evaluate? A number worth knowing before trusting any score.
    dilution = round(sum(WEIGHTS[k] for k, v in kinds.items() if v == "timing"), 3)
    unvalidated = round(sum(WEIGHTS[k] for k, v in kinds.items() if v == "unmeasured"), 3)

    return {
        "status": "ok",
        "n_records": len(records),
        "component_kinds": kinds,
        "experimental_components": experiments,
        "weight_audit": {
            "ranking_weight": round(sum(WEIGHTS[k] for k in ranking_keys), 3),
            "timing_weight_diluting_the_ranking": dilution,
            "never_validated_weight": unvalidated,
            "note": (
                f"{dilution:.0%} of the score comes from components that are identical "
                f"for every stock on a given date and so cannot affect the ranking, and "
                f"{unvalidated:.0%} from components absent from this test entirely. "
                f"Only {sum(WEIGHTS[k] for k in ranking_keys):.0%} of the weight was "
                "actually measured."
            ),
        },
        "composite": composite,
        "components": components,
        "redundant_pairs": overlaps,
        "multiple_testing": {
            "components_tested": n_tests,
            "t_threshold_used": t_threshold(n_tests),
            "note": (
                f"{n_tests} ranking components tested at once. At the usual |t| > 2 "
                "bar the chance of at least one false positive somewhere in the "
                f"table is roughly {1 - 0.95 ** n_tests:.0%}, so the bar is raised "
                "accordingly."
            ),
        },
        "helping": helping,
        "hurting": hurting,
        "candidates_not_significant": candidates,
        "diagnosis": _diagnose(composite, components, helping, hurting),
    }


def _diagnose(composite, components, helping, hurting):
    m = composite["mean_ic"]
    if m is None:
        return "Not enough cross-sectional data to diagnose anything."

    if helping and hurting:
        return (
            f"The composite IC of {m:+.3f} is misleading. "
            f"{', '.join(helping)} point the right way while "
            f"{', '.join(hurting)} point the wrong way, and the weighted average "
            "cancels them out. This is a weighting problem, not a signal problem — "
            "the parts contain information the composite is throwing away."
        )
    if hurting and not helping:
        return (
            f"No component has a positive relationship with forward returns over "
            f"this period, and {', '.join(hurting)} are actively inverted. Either "
            "the period is unusual, the universe is too small to measure anything, "
            "or the measures need rethinking rather than reweighting."
        )
    if helping and not hurting:
        verb = "carries" if len(helping) == 1 else "carry"
        subject = helping[0] if len(helping) == 1 else ", ".join(helping)
        return (
            f"{subject} {verb} what signal there is. The composite dilutes it with "
            "components that measured nothing. Reweighting is worth testing — but "
            "check the stability section first: if the sub-period ICs change sign, "
            "any reweighting is fitted to a regime rather than discovered."
        )
    return (
        f"Composite IC {m:+.3f} and no individual component clears ±0.02. On this "
        "sample nothing measurable is happening in either direction. Before "
        "concluding the engine has no edge, widen the universe — ranking eight "
        "names per date cannot resolve an effect this size."
    )


# ---------------------------------------------------------------------------
# Weight fitting, with an honest out-of-sample test
# ---------------------------------------------------------------------------

def _composite(components: dict, weights: dict):
    num = den = 0.0
    for k, w in weights.items():
        v = components.get(k)
        if v is None:
            continue
        num += w * v
        den += w
    return (num / den) if den > 0 else None


def fit_weights(result: dict, min_ic: float = 0.0):
    """Derive weights on the first half of the period, test on the second.

    Reporting an in-sample improvement would be meaningless: any weighting fitted
    to a period will fit that period. The number to read is ``test.fitted_ic``
    against ``test.current_ic``, and even that is one draw from one period.
    """
    records = [r for r in (result.get("records") or []) if r.get("components")]
    dates = sorted({r["as_of"] for r in records})
    if len(dates) < 16 or len(records) < 60:
        return {"status": "insufficient_sample",
                "message": "Need at least 16 dates and 60 records to split honestly.",
                "n_dates": len(dates), "n_records": len(records)}

    split = dates[len(dates) // 2]
    train = [r for r in records if r["as_of"] < split]
    test = [r for r in records if r["as_of"] >= split]

    # Fit only over components that can actually rank. Including a
    # constant-per-date component would assign it weight for no reason.
    ranking_keys = [k for k in WEIGHTS if classify(records, k) == "ranking"]

    train_ic = {}
    for key in ranking_keys:
        s = _stats(_per_date_ic(train, lambda r, k=key: (r["components"] or {}).get(k)))
        train_ic[key] = s["mean_ic"]

    # Weight proportional to positive measured IC; anything at or below the
    # threshold gets zero. No component is kept out of loyalty to v1.4's guesses.
    positive = {k: v for k, v in train_ic.items() if v is not None and v > min_ic}
    if not positive:
        return {
            "status": "no_positive_components",
            "split_date": split,
            "train_ic": train_ic,
            "message": (
                "No component had a positive IC on the training half, so there is "
                "nothing to weight toward. This is a real finding: on this universe "
                "and period the engine's ranking carries no information. Widen the "
                "universe before concluding it never will."
            ),
        }

    total = sum(positive.values())
    fitted = {k: round(v / total, 4) for k, v in positive.items()}

    def ic_with(rows, weights):
        return _stats(_per_date_ic(
            rows, lambda r: _composite(r["components"] or {}, weights)))

    return {
        "status": "ok",
        "split_date": split,
        "train": {
            "n_records": len(train),
            "component_ic": train_ic,
            "current_ic": ic_with(train, WEIGHTS)["mean_ic"],
            "fitted_ic": ic_with(train, fitted)["mean_ic"],
        },
        "test": {
            "n_records": len(test),
            "current_ic": ic_with(test, WEIGHTS)["mean_ic"],
            "fitted_ic": ic_with(test, fitted)["mean_ic"],
            "note": "This is the only number worth reading. The train figures will always look good.",
        },
        "current_weights": WEIGHTS,
        "fitted_weights": fitted,
        "dropped": [k for k in WEIGHTS if k not in fitted],
        "excluded_as_non_ranking": [k for k in WEIGHTS if k not in ranking_keys],
        "guidance": _fit_guidance(
            ic_with(test, WEIGHTS)["mean_ic"], ic_with(test, fitted)["mean_ic"], fitted),
    }


def _fit_guidance(current, fitted_ic, fitted):
    if current is None or fitted_ic is None:
        return "Not enough test-period dates to compare."
    delta = fitted_ic - current
    kept = ", ".join(f"{k} {v:.0%}" for k, v in sorted(
        fitted.items(), key=lambda x: -x[1]))
    if fitted_ic <= 0:
        return (
            f"Fitted weights score {fitted_ic:+.3f} out of sample — still no edge. "
            "Reweighting cannot rescue components that do not predict. Set "
            "score_tilt_strength to 0 and treat the engine as an evidence "
            "presenter rather than a ranker."
        )
    if delta <= 0.01:
        return (
            f"Fitted weights score {fitted_ic:+.3f} versus {current:+.3f} for the "
            "current ones — no real improvement out of sample. The training-half "
            "gains did not survive, which usually means they were noise. Keep the "
            "current weights; they are at least not fitted to anything."
        )
    return (
        f"Fitted weights score {fitted_ic:+.3f} versus {current:+.3f} out of sample "
        f"(+{delta:.3f}). Suggested: {kept}. Treat this as a hypothesis, not a "
        "conclusion — re-run on a different universe and a different date range "
        "before changing WEIGHTS in decision.py."
    )

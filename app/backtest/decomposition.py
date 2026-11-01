"""Where does a signal actually live — between sectors, or within them?

## Why this exists

`valuation` scores +0.0775 (t = 3.09) on absolute thresholds. Rank the same
metric within sector and it collapses to +0.0152 (t = 0.76). Something has to
explain that, and there are two candidates that point in opposite directions:

**(a) The effect is between sectors.** Cheap *sectors* beat expensive sectors
over this period. Absolute thresholds capture that because they rank a bank
against a software firm; sector-relative ranking deliberately removes it. If
this is the explanation, the "valuation edge" is a sector rotation bet, and it
will last exactly as long as that rotation does.

**(b) Small cohorts destroyed it.** With 63 names across 11 sectors, a sector
cohort is often 5-8 companies. A percentile computed on six observations is
coarse, and coarse measurement attenuates any real effect toward zero. If this
is the explanation, a within-sector effect exists and the test was too blunt to
see it.

Percentile ranking cannot tell these apart. This module can, by decomposing the
raw score rather than re-ranking it:

* **Between-sector IC** — rank each sector by its average score that day
  against that sector's average forward return. One observation per sector per
  date, so cohort size never enters.
* **Within-sector IC** — subtract each sector's mean from both the score and
  the return, then correlate the residuals across all names. This uses the
  continuous score rather than a rank, so a six-company sector contributes
  usable information instead of a crude percentile.

The two add up to roughly the total. Whichever dominates is where the signal is.
"""
import math
import statistics

from .metrics import spearman

MIN_SECTORS = 4
MIN_NAMES_IN_SECTOR = 3


def _stats(values, label="", overlap: float = 1.0):
    """Mean IC with an overlap-adjusted standard error.

    v3.2 fixed this in metrics.py and attribution.py and missed this file, so
    the decomposition kept dividing by sqrt(n_dates) as if a 63-day horizon
    sampled every 21 days gave independent observations. On the screened
    universe that reported within_sector at t = +3.42, which is 1.97 once
    adjusted — the difference between a finding and a null.
    """
    if not values:
        return {"n_dates": 0, "mean_ic": None, "std_error": None,
                "t_stat": None, "significant": False}
    mean = statistics.mean(values)
    sd = statistics.pstdev(values) if len(values) > 1 else 0.0
    effective = max(len(values) / max(overlap, 1.0), 2.0)
    se = sd / math.sqrt(effective) if sd > 0 else None
    t = mean / se if se else None
    return {
        "n_dates": len(values),
        "n_effective_dates": round(effective),
        "mean_ic": round(mean, 4),
        "sd": round(sd, 4),
        "std_error": round(se, 4) if se else None,
        "t_stat": round(t, 2) if t is not None else None,
        "significant": bool(t is not None and abs(t) > 2.0),
        "share_of_dates_positive": round(
            sum(1 for v in values if v > 0) / len(values), 3),
    }


def _by_date(records):
    out = {}
    for r in records:
        out.setdefault(r["as_of"], []).append(r)
    return out


def _value(r, key):
    if key in r:
        return r[key]
    return (r.get("components") or {}).get(key)


def decompose(records, key="valuation", horizon_days=None, every_days=None):
    """Split a component's information coefficient by where it comes from."""
    overlap = max(1.0, (horizon_days or 1) / max(every_days or 1, 1))
    usable = [r for r in records
              if _value(r, key) is not None
              and r.get("forward_return_pct") is not None
              and r.get("sector")]
    if len(usable) < 100:
        return {"status": "insufficient_sample", "n": len(usable),
                "message": ("Needs at least 100 observations carrying a sector "
                            "label. Check that set_sectors ran.")}

    between_ics, within_ics, cohort_sizes = [], [], []

    for _, day in sorted(_by_date(usable).items()):
        sectors = {}
        for r in day:
            sectors.setdefault(r["sector"], []).append(r)
        sectors = {k: v for k, v in sectors.items()
                   if len(v) >= MIN_NAMES_IN_SECTOR}
        if len(sectors) < MIN_SECTORS:
            continue
        cohort_sizes.extend(len(v) for v in sectors.values())

        # --- between: does a cheap SECTOR beat an expensive one? ------------
        s_scores, s_returns = [], []
        for _, members in sectors.items():
            s_scores.append(statistics.mean([_value(m, key) for m in members]))
            s_returns.append(statistics.mean(
                [m["forward_return_pct"] for m in members]))
        b = spearman(s_scores, s_returns) if len(s_scores) >= 8 else None
        if b is None and len(s_scores) >= MIN_SECTORS:
            b = _small_spearman(s_scores, s_returns)
        if b is not None:
            between_ics.append(b)

        # --- within: inside a sector, does the cheaper name beat the dearer? -
        xs, ys = [], []
        for _, members in sectors.items():
            vals = [_value(m, key) for m in members]
            rets = [m["forward_return_pct"] for m in members]
            mv, mr = statistics.mean(vals), statistics.mean(rets)
            xs.extend(v - mv for v in vals)
            ys.extend(r - mr for r in rets)
        w = spearman(xs, ys)
        if w is not None:
            within_ics.append(w)

    between = _stats(between_ics, overlap=overlap)
    within = _stats(within_ics, overlap=overlap)
    return {
        "status": "ok",
        "component": key,
        "n_observations": len(usable),
        "median_cohort_size": (int(statistics.median(cohort_sizes))
                               if cohort_sizes else None),
        "between_sector": {
            **between,
            "question": "Do cheap sectors beat expensive sectors?",
        },
        "within_sector": {
            **within,
            "question": "Inside a sector, does the cheaper company beat the dearer one?",
        },
        "interpretation": _interpret(key, between, within,
                                     cohort_sizes and statistics.median(cohort_sizes)),
    }


def _small_spearman(xs, ys):
    """Spearman for the 4-7 sector case, which the main helper declines."""
    if len(xs) < 4:
        return None
    n = len(xs)
    rx = sorted(range(n), key=lambda i: xs[i])
    ry = sorted(range(n), key=lambda i: ys[i])
    rank_x = {v: i for i, v in enumerate(rx)}
    rank_y = {v: i for i, v in enumerate(ry)}
    d2 = sum((rank_x[i] - rank_y[i]) ** 2 for i in range(n))
    return round(1 - (6 * d2) / (n * (n * n - 1)), 4)


def _interpret(key, between, within, cohort):
    b, w = between["mean_ic"], within["mean_ic"]
    if b is None or w is None:
        return "Not enough sector structure to decompose."

    small_cohorts = cohort is not None and cohort < 8
    cohort_note = (
        f" Median sector cohort is {cohort:.0f} companies, which is small — a "
        "weak within-sector effect could be hidden by that, so a null here is "
        "less conclusive than a null between sectors."
        if small_cohorts else "")

    if between["significant"] and not within["significant"]:
        return (
            f"The {key} signal is BETWEEN sectors ({b:+.3f}, t={between['t_stat']:+.2f}) "
            f"and absent within them ({w:+.3f}, t={within['t_stat']:+.2f}). That means "
            "it is a sector rotation bet, not company selection: it ranks cheap "
            "industries above expensive ones and says little about which company "
            "inside an industry to own. It will keep working for as long as that "
            "rotation continues, and stop when it reverses." + cohort_note
        )
    if within["significant"] and not between["significant"]:
        return (
            f"The {key} signal is WITHIN sectors ({w:+.3f}, t={within['t_stat']:+.2f}) "
            f"and not between them ({b:+.3f}). This is the good case: it is genuine "
            "company selection, and it survives sector-neutral construction. Build "
            "the portfolio sector-neutral to isolate it from sector risk."
        )
    if within["significant"] and between["significant"]:
        return (
            f"Both parts are significant: between {b:+.3f}, within {w:+.3f}. Part "
            "sector rotation, part company selection. A sector-neutral portfolio "
            "keeps the second and drops the first — worth running both to see how "
            "much of the return each side was providing."
        )
    return (
        f"Neither part is significant on its own (between {b:+.3f} t="
        f"{between['t_stat']:+.2f}, within {w:+.3f} t={within['t_stat']:+.2f}). "
        f"The headline {key} IC is not clearly attributable to either, which "
        "usually means it is weaker than the headline number suggests."
        + cohort_note
    )

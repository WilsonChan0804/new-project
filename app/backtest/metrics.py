"""Backtest metrics.

## Why this file was rewritten in v2.1

The first 63-name run reported a pooled IC of -0.092 while the per-date mean
was -0.005 +/- 0.032. Those describe different things, and the verdict was
reading the wrong one.

**Pooled IC** pools every (score, return) pair across all dates. It mixes two
questions: "did the score rank stocks correctly on a given morning?" and "did
the score happen to be high in months the whole market fell?" The second
dominates, because the spread of returns *across* months is far larger than the
spread *within* a month.

**Per-date IC** asks only the first question, which is the one a stock-picking
score is answerable for. It is now the headline. The pooled figure is kept as a
diagnostic: a large gap between the two means the score is entangled with market
timing, which is worth knowing but is not stock-selection skill.

The bucket tables had the same flaw, so returns are now **demeaned within each
date** before bucketing. Without that, a bucket populated mostly during one
favourable quarter looks like a discovery.

Rules of thumb: a per-date mean IC of 0.02-0.05 is a real but modest edge,
0.05-0.10 is strong, and above 0.15 on a small sample almost always means a
look-ahead leak rather than a discovery.
"""
import math
import statistics


def _rank(values):
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def spearman(xs, ys):
    if len(xs) < 8:
        return None
    rx, ry = _rank(xs), _rank(ys)
    n = len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return round(num / den, 4) if den else None


def _by_date(rows):
    out = {}
    for r in rows:
        out.setdefault(r["as_of"], []).append(r)
    return out


def _demean(rows):
    """Each row's forward return minus that date's average.

    The cross-sectional residual: how the stock did *relative to the other
    candidates that morning*. That is what a ranking score is responsible for.
    The raw return also contains whatever the market did that quarter, which the
    score had no say in.
    """
    out = []
    for _, group in _by_date(rows).items():
        rets = [g["forward_return_pct"] for g in group]
        if len(rets) < 2:
            continue
        avg = statistics.mean(rets)
        for g in group:
            out.append({**g, "demeaned_return_pct": g["forward_return_pct"] - avg})
    return out


def per_date_ic(rows, value_fn=lambda r: r.get("score"), min_names=8):
    ics = []
    for d, group in sorted(_by_date(rows).items()):
        pairs = [(value_fn(g), g["forward_return_pct"]) for g in group]
        pairs = [(x, y) for x, y in pairs if x is not None and y is not None]
        if len(pairs) < min_names:
            continue
        ic = spearman([p[0] for p in pairs], [p[1] for p in pairs])
        if ic is not None:
            ics.append({"as_of": d, "ic": ic, "n": len(pairs)})
    return ics


def ic_stats(ics, overlap: float = 1.0):
    """Mean IC with a standard error that accounts for overlapping windows.

    A 63-day horizon sampled every 21 days means consecutive dates share two
    thirds of their window, so 261 dates are not 261 independent observations —
    they are about 87. Dividing by sqrt(n_dates) understates the standard error
    by sqrt(overlap), which inflates every t-statistic by the same factor.

    This mattered: on the 15-year run, `fundamentals` read t = 3.82 against a
    corrected bar of 2.64 and looked like a discovery. Adjusted for overlap it
    is 2.21, and does not clear the bar. The headline sample size already
    reported `n_effective`; the significance test was not using it.
    """
    return _ic_stats_impl(ics, overlap)


def _ic_stats_impl(ics, overlap: float = 1.0):
    if not ics:
        return {"n_dates": 0, "mean_ic": None, "sd": None, "std_error": None,
                "t_stat": None, "significant": False}
    vals = [x["ic"] for x in ics]
    mean = statistics.mean(vals)
    sd = statistics.pstdev(vals) if len(vals) > 1 else 0.0
    effective = max(len(vals) / max(overlap, 1.0), 2.0)
    se = sd / math.sqrt(effective) if sd > 0 else None
    t = mean / se if se else None
    return {
        "n_dates": len(vals),
        "n_effective_dates": round(effective),
        "overlap_factor": round(overlap, 1),
        "mean_ic": round(mean, 4),
        "sd": round(sd, 4),
        "std_error": round(se, 4) if se else None,
        "t_stat": round(t, 2) if t is not None else None,
        "significant": bool(t is not None and abs(t) > 2.0),
        "share_of_dates_positive": round(sum(1 for v in vals if v > 0) / len(vals), 3),
    }


def _buckets(rows, key, edges, labels, return_key):
    out = []
    for i, (lo, hi) in enumerate(edges):
        sel = [r for r in rows if r.get(key) is not None and lo <= r[key] < hi]
        if not sel:
            continue
        rets = [r[return_key] for r in sel]
        out.append({
            "bucket": labels[i],
            "n": len(sel),
            "mean_return_pct": round(statistics.mean(rets), 2),
            "median_return_pct": round(statistics.median(rets), 2),
            "hit_rate": round(sum(1 for r in rets if r > 0) / len(rets), 3),
        })
    return out


def _stability(rows, n_parts=3):
    """Does whatever edge exists hold up across sub-periods?

    A signal that works in one half and reverses in the other has not been
    discovered; it has been fitted to a regime. This is the most common way a
    promising backtest turns out to be nothing, so it gets its own section.
    """
    dates = sorted({r["as_of"] for r in rows})
    if len(dates) < n_parts * 6:
        return None
    size = len(dates) // n_parts
    parts = []
    for i in range(n_parts):
        chunk = dates[i * size:(i + 1) * size] if i < n_parts - 1 else dates[i * size:]
        sel = [r for r in rows if r["as_of"] in chunk]
        s = _ic_stats_impl(per_date_ic(sel), 1.0)
        parts.append({"period": f"{chunk[0]} to {chunk[-1]}",
                      "n_dates": s["n_dates"], "mean_ic": s["mean_ic"]})

    ics = [p["mean_ic"] for p in parts if p["mean_ic"] is not None]
    if len(ics) < 2:
        return {"periods": parts, "verdict": "Not enough sub-periods to judge."}

    signs = {1 if v > 0 else -1 for v in ics}
    spread = max(ics) - min(ics)
    if len(signs) > 1 and spread > 0.10:
        verdict = (
            f"Unstable. Sub-period ICs run from {min(ics):+.3f} to {max(ics):+.3f} "
            "and change sign. Whatever the average says, the relationship is not the "
            "same thing in each period -- treat any fitted weights as fitted to a "
            "regime, not discovered."
        )
    elif len(signs) > 1:
        # Signs differ but the spread is small: every sub-period sits near zero.
        # Calling this a "consistent sign" would be simply false.
        verdict = (
            f"Sub-period ICs change sign ({min(ics):+.3f} to {max(ics):+.3f}) but "
            "all sit close to zero. Consistent with there being no relationship at "
            "all, rather than a relationship that flips."
        )
    elif spread > 0.08:
        verdict = (f"Wide spread ({min(ics):+.3f} to {max(ics):+.3f}) but a "
                   "consistent sign. Weak evidence of something persistent.")
    else:
        verdict = f"Consistent across sub-periods ({min(ics):+.3f} to {max(ics):+.3f})."
    return {"periods": parts, "ic_spread": round(spread, 4), "verdict": verdict}


def summarise(result: dict):
    rows = [r for r in (result.get("records") or [])
            if r.get("score") is not None and r.get("forward_return_pct") is not None]
    if len(rows) < 10:
        return {"status": "insufficient_sample", "n": len(rows),
                "message": ("Fewer than 10 resolved observations. Widen the date "
                            "range or add tickers."),
                "warnings": result.get("warnings", [])}

    horizon_cfg = result["config"]["horizon_days"]
    every_cfg = result["config"]["every_days"]
    overlap_cfg = max(1.0, horizon_cfg / max(every_cfg, 1))

    ics = per_date_ic(rows)
    stats = ic_stats(ics, overlap_cfg)
    pooled = spearman([r["score"] for r in rows],
                      [r["forward_return_pct"] for r in rows])

    dm = _demean(rows)
    horizon = result["config"]["horizon_days"]
    every = result["config"]["every_days"]
    overlap = max(1.0, horizon / max(every, 1))

    bench = [r["benchmark_return_pct"] for r in rows
             if r.get("benchmark_return_pct") is not None]
    edges = [(0, 40), (40, 50), (50, 60), (60, 70), (70, 101)]
    labels = ["<40", "40-50", "50-60", "60-70", "70+"]

    return {
        "status": "ok",
        "n_observations": len(rows),
        "n_dates": stats["n_dates"],
        "n_effective": int(len(rows) / overlap),
        "overlap_factor": round(overlap, 1),
        "date_range": [result["config"]["start"], result["config"]["end"]],
        "horizon_days": horizon,

        # --- headline: stock-selection skill ------------------------------
        "information_coefficient": stats["mean_ic"],
        "ic_std_error": stats["std_error"],
        "ic_t_stat": stats["t_stat"],
        "ic_significant": stats["significant"],
        "ic_sd_across_dates": stats["sd"],
        "ic_effective_dates": stats.get("n_effective_dates"),
        "ic_se_note": (
            f"Standard error uses {stats.get('n_effective_dates')} effective dates, "
            f"not {stats['n_dates']} calendar dates: a {horizon_cfg}-day horizon "
            f"sampled every {every_cfg} days means consecutive observations share "
            "most of their window."
        ),
        "share_of_dates_positive": stats["share_of_dates_positive"],
        "ic_by_date": ics[:24],

        # --- diagnostic only ----------------------------------------------
        "pooled_ic": pooled,
        "pooled_vs_per_date_note": _pooled_note(pooled, stats["mean_ic"]),

        "stability": _stability(rows),

        "score_buckets_cross_sectional": _buckets(
            dm, "score", edges, labels, "demeaned_return_pct"),
        "score_buckets_raw": _buckets(
            rows, "score", edges, labels, "forward_return_pct"),
        "bucket_note": (
            "Read the cross-sectional table. The raw table pools dates, so a bucket "
            "populated mostly during one good quarter looks skilful when it is not."
        ),

        "mean_return_pct": round(
            statistics.mean([r["forward_return_pct"] for r in rows]), 2),
        "mean_benchmark_return_pct": round(statistics.mean(bench), 2) if bench else None,

        "verdict": _verdict(stats),
        "warnings": result.get("warnings", []),
        "how_to_read": (
            "information_coefficient is the average per-date rank correlation "
            "between the score and what happened next: did the score order that "
            "morning's candidates correctly? Judge it against ic_std_error, not "
            "against zero. Then check stability -- an average that hides a sign flip "
            "between periods is a fitted regime, not an edge."
        ),
    }


def _pooled_note(pooled, per_date):
    if pooled is None or per_date is None:
        return None
    gap = pooled - per_date
    if abs(gap) < 0.03:
        return "Pooled and per-date agree; no meaningful timing component."
    direction = "high" if gap < 0 else "low"
    return (
        f"Pooled IC ({pooled:+.3f}) differs from the per-date mean ({per_date:+.3f}) "
        f"by {gap:+.3f}. That gap is market timing, not stock ranking: the score "
        f"tended to be {direction} in periods that turned out badly. Only the "
        "per-date figure measures stock selection."
    )


def _verdict(stats):
    ic, se, t, n = (stats["mean_ic"], stats["std_error"],
                    stats["t_stat"], stats["n_dates"])
    if ic is None:
        return "Not enough data to measure anything."
    if n < 20:
        return (f"Mean IC {ic:+.3f} over only {n} dates. Too few periods to "
                "distinguish skill from luck. Extend the date range.")
    if t is None or abs(t) < 2.0:
        return (
            f"Mean IC {ic:+.3f} +/- {se:.3f} (t={t:+.2f}). INDISTINGUISHABLE FROM "
            "ZERO. The score orders stocks about as well as alphabetical order "
            "would. This is a genuine null, not a negative -- the composite is not "
            "backwards, it is uninformative. Check the component table: a flat "
            "composite can still contain parts that work."
        )
    if ic < 0:
        return (
            f"Mean IC {ic:+.3f} +/- {se:.3f} (t={t:+.2f}) -- reliably negative over "
            "this period. Before flipping the sign, check stability: a signal that "
            "inverts in only one regime is not a tradable insight."
        )
    if ic < 0.05:
        return (f"Mean IC {ic:+.3f} +/- {se:.3f} (t={t:+.2f}) -- a modest but "
                "measurable edge, in the range most real equity signals occupy. "
                "Confirm it holds across sub-periods before acting on it.")
    if ic < 0.15:
        return (f"Mean IC {ic:+.3f} (t={t:+.2f}) -- strong for an equity signal. "
                "Verify on a period the weights were not chosen against.")
    return (f"Mean IC {ic:+.3f} -- higher than published equity signals typically "
            "achieve, which usually indicates a look-ahead leak. Audit the "
            "point-in-time handling before celebrating.")

"""Composite scoring and action selection.

Two structural fixes over v1.4:

1. Missing components no longer get a silent 50. The weights are renormalised
   over whatever data actually exists, and the fraction of weight backed by
   real data (``coverage``) is a first-class output. Below
   ``settings.min_coverage`` the engine refuses to give a directional action.

2. Confidence is no longer ``45 + 0.30 * abs(score - 50)``. That formula made
   the engine *more* confident the more extreme its answer was -- which is a
   description of the answer, not of the evidence, and it fed straight back
   into the action ladder. Confidence here is built from data coverage,
   agreement between independent signals, and data freshness.
"""
import statistics

from ..config import settings

WEIGHTS = {
    "market": 0.10,
    "sector": 0.10,
    "fundamentals": 0.15,
    "growth": 0.10,
    "valuation": 0.10,
    "technical": 0.20,
    "money_flow": 0.10,
    "news": 0.15,
}

# Standard deviation across components at which signals are treated as
# maximally contradictory. Tune this once you have calibration data.
MAX_DISPERSION = 30.0


def composite(parts: dict):
    """Weighted mean over available components only."""
    num = den = 0.0
    for key, w in WEIGHTS.items():
        v = parts.get(key)
        if v is None:
            continue
        num += w * float(v)
        den += w
    total_w = sum(WEIGHTS.values())
    coverage = den / total_w
    score = round(num / den, 2) if den > 0 else None
    return score, round(coverage, 3)


def agreement(parts: dict):
    """0-100: do the independent signals point the same way?

    Spread-out components mean the evidence conflicts, which should lower
    confidence even when the average happens to look strong.
    """
    vals = [float(v) for v in parts.values() if v is not None]
    if len(vals) < 3:
        return None
    sd = statistics.pstdev(vals)
    # ~30 points of dispersion is close to maximal disagreement on a 0-100 scale.
    return round(max(0.0, 100.0 * (1.0 - sd / MAX_DISPERSION)), 2)


def confidence(coverage, agree, freshness_pct, news_events):
    """Evidence quality. Deliberately independent of which way the score points."""
    c = 100.0 * coverage                       # can we see enough?
    if agree is not None:
        c = 0.6 * c + 0.4 * agree              # do the signals concur?
    if freshness_pct is not None:
        c *= 0.85 + 0.15 * (freshness_pct / 100.0)
    if news_events is not None and news_events < 3:
        c *= 0.90                              # thin news basis
    return round(max(0.0, min(100.0, c)), 2)


def critical_missing(parts: dict):
    """Which informative components are absent?

    Coverage is a blunt instrument: it treats every missing component alike.
    But the components are not alike — the backtest found exactly one that
    carries measurable information, and a run missing that one is not 65% of an
    answer, it is a different question.
    """
    wanted = [c.strip() for c in settings.critical_components.split(",") if c.strip()]
    return [c for c in wanted if parts.get(c) is None]


def choose_action(score, conf, coverage, reward_to_risk, parts=None):
    """Action ladder. Refuses to act when the evidence base is too thin."""
    missing = critical_missing(parts or {})
    if missing and score is not None:
        names = ", ".join(missing)
        return "NO ACTION", (
            f"Missing {names} — the component the backtest found most informative. "
            "Overall coverage looks adequate, but the score without it is not the "
            "same measurement."
        )

    if score is None or coverage < settings.min_coverage:
        return "INSUFFICIENT DATA", (
            f"Only {round(100 * coverage)}% of scoring weight is backed by real "
            f"data (minimum {round(100 * settings.min_coverage)}%)."
        )

    if conf < settings.min_confidence_for_action:
        return "NO ACTION", (
            "Evidence quality is too low to justify a directional call. "
            "This is a valid answer, not a failure."
        )

    # v3.10: the expected-value gate now covers every buy-side action, not just
    # scores of 68+. Before, a score of 64-67 with negative expected return after
    # costs still came out ACCUMULATE: a recommendation to buy something the
    # engine's own arithmetic said would lose money. With score_tilt_strength at
    # 0 the expected return is always negative after costs, so in practice the
    # engine no longer says BUY or ACCUMULATE at all. That is the honest output
    # of a score measured as uninformative.
    if reward_to_risk is not None and reward_to_risk <= 0 and score >= 64:
        return "WATCH", (
            "Score is constructive but expected value is negative after costs "
            "over this horizon, so this is not a buy signal."
        )

    if score >= 72 and conf >= 70:
        return "BUY", "Strong composite with well-supported evidence."
    if score >= 64:
        return "ACCUMULATE", "Constructive composite; scale in rather than commit fully."
    if score >= 55:
        return "WATCH", "Mildly positive but not compelling; wait for confirmation."
    if score >= 45:
        return "HOLD", "No directional edge either way."
    if score >= 35:
        return "REDUCE", "Evidence leans negative."
    return "AVOID", "Evidence is clearly negative."


def evaluate(parts: dict, freshness_pct=None, news_events=None):
    score, coverage = composite(parts)
    agree = agreement(parts)
    conf = confidence(coverage, agree, freshness_pct, news_events)
    return {
        "opportunity_score": score,
        "coverage": coverage,
        "agreement": agree,
        "confidence": conf,
        "missing_components": [k for k in WEIGHTS if parts.get(k) is None],
        "weights_used": {
            k: round(w / sum(WEIGHTS[x] for x in WEIGHTS if parts.get(x) is not None), 3)
            for k, w in WEIGHTS.items()
            if parts.get(k) is not None
        },
    }

"""Scenario and expected-value engine.

What changed, and why it matters more than anything else in this rebuild:

v1.4 derived BOTH the probabilities AND the return magnitudes from the
composite score. Expected value was therefore a monotonic re-labelling of the
score -- it carried no independent information, but it read like a risk
estimate. It also had no time horizon, so `+14.45%` was a number without
units and could never be checked against reality.

Here:

* Return magnitudes come from the stock's own realised volatility over an
  explicit horizon. They do not depend on the score at all.
* The score only tilts the probabilities, and only weakly, by a constant you
  can see and change (``score_tilt_strength``). That tilt is an UNCALIBRATED
  PRIOR. Until the calibration report says otherwise, treat it as a guess.
* Expected value is reported gross and net of dealing costs and FX friction,
  because a +4% gross edge on a 25bp round trip in a foreign currency is not
  a +4% edge to you.
"""
import math

from ..config import settings

TRADING_DAYS = 252


def build(score, vol_annualised, horizon_days: int, cross_currency: bool = True):
    """Return (scenarios, diagnostics) or (None, reason) if not computable."""
    if vol_annualised is None or vol_annualised <= 0:
        return None, "No realised volatility available; scenarios not computed."
    if horizon_days <= 0:
        return None, "Horizon must be positive."

    sigma_h = vol_annualised * math.sqrt(horizon_days / TRADING_DAYS)

    # Outcome magnitudes: pure volatility geometry, score-independent.
    # Bear leg is wider than bull because equity drawdowns are fat-tailed.
    bull_ret = 1.00 * sigma_h
    base_ret = 0.05 * sigma_h
    bear_ret = -1.35 * sigma_h

    # Probabilities: uninformative prior, weakly tilted by the composite score.
    tilt = 0.0
    if score is not None:
        tilt = max(-1.0, min(1.0, (score - 50.0) / 50.0))
    s = settings.score_tilt_strength

    p_bull = 1 / 3 + s * tilt
    p_bear = 1 / 3 - s * tilt
    p_bull = max(0.05, min(0.80, p_bull))
    p_bear = max(0.05, min(0.80, p_bear))
    p_base = max(0.05, 1.0 - p_bull - p_bear)
    total = p_bull + p_base + p_bear
    p_bull, p_base, p_bear = p_bull / total, p_base / total, p_bear / total

    # Round first, then absorb the residual into Base so the reported
    # probabilities sum to exactly 1 rather than 0.9999.
    p_bull, p_bear = round(p_bull, 4), round(p_bear, 4)
    p_base = round(1.0 - p_bull - p_bear, 4)

    scenarios = [
        {
            "name": "Bull", "probability": round(p_bull, 4),
            "return_pct": round(100 * bull_ret, 2),
            "basis": "+1.00 sigma over the horizon",
        },
        {
            "name": "Base", "probability": round(p_base, 4),
            "return_pct": round(100 * base_ret, 2),
            "basis": "flat to marginally positive",
        },
        {
            "name": "Bear", "probability": round(p_bear, 4),
            "return_pct": round(100 * bear_ret, 2),
            "basis": "-1.35 sigma over the horizon",
        },
    ]

    ev_gross = sum(x["probability"] * x["return_pct"] for x in scenarios)

    cost_pct = settings.roundtrip_cost_bps / 100.0
    if cross_currency and settings.base_currency != settings.quote_currency:
        cost_pct += settings.fx_cost_bps / 100.0
        fx_band = 100 * settings.annual_fx_vol * math.sqrt(horizon_days / TRADING_DAYS)
    else:
        fx_band = 0.0

    ev_net = ev_gross - cost_pct
    downside = abs(min(x["return_pct"] for x in scenarios))

    diagnostics = {
        "horizon_days": horizon_days,
        "horizon_label": horizon_label(horizon_days),
        "sigma_horizon_pct": round(100 * sigma_h, 2),
        "expected_return_pct_gross": round(ev_gross, 2),
        "cost_drag_pct": round(cost_pct, 2),
        "expected_return_pct_net": round(ev_net, 2),
        "expected_downside_pct": round(downside, 2),
        "reward_to_risk": round(ev_net / downside, 3) if downside > 0 else None,
        "fx_uncertainty_pct": round(fx_band, 2),
        "base_currency": settings.base_currency,
        "quote_currency": settings.quote_currency,
        "probability_source": (
            "uninformative 1/3 prior, untilted: the composite score was measured "
            "at IC -0.006 +/- 0.027 and does not rank stocks, so it is not used to "
            "move these odds"
            if settings.score_tilt_strength == 0 else
            f"uninformative 1/3 prior tilted by score at strength "
            f"{settings.score_tilt_strength}; NOT calibrated"
        ),
        "ranking_validated": False,
        "score_influences_probabilities": settings.score_tilt_strength > 0,
        "calibrated": False,
    }
    return scenarios, diagnostics


def horizon_label(days: int) -> str:
    if days <= 7:
        return "~1 week"
    if days <= 25:
        return "~1 month"
    if days <= 70:
        return "~3 months"
    if days <= 140:
        return "~6 months"
    if days <= 300:
        return "~1 year"
    return f"~{round(days / 252, 1)} years"


_label = horizon_label  # backwards-compatible alias

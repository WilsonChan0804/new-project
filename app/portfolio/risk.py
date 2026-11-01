"""Position sizing.

Structurally the soundest file in v1.4 -- but it was orphaned, because
``/analyze`` never produced an invalidation price, so nothing could call it.
v1.5 emits an ATR-based invalidation level from the analyzer, which makes this
reachable.

Additions: beta-adjusted exposure, and an explicit warning when the candidate
would push correlated (same-sector) exposure past the cap. Ten technology
names at 10% each is one bet, not a diversified portfolio.
"""


def size_position(
    portfolio_value: float,
    positions: list,
    candidate: dict,
    max_position_pct: float = 0.10,
    max_sector_pct: float = 0.30,
    max_risk_pct: float = 0.0075,
):
    """Risk-parity style sizing capped by position and sector concentration.

    candidate: {ticker, sector, entry, invalidation, confidence, beta?}
    positions: [{ticker, value, sector, beta?}, ...]
    """
    if portfolio_value <= 0:
        raise ValueError("portfolio_value must be positive")

    entry = float(candidate["entry"])
    invalidation = float(candidate["invalidation"])
    risk_per_share = abs(entry - invalidation)
    if risk_per_share <= 0:
        raise ValueError("entry and invalidation must differ")
    if invalidation >= entry:
        raise ValueError("invalidation must sit below entry for a long position")

    tkr = candidate["ticker"].upper()
    sec = candidate.get("sector")

    current = sum(p["value"] for p in positions if p["ticker"].upper() == tkr)
    sector_value = sum(p["value"] for p in positions if p.get("sector") == sec)

    # 1. How much money am I willing to lose if the thesis is wrong?
    allowed_risk = portfolio_value * max_risk_pct
    # 2. What position size puts exactly that at risk at the invalidation level?
    raw_value = allowed_risk / (risk_per_share / entry)
    # 3. Scale down when the evidence is weak.
    conf = float(candidate.get("confidence") or 50.0)
    confidence_adjusted = raw_value * max(0.25, min(1.0, conf / 100.0))

    position_headroom = portfolio_value * max_position_pct - current
    sector_headroom = portfolio_value * max_sector_pct - sector_value
    final = max(0.0, min(confidence_adjusted, position_headroom, max(0.0, sector_headroom)))

    binding = "none"
    if final <= 0:
        binding = "position_cap" if position_headroom <= 0 else "sector_cap"
    elif final < confidence_adjusted - 0.01:
        binding = "position_cap" if position_headroom < sector_headroom else "sector_cap"

    warnings = []
    if sector_headroom < portfolio_value * 0.05:
        warnings.append(
            f"Sector exposure to {sec} is near the {max_sector_pct:.0%} cap. "
            "Correlated names size together in a drawdown."
        )
    beta = candidate.get("beta")
    if beta is not None and beta > 1.3:
        warnings.append(
            f"Candidate beta is {beta}; a 10% position behaves like "
            f"{round(10 * beta, 1)}% of market exposure."
        )

    return {
        "allowed_risk_value": round(allowed_risk, 2),
        "risk_per_share": round(risk_per_share, 4),
        "stop_distance_pct": round(100 * risk_per_share / entry, 2),
        "raw_position_value": round(raw_value, 2),
        "confidence_adjusted_value": round(confidence_adjusted, 2),
        "recommended_value": round(final, 2),
        "recommended_shares": round(final / entry, 4),
        "resulting_position_pct": round(100 * (current + final) / portfolio_value, 2),
        "resulting_sector_pct": round(100 * (sector_value + final) / portfolio_value, 2),
        "binding_constraint": binding,
        "warnings": warnings,
        "action": "ADD" if final > 0 else "DO NOT ADD",
    }

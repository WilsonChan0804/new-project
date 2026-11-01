"""Portfolio simulator — blueprint #28's missing half.

Per-decision records answer "did the score rank correctly?". They do not answer
"what would have happened to my money?", because that depends on how many
positions you hold, how often you trade, and what it costs — none of which
appear in an information coefficient.

The gap between the two is often large and usually in the disappointing
direction. An IC of 0.05 is a real edge and can still lose money after costs if
the strategy turns over its book every month.

## Non-overlapping periods (fixed in v2.3)

v2.2 took the 63-day forward return, multiplied it by 21/63 to approximate a
21-day return, and annualised the result as if it were a 21-day series. That is
wrong twice over: scaling a 63-day return by a third keeps 63 days of
volatility and divides it by three (understating true 21-day volatility by
about 42%), and consecutive periods shared 42 of their 63 days, so they were
autocorrelated. Together these inflated Sharpe by roughly sqrt(63/21) = 1.73x.
The reported 3.07 was really closer to 1.77.

The fix is to hold each position for the full horizon and only rebalance when
it ends, so periods never overlap. That uses fewer dates, so the simulation is
run once per starting offset (three, for a 63-day horizon sampled every 21
days) and the metrics are averaged. Every date is used, none is double-counted,
and the volatility is the real thing.

## What this does

Holds the top N by score for a full horizon, charges the round-trip cost from
`settings` on whatever actually turned over, and reports Sharpe, maximum
drawdown, turnover and sector concentration — always beside an equal-weight
buy-and-hold of the same universe.

## Read the benchmark column first

The universe here is survivor-only large-cap US equity over a period when that
did well. Almost any strategy on it will show a positive return. The only
number that means anything is the **difference** from equal-weight
buy-and-hold, and even that is flattered by survivorship.
"""
import math
import statistics

from ..config import settings

TRADING_DAYS = 252


def _annualise(period_returns, periods_per_year):
    if not period_returns:
        return None
    total = 1.0
    for r in period_returns:
        total *= (1.0 + r / 100.0)
    years = len(period_returns) / periods_per_year
    if years <= 0 or total <= 0:
        return None
    return round(100.0 * (total ** (1.0 / years) - 1.0), 2)


def _max_drawdown(period_returns):
    peak = equity = 1.0
    worst = 0.0
    for r in period_returns:
        equity *= (1.0 + r / 100.0)
        peak = max(peak, equity)
        worst = min(worst, equity / peak - 1.0)
    return round(100.0 * worst, 2)


def _sharpe(period_returns, periods_per_year):
    if len(period_returns) < 4:
        return None
    mean = statistics.mean(period_returns)
    sd = statistics.pstdev(period_returns)
    if sd == 0:
        return None
    return round((mean / sd) * math.sqrt(periods_per_year), 2)


def _select(day, top_n, min_score, score_key, sector_neutral, per_sector):
    """Pick the book for one rebalance date.

    Sector-neutral picks the best k inside each sector instead of the best N
    overall. That removes the sector bet entirely, which is the only way to see
    whether a signal is company selection or industry rotation wearing a
    company-selection label.
    """
    candidates = [r for r in day if r.get(score_key) is not None]
    if min_score is not None:
        candidates = [c for c in candidates if c[score_key] >= min_score]
    if not sector_neutral:
        return sorted(candidates, key=lambda r: r[score_key], reverse=True)[:top_n]

    by_sector = {}
    for r in candidates:
        by_sector.setdefault(r.get("sector") or "UNKNOWN", []).append(r)
    picks = []
    for _, members in by_sector.items():
        members.sort(key=lambda r: r[score_key], reverse=True)
        picks.extend(members[:per_sector])
    return picks


def _one_pass(by_date, dates, top_n, min_score, score_key, cost_pct, sectors_seen,
              sector_neutral=False, per_sector=1):
    """One non-overlapping pass: hold each selection for the whole horizon."""
    strat, bench, turnovers, holdings = [], [], [], []
    held = set()

    for d in dates:
        day = by_date[d]
        picks = _select(day, top_n, min_score, score_key, sector_neutral, per_sector)

        bench.append(statistics.mean([r["forward_return_pct"] for r in day]))

        if not picks:
            strat.append(0.0)
            turnovers.append(1.0 if held else 0.0)
            held = set()
            continue

        gross = statistics.mean([r["forward_return_pct"] for r in picks])
        new_held = {r["ticker"] for r in picks}
        churn = len(new_held ^ held) / max(len(new_held | held), 1)
        turnovers.append(churn)
        strat.append(gross - cost_pct * churn)
        held = new_held

        sec = {}
        for r in picks:
            key = r.get("sector") or "UNKNOWN"
            sec[key] = sec.get(key, 0) + 1
        sectors_seen.append(sec)
        holdings.append({"as_of": d, "n": len(picks),
                         "tickers": sorted(new_held),
                         "sectors": dict(sorted(sec.items(), key=lambda x: -x[1]))})

    return strat, bench, turnovers, holdings


def _concentration(sectors_seen, top_n):
    """Is this a stock selection or a sector bet wearing one?

    A 'valuation' screen that always lands on the same two sectors is a factor
    bet, and it will keep working exactly as long as that factor does.
    """
    if not sectors_seen:
        return None
    totals = {}
    for sec in sectors_seen:
        for k, v in sec.items():
            totals[k] = totals.get(k, 0) + v
    total = sum(totals.values()) or 1
    shares = {k: round(100.0 * v / total, 1)
              for k, v in sorted(totals.items(), key=lambda x: -x[1])}
    top = list(shares.items())[:2]
    top_share = sum(v for _, v in top)

    if top_share > 55:
        names = (f"{top[0][0]} and {top[1][0]}" if len(top) > 1 else top[0][0])
        plural = "those sectors do" if len(top) > 1 else "that sector does"
        note = (
            f"{names} account for {top_share:.0f}% of all positions held. This is "
            "closer to a sector bet than a stock selection: it is a factor bet, and "
            f"it will work for as long as {plural} — which is not the same as the "
            "score being informative about individual companies."
        )
    elif top_share > 40:
        note = (f"Top two sectors are {top_share:.0f}% of positions — noticeably "
                "concentrated. Worth checking against a sector-neutral version.")
    else:
        note = f"Reasonably spread; top two sectors are {top_share:.0f}% of positions."
    return {"sector_share_pct": shares, "top_two_share_pct": round(top_share, 1),
            "note": note}


def simulate(result: dict, top_n: int = 10, min_score: float | None = None,
             score_key: str = "score", sector_neutral: bool = False,
             per_sector: int = 1):
    """Hold the top N by score for a full horizon, rebalancing when it ends.

    Periods never overlap. The simulation runs once per starting offset and the
    metrics are averaged, so all dates are used without double-counting.
    """
    records = [r for r in (result.get("records") or [])
               if r.get(score_key) is not None
               and r.get("forward_return_pct") is not None]
    if len(records) < 30:
        return {"status": "insufficient_sample", "n": len(records)}

    by_date = {}
    for r in records:
        by_date.setdefault(r["as_of"], []).append(r)
    all_dates = sorted(by_date)

    cfg = result["config"]
    every, horizon = cfg["every_days"], cfg["horizon_days"]

    # Step through the schedule so consecutive holdings do not overlap.
    stride = max(1, round(horizon / max(every, 1)))
    periods_per_year = TRADING_DAYS / horizon

    cost_pct = settings.roundtrip_cost_bps / 100.0
    if settings.base_currency != settings.quote_currency:
        cost_pct += settings.fx_cost_bps / 100.0

    passes, sectors_seen, holdings_all = [], [], []
    for offset in range(stride):
        dates = all_dates[offset::stride]
        if len(dates) < 4:
            continue
        strat, bench, turns, holds = _one_pass(
            by_date, dates, top_n, min_score, score_key, cost_pct, sectors_seen,
            sector_neutral, per_sector)
        passes.append((strat, bench, turns))
        holdings_all.extend(holds)

    if not passes:
        return {"status": "insufficient_sample",
                "message": (f"Only {len(all_dates)} dates at a {horizon}-day horizon "
                            "leaves too few non-overlapping periods to simulate."),
                "n_dates": len(all_dates)}

    def avg(fn):
        vals = [v for v in (fn(*p) for p in passes) if v is not None]
        return round(statistics.mean(vals), 2) if vals else None

    n_per_pass = statistics.mean([len(p[0]) for p in passes])

    strat_all = [x for p in passes for x in p[0]]
    bench_all = [x for p in passes for x in p[1]]
    turn_all = [x for p in passes for x in p[2]]
    mean_turn = statistics.mean(turn_all) if turn_all else 0.0

    out = {
        "status": "ok",
        "config": {"top_n": top_n, "min_score": min_score, "score_key": score_key,
                   "sector_neutral": sector_neutral,
                   "per_sector": per_sector if sector_neutral else None,
                   "holding_period_days": horizon,
                   "non_overlapping_passes": len(passes),
                   "periods_per_pass": round(n_per_pass, 1),
                   "cost_per_full_turnover_pct": round(cost_pct, 3)},
        "strategy": {
            "annualised_return_pct": avg(lambda s, b, t: _annualise(s, periods_per_year)),
            "sharpe": avg(lambda s, b, t: _sharpe(s, periods_per_year)),
            "max_drawdown_pct": avg(lambda s, b, t: _max_drawdown(s)),
            "hit_rate": round(sum(1 for r in strat_all if r > 0) / len(strat_all), 3),
            "mean_period_return_pct": round(statistics.mean(strat_all), 3),
        },
        "benchmark_equal_weight_universe": {
            "annualised_return_pct": avg(lambda s, b, t: _annualise(b, periods_per_year)),
            "sharpe": avg(lambda s, b, t: _sharpe(b, periods_per_year)),
            "max_drawdown_pct": avg(lambda s, b, t: _max_drawdown(b)),
            "hit_rate": round(sum(1 for r in bench_all if r > 0) / len(bench_all), 3),
            "mean_period_return_pct": round(statistics.mean(bench_all), 3),
        },
        "average_turnover": round(mean_turn, 3),
        "annual_cost_drag_pct": round(mean_turn * cost_pct * periods_per_year, 2),
        "sector_concentration": _concentration(sectors_seen, top_n),
        "recent_holdings": sorted(holdings_all, key=lambda h: h["as_of"])[-3:],
    }

    if n_per_pass < 10:
        out["sample_warning"] = (
            f"Only about {n_per_pass:.0f} non-overlapping periods per pass. Sharpe "
            "and drawdown from that few observations are indicative at best."
        )

    out["verdict"] = _verdict(out, mean_turn)
    out["caveats"] = [
        "Positions are held for the full horizon so periods do not overlap. Fewer "
        "periods than the raw date count, but honest volatility.",
        "Survivor-only universe: the benchmark is flattered and so is the strategy.",
        "No slippage, no market impact, no tax. Costs are the round-trip figure "
        "from settings applied to whatever actually turned over.",
        "Read the difference from the benchmark, never the strategy return alone.",
    ]
    return out


def _verdict(out, turnover):
    st, bm = out["strategy"], out["benchmark_equal_weight_universe"]
    s_ann, b_ann = st["annualised_return_pct"], bm["annualised_return_pct"]
    s_sh, b_sh = st["sharpe"], bm["sharpe"]
    if s_ann is None or b_ann is None:
        return "Not enough periods to evaluate."

    gap = s_ann - b_ann
    sh_gap = (s_sh - b_sh) if (s_sh is not None and b_sh is not None) else None
    conc = (out.get("sector_concentration") or {}).get("top_two_share_pct", 0)

    if gap <= 0:
        return (
            f"Strategy {s_ann:+.1f}%/yr versus {b_ann:+.1f}%/yr for simply holding the "
            f"whole universe equally weighted — behind by {abs(gap):.1f} points, with "
            f"{out['annual_cost_drag_pct']:.1f} points of that lost to turnover. "
            "Selecting cost money relative to not selecting."
        )

    # Beating on return alone is not skill if the Sharpe is unchanged: the extra
    # return is then just extra risk.
    if sh_gap is not None and sh_gap < -0.1:
        return (
            f"Strategy returns more ({s_ann:+.1f}%/yr against {b_ann:+.1f}%/yr) but "
            f"with a WORSE Sharpe: {s_sh} versus {b_sh}. Per unit of risk taken, you "
            "did better simply holding the whole universe. The extra return did not "
            "compensate for the extra volatility."
        )
    if sh_gap is not None and sh_gap < 0.15:
        return (
            f"Strategy returns {s_ann:+.1f}%/yr against {b_ann:+.1f}%/yr, but Sharpe is "
            f"{s_sh} versus {b_sh} — effectively unchanged. The extra return is "
            "compensation for extra risk, not evidence the score picks better stocks. "
            "A leveraged holding of the whole universe would have done the same."
        )
    if conc > 55:
        return (
            f"Strategy {s_ann:+.1f}%/yr versus {b_ann:+.1f}%/yr with a better Sharpe "
            f"({s_sh} vs {b_sh}) — but {conc:.0f}% of positions sat in two sectors. "
            "That is a factor bet, and it will last exactly as long as the factor does."
        )
    return (
        f"Strategy {s_ann:+.1f}%/yr versus {b_ann:+.1f}%/yr, Sharpe {s_sh} vs {b_sh}, "
        f"turnover {turnover:.0%} per rebalance. Genuinely encouraging — but on a "
        "survivor-only universe over one period. Re-run on different years and a "
        "clean universe before believing it."
    )

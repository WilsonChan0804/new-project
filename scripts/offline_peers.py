"""Does peer normalisation recover a signal that absolute thresholds destroy?

Synthetic universe with a deliberately realistic distortion:

  * Three sectors with very different natural P/E levels (utilities ~12,
    industrials ~20, software ~45) -- as in reality.
  * Within EVERY sector, the cheaper half outperforms. The signal is real and
    identical in all three.

An absolute P/E threshold cannot see this. It marks every utility cheap and
every software firm expensive, so it ends up ranking sectors, not companies,
and the within-sector signal is buried. Percentile-ranking inside each sector
should recover it.
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.analysis import peers                       # noqa: E402
from app.analysis.features import squash             # noqa: E402
from app.backtest.metrics import ic_stats, per_date_ic  # noqa: E402

rng = random.Random(3)
SECTORS = {"UTILITIES": 12.0, "INDUSTRIALS": 20.0, "SOFTWARE": 45.0}
DATES, PER_SECTOR = 40, 14

records = []
for d in range(DATES):
    as_of = f"2024-{1 + d % 12:02d}-{1 + d // 12:02d}"
    day = []
    for sector, level in SECTORS.items():
        for i in range(PER_SECTOR):
            # position within this sector's own P/E range, -1 (cheap) .. +1
            pos = rng.uniform(-1, 1)
            pe = level * (1 + 0.45 * pos)
            # cheap-within-sector outperforms, identically in every sector
            fwd = -6.0 * pos + rng.gauss(0, 5)
            day.append({"as_of": as_of, "ticker": f"{sector[:3]}{i}", "sector": sector,
                        "raw_metrics": {"pe": pe}, "forward_return_pct": fwd,
                        "absolute": squash((20.0 - pe) / 15.0, k=0.7)})
    # peer rank within sector, exactly as the replay does
    by_sector = {}
    for r in day:
        by_sector.setdefault(r["sector"], []).append(r)
    for r in day:
        cohort = [c["raw_metrics"] for c in by_sector[r["sector"]]]
        r["peer"] = peers.scores(r["raw_metrics"], cohort)["valuation_peer"]
    records.extend(day)

abs_ic = ic_stats(per_date_ic(records, lambda r: r["absolute"]))
peer_ic = ic_stats(per_date_ic(records, lambda r: r["peer"]))

print(f"observations {len(records)}  dates {DATES}  sectors {len(SECTORS)}\n")
print(f"absolute P/E threshold   IC {abs_ic['mean_ic']:+.4f}  t {abs_ic['t_stat']:+.2f}")
print(f"sector percentile        IC {peer_ic['mean_ic']:+.4f}  t {peer_ic['t_stat']:+.2f}")
print(f"\nimprovement              {peer_ic['mean_ic'] - abs_ic['mean_ic']:+.4f}")
print("\nWhy: the truth is 'cheap within its own sector wins'. An absolute")
print("threshold ranks utilities above software on every date regardless of")
print("which companies are actually cheap, so it measures a sector bet.")

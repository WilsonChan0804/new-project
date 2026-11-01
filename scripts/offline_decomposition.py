"""Can the decomposition tell a sector bet from company selection?

Three synthetic universes, each with a known answer:

  A. BETWEEN only — cheap sectors beat expensive sectors, but inside a sector
     the cheap and dear names do equally well. A sector rotation bet.
  B. WITHIN only  — inside every sector the cheaper name wins, but sectors
     themselves are indistinguishable. Genuine company selection.
  C. NEITHER      — valuation is unrelated to anything.

If the decomposition works, it says "between" for A, "within" for B, and
"neither" for C. This is the test that separates the two explanations for the
real result, where absolute valuation scored +0.078 and sector-relative
valuation scored +0.015.
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.backtest.decomposition import decompose  # noqa: E402

SECTORS = ["TECH", "FIN", "ENERGY", "HEALTH", "STAPLES", "INDUSTRIALS"]
DATES, PER_SECTOR = 40, 9


def build(mode, seed=7):
    rng = random.Random(seed)
    records = []
    for d in range(DATES):
        as_of = f"2024-{1 + d % 12:02d}-{1 + d // 12:02d}"
        sector_cheapness = {s: rng.uniform(20, 80) for s in SECTORS}
        for s in SECTORS:
            base = sector_cheapness[s]
            # sector return driven by sector cheapness only in "between"
            sector_ret = (0.10 * (base - 50) if mode == "between" else 0.0)
            for i in range(PER_SECTOR):
                within = rng.uniform(-20, 20)
                score = max(1, min(99, base + within))
                fwd = sector_ret + rng.gauss(0, 4)
                if mode == "within":
                    fwd += 0.25 * within
                records.append({"as_of": as_of, "ticker": f"{s}{i}", "sector": s,
                                "components": {"valuation": score},
                                "forward_return_pct": fwd})
    return records


for mode, expect in [("between", "BETWEEN"), ("within", "WITHIN"), ("none", "NEITHER")]:
    out = decompose(build(mode), "valuation")
    b, w = out["between_sector"], out["within_sector"]
    print(f"\n=== universe: {mode}  (truth: {expect}) ===")
    print(f"  between-sector  IC {b['mean_ic']:+.4f}  t {b['t_stat']:+6.2f}"
          f"  sig={b['significant']}")
    print(f"  within-sector   IC {w['mean_ic']:+.4f}  t {w['t_stat']:+6.2f}"
          f"  sig={w['significant']}")
    print(f"  -> {out['interpretation'][:150]}")

"""Does the attribution layer detect components cancelling each other out?

Synthetic universe where the truth is known:

  * `technical`  is genuinely predictive of the forward return
  * `valuation`  is genuinely ANTI-predictive (expensive names keep winning)
  * everything else is pure noise

Weighted together they largely cancel, so the composite IC lands near zero --
which is exactly the shape of the real AAPL/NVDA-era result. A composite IC of
zero must not be read as "no signal" when this is what is underneath.
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.analysis.decision import WEIGHTS            # noqa: E402
from app.backtest import attribution as attr         # noqa: E402
from app.backtest import universe as uni             # noqa: E402

random.seed(11)
NAMES = 40
DATES = 40


def build():
    records = []
    for d in range(DATES):
        as_of = f"2024-{1 + d % 12:02d}-{1 + (d // 12) * 7:02d}"
        for n in range(NAMES):
            tech = random.uniform(20, 90)
            val = random.uniform(10, 90)
            noise = {k: random.uniform(25, 85) for k in
                     ("market", "sector", "fundamentals", "growth", "money_flow", "news")}
            # truth: return follows technical, moves against valuation
            fwd = (0.22 * (tech - 55) - 0.20 * (val - 50)) / 4.0 + random.gauss(0, 6)
            comps = {"technical": tech, "valuation": val, **noise}
            num = den = 0.0
            for k, w in WEIGHTS.items():
                num += w * comps[k]; den += w
            records.append({
                "as_of": as_of, "ticker": f"T{n}", "score": round(num / den, 2),
                "components": comps, "forward_return_pct": round(fwd, 3),
                "coverage": 1.0, "confidence": 60, "action": "HOLD",
                "benchmark_return_pct": 1.0, "excess_return_pct": round(fwd - 1.0, 3),
            })
    return {"records": records, "warnings": [],
            "config": {"horizon_days": 63, "every_days": 21,
                       "start": "2024-01-01", "end": "2024-12-31"}}


raw = build()
a = attr.attribute(raw)

print("composite IC       :", a["composite"]["mean_ic"], " t =", a["composite"]["t_stat"])
print()
print(f"{'component':<16}{'mean IC':>9}{'t':>8}{'sig':>6}   reads")
for k, v in sorted(a["components"].items(), key=lambda x: -(x[1]["mean_ic"] or 0)):
    print(f"{k:<16}{v['mean_ic']:>9.4f}{v['t_stat']:>8.1f}{str(v['significant']):>6}   {v['reads'][:52]}")
print()
print("helping :", a["helping"])
print("hurting :", a["hurting"])
print("DIAGNOSIS:", a["diagnosis"])
print()

f = attr.fit_weights(raw)
print("=== weight fitting (train on first half, test on second) ===")
print("split date :", f["split_date"])
print("train  current", f["train"]["current_ic"], " fitted", f["train"]["fitted_ic"])
print("TEST   current", f["test"]["current_ic"], " fitted", f["test"]["fitted_ic"])
print("fitted weights:", f["fitted_weights"])
print("dropped:", f["dropped"])
print()
print(f["guidance"])
print()
print("=== sample adequacy ===")
for n in (8, 40):
    print(f"  {n} names:", uni.adequacy(n, DATES)["verdict"][:150])

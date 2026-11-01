"""Does the event study find a real event effect, and reject a fake one?

Three universes with known truth:

  A. NULL    — 8-K filings occur at random and mean nothing.
  B. REAL    — a 4.02 non-reliance filing genuinely precedes a -8% abnormal move.
  C. NOISE MINING — twenty undeclared item codes, all meaningless. The
     pre-registered list must stay clean while the exploratory table lights up,
     which is the whole point of declaring hypotheses in advance.
"""
import os
import random
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.backtest import event_study as es  # noqa: E402

DATES = [date(2020, 1, 6) + timedelta(days=21 * i) for i in range(90)]
NAMES = 60


def build(mode, seed=5):
    rng = random.Random(seed)
    records, filings = [], {f"T{n}": [] for n in range(NAMES)}

    for d in DATES:
        market = rng.gauss(1.5, 7)
        for n in range(NAMES):
            ticker = f"T{n}"
            codes, effect = [], 0.0

            if mode in ("null", "real") and rng.random() < 0.06:
                code = rng.choice(["4.02", "4.01", "2.06", "5.02", "1.01", "2.02"])
                codes.append(code)
                if mode == "real" and code == "4.02":
                    effect = -8.0
            if mode == "mine" and rng.random() < 0.25:
                codes.append(f"9.{rng.randint(10, 29)}")

            if codes:
                filings[ticker].append(
                    {"filed": (d - timedelta(days=rng.randint(1, 40))).isoformat(),
                     "items": codes, "form": "8-K"})

            records.append({
                "as_of": d.isoformat(), "ticker": ticker,
                "forward_return_pct": market + effect + rng.gauss(0, 6),
                "components": {}, "score": 50.0})
    return records, filings


for mode, truth in [("null", "no effect"),
                    ("real", "4.02 really does precede -8%"),
                    ("mine", "20 undeclared codes, all meaningless")]:
    records, filings = build(mode)
    es.attach_events(records, filings)
    out = es.run(records)

    print(f"\n{'=' * 64}\n{mode.upper()}  (truth: {truth})")
    print(f"  observations {out['n_observations']}, with an event "
          f"{out['n_with_any_event']}, bar |t| > {out['t_threshold']}")
    for r in out["results"]:
        if r["status"] != "ok":
            continue
        mark = "  <-- SIGNIFICANT" if r["significant"] else ""
        print(f"    {r['hypothesis']:<22} n={r['n_events']:<5} "
              f"{r['mean_abnormal_return_pct']:+6.2f}%  t={r['t_stat']:+6.2f}{mark}")
    if out["exploratory"]:
        hits = [e for e in out["exploratory"] if e["significant"]]
        print(f"    exploratory: {len(out['exploratory'])} codes tested, "
              f"{len(hits)} 'significant' — none of it evidence")
    print(f"  -> {out['verdict'][:190]}")

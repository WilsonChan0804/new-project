# Roadmap — v3.8.0 · research phase closed

## The question, and the answer

**Does this engine's composite score rank US equities at a three-month horizon?**

No. Measured on 51,436 observations across 261 dates and 250 names spanning
2011-2026, with an independently reproduced measurement layer.

| | |
|---|---|
| Composite IC | **+0.008 ± 0.014**, t = +0.57 |
| Effective dates | 87 (261 calendar, 3x overlap) |
| Detectable floor | ~0.035 — wide enough for the null to mean something |
| Sub-period ICs | −0.000 / −0.010 / +0.034 |
| Composite portfolio | 17.37% / Sharpe **0.81** vs 17.74% / **0.99** |
| Sector-neutral portfolio | 14.44% / Sharpe **0.74** vs 17.74% / **0.99** |
| Alphalens cross-check | agrees to 4 decimal places |

## Every hypothesis, and how it died

Six candidates looked significant at some point. None survived.

| Candidate | Best reading | Killed by | Final |
|---|---|---|---|
| `valuation`, between sectors | +0.113, t = 2.17 | 15-year window | −0.012, t = −0.32 |
| `fundamentals` | +0.042, t = 3.82 | overlap correction | +0.005, t = +0.60 |
| `valuation`, within sectors | +0.029, t = 3.42 | overlap correction | +0.029, t = **1.98** |
| item 1.02, contract termination | −2.94%, t = −3.08 | independent sample | −0.17%, t = −0.05 |
| `impairment` | −5.00%, t = −2.86 | one filing = one event | −6.15%, t = −1.68 |
| Refitted weights | +0.152 in training | held-out half | −0.022 |

Three distinct checks, each of which killed at least one apparent finding:
**a longer window, an overlap correction, an independent sample.**

## The one thing that never quite dies

`valuation` has been positive in every window and has never cleared the bar:

| Window | IC | t | Bar |
|---|---|---|---|
| 3-year, 63 names | +0.092 | 3.60 | 2.64 ✓ |
| 15-year, 63 names | +0.017 | 1.58 | 2.64 |
| 15-year, 250 names | +0.036 | **2.11** | 2.64 |

Consistently positive, consistently short. Three windows of "suggestive but not
significant" is not evidence — it is what a weak-or-absent effect looks like.
The within-sector split is also measured on a median cohort of 12, which is
thin: a null there is less conclusive than the composite null.

If anything here is ever real, it is this. It is not real yet.

## Status by phase

| Phase | Steps | State |
|---|---|---|
| 0 Foundations | 8 | ✅ complete |
| 1 Measurement harness | 9 | ✅ complete |
| 2 Cross-sectional verdict | 7 | ✅ complete — null |
| 2b 15-year verdict | 8 | ✅ complete — null |
| 3 Evidence layer | 8 | ✅ 6 built, 2 partial (news unvalidatable) |
| 4 Widen and deepen | 9 | ✅ complete — warehouse 780k rows, screen 438 names |
| 5 Ruled out | 7 | 🚫 by measurement |
| 6 Paid data | 5 | **Declined — see below** |

## Paid data: no

The decision rule was: buy only if something clears its bar and holds. Nothing
has. Buying a survivorship-free universe now would purchase a more rigorous
confirmation of a null — accurate, and not worth a subscription.

Revisit only if `valuation` clears 2.64 on a fresh window with a cohort above
30 per sector. That would be a reason.

## What the engine is for now

**Research harness.** Point-in-time filings enforced in code, a leak test on
random-walk prices, multiple-testing correction, overlap-adjusted standard
errors in all three modules, pre-registered hypotheses with an independent
confirmation registry, and agreement with Alphalens. This is the part that
worked, and it is why the null is trustworthy.

**Evidence presenter.** Cash flow, leverage and earnings quality from filings
with real dates. 8-K red flags. Sector models — NIM and loan growth for banks,
FFO for REITs, cash runway for biotech, inventory divergence for goods makers,
each carrying the figures behind its claim. Refusal logic that returns
`NO ACTION` rather than a number when the informative component is missing.

**Not a stock picker.** Tested six ways, over fifteen years, on a real
cross-section. `score_tilt_strength` is 0 and should stay there.

## The only work left worth doing

**Run it forward.** Built in v3.9 — `scripts\watchlist.py` and
`scripts\calibration.py`. Everything above is backtest. The engine logs every
decision with its horizon and entry price, and `/api/v1/calibration/report`
scores those against what actually happened. Analyse a watchlist weekly, run
`POST /api/v1/calibration/resolve` monthly, and in six months you will have
something no backtest can give: **out-of-sample evidence generated after the
rules were fixed.**

That is the one remaining test the project has not run, and the only one whose
result is not already known.

## Optional, free, unlikely to change anything

- ALFRED macro vintages — the last free data gap
- Re-screen periodically as listings change
- `build_warehouse.py --refresh` monthly

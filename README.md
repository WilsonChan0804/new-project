# Investment Decision Engine — v3.7.2

> **The score does not rank stocks, and the engine now says so.** Measured at
> IC -0.006 +/- 0.027 over 3,339 observations, with refitted weights scoring
> -0.022 out of sample. `score_tilt_strength` is 0 by default as of v3.0: the
> composite no longer moves the scenario probabilities, because it has been
> tested and does not carry the information that would justify it.
>
> What remains, and works: point-in-time SEC filings, 8-K red flags,
> sector-specific fundamentals, refusal logic, and a research harness that
> agrees with Alphalens to four decimal places. See `ROADMAP.md`.

**Start here:** run the server, then open <http://127.0.0.1:8000> — that is the
plain-English dashboard. The raw JSON API is still at `/docs`.

See `ROADMAP.md` for where this stands against the full 35-point blueprint.

A rebuild of v1.4 focused on one principle: **the engine must never emit a
number it cannot defend.**

v1.4 produced confident-looking output from missing data. Feed it a ticker with
no fundamentals, no news and no price history and it still returned
`HOLD, expected return +4.0%, bull probability 30%`. Every one of those numbers
was manufactured by neutral fills. This version refuses.

---

## What changed and why

### 0. New in v3.0 — acting on the measurement

The backtest returned a composite IC of **-0.006 +/- 0.027** (t = -0.22) with a
detectable floor of 0.035, and — decisively — weights refitted on the first half
of the period scored **-0.022 on the held-out second half**. Reweighting cannot
rescue components that do not predict.

So `score_tilt_strength` is now **0**. A score of 95 and a score of 5 produce
identical scenario probabilities, and `probability_source` explains why. The
plain-English view no longer describes the score as leaning anywhere; it calls
it a summary of the evidence and states that it did not predict which shares
went up.

This removes a claim, not a capability. Untouched: point-in-time filings, 8-K
red flags, sector models, peer normalisation, refusal logic, the
reasons-against panel, and the whole research harness.

### Fixed in v3.7.2

`build_warehouse.py --universe screen` drew only 500 names and silently applied
the critical-component filter, so the 68 screened names without valuation never
got prices downloaded. The filter belongs at backtest time, where it decides
what gets *ranked*; a warehouse should hold whatever you might later want to
look at. It now draws up to `--max-names` (600 by default) and reports what it
found.

### Fixed in v3.9.1 — a log of one company is one observation

The first real forward log held **8 decisions across 4 days, all on one
ticker** — from repeated `/analyze?log=true` calls. `status` reported "8
decisions logged" and the calibration report would have treated them as 8
independent observations. They are closer to one: the same company inside a
single horizon resolves to nearly the same outcome, so the eight agree with
each other by construction rather than by evidence.

`status` now reports distinct tickers and says so plainly when one name
dominates. The report carries `distinct_tickers` and `effective_sample_size`
alongside the raw count.

`watchlist.py` also stops describing the file and just writes it — ten names
across ten sectors, with the reasoning in the comments. Telling someone to
create a file by hand is friction with no purpose.

### New in v3.9.0 — running it forward

Everything measured so far is backtest: today's rules applied to history that
had already happened. The one test the project has not run is the forward one,
and it now has a command line.

```
python scripts\watchlist.py              analyse and log, weekly
python scripts\calibration.py status     what is logged and pending
python scripts\calibration.py resolve    close out anything past its horizon
python scripts\calibration.py report     Brier score against a coin flip
```

Put one ticker per line in `watchlist.txt`. Each run logs a decision with its
horizon and entry price; months later the resolver scores it against what
actually happened.

The expected result is a Brier score near 0.25 — the engine already knows it
does not rank stocks. Running it anyway is the point: a prediction made in
advance and scored in public is worth more than any amount of retrospective
fitting, including when it confirms a null.

### Fixed in v3.8.0 — two places the overlap correction never reached

The screened-universe run (370 names, 261 dates) produced two apparent findings.
Neither survives.

**`within_sector` valuation at t = +3.42.** `decomposition.py` never received
the v3.2 overlap fix that `metrics.py` and `attribution.py` did, so it divided
by √261 as if a 63-day horizon sampled every 21 days gave independent
observations. Adjusted: **t = 1.97**, below any bar.

**`impairment` at −5.00%, t = −2.86.** Worse: the event study counted one
filing several times. A 45-day event window sampled every 21 days puts a single
8-K inside two or three consecutive windows, so 79 "impairments" were really
about 30 filings, each counted twice or three times with no new information.
Filings are now counted once, at the first rebalance date that could see them,
and the forward-return overlap is corrected on top.

A test now checks all three modules agree about what an independent
observation is, because a response whose tables contradict each other is worse
than one that is simply wrong.

### New in v3.7.1 — run a backtest from the command line

```
python scripts\run_backtest.py --universe screen --years 15
```

No server, no browser, no JSON quoting. It runs the same code the API runs,
prints a readable summary, and writes the full result to
`backtest_result.json`.

Pasting a JSON body into a Windows command prompt does not work — `'{' is not
recognized as an internal or external command` — and telling someone to fight
`curl` quoting on CMD is not much better. This is the fix.

### New in v3.7.0 — backtest the universe you screened

The corrected screen produced 438 names with a median sector cohort of 28, up
from the 6 that a hand-picked 63-name list gave. But `POST /api/v1/backtest`
capped `tickers` at 120 and offered only preset universes, so there was no way
to point it at the screen. That made the screen decorative.

`"universe": "screen"` now draws from the last completed screen, carrying
sectors through so the cohorts are real, and applying the same
critical-component filter. `max_names` caps how many are drawn.

### Fixed in v3.6.0 — the screen ranked the alphabet

The first real screen returned a top fifteen of AUGO, AU, ARIS, ARGX, ATRC,
APA, BRZE, BCH, ASST, ALRM, ALM, AYA, AMN, BTG, APPN. Every one begins with A
or B.

`candidate_tickers()` sorted the SEC ticker list and took `out[:limit]`, so
`--limit 1500` screened the front of the alphabet rather than the market. Not a
universe — a filing cabinet drawer. The limit now takes a deterministic random
sample, so a partial screen is a slice of the market and two runs of the same
size stay comparable. `--alphabetical` keeps the old behaviour for anyone who
wants it.

**And the ranking led with its least-informed names.** Nine of the top nineteen
had `valuation: null` and coverage of 0.30-0.40 — ranked on technical and money
flow alone, the two components the backtest measured at −0.015 and −0.002. The
one component ever measured significant was missing from the names at the top
of the list.

`GET /api/v1/screen` now excludes names missing the critical components by
default and reports how many were removed. Pass `require_critical=false` to see
them anyway. A ranking led by the least-informed names is worse than no ranking.

### New in v3.5.0 — a finding cannot be confirmed by the data that produced it

The 15-year event study did exactly what pre-registration is for, in both
directions at once.

All five testable pre-registered hypotheses came back null — red flags combined
(t = −1.76), impairment (−0.78), officer departure (−1.64), results announced
(0.35), material agreement (0.25). Three others had too few occurrences in a
63-name mega-cap universe to test at all.

And one **undeclared** code lit up: item 1.02, termination of a material
definitive agreement, at **−2.94% abnormal return, t = −3.08, n = 189**. Had it
been in the pre-registered list it would have cleared the bar.

It was not, so it is not evidence. v3.5 adds `AWAITING_CONFIRMATION`: a
registry of hypotheses found by exploration, recording the exact universe and
period they were found in. Each run reports `is_confirmation`, which is false
whenever the current sample matches the discovery sample — because a result
found by looking cannot be confirmed by the data it was found in. Testing twenty
codes and reporting the best is how a discovery gets manufactured.

**Also fixed:** exploratory results reported `matches_prediction: true` purely
because their predicted direction was `"none"`. That reads as confirmation of a
hypothesis nobody made. It is now `null` when nothing was predicted.

### New in v3.4.0 — flags you can check against the filing

A real run flagged **"Inventory grew 87% while revenue grew 14%"** for Apple.
That is a strong claim, and there was no way to tell from the response whether
it reflected a genuine build-up, a seasonal quarter-on-quarter comparison, or an
XBRL tag that changed meaning between filings.

Growth flags now carry their own evidence: the current and prior-year values,
both period end dates, and the filing date. The flag itself reads

> Inventory grew 87% while revenue grew 14% (12,500,000,000 at 2026-06-27
> versus 6,680,000,000 at 2025-06-28). ... Check the figures against the filing
> before acting on this — a large swing can also be a seasonal build or a
> changed tag.

Bank loan and deposit flags get the same treatment. An unverifiable claim in an
evidence presenter is worse than no claim, because the whole point of the layer
is that a human can go and look.

### New in v3.3.0 — the pre-registered event study

Everything cross-sectional is settled: no component ranks stocks over fifteen
years. 8-K events are the last untested hypothesis and the only one that *can*
be tested, because `acceptanceDateTime` records the exact moment a filing
became public.

**Hypotheses are declared in code before any result is seen.** Eight of them,
each with a predicted direction, and the Bonferroni correction applies to all
eight rather than to whatever survives. There are twenty-odd 8-K item codes;
testing all of them and reporting the best is how a discovery gets
manufactured. Anything not on the list appears under `exploratory` and is
explicitly labelled as not evidence.

Declaring the direction matters too: a significant result pointing the opposite
way to the prediction is recorded as **contradicting** the hypothesis, not
supporting it.

It measures **post-event drift** — whether the information is still exploitable
once public — not the announcement-day reaction, which is long gone by the time
a monthly rebalance sees it. Measuring the latter would flatter the strategy by
pretending you could trade a filing before anyone read it.

Validated on three synthetic universes with known truth:

```
NULL   no effect          -> nothing significant
REAL   4.02 precedes -8%  -> non_reliance -3.31%, t = -5.57, isolated correctly
MINE   20 undeclared codes -> 0 significant, all flagged exploratory
```

The REAL case also shows the dilution honestly: `red_flags_combined` reads
-1.34% against `non_reliance`'s -3.31%, because bundling one true signal with
five empty ones weakens it.

### New in v3.2.0 — overlapping windows are not independent observations

The 15-year run reported `fundamentals` at **t = 3.82** against a corrected bar
of 2.64, which reads as a discovery. It is not.

Standard errors were computed as `sd / sqrt(n_dates)`, treating 261 dates as
261 independent observations. With a 63-day horizon sampled every 21 days,
consecutive dates share two thirds of their window — there are about **87**
independent observations, and the standard error was understated by √3. The
honest figure is **t = 2.21**, which does not clear the bar.

The headline had already been reporting `n_effective` for sample size; the
significance test simply was not using it. Now both do, and every response
carries `ic_effective_dates` with an explanation.

This makes the null more robust, not less: the composite reads +0.004 ± 0.017
after adjustment.

### New in v3.1.0 — the depth cap is gone

The warehouse now holds **779,640 rows across 76 tickers, median 43.2 years,
back to 1966** — verified daily, 237 bars a year. But `POST /api/v1/backtest`
capped `years` at 10, a limit set when the store held five. A cap that quietly
prevents asking the question is worse than no cap; it now allows up to 40, and
the research view defaults to 15.

The replay also warns when a ticker's history does not reach back to the start
of the window, so a name listed in 2012 contributing nothing to a 2005 test is
stated rather than showing up later as an unexplained sample-size drop.

### Fixed in v3.0.3

**`range=max` returned downsampled data.** A rebuild produced 1962-2026 for 76
tickers with **231 bars each** — about 3.6 a year, neither daily nor monthly.
Yahoo's v8 chart endpoint quietly reduces granularity on very long ranges.
Spans over five years now use explicit `period1`/`period2` epoch bounds, and
any series averaging under 150 bars a year is rejected outright rather than
stored: scoring indicators on quarterly bars labelled as daily is worse than
having no data. `coverage()` now reports this as `inconsistent` rather than ok.

### Fixed in v3.0.2

`GET /api/v1/warehouse` reported `status: ok` for a store holding 76 tickers,
17,526 rows and a claimed 41.7-year median — figures that cannot all be true,
since 41 years is about 10,500 daily bars. Coverage now cross-checks the
metadata (what an upsert believed it wrote) against the table (what is actually
stored) and returns `status: inconsistent` with the shortfall when they
disagree. It also reports `rows_per_ticker`, which makes this kind of mismatch
obvious at a glance.

### Fixed in v3.0.1

**The v3.0 fix worked but nothing re-downloaded.** `warehouse.has()` checked
presence and freshness, not depth, so every ticker already holding five years
was skipped on a `--years 15` rebuild. The backtest kept reading the same 1254
rows and returned byte-identical numbers. Depth is now part of the check, and
the build script reports upfront how many stored tickers are shallower than
requested.

### Fixed in v3.0

**`--years 15` silently returned 5.** The warehouse accepted the argument and
then discarded it, because the Yahoo range was hardcoded to `5y`. Every ticker
came back with exactly 1254 rows — one market regime, when spanning several was
the entire point. The depth now plumbs through, the cache key includes it, and
a deeper request bypasses a shallower warehouse entry rather than being
satisfied by it.

### 0b. New in v2.12 — the research view

`GET /research`. Runs a backtest and renders the result, with one rule: **every
field shows a measured quantity, and "not measured" is a visual state rather
than a blank.**

The signature element is a ruler rather than a number. The information
coefficient is drawn as a 95% interval against a marked "no skill" line,
because a point estimate without its uncertainty is the easiest way to read a
result that is not there. When the interval covers zero, you can see that it
does.

It also shows what the plain dashboard cannot: per-component IC with the
multiple-testing threshold stated, timing components labelled "same for every
stock — cannot rank" instead of blank, the between/within sector decomposition,
sub-period stability, and all three portfolio simulations beside their
benchmark Sharpe.

**There is no field for expected return, win rate, or out-of-sample success.**
Those numbers do not exist for this engine. A layout with slots for them would
eventually get filled — which is exactly how v1.4 came to report "+4.0%
expected return" on a run where every single component was missing. The output
shape demanded a number, so the code produced one. A mock dashboard creates the
same pressure one layer earlier, which is why the roadmap declines to design
around figures we do not have. A test enforces it.

### 0b. New in v2.11 — sector-specific fundamentals

The generic model asks every company the same questions: margin, growth, debt,
cash conversion. For a bank that is close to meaningless — its balance sheet
*is* its business, its inventory is loans, and its margin is the spread between
deposit costs and lending income. None of that appears in `ProfitMargin`.

This is the one part of the expanded plan that adds **genuinely new
information** rather than more arithmetic on the same price series.

| Model | Sectors | What it reads |
|---|---|---|
| `bank` | Financials | Net interest margin, loan and deposit growth, loan-to-deposit, provisions, efficiency ratio |
| `reit` | Real estate | FFO reconstructed from net income + depreciation − property gains, dividend cover |
| `research_driven` | Healthcare | R&D intensity, and **cash runway in quarters** |
| `goods_or_software` | Tech, consumer, industrials, materials | Inventory turns, inventory-vs-revenue divergence, gross margin |
| `capital_intensive` | Energy, utilities | Asset turnover, whether capex is funded by operations or borrowing |

Every figure is an XBRL tag in filings already being downloaded, carries a
filing date, and is therefore point-in-time by construction — a test enforces
that a figure filed in February is invisible in January.

**They do not enter the score.** Deliberately: the composite already measures an
IC indistinguishable from zero, and adding unvalidated components to it repeats
the mistake this project exists to avoid. They surface as diagnostics and as
entries in `reasons_against`. Several are red flags on their own terms whatever
their predictive power — a biotech with one quarter of cash left is in trouble
regardless of its information coefficient.

### 0b. v2.10 — externally validated on real data

The Alphalens cross-check now runs on the real backtest, not just synthetic
data, and the headline figures match:

```
                        yours     alphalens
mean IC (per-date)     -0.0018      -0.0018     <- exact
sector-adjusted IC     +0.0230      +0.0089
```

The quantile tables agree in shape too — both show the same U (ends up, middle
down, no monotonic ordering). The sector-adjusted figures differ by 0.014
because the two demean differently: Alphalens `group_adjust` demeans the
returns, while `signal_decomposition` demeans both score and return. Both sit
near zero and neither is significant, so the conclusion is identical.

**The measurement layer is externally validated.** The null result rests on
arithmetic that a widely-used independent library reproduces.

### Fixed in v2.10

**Ticker suggestions missed transpositions.** `APPL` returned PPL, APP and
SPPL — but not AAPL. difflib rewards a long contiguous run, and PPL scores
0.857 against AAPL's 0.750, even though AAPL is a single *transposition* away:
the right keys in the wrong order, which is the commonest typing error there
is. Suggestions now rank by Damerau-Levenshtein distance, which counts a swap
as one edit. `APPL→AAPL`, `MFST→MSFT`, `GOGL→GOOGL`, `TLSA→TSLA` all resolve.

**A test depended on leftover cache files.** One warehouse test passed or
failed according to what a previous run had written to `.cache`. Intermittent
failures are worse than consistent ones, so it now isolates the cache directory.

### 0b. New in v2.9 — the historical warehouse

Every backtest until now re-fetched prices over the network and recomputed from
scratch, which capped the research at what one run could pull: 63 names, 3
years, 53 dates. Every question still open needs the opposite shape of data —
thousands of names over fifteen years, queried repeatedly.

```bash
python scripts/build_warehouse.py --universe diversified_60 --years 15
```

Backtests then read from it automatically. Beyond the numbers it records
**provenance**: which source, whether the series is split-adjusted, and when it
was ingested — because Yahoo and Alpha Vantage disagree, and a stored bar that
does not say where it came from cannot be audited later.

`GET /api/v1/warehouse` reports coverage and runs a **gap check** against SPY's
calendar. A series with holes computes its indicators over a different window
than it claims to, which is the kind of error that produces a confident wrong
answer rather than an obvious one.

Its assessment is deliberately blunt about what depth of history does *not*
buy: everything stored is a company that still exists today, so a fifteen-year
backtest on it is still fifteen years of survivors.

### Fixed in v2.9

Yahoo returns epoch seconds at market **open**, so daily bars arrived stamped
`2023-05-30 12:00:00` rather than `2023-05-30`. Two consequences: the replay's
`date <= as_of` filter silently excluded the as-of day's own bar, and any
external tool matching on dates found **zero** overlap — which is why the
Alphalens export failed with "Factor and prices indices don't match". Bars are
now normalised to midnight at the source, and the exporter additionally snaps
each decision date onto the last trading day at or before it.

### 0b. New in v2.8 — the measurement layer checked against Alphalens

Every number in this project comes from code in this repo. If the measurement
layer has a bug, every conclusion is wrong in the same direction and no
internal test would catch it — the tests share an author with the thing they
test.

[Alphalens](https://github.com/stefan-jansen/alphalens-reloaded) is the
standard open-source implementation of this analysis, in use since 2016.
Running the same factor through it is the only genuinely independent check.

```bash
pip install alphalens-reloaded          # note the suffix; original is dead
python scripts/export_for_alphalens.py
python scripts/alphalens_check.py
```

On a synthetic factor with a planted signal, both implementations agree
**exactly**:

```
ours (per_date_ic)   +0.4644   t +17.96   n=19
alphalens mean IC    +0.4644
difference            0.0000
```

That is now a test (skipped if Alphalens is not installed). The null result of
−0.005 ± 0.032 rests on arithmetic that a widely-used third-party library
reproduces.

**One practical snag, solved.** Alphalens assumes a daily factor. With a 21-day
rebalance it computes every return correctly, then fails on a final line that
stamps the price panel's inferred trading calendar onto the factor's date
index. The assignment is metadata only, so the bundled `tolerant_freq()`
context manager relaxes that one check and restores it immediately — verified
to change no number.

### 0b. New in v2.7 — a news source that can actually be tested

The news component held 15% of the composite's weight and was **never
validated once** — not skipped, but untestable, because no free provider
archives news history. Every backtest reported `news` coverage 0.

8-K filings close that hole. The SEC requires one within four business days of
a material event, tagged with an item code saying what happened:

| | News sentiment (Alpha Vantage) | 8-K filings (SEC) |
|---|---|---|
| Cost | 25 calls/day total | free, unlimited |
| Historical archive | none | complete |
| Timestamps | approximate | exact (`acceptanceDateTime`) |
| Coverage | large caps mostly | every US registrant |
| Backtestable | **no** | **yes** |
| Tells you | tone | what happened |

Item codes are classified into events with a direction and a severity, and
crucially the ambiguous ones stay ambiguous: Item 2.02 says results were
announced, not whether they were good, so it is marked `direction: "unknown"`
and does not move the score. A test enforces that.

Red flags surface directly in `reasons_against` — an auditor resignation
(4.01), a non-reliance notice on prior financials (4.02), a delisting notice
(3.01) or a material impairment (2.06) is a reported fact, and worth more than
any headline.

The severity weights are hand-assigned and unvalidated like every other
constant here. The difference is that these **can** be validated, because the
filing timestamps are exact. That is the reason to build this rather than add
another sentiment feature.

### Fixed in v2.7

`GET /api/v1/screen?run_id=30` returned a 500 when no such run existed. It now
returns a clear message listing the run ids that do exist.

### 0b. New in v2.6 — screening the universe, and splitting news by scope

**The screener.** `python scripts/screen_universe.py` ranks every liquid US
listing rather than a hand-picked list. Results land in SQLite and come back
from `GET /api/v1/screen`, sortable by overall score or by percentile within
sector.

It exists for two reasons. The obvious one is that you cannot know every US
stock. The less obvious one matters more: the decomposition found valuation
significant **between** sectors (+0.112, t=2.30) and not **within** them
(+0.023, t=0.76) — but flagged that the median sector cohort was **six
companies**, too few to detect a within-sector effect even if one exists.
Screen 1500 names and cohorts become 100-300. The open question becomes
answerable.

Practical notes: SEC filings and Yahoo prices only, both free and cached, both
throttled. First run takes 20-40 minutes for 1500 names; Ctrl-C is safe and
`--resume` continues. Alpha Vantage is skipped entirely — 25 calls a day cannot
screen anything — so `news` is absent for every name and coverage reflects that.

**News split by scope.** Company news, sector news and macro news are now
scored separately. This follows directly from an earlier finding: the `market`
component turned out to be unmeasurable cross-sectionally because it was
identical for every stock on a given date. Macro headlines have exactly the
same shape — a rate cut moves everything at once — so blending them into a
per-stock news score was the same category error. The headline `news` figure
now uses company-specific stories only, with `news_macro` reported separately
as the timing signal it is.

### 0b. New in v2.5 — where the valuation signal actually lives

With the sector bug fixed, `valuation_peer` fell from **+0.0905 (t = 3.80)** to
**+0.0152 (t = 0.76)**. Absolute `valuation` still scores **+0.0775 (t = 3.09)**.
Ranking the same metric within sector destroys it. Two explanations point in
opposite directions:

* the effect is **between** sectors — a rotation bet that absolute thresholds
  capture and sector-relative ranking deliberately removes; or
* the effect is **within** sectors, and cohorts of 5-8 companies were too small
  for a percentile to measure it.

Percentile ranking cannot separate those. `backtest/decomposition.py` can,
by decomposing the raw score instead of re-ranking it: sector means against
sector returns for the between part, sector-demeaned residuals for the within
part. Both are reported in `signal_decomposition`.

Validate it on universes with a known answer:

```bash
python scripts/offline_decomposition.py
```

```
truth BETWEEN   between +0.743 (t +23.3)   within +0.001 (t +0.02)   -> "rotation bet"
truth WITHIN    between +0.111 (t  +1.6)   within +0.588 (t +36.8)   -> "company selection"
truth NEITHER   between +0.057 (t  +0.9)   within +0.001 (t +0.02)   -> "neither"
```

**Sector-neutral portfolio.** `portfolio_simulation_sector_neutral` holds the
best name in each sector rather than the best ten overall. An edge that is
really sector rotation cannot survive that construction; company selection can.

### Fixed in v2.5

The portfolio verdict said "Sharpe is 1.45 versus 1.78 — effectively
unchanged". It is not unchanged, it is **worse**, and that was the finding: per
unit of risk you did better holding the whole universe. Worse and unchanged are
now separate messages.

### 0b. New in v2.4 — the peer-normalisation bug, and the paid-data question

**Peer normalisation was never running.** `set_sectors` populated the ticker →
sector-ETF map but not the ticker → sector-label map, so every record carried
`sector: None`, all 63 names fell into one "UNKNOWN" cohort, and the
"peer-normalised" scores ranked across the **whole universe** rather than
within sector. The `sector_concentration: {"UNKNOWN": 100}` in the v2.3 output
was the tell.

That explains the all-banks-and-telecoms portfolio exactly: a universe-wide
cheapness rank puts banks and telecoms on top by construction, which is the
sector tilt peer normalisation exists to strip out. So `valuation_peer +0.0905`
was measuring the sector bet, not a sector-relative valuation effect.

Fixed, with sectors now falling back to SEC SIC codes when no map is supplied,
and a warning when more than 20% of rankings drop to universe scope. **Re-run
before drawing conclusions — that number will change.**

**EODHD support (optional, paid).** `python scripts/check_eodhd.py` probes a
free key and reports which of the engine's gaps your plan actually closes,
before you subscribe. It tests historical constituents and — critically — EOD
prices for tickers that have since been delisted, because a constituent list
without prices for the vanished names is half a fix.

### 0b. New in v2.3 — auditing the result that looked good

The v2.2 run produced the first encouraging number in this project: a
valuation-only portfolio returning **+28.5%/yr against +21.9%** for the
universe, Sharpe **3.07 vs 3.02**. Three things about it did not survive
inspection.

**The Sharpe was inflated by a real bug.** The simulator took the 63-day
forward return, multiplied it by 21/63, and annualised the result as if it were
a 21-day series. Scaling a 63-day return by a third keeps 63 days of volatility
and divides it by three — understating true 21-day volatility by about 42% —
and consecutive periods shared 42 of their 63 days, so they were autocorrelated
too. Sharpe was inflated by roughly √(63/21) = 1.73x; the reported 3.07 was
nearer 1.77.

Positions are now held for the full horizon so periods never overlap. The
simulation runs once per starting offset (three, here) and averages, so every
date is used and none is double-counted.

**Beating on return with an unchanged Sharpe is not skill.** 3.07 versus 3.02
is a rounding difference. More return at the same risk-adjusted ratio is more
risk, not better selection — a leveraged holding of the whole universe would
have done the same. The verdict now says so instead of calling it
"encouraging".

**The winning portfolio was six banks and two telecoms.** Sector concentration
is now measured and reported: when two sectors hold more than 55% of positions,
that is a factor bet, and it lasts exactly as long as the factor does.

**Also fixed:** `quality_peer` was labelled "worth adopting" on a +0.021 IC
delta while its t-stat was 0.73. A move between two insignificant numbers is
noise moving around; the comparison now requires significance before calling
anything an improvement.

**Sector no longer depends on Alpha Vantage.** An exhausted quota left `sector`
null, which silently disabled both the sector regime and the peer cohort.
Sector is now derived from the SEC's SIC classification when AV is unavailable
— free, keyless and cached.

### 0b. New in v2.2 — acting on what the backtest found

The 63-name run found exactly one component carrying a measurable effect:
**valuation, +0.078, t = +3.09** — holding 10% of the weight, while technical
held 20% for an IC of −0.019. v2.2 acts on that.

**Peer normalisation (blueprint #12).** Every fundamental measure was scored
against a global threshold, so a P/E of 20 was neutral whether the company was
a utility, a bank or a chip designer. Banks rarely exceed a P/E in the teens,
so every bank looked cheap; software trades on growth, so every software firm
looked expensive. The score was partly a sector bet wearing a valuation label.

Metrics are now percentile-ranked within sector. Validate it with
`python scripts/offline_peers.py`, on a universe where the truth is known —
cheap-within-sector wins identically in all three sectors, but the sectors sit
at very different absolute P/E levels:

```
absolute P/E threshold   IC +0.2505   t +11.41
sector percentile        IC +0.5363   t +34.73
```

In the backtest the peer variants are computed **alongside** the absolute ones,
so `attribution.experimental_components` reports the IC delta directly rather
than asking you to take it on faith. For live analysis, build the table once:

```bash
python scripts/build_peer_table.py
```

**A critical-component gate.** Your v2.1 AAPL run said `ACCUMULATE` at 65%
coverage with valuation missing. Coverage is a blunt instrument — it treats
every absent component alike, but they are not alike. A run missing the one
informative component is not 65% of an answer, it is a different question. That
same run now returns `NO ACTION` naming valuation. Configurable via
`CRITICAL_COMPONENTS`.

**Portfolio simulation (blueprint #28).** An IC answers "did the score rank
correctly?", not "what would have happened to my money?". The gap is usually
disappointing: an IC of 0.05 is a real edge and can still lose after costs if
the book turns over monthly. The simulator holds the top N, charges the
round-trip cost on whatever actually churned, and reports Sharpe, drawdown and
turnover — always beside an equal-weight buy-and-hold of the same universe.
Read the difference, never the strategy figure alone.

It also runs a second simulation ranked on peer-normalised valuation *alone*,
so the one component that measured real can be judged on its own.

### Fixed in v2.2

- `fundamentals.status` reported `unavailable` while `score_breakdown` carried
  72.31 and the plain view said "Good" — the status described only the Alpha
  Vantage half, ignoring SEC filings.
- Company name is now taken from EDGAR when the Alpha Vantage quota is spent.
- The multiple-testing note said "Eight components" while testing six.
- A timing IC of −0.51 was called "suggestive". With ~18 independent dates from
  a single market cycle it is not suggestive of anything; effective sample size
  is now computed and stated.

### 0b. New in v2.1 — measuring ranking, not timing

The first 63-name run reported a pooled IC of −0.092 while the per-date mean
was −0.005 ± 0.032. Those answer different questions and the verdict was
reading the wrong one.

**Pooled IC** mixes "did the score rank stocks correctly this morning?" with
"was the score high in months the market fell?". The second dominates, because
returns vary far more across months than within them. The per-date mean is now
the headline; pooled is kept as a diagnostic that names the gap as timing.

Bucket tables had the same flaw, so returns are now **demeaned within each
date**. A bucket populated mostly during one good quarter no longer looks
skilful.

**Ranking vs timing components.** `market` reported `n_dates: 0` — described as
"never enough names to measure", which was misleading. It is the same value for
every stock on a date, so rank correlation against it is undefined at any
universe size. That is a category error, not a measurement failure, and it is
now labelled as such and evaluated against the market's own forward return
instead.

**Weight audit.** The response now states how much of the score was actually
measured. In the real run: 25% of the weight (market 10% + news 15%) could not
be evaluated at all.

**Stability.** Sub-period ICs are reported with an explicit instability
verdict. Writing it caught a logic bug where a "consistent sign" message fired
even when the signs differed.

### 0b. New in v2.0 — reading the backtest honestly

The first real backtest returned a composite IC of −0.066 on eight tickers.
Two things follow.

**A composite IC near zero has two opposite explanations.** Either nothing
predicts, or several things predict and cancel each other out. The headline
number cannot tell them apart, so `attribution` now scores every component
separately against the same forward returns. Validate it with
`python scripts/offline_attribution.py`: on a synthetic universe where
technical genuinely predicts and valuation genuinely anti-predicts, the
composite reads +0.020 while the parts read +0.167 and −0.217. That composite
is not a null result — it is a weighting failure.

**Eight names per date cannot measure anything.** Cross-sectional IC has a
standard error near 1/√(n−3), so eight names gives a floor of about 0.14 —
roughly five times larger than a real equity signal. `sample_adequacy` now
computes and reports this floor, and `universe.diversified_60` gives a
63-name, 11-sector list so no single industry's run drives the answer.

**Multiple-testing correction.** Testing eight components at the usual |t| > 2
gives about a one-in-three chance one fires by luck — the trap behind every
"I found the factor that works" story. Components are judged at a Bonferroni
threshold (|t| > 2.73 for eight), and `helping`/`hurting` require significance
rather than just a sign. Sub-threshold leanings appear separately under
`candidates_not_significant`, labelled as what they are.

**Weight fitting, tested out of sample.** `fit_weights` derives weights on the
first half of the period and reports the result on the second half. The train
figure will always look good and is deliberately reported next to the test
figure so the gap is visible.

The preset universes carry a survivorship warning that is not boilerplate:
every list was written in 2026 from companies that exist in 2026. Read the
rank correlation, not the return figures.

### 0b. New in v1.9 — the backtester

`POST /api/v1/backtest`. At each historical date the replay reconstructs only
what was knowable that morning: prices truncated to the date, fundamentals via
`edgar.Facts(as_of=...)`, and a P/E built from the price that day and earnings
reported by that day.

**News and macro are excluded, deliberately.** No free provider serves
historical news archives, and FRED serves *revised* macro data — the CPI print
for March 2024 as it reads today is not the number published in April 2024.
Including either would make the backtest look far better than the live engine
ever could.

The headline metric is the **information coefficient**: rank correlation
between the score and the forward return. Reported before any performance
figure, because a strategy can look good purely by holding a rising market.

`n_effective` is also reported and is the number that counts. A 63-day horizon
sampled every 21 days means each observation shares two thirds of its window
with its neighbours, so 300 rows is really about 100 independent observations.

Validate it yourself with no network:

```bash
python scripts/offline_backtest.py
```

Random-walk prices give IC ≈ 0.00 with flat buckets; trend-following prices
give IC ≈ 0.27 with buckets rising from −1.3% to +16.4%. Both are regression
tests. The first is the important one — a strong IC on unpredictable data would
mean future information is leaking in.

### Also fixed in v1.9

**TTM was ten months stale.** Most US filers never publish a standalone Q4 —
the fourth quarter only appears inside the 10-K. So "sum the last four
quarterly facts" reached back fifteen months, failed its sanity check, and fell
through to the annual report. AAPL's filing lag was 304 days. TTM now uses
`annual + year-to-date − prior-year year-to-date`, the standard construction,
and the lag drops to about 31 days.

**A mistyped ticker no longer burns API quota.** `APPL` previously spent three
of a 25/day Alpha Vantage budget before failing. The engine now checks the SEC
ticker map (free, cached) before spending anything, and suggests the closest
match.

### 0b. New in v1.8 — the three foundations

**Point-in-time fundamentals from SEC EDGAR.** `companyfacts` tags every
reported figure with the date it was filed. Every accessor takes an `as_of`
date and refuses to look at anything filed after it, which is what makes an
honest backtest possible at all. Free, no key.

This fills the three gaps the blueprint wanted in business quality and v1.7
did not have:

| Sub-score | What it asks | Built from |
|---|---|---|
| Profit margins | Is it profitable? | Alpha Vantage ratios |
| Cash generation | Does profit turn into cash? | FCF margin, cash conversion, OCF growth |
| Debt and liquidity | Could it survive a bad year? | Net debt/equity, net debt/OCF, current ratio |
| Are the profits real? | Accruals and dilution | Accrual ratio, share count change |

The share-count check matters more than it looks: earnings growth means
nothing to you if the share count grew faster.

**Macro regime from FRED.** Rates, yield curve, inflation, high-yield credit
spreads, VIX and the dollar. Market regime is now 60% price trend / 40% macro
when a FRED key is present — and stays 100% price when it isn't, rather than
padding the gap with a guess. Credit spreads carry the most weight because they
tend to move before equity prices do.

**Feature store.** Every `/analyze` now writes its feature vector to SQLite.
It deliberately stores evidence only — not the score, action or probability —
so a future model trains on the world rather than on its predecessor's
opinions. `GET /api/v1/features/summary` tells you how far off a trainable
sample you are.

### 1. Missing data is excluded, not filled with 50

v1.4 disclosed gaps in `data_quality`, then computed the headline score on
`50.0` substitutes anyway:

```python
calc_parts = {k: (50.0 if v is None else v) for k, v in parts.items()}   # v1.4
```

v1.5 renormalises the weights across whatever data actually exists and reports
`coverage`. Below 60% coverage the action is `INSUFFICIENT DATA`, full stop.

### 2. Expected value no longer echoes the score

In v1.4 both the scenario probabilities *and* the return magnitudes were
derived from the composite score, so expected value was a relabelling of the
score wearing a risk-analysis costume. And `risk_reward` was fed a hardcoded
`50.0`, contributing a constant 5 points to every stock ever analysed.

Now:

- **Return magnitudes** come from the stock's own realised volatility over an
  explicit horizon. Score-independent.
- **Probabilities** start at an uninformative 1/3 and are tilted by the score
  at a strength you can see (`score_tilt_strength = 0.15`). That tilt is an
  uncalibrated prior and is labelled as such in every response.
- **Every scenario has a horizon.** `+14.45%` with no time unit could never be
  checked against reality; `+13.4% over 63 trading days` can.

### 3. Missing fundamentals no longer read as bullish

v1.4's `n()` returned `0.0` for anything absent, and Alpha Vantage returns the
string `"None"` for fields it doesn't have. Result:

```
valuation = 75 - 1.2 * max(0 - 20, 0) - 8 * max(0 - 2, 0) = 75.0
```

A company with **no P/E at all** scored 75/100 on valuation — the best score in
the system. v1.5 returns `None`, and scores a genuinely negative P/E as the
negative signal it is.

The `- 2 * debt` term in `quality` is gone. `OVERVIEW` does not reliably return
`DebtToEquity`; when absent it silently became 0 (no penalty ever) and when
present as a percentage it drove quality to 0 for every normally-leveraged
large cap. Leverage is simply not scored rather than faked.

### 4. Confidence measures evidence, not conviction

v1.4: `confidence = 45 + 0.30*abs(score - 50) + 0.20*abs(news - 50)`.

That made the engine more confident the more extreme its own answer was — a
description of the output, not of the evidence — and it fed straight back into
the action ladder. v1.5 builds confidence from data coverage, agreement between
independent signals, and news freshness. A bullish 90 and a bearish 10 now get
identical confidence, which is the point.

### 5. Prices come from a source chain (v1.6)

v1.5 depended on Stooq alone, and Stooq blocks some networks outright — it
serves an HTML page instead of CSV. That left the engine at 50% coverage with
nothing to say.

Prices now come from an ordered chain, configurable via `PRICE_SOURCES`:

| Source | Key | Adjusted | Notes |
|---|---|---|---|
| `yahoo` | no | yes | v8 chart endpoint, full history. Default primary. |
| `stooq` | no | yes | Works from many networks, blocked on others. |
| `alpha_vantage` | yes | **no** | Last resort. Split artifacts are detected and flagged. |

`GET /api/v1/providers/prices` probes all three independently and tells you
which to put first. When an unadjusted source is used, single-day moves over
35% are flagged as probable corporate actions rather than silently scored as
crashes.

Yahoo returns `adjclose`; the whole OHLC bar is scaled by the same factor, so
`money_flow` (which reads high/low) stays internally consistent.

### 5b. One adjusted source, consistently

Alpha Vantage's free `TIME_SERIES_DAILY` is **unadjusted** — a 4:1 split reads
as a −75% crash to any trend model. Stooq is adjusted. v1.4 used AV first and
Stooq as fallback, so the technical score meant different things depending on
which provider happened to answer.

v1.5 uses Stooq for all prices (adjusted, no key, full history back to 2015 so
200-day averages and 52-week range actually work) and spends the entire Alpha
Vantage budget on fundamentals and news.

The Stooq symbol is `aapl.us`, not `aapl`. v1.4 stripped the `.us` suffix,
which cannot work — the v1.3 404 was a blocked request, not a bad symbol. Fixed
with a proper User-Agent and explicit rate-limit detection.

### 6. News is deduplicated *before* scoring

v1.4 averaged sentiment over all 50 raw articles and deduplicated afterwards
for display only, so the stated goal — telling 40 syndications of one story
apart from 3 real events — was never reached by the score. v1.5 clusters first;
each event gets one vote. It also reads the sentiment entry for *your* ticker
rather than `ticker_sentiment[0]`, which is whichever ticker the article listed
first.

### 7. Scores are volatility-normalised

`momentum = 50 + 800*r20 + 400*r60` maxed out at roughly a +6% month, so every
strong stock scored 100 and became indistinguishable. v1.5 expresses moves in
sigmas of the stock's own volatility and squashes with `tanh`, which compresses
instead of clipping.

### 8. New: decision log and calibration

v1.4 had no storage at all, despite the plan resting on it. v1.5 writes every
analysis to SQLite with its horizon, entry price and stated probability.
`POST /api/v1/calibration/resolve` closes out elapsed decisions;
`GET /api/v1/calibration/report` returns a reliability table and Brier score.

**This is the only part of the system that can tell you whether the rest works.**

### 9. New: costs, FX, and a reachable sizing layer

Expected return is reported gross *and* net of dealing costs. Since the base
currency is GBP and the assets are USD, FX friction is charged and FX
uncertainty is reported as a separate band — a +4% USD edge is not a +4% edge
to a sterling investor.

`portfolio/risk.py` was structurally sound in v1.4 but orphaned, because
`/analyze` never produced an invalidation price. v1.5 emits an ATR-based
invalidation level, so sizing is now reachable.

---

## Install

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
copy .env.example .env          # then add your Alpha Vantage key
```

See the output shape immediately, with no key and no network:

```bash
python scripts/offline_demo.py
```

Then:

```bash
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000/docs>.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /` | **Plain-English dashboard** |
| `GET /research` | **Research view — does the score work?** |
| `GET /api/v1/stocks/{ticker}/filings` | Point-in-time fundamentals from SEC XBRL |
| `GET /api/v1/macro` | Macro regime (rates, curve, credit, VIX, dollar) |
| `POST /api/v1/backtest` | **Point-in-time replay + component attribution** |
| `GET /api/v1/backtest/universes` | Preset universes |
| `GET /api/v1/backtest/data-upgrade` | What paid data would fix, and which providers |
| `GET /api/v1/stocks/{ticker}/events` | Material events from 8-K filings |
| `GET /api/v1/stocks/{ticker}/sector-model` | Sector-specific fundamentals |
| `GET /api/v1/warehouse` | Local price store coverage and gap report |
| `GET /api/v1/screen` | **Ranked results from a universe-wide screen** |
| `GET /api/v1/peers` | The sector peer table live analysis ranks against |
| `GET /api/v1/features/summary` | How much training data has accumulated |
| `GET /api/v1/features/{ticker}` | Stored feature history for one ticker |
| `GET /api/v1/providers/prices` | Which price sources your network can reach |
| `GET /health` | Version check |
| `GET /api/v1/stocks/{ticker}/diagnostics` | Which providers are actually working |
| `GET /api/v1/stocks/{ticker}/context` | Market and sector regime |
| `GET /api/v1/stocks/{ticker}/analyze?horizon_days=63` | Full analysis (logs by default) |
| `POST /api/v1/portfolio/size` | Position size from entry + invalidation |
| `POST /api/v1/calibration/resolve` | Close out elapsed decisions |
| `GET /api/v1/calibration/report` | Reliability table + Brier score |

`horizon_days`: 21 ≈ 1 month, 63 ≈ 3 months, 126 ≈ 6 months, 252 ≈ 1 year.

## Reading the calibration report

`brier_score` is the mean squared error of the probability forecasts. Always
saying 50% scores 0.25. If the engine cannot beat 0.25 over a real sample, its
probabilities are adding noise — set `score_tilt_strength = 0` and the engine
becomes an honest "here is the volatility, here is the evidence, decide
yourself" tool, which is still useful.

Compare `mean_predicted` against `actual_bullish_rate` in each bin. If it says
70% and delivers 45%, the model is overconfident and the tilt is too strong.

Sample sizes under ~100 per bin are not evidence of anything.

## Known limits — read before trusting output

- **Probabilities are uncalibrated.** Nothing has been fitted or backtested.
  The tilt constant is a guess, labelled as one in every response.
- **Fundamentals are current-snapshot, not point-in-time.** Any backtest built
  on `OVERVIEW` will be look-ahead biased and will look better than reality.
- **Leverage, cash flow and dilution are not scored.** OVERVIEW doesn't carry
  them reliably. Add a filings-based source if you want them.
- **No correlation matrix.** Sector caps are a crude proxy; ten technology
  names is one bet regardless of what the sector labels say.
- **Stooq is a free source.** Validate licensing and data quality before
  treating this as anything but a research tool.
- **This is not financial advice.** It is a hypothesis generator with a
  measurement harness attached. The measurement harness is the important part.

## Suggested workflow

1. Run `/analyze` on your watchlist daily with `log=true`.
2. Do **not** trade on the output.
3. After a few months, run `/calibration/resolve` then `/calibration/report`.
4. If `beats_coinflip` is false, the scoring is decoration — go back to the
   feature layer rather than adding data sources.
5. Only once calibration holds should the probabilities influence sizing.

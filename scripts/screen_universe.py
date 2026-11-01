"""Screen the US listed universe.

    python scripts/screen_universe.py                 # ~1500 liquid names
    python scripts/screen_universe.py --limit 300     # quick trial
    python scripts/screen_universe.py --resume        # continue an interrupted run
    python scripts/screen_universe.py --all --log-forward   # whole US market,
                                                      # logged for the forward test

The first run is slow — one SEC filings call and one price request per ticker,
throttled to stay polite. Expect roughly 20-40 minutes for 1500 names. Both
sources are cached, so a re-run the same day takes seconds.

Ctrl-C is safe: progress is written per ticker and `--resume` picks up where it
stopped.

Nothing here uses Alpha Vantage. A 25-call daily budget cannot screen anything,
and everything needed comes from SEC filings and Yahoo prices — which is why
`news` will be missing for every name, and why coverage tops out below 1.0.
"""
import argparse
import os
import sys
import time
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.screener import runner, store  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=1500,
                    help="Max tickers to attempt (default 1500)")
    ap.add_argument("--min-dollar-volume", type=float, default=5_000_000,
                    help="Median daily turnover floor (default 5M)")
    ap.add_argument("--min-price", type=float, default=3.0)
    ap.add_argument("--all", action="store_true",
                    help="Every SEC-listed ticker (~7-8k before the liquidity "
                         "filter). First run 1-3 hours; cached re-runs are faster.")
    ap.add_argument("--log-forward", action="store_true",
                    help="Log every scored name as a forward-test decision, so "
                         "the calibration report measures the whole market.")
    ap.add_argument("--resume", action="store_true",
                    help="Continue the most recent unfinished run")
    ap.add_argument("--throttle", type=float, default=0.12)
    ap.add_argument("--alphabetical", action="store_true",
                    help="Take the first N tickers by name instead of a random "
                         "sample. Rarely what you want — it screens the front of "
                         "the alphabet, not the market.")
    args = ap.parse_args()
    if args.all:
        args.limit = 0

    as_of = date.today()
    print("Building candidate list from the SEC ticker file...")
    try:
        candidates = runner.candidate_tickers(limit=args.limit,
                                             alphabetical=args.alphabetical)
    except Exception as exc:
        print(f"Could not fetch the SEC ticker list: {exc}")
        return 1
    how = "first by name" if args.alphabetical else "random sample, fixed seed"
    print(f"  {len(candidates)} candidates after cleaning ({how})")
    if candidates:
        letters = sorted({c["ticker"][0] for c in candidates})
        print(f"  spanning {len(letters)} initial letters: "
              f"{''.join(letters[:14])}{'...' if len(letters) > 14 else ''}\n")

    run = store.latest_unfinished(as_of) if args.resume else None
    if run:
        run_id = run["id"]
        done = store.already_done(run_id)
        print(f"Resuming run {run_id}: {len(done)} already attempted\n")
    else:
        run_id = store.start_run(
            as_of, runner.ENGINE_VERSION, len(candidates),
            {"limit": args.limit, "min_dollar_volume": args.min_dollar_volume,
             "min_price": args.min_price})
        done = set()
        print(f"Started run {run_id}\n")

    counts = {"ok": 0, "illiquid": 0, "no_data": 0}
    started = time.time()

    try:
        for i, c in enumerate(candidates, 1):
            ticker = c["ticker"]
            if ticker in done:
                continue
            try:
                row, status, note = runner.score_ticker(
                    ticker, as_of, args.min_dollar_volume, args.min_price)
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                row, status, note = None, "no_data", str(exc)[:80]

            counts[status] = counts.get(status, 0) + 1
            store.record(run_id, row=row, ticker=ticker, status=status, note=note)

            if status == "ok":
                sector = (row.get("sector") or "?")[:16]
                print(f"[{i:>5}/{len(candidates)}] {ticker:<6} "
                      f"score {row['score']:>5.1f}  cov {row['coverage']:.2f}  "
                      f"{sector}")
            elif i % 50 == 0:
                rate = i / max(time.time() - started, 1)
                left = (len(candidates) - i) / max(rate, 0.01) / 60
                print(f"[{i:>5}/{len(candidates)}] ... {counts['ok']} scored, "
                      f"~{left:.0f} min remaining")

            runner.throttle(args.throttle)

    except KeyboardInterrupt:
        print(f"\nInterrupted. {counts['ok']} scored so far.")
        print(f"Resume with:  python scripts/screen_universe.py --resume "
              f"--limit {args.limit}")
        return 130

    summary = store.finalise(run_id)
    if args.log_forward:
        from app.storage import db
        logged, skipped = db.log_screen_decisions(run_id)
        print(f"\nForward test: logged {logged} names"
              + (f", {skipped} skipped (already logged this week)" if skipped else ""))
    cohorts = store.cohort_sizes(run_id)
    median = sorted(cohorts.values())[len(cohorts) // 2] if cohorts else 0

    print(f"\n{'=' * 62}")
    print(f"Run {run_id} complete in {(time.time() - started) / 60:.1f} min")
    print(f"  scored     {summary['scored']}")
    print(f"  illiquid   {counts['illiquid']}")
    print(f"  no data    {counts['no_data']}")
    print(f"\nSector cohorts (this is the number that matters):")
    for sector, n in sorted(cohorts.items(), key=lambda x: -x[1]):
        print(f"  {sector:<24} {n:>4}")
    print(f"\nMedian cohort: {median}")
    if median >= 30:
        print("  Large enough for a sector percentile to mean something. The "
              "backtest's within-sector question can now be tested properly —\n"
              "  re-run the backtest on a wider universe to settle it.")
    else:
        print("  Still thin. Raise --limit or lower --min-dollar-volume.")

    print("\nRead the results with:  GET /api/v1/screen?limit=50")
    print("\nReminder: the composite's measured IC is indistinguishable from "
          "zero.\nUse this ranking to surface names you had not heard of, then "
          "judge them\nyourself. The order is not a prediction.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

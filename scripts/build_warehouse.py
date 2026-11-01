"""Download historical prices once, then query them forever.

    python scripts/build_warehouse.py                    # diversified_60, 15 years
    python scripts/build_warehouse.py --universe screen  # everything already screened
    python scripts/build_warehouse.py --tickers AAPL,MSFT
    python scripts/build_warehouse.py --refresh          # top up existing tickers

Every backtest until now re-fetched prices over the network, which capped the
research at whatever one run could pull: 63 names, 3 years. The open questions
all need the opposite shape of data — thousands of names over fifteen years,
queried repeatedly.

Ctrl-C is safe; each ticker is committed as it lands.

## A caveat that no amount of downloading fixes

Depth of history is not breadth of universe. Everything downloaded here is a
company that still exists today, so a fifteen-year backtest on it is still
fifteen years of survivors. That flatters returns and hides exactly the
companies a scoring engine most needs to have ranked correctly. It is a
separate problem, and the only one left that costs money.
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.backtest import universe as bt_universe  # noqa: E402
from app.providers import prices                  # noqa: E402
from app.storage import warehouse                 # noqa: E402

BENCHMARKS = ["SPY", "QQQ", "XLK", "XLV", "XLF", "XLE", "XLY", "XLP",
              "XLI", "XLC", "XLRE", "XLU", "XLB"]


def resolve_universe(args):
    if args.tickers:
        return [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    if args.universe == "screen":
        from app.screener import store as screen_store
        # Download everything the screen scored, including names that lack
        # valuation. The critical-component filter belongs at backtest time,
        # where it decides what gets RANKED; a warehouse should hold whatever
        # you might later want to look at.
        res = screen_store.results(limit=args.max_names, require_critical=False)
        if res.get("status") != "ok":
            print("No completed screen to draw from. Run screen_universe.py first,"
                  " or pass --universe diversified_60.")
            return []
        tickers = [r["ticker"] for r in res["results"]]
        print(f"  {len(tickers)} tickers from screen run {res['run']['id']} "
              f"({res['run']['scored']} scored, "
              f"{res['filtering']['excluded_missing_critical']} lack valuation "
              "but are still downloaded)")
        return tickers
    return list(bt_universe.get(args.universe))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--universe", default="diversified_60",
                    help="diversified_60 | starter_10 | screen")
    ap.add_argument("--tickers", default=None, help="Comma-separated override")
    ap.add_argument("--years", type=int, default=15,
                    help="Target depth. More regimes is the point (default 15)")
    ap.add_argument("--refresh", action="store_true",
                    help="Re-download tickers already stored")
    ap.add_argument("--max-names", type=int, default=600,
                    help="Cap when drawing from a screen (default 600)")
    ap.add_argument("--throttle", type=float, default=0.25)
    args = ap.parse_args()

    tickers = resolve_universe(args)
    if not tickers:
        return 1
    tickers = sorted(set(tickers) | set(BENCHMARKS))

    print(f"{len(tickers)} tickers (including {len(BENCHMARKS)} benchmarks/ETFs)")
    print(f"Target depth: {args.years} years")

    shallow = [t for t in tickers
               if warehouse.has(t, max_age_days=3650)
               and not warehouse.has(t, max_age_days=3650, min_years=args.years)]
    if shallow:
        print(f"{len(shallow)} ticker(s) already stored but SHALLOWER than "
              f"{args.years} years — these will be re-downloaded.")
    print()

    stored = skipped = failed = 0
    started = time.time()

    try:
        for i, ticker in enumerate(tickers, 1):
            # Depth is part of the check: an entry holding 5 years must not
            # satisfy a 15-year request just because it is fresh.
            if not args.refresh and warehouse.has(ticker, max_age_days=7,
                                                  min_years=args.years):
                skipped += 1
                continue
            try:
                df, meta = prices.daily(ticker, use_warehouse=False,
                                        years=args.years)
                result = warehouse.upsert(ticker, df, meta)
                stored += 1
                adj = "adj" if result["adjusted"] else "UNADJUSTED"
                span = (int(result["last"][:4]) - int(result["first"][:4]))
                short = "  <- SHORT" if span < args.years - 1 else ""
                print(f"[{i:>4}/{len(tickers)}] {ticker:<6} {result['rows']:>5} rows  "
                      f"{result['first']} to {result['last']}  ~{span}y  "
                      f"{result['source']} ({adj}){short}")
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                failed += 1
                print(f"[{i:>4}/{len(tickers)}] {ticker:<6} FAILED  {str(exc)[:70]}")
            time.sleep(args.throttle)
    except KeyboardInterrupt:
        print(f"\nInterrupted. {stored} stored so far; re-run to continue.")
        return 130

    cov = warehouse.coverage()
    print(f"\n{'=' * 66}")
    print(f"Stored {stored}, skipped {skipped} (already fresh), failed {failed}"
          f"   in {(time.time() - started) / 60:.1f} min")
    print(f"\nWarehouse: {cov['tickers']} tickers, {cov['price_rows']:,} rows")
    print(f"  {cov['earliest']} to {cov['latest']}")
    print(f"  median history {cov['median_years_of_history']} years")
    print(f"  sources: {cov['sources']}")
    for note in cov["assessment"]:
        print(f"\n  * {note}")

    # A series with holes silently changes the window every indicator uses.
    print(f"\n{'-' * 66}\nGap check against SPY's calendar:")
    holey = []
    for t in tickers[:60]:
        g = warehouse.detect_gaps(t)
        if g.get("status") == "ok" and g["missing_pct"] > 1.0:
            holey.append(g)
    if holey:
        for g in sorted(holey, key=lambda x: -x["missing_pct"])[:8]:
            print(f"  {g['ticker']:<6} {g['missing_pct']:>5.1f}% missing, "
                  f"longest run {g['worst_run']} days")
        print("\n  Series with holes compute indicators over a different window "
              "than\n  they claim. Worth refreshing these from another source.")
    else:
        print("  No ticker missing more than 1% of SPY's trading days.")

    print("\nBacktests now read from here automatically "
          "(USE_WAREHOUSE=true in .env).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

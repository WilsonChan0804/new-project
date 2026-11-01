"""Analyse a watchlist and log every decision for forward calibration.

    python scripts\\watchlist.py

This is the one test the project has not run. Everything else is backtest —
rules applied to history that had already happened. Running the engine forward
produces evidence generated **after** the rules were fixed, which is the only
kind a backtest cannot fake.

Each run writes a decision to the log with its horizon and entry price. Months
later `scripts\\calibration.py` scores those against what actually happened.

## Watchlist file

Put one ticker per line in `watchlist.txt`. Blank lines and anything after `#`
are ignored:

    AAPL
    MSFT      # comment
    JPM

## A word on size

Alpha Vantage's free tier allows 25 requests a day and each ticker costs two
(company figures and news), so roughly twelve names a day. Prices, SEC filings
and 8-K events are free and unlimited, so a larger watchlist still works — it
just loses the Alpha Vantage half, which the coverage figure reports honestly.
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.analysis.analyzer import StockAnalyzer  # noqa: E402
from app.storage import db                       # noqa: E402
from app.storage import features as feature_store  # noqa: E402

DEFAULT_FILE = "watchlist.txt"

# One name per sector, so the log accumulates a cross-section rather than eight
# views of the same company. Concentration is the enemy of calibration: eight
# decisions on one ticker resolve to nearly the same outcome and count as one.
STARTER_WATCHLIST = """\
# One ticker per line. Anything after # is ignored.
# Around ten names is right: Alpha Vantage's free tier allows 25 calls a day
# and each ticker costs two.
#
# Spread across sectors. Eight decisions on one company are one observation,
# not eight, because their outcomes are the same outcome.
AAPL      # technology
JPM       # financials
XOM       # energy
JNJ       # healthcare
WMT       # consumer defensive
HD        # consumer cyclical
CAT       # industrials
NEE       # utilities
LIN       # materials
AMT       # real estate
"""


def load_watchlist(path):
    if not os.path.exists(path):
        return None
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            ticker = line.split("#")[0].strip().upper()
            if ticker:
                out.append(ticker)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default=DEFAULT_FILE)
    ap.add_argument("--tickers", default=None, help="Comma-separated override")
    ap.add_argument("--horizon-days", type=int, default=63)
    ap.add_argument("--no-log", action="store_true",
                    help="Analyse without writing to the calibration log")
    ap.add_argument("--min-gap-days", type=int, default=6,
                    help="Skip logging a ticker already logged this recently "
                         "(default 6, i.e. at most once a week). 0 disables.")
    args = ap.parse_args()

    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    else:
        tickers = load_watchlist(args.file)
        if tickers is None:
            # Write the file rather than describing it. Telling someone to
            # create a file by hand is friction with no purpose.
            with open(args.file, "w", encoding="utf-8") as fh:
                fh.write(STARTER_WATCHLIST)
            print(f"Created {args.file} with a starter list:\n")
            for line in STARTER_WATCHLIST.splitlines():
                if line.strip() and not line.startswith("#"):
                    print(f"    {line}")
            print(f"\nEdit {args.file} to suit, then run this again.")
            print("Running now with the starter list.\n")
            tickers = load_watchlist(args.file)

    if not tickers:
        print(f"{args.file} is empty.")
        return 1

    print(f"{len(tickers)} tickers, {args.horizon_days}-day horizon, "
          f"logging={'off' if args.no_log else 'on'}\n")

    analyzer = StockAnalyzer()
    rows, flags = [], []
    skipped = 0

    for i, ticker in enumerate(tickers, 1):
        try:
            res = analyzer.analyze(ticker, args.horizon_days)
        except Exception as exc:
            print(f"[{i:>3}/{len(tickers)}] {ticker:<6} FAILED  {str(exc)[:60]}")
            continue

        decision_id = None
        recent = (db.recent_decision(ticker, args.min_gap_days)
                  if args.min_gap_days > 0 and not args.no_log else None)
        if recent:
            skipped += 1
        elif not args.no_log and res.get("price") is not None:
            try:
                decision_id = db.log_decision(res)
                feature_store.save(res, decision_id)
            except Exception as exc:
                print(f"        log failed: {str(exc)[:60]}")

        rows.append({
            "ticker": ticker,
            "name": (res.get("name") or "")[:26],
            "action": res.get("action"),
            "score": res.get("opportunity_score"),
            "coverage": res.get("coverage"),
            "price": res.get("price"),
            "id": decision_id,
        })

        for flag in (res.get("corporate_events") or {}).get("red_flags", []):
            flags.append(f"{ticker}: {flag['label']} ({flag['age_days']}d ago)")
        for flag in ((res.get("sector_model") or {}).get("flags") or [])[:2]:
            flags.append(f"{ticker}: {flag[:150]}")

        time.sleep(0.2)

    if not rows:
        print("Nothing analysed.")
        return 1

    print(f"\n{'ticker':<8}{'action':<20}{'score':>7}{'cov':>7}{'price':>10}  name")
    for r in sorted(rows, key=lambda x: -(x["score"] or 0)):
        score = f"{r['score']:.1f}" if r["score"] is not None else "—"
        cov = f"{r['coverage']:.2f}" if r["coverage"] is not None else "—"
        price = f"{r['price']:.2f}" if r["price"] is not None else "—"
        print(f"{r['ticker']:<8}{str(r['action']):<20}{score:>7}{cov:>7}"
              f"{price:>10}  {r['name']}")

    if flags:
        print(f"\nFLAGS FROM FILINGS  ({len(flags)})")
        for f in flags[:20]:
            print(f"  {f}")
        print("\n  These are reported facts, not predictions. Worth reading the "
              "filing.")
    else:
        print("\nNo red flags in recent filings.")

    logged = sum(1 for r in rows if r["id"])
    if skipped:
        print(f"\n{skipped} ticker(s) not logged: already logged in the last "
              f"{args.min_gap_days} days. Re-running inside a week adds duplicates, "
              "not evidence.")
    if logged:
        print(f"\n{logged} decision(s) logged. They resolve in about "
              f"{int(args.horizon_days * 1.45)} days.")
        print("Then:  python scripts\\calibration.py resolve")
    print("\nReminder: the composite was measured at IC +0.008 +/- 0.014 and does "
          "not rank\nstocks. Read the flags and the filings; treat the score as a "
          "summary, not a forecast.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

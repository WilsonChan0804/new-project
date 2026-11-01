"""Score the engine's live decisions against what actually happened.

    python scripts\\calibration.py resolve     # close out anything past its horizon
    python scripts\\calibration.py report      # how the closed ones did
    python scripts\\calibration.py status      # what is logged and what is pending

Backtests apply today's rules to yesterday's data. This applies fixed rules to
data that had not happened yet when the decision was made, which is the only
evidence a backtest cannot manufacture.

The engine already knows it does not rank stocks — composite IC +0.008 +/-
0.014 over fifteen years. So the expected outcome here is a Brier score near
0.25, matching a coin flip. Running it anyway is the point: a prediction made
in advance and scored in public is worth more than any amount of retrospective
fitting, including when it confirms a null.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.providers import prices  # noqa: E402
from app.storage import db        # noqa: E402


def cmd_status():
    with db.connect() as conn:
        total = conn.execute("SELECT COUNT(*) c FROM decisions").fetchone()["c"]
        resolved = conn.execute("SELECT COUNT(*) c FROM outcomes").fetchone()["c"]
        by_action = conn.execute(
            "SELECT action, COUNT(*) c FROM decisions GROUP BY action "
            "ORDER BY c DESC").fetchall()
        span = conn.execute(
            "SELECT MIN(created_at) a, MAX(created_at) b FROM decisions").fetchone()
        by_ticker = conn.execute(
            "SELECT ticker, COUNT(*) c FROM decisions GROUP BY ticker "
            "ORDER BY c DESC").fetchall()

    due = db.due_decisions()
    print(f"decisions logged   {total}")
    print(f"already resolved   {resolved}")
    print(f"due to resolve now {len(due)}")
    print(f"pending, not due   {total - resolved - len(due)}")
    if span and span["a"]:
        print(f"first logged       {span['a'][:10]}")
        print(f"most recent        {span['b'][:10]}")
    if by_action:
        print("\nby action:")
        for r in by_action:
            print(f"  {r['action']:<20} {r['c']}")
    if by_ticker:
        distinct = len(by_ticker)
        top = by_ticker[0]
        print(f"\ndistinct tickers   {distinct}")
        if distinct <= 3 and total >= 5:
            share = 100.0 * top["c"] / total
            print(f"\n  {top['ticker']} accounts for {share:.0f}% of the log. For "
                  "calibration those are\n  not independent decisions: the same "
                  "company over a few days resolves to\n  nearly the same outcome, "
                  "so they count as roughly one observation.\n  Spread the watchlist "
                  "across sectors — see watchlist.txt.")

    if due:
        print(f"\n{len(due)} ready. Run:  python scripts\\calibration.py resolve")
    elif total == 0:
        print("\nNothing logged yet. Run:  python scripts\\watchlist.py")
    return 0


def cmd_resolve():
    due = db.due_decisions()
    if not due:
        print("Nothing is past its horizon yet. Check back later.")
        return 0

    print(f"{len(due)} decision(s) due.\n")
    ok = failed = 0
    for d in due:
        try:
            df, _ = prices.daily(d["ticker"])
            exit_price = float(df.close.iloc[-1])
            ret = db.record_outcome(d["id"], exit_price, d["entry_price"])
            ok += 1
            print(f"  {d['ticker']:<7}{d['action']:<18} "
                  f"{d['entry_price']:.2f} -> {exit_price:.2f}   {ret:+.2f}%")
        except Exception as exc:
            failed += 1
            print(f"  {d['ticker']:<7}FAILED  {str(exc)[:60]}")

    print(f"\nresolved {ok}, failed {failed}")
    print("Then:  python scripts\\calibration.py report")
    return 0


def cmd_report(bins):
    r = db.calibration_report(bins)
    if r.get("status") != "ok":
        print(r.get("message", r.get("status")))
        return 0

    print(f"sample size {r['sample_size']}")
    print(f"\nBrier score            {r['brier_score']}")
    print(f"always-say-50% baseline {r['brier_baseline_always_50pct']}")
    print(f"beats a coin flip       {r['beats_coinflip']}")

    if r.get("reliability_table"):
        print("\nRELIABILITY  (does 60% happen 60% of the time?)")
        print(f"  {'predicted':<14}{'said':>8}{'happened':>10}{'mean ret':>10}{'n':>6}")
        for b in r["reliability_table"]:
            print(f"  {b['predicted_range']:<14}{b['mean_predicted']:>8.3f}"
                  f"{b['actual_bullish_rate']:>10.3f}"
                  f"{b['mean_realised_return_pct']:>10.2f}{b['n']:>6}")

    if r.get("by_action"):
        print("\nBY ACTION")
        print(f"  {'action':<20}{'n':>5}{'mean ret':>10}{'hit rate':>10}")
        for action, b in sorted(r["by_action"].items(),
                                key=lambda x: -x[1]["mean_return_pct"]):
            print(f"  {action:<20}{b['n']:>5}{b['mean_return_pct']:>10.2f}"
                  f"{b['hit_rate']:>10.3f}")

    print(f"\n{r['interpretation']}")
    if r["sample_size"] < 100:
        print(f"\nWith {r['sample_size']} resolved decisions nothing here is "
              "conclusive. A few hundred is where it starts to mean something.")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["resolve", "report", "status"],
                    nargs="?", default="status")
    ap.add_argument("--bins", type=int, default=5)
    args = ap.parse_args()

    if args.command == "resolve":
        return cmd_resolve()
    if args.command == "report":
        return cmd_report(args.bins)
    return cmd_status()


if __name__ == "__main__":
    sys.exit(main())

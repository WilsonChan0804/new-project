"""Run a backtest from the command line and save the result to a file.

    python scripts\\run_backtest.py --universe screen --years 15

No server needed, no JSON quoting, no browser. It runs the same code the API
runs and writes the full result to a file you can upload or read later, plus a
readable summary on screen.

Examples:

    python scripts\\run_backtest.py --universe screen --years 15
    python scripts\\run_backtest.py --universe diversified_60 --years 15
    python scripts\\run_backtest.py --universe screen --max-names 100 --years 5
"""
import argparse
import json
import os
import sys
import time
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.backtest import attribution as bt_attr        # noqa: E402
from app.backtest import decomposition as bt_decomp    # noqa: E402
from app.backtest import event_study as bt_events      # noqa: E402
from app.backtest import metrics as bt_metrics         # noqa: E402
from app.backtest import portfolio as bt_portfolio     # noqa: E402
from app.backtest import universe as bt_universe       # noqa: E402
from app.backtest.replay import Replay                 # noqa: E402


def resolve_universe(args):
    if args.universe.lower() == "screen":
        from app.screener import store as screen_store
        res = screen_store.results(limit=args.max_names, order="score",
                                   require_critical=True)
        if res.get("status") != "ok" or not res.get("results"):
            print("No completed screen to draw from. Run this first:\n"
                  "    python scripts\\screen_universe.py --limit 1500")
            return None
        sectors = {r["ticker"]: (r.get("sector") or "UNKNOWN")
                   for r in res["results"]}
        print(f"Drawing {len(sectors)} names from screen run "
              f"{res['run']['id']} (median cohort {res['median_cohort_size']})")
        return sectors
    try:
        return bt_universe.get(args.universe)
    except KeyError as exc:
        print(exc)
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--universe", default="screen",
                    help="screen | diversified_60 | starter_10")
    ap.add_argument("--years", type=int, default=15)
    ap.add_argument("--horizon-days", type=int, default=63)
    ap.add_argument("--every-days", type=int, default=21)
    ap.add_argument("--max-names", type=int, default=250)
    ap.add_argument("--top-n", type=int, default=10)
    ap.add_argument("--out", default="backtest_result.json")
    args = ap.parse_args()

    sectors = resolve_universe(args)
    if not sectors:
        return 1

    end = date.today() - timedelta(days=int(args.horizon_days * 1.5))
    start = end - timedelta(days=365 * args.years)
    print(f"Replaying {len(sectors)} tickers, {start} to {end}, "
          f"{args.horizon_days}-day horizon.")
    print("First run pulls prices and filings; later runs read the warehouse.\n")

    started = time.time()
    replay = Replay(list(sectors), horizon_days=args.horizon_days,
                    every_days=args.every_days, start=start, end=end)
    replay.set_sectors(sectors)
    raw = replay.run()

    if not raw["records"]:
        print("No records produced. Check that prices are available.")
        return 1

    summary = bt_metrics.summarise(raw)
    if summary.get("status") != "ok":
        print(summary.get("message", summary.get("status")))
        return 1

    n_dates = len({r["as_of"] for r in raw["records"]})
    summary["sample_adequacy"] = bt_universe.adequacy(
        round(len(raw["records"]) / max(n_dates, 1)), n_dates)
    summary["universe"] = {
        "name": args.universe, "requested": len(sectors),
        "with_usable_data": len({r["ticker"] for r in raw["records"]}),
        "survivorship_warning": bt_universe.SURVIVORSHIP_WARNING,
    }
    summary["attribution"] = bt_attr.attribute(raw)
    summary["signal_decomposition"] = {
        k: bt_decomp.decompose(raw["records"], k,
                               horizon_days=args.horizon_days,
                               every_days=args.every_days)
        for k in ("valuation", "score")}
    summary["weight_fitting"] = bt_attr.fit_weights(raw)
    summary["portfolio_simulation"] = bt_portfolio.simulate(raw, top_n=args.top_n)
    summary["portfolio_simulation_sector_neutral"] = bt_portfolio.simulate(
        raw, score_key="score", sector_neutral=True, per_sector=1)

    bt_events.attach_events(raw["records"], raw.get("filings_by_ticker") or {})
    summary["event_study"] = bt_events.run(raw["records"], sample_id={
        "universe": args.universe,
        "period": f"{start} to {end}",
        "horizon_days": args.horizon_days,
    }, horizon_days=args.horizon_days, every_days=args.every_days)

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2, default=str)

    # ---- readable summary -------------------------------------------------
    print(f"{'=' * 66}")
    print(f"Done in {(time.time() - started) / 60:.1f} min. "
          f"Full result written to {args.out}")
    print(f"{'=' * 66}\n")

    print(f"observations {summary['n_observations']}, dates {summary['n_dates']}, "
          f"effective dates {summary.get('ic_effective_dates')}")
    print(f"\nCOMPOSITE IC  {summary['information_coefficient']:+.4f} "
          f"+/- {summary['ic_std_error']:.4f}   t = {summary['ic_t_stat']:+.2f}")
    print(f"  {summary['verdict'][:200]}")

    a = summary["attribution"]
    if a.get("status") == "ok":
        bar = (a.get("multiple_testing") or {}).get("t_threshold_used", "?")
        print(f"\nCOMPONENTS   (bar |t| > {bar})")
        for name, c in a["components"].items():
            if c.get("mean_ic") is None:
                print(f"  {name:<15} {'—':>9}          {c.get('kind', '')}")
            else:
                mark = "  <-- SIGNIFICANT" if c["significant"] else ""
                print(f"  {name:<15} {c['mean_ic']:+9.4f}  t {c['t_stat']:+6.2f}{mark}")

    d = summary["signal_decomposition"].get("valuation") or {}
    if d.get("status") == "ok":
        print(f"\nVALUATION, WHERE IT LIVES   (median cohort "
              f"{d.get('median_cohort_size')})")
        for part in ("between_sector", "within_sector"):
            b = d[part]
            print(f"  {part:<16} {b['mean_ic']:+.4f}  t {b['t_stat']:+.2f}  "
                  f"sig={b['significant']}")

    if summary.get("stability"):
        print("\nSTABILITY")
        for p in summary["stability"]["periods"]:
            print(f"  {p['period']}  n={p['n_dates']:>3}  IC {p['mean_ic']:+.4f}")

    print("\nPORTFOLIOS")
    for label, key in [("composite", "portfolio_simulation"),
                       ("sector-neutral", "portfolio_simulation_sector_neutral")]:
        p = summary.get(key) or {}
        if p.get("status") == "ok":
            s, b = p["strategy"], p["benchmark_equal_weight_universe"]
            print(f"  {label:<16} {s['annualised_return_pct']:>7}% / Sharpe "
                  f"{s['sharpe']:<5}   benchmark {b['annualised_return_pct']}% / "
                  f"{b['sharpe']}")

    e = summary.get("event_study") or {}
    if e.get("status") == "ok":
        print(f"\nEVENT STUDY   (bar |t| > {e['t_threshold']})")
        for r in e["results"]:
            if r["status"] != "ok":
                print(f"  {r['hypothesis']:<24} too few events")
            else:
                mark = "  <-- SIGNIFICANT" if r["significant"] else ""
                print(f"  {r['hypothesis']:<24} n={r['n_events']:<6} "
                      f"{r['mean_abnormal_return_pct']:+6.2f}%  "
                      f"t={r['t_stat']:+6.2f}{mark}")
        for r in e.get("awaiting_confirmation", []):
            if r.get("status") == "ok":
                print(f"  {r['hypothesis']:<24} n={r['n_events']:<6} "
                      f"{r['mean_abnormal_return_pct']:+6.2f}%  "
                      f"t={r['t_stat']:+6.2f}   "
                      f"independent={r['is_confirmation']}")
        print(f"  {e['verdict'][:200]}")

    print(f"\nUpload {args.out} if you want it read in detail.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

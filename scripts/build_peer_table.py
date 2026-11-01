"""Build the sector peer table that live analysis ranks against.

Run this once, then again every month or so as filings update:

    python scripts/build_peer_table.py

It walks the diversified_60 universe, pulls each company's current SEC filings
and price, extracts the raw metrics, and stores the per-sector distributions in
SQLite. After that, `/analyze` reports where a company sits against its own
sector rather than against a global threshold.

Costs no Alpha Vantage quota: prices come from Yahoo and fundamentals from SEC
EDGAR, both keyless. Expect a few minutes on the first run and seconds after,
since both are cached.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import date  # noqa: E402

from app.analysis import filings as filings_mod  # noqa: E402
from app.analysis import peers as peers_mod      # noqa: E402
from app.backtest import universe as uni         # noqa: E402
from app.backtest.replay import valuation_pit    # noqa: E402
from app.providers import edgar, prices          # noqa: E402


def main(universe_name="diversified_60"):
    sectors = uni.get(universe_name)
    as_of = date.today()
    rows, failed = [], []

    for i, (ticker, sector) in enumerate(sorted(sectors.items()), 1):
        try:
            df, _ = prices.daily(ticker)
            price = float(df.close.iloc[-1])
            facts = edgar.load(ticker)
            fil = filings_mod.analyse(facts, as_of)
            _, val_inputs = valuation_pit(facts, as_of, price)
            metrics = peers_mod.extract_metrics(fil, val_inputs)
            if any(v is not None for v in metrics.values()):
                rows.append({"sector": sector, "metrics": metrics})
                have = sum(1 for v in metrics.values() if v is not None)
                print(f"[{i:>2}/{len(sectors)}] {ticker:<6} {sector:<24} "
                      f"{have}/{len(metrics)} metrics")
            else:
                failed.append((ticker, "no usable metrics"))
        except Exception as exc:
            failed.append((ticker, str(exc)[:70]))
            print(f"[{i:>2}/{len(sectors)}] {ticker:<6} SKIPPED — {str(exc)[:60]}")
        time.sleep(0.12)   # be polite to SEC

    if len(rows) < peers_mod.MIN_COHORT:
        print(f"\nOnly {len(rows)} companies resolved — too few to rank against. "
              "Nothing saved.")
        return 1

    table = peers_mod.PeerTable.build(rows)
    summary = table.save()

    print(f"\nSaved peer table: {len(rows)} companies, "
          f"{summary['sectors']} sectors.")
    thin = []
    for sector, info in summary["metrics_per_sector"].items():
        marker = ""
        if info["median_cohort"] < peers_mod.MIN_COHORT:
            marker = "  <- too thin to rank within; falls back to absolute"
            thin.append(sector)
        print(f"   {sector:<24} {info['median_cohort']:>3} peers"
              f"  {info['metrics']} metrics{marker}")

    if thin:
        print(f"\n{len(thin)} sector(s) below the {peers_mod.MIN_COHORT}-company "
              "minimum. Add more names in those sectors to app/backtest/universe.py "
              "if you want them ranked rather than scored absolutely.")
    if failed:
        print(f"\n{len(failed)} skipped:")
        for t, why in failed[:10]:
            print(f"   {t:<6} {why}")
    print("\nDone. /analyze will now report sector-relative percentiles.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "diversified_60"))

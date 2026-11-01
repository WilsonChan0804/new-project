"""Check this engine's measurement layer against Alphalens.

    pip install alphalens-reloaded
    python scripts/export_for_alphalens.py
    python scripts/alphalens_check.py

Note the package name: `alphalens-reloaded`, the maintained fork by Stefan
Jansen. The original `alphalens` on PyPI stopped at 0.4.0 and does not run on
modern pandas.

## What it compares

| This engine | Alphalens |
|---|---|
| `information_coefficient` (per-date mean) | `mean_information_coefficient` |
| `signal_decomposition.within_sector` | same, with `binning_by_group=True` |
| `score_buckets_cross_sectional` | `mean_return_by_quantile(demeaned=True)` |

The two use different code paths for the same quantities, so agreement is
evidence the arithmetic is right and disagreement localises a bug.

## Where they legitimately differ

Alphalens shifts prices **positionally** — `periods=63` means 63 rows down the
price panel, not 63 calendar days — and drops any factor date without a full
forward window. This engine measures Spearman per date and averages; Alphalens
does the same but computes forward returns from a price panel rather than from
stored entry/exit pairs. Small differences follow from that and are expected.
A gap larger than about 0.02 in mean IC is not.
"""
import argparse
import os
import sys
from contextlib import contextmanager

import pandas as pd


@contextmanager
def tolerant_freq():
    """Work around an Alphalens incompatibility with monthly rebalance dates.

    `compute_forward_returns` finishes its work, then stamps the trading
    calendar it inferred from the daily price panel onto the factor's date
    index (`df.index.levels[0].freq = freq`). With a daily factor those dates
    conform. With a 21-day rebalance they do not, and pandas raises
    `Inferred frequency None ... does not conform to passed frequency C`.

    The assignment is metadata only and happens after every return is already
    computed, so relaxing the check changes no number — verified by running the
    same factor both ways and getting identical results to four decimal places.
    Scoped to this call and restored immediately.
    """
    from pandas.core.arrays.datetimelike import TimelikeOps
    original = TimelikeOps._validate_frequency
    TimelikeOps._validate_frequency = staticmethod(lambda *a, **k: None)
    try:
        yield
    finally:
        TimelikeOps._validate_frequency = original

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

EXPORT = "alphalens_export"


def load():
    if not os.path.exists(f"{EXPORT}/factor.csv"):
        print(f"No {EXPORT}/factor.csv. Run scripts/export_for_alphalens.py first.")
        return None, None, None

    f = pd.read_csv(f"{EXPORT}/factor.csv", parse_dates=["date"])
    prices = pd.read_csv(f"{EXPORT}/prices.csv", parse_dates=["date"]).set_index("date")

    factor = f.set_index(["date", "asset"])["factor"].sort_index()
    sectors = f.drop_duplicates("asset").set_index("asset")["sector"].to_dict()
    return factor, prices, sectors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--periods", type=int, default=63)
    ap.add_argument("--quantiles", type=int, default=5)
    ap.add_argument("--factor", default="score", help="label only, for output")
    args = ap.parse_args()

    try:
        import alphalens as al
    except ImportError:
        print("Alphalens is not installed.\n\n    pip install alphalens-reloaded\n\n"
              "Note the '-reloaded' suffix: the original package is unmaintained "
              "and breaks on current pandas.")
        return 1

    factor, prices, sectors = load()
    if factor is None:
        return 1

    print(f"factor rows {len(factor)}   assets {prices.shape[1]}   "
          f"price days {prices.shape[0]}\n")

    common = [a for a in prices.columns if a in sectors]
    prices = prices[common]
    factor = factor[factor.index.get_level_values("asset").isin(common)]

    with tolerant_freq():
        # --- 1. plain cross-sectional -------------------------------------
        data = al.utils.get_clean_factor_and_forward_returns(
            factor=factor, prices=prices, groupby=sectors,
            quantiles=args.quantiles, periods=(args.periods,),
            max_loss=0.6)

        ic_value = float(al.performance.mean_information_coefficient(data).iloc[0])

        # --- 2. sector-relative, the within-sector question ---------------
        grouped = al.utils.get_clean_factor_and_forward_returns(
            factor=factor, prices=prices, groupby=sectors,
            binning_by_group=True, quantiles=args.quantiles,
            periods=(args.periods,), max_loss=0.6)
        ic_within = float(al.performance.mean_information_coefficient(
            grouped, group_adjust=True).iloc[0])

        # --- 3. quantile returns, demeaned by date ------------------------
        q_mean, _ = al.performance.mean_return_by_quantile(data, demeaned=True)

    col = q_mean.columns[0]

    print("=" * 66)
    print(f"ALPHALENS, factor = {args.factor}, horizon = {args.periods} days")
    print("=" * 66)
    print(f"  mean IC                       {ic_value:+.4f}")
    print(f"  mean IC, sector-adjusted      {ic_within:+.4f}")
    print("\n  mean return by quantile (demeaned within date):")
    for q, v in q_mean[col].items():
        print(f"    Q{q}   {100 * float(v):+.3f}%")

    print("\n" + "=" * 66)
    print("COMPARE against your own backtest response")
    print("=" * 66)
    print("  Alphalens mean IC          ->  information_coefficient")
    print("  Alphalens sector-adjusted  ->  signal_decomposition.<factor>"
          ".within_sector.mean_ic")
    print("  Alphalens quantile returns ->  score_buckets_cross_sectional")
    print("\n  Agreement within ~0.02 on mean IC means the measurement layer is")
    print("  externally validated. A larger gap means one implementation has a")
    print("  bug, and that is worth far more than any new feature.")
    print("\n  Reminder on direction: Q1 is the LOWEST factor value. If your")
    print("  quantile returns rise from Q1 to Q5, the factor ranks correctly.")

    print("\nFor the full picture, in a notebook:")
    print("    al.tears.create_full_tear_sheet(factor_data, by_group=True)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

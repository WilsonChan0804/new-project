"""Offline backtest smoke test — synthetic prices, no network.

Two universes are replayed. In the first, prices are pure random walks, so the
score should have no relationship with what happens next and the IC should sit
near zero. In the second, a stock's future return is deliberately tied to its
own past trend, so the IC should turn clearly positive.

If the first shows a strong IC, something is leaking future information.
"""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.backtest import metrics as bt_metrics   # noqa: E402
from app.backtest import replay as rp            # noqa: E402


def walk(seed, n=1400, drift=0.0003, vol=0.015, momentum=0.0):
    """momentum > 0 makes the next move depend on the last 60 days."""
    rng = np.random.default_rng(seed)
    r = rng.normal(drift, vol, n)
    if momentum:
        for i in range(60, n):
            r[i] += momentum * float(np.mean(r[i - 60:i]))
    close = 100 * np.exp(np.cumsum(r))
    return pd.DataFrame({
        "date": pd.date_range("2021-01-04", periods=n, freq="B"),
        "open": close, "high": close * 1.007, "low": close * 0.993,
        "close": close, "volume": rng.integers(1e6, 6e6, n).astype(float),
    })


def run(label, momentum):
    tickers = [f"S{i}" for i in range(24)]
    series = {t: walk(100 + i, momentum=momentum) for i, t in enumerate(tickers)}
    series["SPY"] = walk(7)

    span = series[tickers[0]].date
    start = (span.iloc[300]).date()
    end = (span.iloc[-70]).date()

    r = rp.Replay(tickers, horizon_days=63, every_days=14, start=start, end=end)
    r._load = lambda: r._prices.update(series)
    out = r.run()
    m = bt_metrics.summarise(out)

    print(f"\n=== {label} ===")
    if m["status"] != "ok":
        print(m["message"])
        return
    print(f"observations {m['n_observations']}  effective {m['n_effective']}"
          f"  (overlap x{m['overlap_factor']})")
    print(f"IC (per-date mean) {m['information_coefficient']:+.4f} "
          f"+/- {m['ic_std_error']:.4f}  t={m['ic_t_stat']:+.2f}")
    print(f"pooled IC          {m['pooled_ic']:+.4f}  (diagnostic only)")
    print("cross-sectional score buckets:")
    for b in m["score_buckets_cross_sectional"]:
        print(f"   {b['bucket']:>7}  n={b['n']:<4} mean {b['mean_return_pct']:>6.2f}%"
              f"  hit {b['hit_rate']:.0%}")
    print("verdict:", m["verdict"])


run("A. random walks — IC should be near zero", momentum=0.0)
run("B. trend-following prices — IC should be clearly positive", momentum=0.45)

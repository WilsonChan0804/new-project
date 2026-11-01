"""Which EODHD plan do you actually need? Test it, don't guess.

    python scripts/check_eodhd.py

Sign up for the free key first (20 calls/day, no card required) and put it in
`.env` as `EODHD_API_KEY`. This script spends about six of those calls probing
the endpoints the engine would use, and tells you which of its gaps each one
closes.

It is deliberately opinionated about what matters. The engine already gets
point-in-time fundamentals free from SEC EDGAR, and its news component has
never measured anything, so paying for either would be spending money on a
problem you do not have.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import date  # noqa: E402

from app.config import settings  # noqa: E402
from app.providers.eodhd import EodhdClient, EodhdNotSubscribed  # noqa: E402

# Tickers that left the index. If EOD prices work for these, survivorship can
# actually be fixed; if they only work for survivors, nothing has changed.
DELISTED_PROBES = ["SIVB.US", "FRC.US", "ATVI.US"]


def probe(label, fn, why):
    print(f"\n--- {label}")
    print(f"    why it matters: {why}")
    try:
        result = fn()
        print(f"    AVAILABLE  {result}")
        return True
    except EodhdNotSubscribed as exc:
        print(f"    NOT ON THIS PLAN  {exc}")
        return False
    except Exception as exc:
        print(f"    FAILED  {type(exc).__name__}: {str(exc)[:110]}")
        return False


def main():
    if not settings.eodhd_api_key:
        print("No EODHD_API_KEY in .env.\n"
              "Get a free key at eodhd.com/register (no card needed) and add:\n"
              "    EODHD_API_KEY=your_key_here")
        return 1

    client = EodhdClient()
    results = {}

    def constituents():
        rows = client.sp500_membership()
        delisted = sum(1 for r in rows if r["is_delisted"])
        past = sum(1 for r in rows if not r["is_active"])
        return (f"{len(rows)} tickers, {past} no longer members, "
                f"{delisted} delisted")

    results["constituents"] = probe(
        "S&P 500 historical constituents",
        constituents,
        "THE survivorship fix. Reconstructs the index as it stood on a past "
        "date, so companies that failed or were acquired stop vanishing.")

    def delisted_prices():
        ok = []
        for t in DELISTED_PROBES:
            try:
                df = client.daily(t, start="2019-01-01")
                if len(df):
                    ok.append(f"{t}({len(df)}d)")
            except Exception:
                continue
        if not ok:
            raise EodhdNotSubscribed(
                "No price history for any delisted ticker tested.")
        return "price history for " + ", ".join(ok)

    results["delisted_prices"] = probe(
        "EOD prices for delisted companies",
        delisted_prices,
        "A constituent list is useless without prices for the names that "
        "disappeared. Both halves are needed or neither works.")

    def live_prices():
        df = client.daily("AAPL.US", start="2021-01-01")
        return f"AAPL {len(df)} rows, adjusted, to {df.date.iloc[-1].date()}"

    results["eod_prices"] = probe(
        "EOD prices, current tickers",
        live_prices,
        "Would replace Yahoo. Not urgent — Yahoo already works and is free.")

    # --- verdict ----------------------------------------------------------
    print("\n" + "=" * 70)
    core = results["constituents"] and results["delisted_prices"]

    if core:
        print("This key CLOSES the survivorship gap.")
        print("\nNext: set in .env")
        print("    BACKTEST_UNIVERSE_SOURCE=eodhd_sp500")
        print("then re-run the backtest and compare the information coefficient")
        print("against your survivor-only run. Expect it to get WORSE. That is")
        print("the point — you are removing flattery, not adding skill.")
    elif results["constituents"]:
        print("Constituents work but delisted prices do not — that is half a fix,")
        print("and half a fix here is no fix. You would know which companies left")
        print("the index but not what happened to them.")
    else:
        print("This key does NOT close the survivorship gap.")
        print("\nEODHD states that S&P 500 historical constituents come with any")
        print("plan that includes the Fundamental Data API. The EOD-only tier does")
        print("not include it, which is why the cheapest plan is not the right one")
        print("here even though price data is what you superficially need.")

    print("\n" + "-" * 70)
    print("What NOT to pay for, given what this engine already has:")
    print("  * Fundamentals — SEC EDGAR already gives these point-in-time, free,")
    print("    from the primary source. Buying them again fixes nothing.")
    print("  * News archive — the news component has never produced a measurable")
    print("    result. It held 15% of the weight and was never validated. Paying")
    print("    to feed it is spending money on a problem you do not have.")
    print("  * Intraday — the engine has no intraday logic and does not need any.")
    print("\nAsk about the student/academic discount before subscribing: EODHD")
    print("lists 50% off for 12 months with proof of status.")
    print("Check WRDS access through any university affiliation first — if you")
    print("have it, it is better data than any of this and costs nothing.")
    return 0 if core else 2


if __name__ == "__main__":
    sys.exit(main())

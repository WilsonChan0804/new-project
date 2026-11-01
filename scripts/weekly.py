"""The whole weekly routine in one command. Built to be run by a scheduler.

    python scripts\\weekly.py                 # everything
    python scripts\\weekly.py --skip-screen   # watchlist + resolve only (fast)
    python scripts\\weekly.py --limit 1500    # sample the market instead of all of it

Steps, in order:

1. **Resolve** every decision past its horizon (priced at its due date, vs SPY).
2. **Screen the whole US market** from free data (SEC + Yahoo) and log every
   scored name to the forward test. Resumes automatically if a run from today
   was interrupted.
3. **Watchlist**: full analysis, Alpha Vantage included, on watchlist.txt.
4. **Report**: the calibration report, as it stands.

Output goes to the screen and to ``logs/weekly-YYYY-MM-DD.log``. Each step
runs as its own process, so one failing does not stop the others.

Running it twice in a week does no harm: decisions already logged in the last
six days are skipped rather than duplicated.
"""
import argparse
import os
import subprocess
import sys
from datetime import date, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(step, args, log):
    cmd = [sys.executable, os.path.join(ROOT, "scripts", step), *args]
    banner = f"\n{'=' * 70}\n{datetime.now():%Y-%m-%d %H:%M}  {step} {' '.join(args)}\n{'=' * 70}\n"
    print(banner, end="", flush=True)
    log.write(banner)
    proc = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True,
                            encoding="utf-8", errors="replace",
                            env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    for line in proc.stdout:
        print(line, end="", flush=True)
        log.write(line)
    code = proc.wait()
    if code not in (0, None):
        msg = f"\n!! {step} exited with code {code}\n"
        print(msg, end="")
        log.write(msg)
    log.flush()
    return code


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-screen", action="store_true")
    ap.add_argument("--skip-watchlist", action="store_true")
    ap.add_argument("--limit", type=int, default=0,
                    help="Screen a random sample of N names instead of the whole "
                         "market (0 = all, the default)")
    args = ap.parse_args()

    os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
    path = os.path.join(ROOT, "logs", f"weekly-{date.today()}.log")
    failures = 0
    with open(path, "a", encoding="utf-8") as log:
        failures += bool(run("calibration.py", ["resolve"], log))
        if not args.skip_screen:
            screen_args = ["--log-forward", "--resume", "--limit", str(args.limit)]
            failures += bool(run("screen_universe.py", screen_args, log))
        if not args.skip_watchlist:
            failures += bool(run("watchlist.py", [], log))
        failures += bool(run("calibration.py", ["report"], log))
    print(f"\nLog written to {path}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

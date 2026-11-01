# Two GitHub AI trading tools, reviewed against this engine

Reviewed 2026-11-01 from each repository's default branch.

## HKUDS/AI-Trader

**What it is:** a social platform where AI agents sign up, publish trading
signals, copy each other's trades and earn points, with $100K paper accounts and
a leaderboard (ai4trade.ai). The repo is the platform's FastAPI backend, React
frontend and agent "skills", plus a research pipeline for a paper about agent
competition and cooperation.

**What it is not:** a stock-analysis engine. There is no factor model, no
backtest of whether any signal predicts returns, and no point-in-time data
discipline, because none of that is its purpose.

**Adoptable:** very little.
- Paper trading with mark-to-market: this engine's forward test already does
  the measuring part, against SPY, without inventing fills.
- yfinance fallback for prices: already here (`PRICE_SOURCES=yahoo`).

**Caution:** its quick start tells an agent to fetch a SKILL.md from an external
site and register itself. Copy-trading a leaderboard selects for luck: with
thousands of agents, the top of a short-window leaderboard is mostly noise.

## TauricResearch/TradingAgents (v0.7.1)

**What it is:** a multi-agent LLM framework. Analyst agents (fundamentals,
sentiment, news, technical) write reports, bull and bear researchers debate,
a trader proposes, and risk managers and a portfolio manager approve. It
supports many LLM providers and any Yahoo market (including Hong Kong, e.g.
`0700.HK`). Since v0.5 it has worked hard on point-in-time integrity.

**Adopted in v3.10:**
- **Enter at the first close after the decision.** A decision may read data
  from after that day's close, so the earliest price anyone could act at is
  the next close. `app/storage/resolve.py` now does this.
- **Score decisions as alpha against a benchmark, grouped by rating.** Their
  memory log settles every decision against the regional benchmark; this
  engine now records SPY over the same window and reports excess return by
  action.

**Considered, not adopted:**
- **LLM agents as the signal.** Three problems. Cost: several model calls per
  ticker per run, which rules out screening thousands of names weekly.
  Non-determinism: its README says two runs of the same ticker and date can
  differ. And, decisively, an LLM cannot be honestly backtested on dates
  inside its training data, because the model may already know what happened.
  Only forward runs are clean, which is what this engine's forward test
  already does more cheaply.
- **Possible later use:** an LLM-written research memo for the 10-20 names a
  screen shortlists, as reading material rather than a signal. It would sit
  beside the 8-K flags and filings, not feed the score.
- **Non-US markets:** this engine depends on SEC EDGAR, so it is US-only.
  TradingAgents is the better starting point for Hong Kong shares.

## Bottom line

Neither tool shows evidence that it predicts returns. TradingAgents is a
well-engineered research scaffold and says so itself. AI-Trader is a social
trading platform. This engine's distinguishing parts (point-in-time filings,
overlap-corrected statistics, a forward test whose rules are fixed before the
results exist) are things both either lack or are only now adding.

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from .analysis import context as ctx
from .analysis.analyzer import StockAnalyzer
from .config import VERSION, settings
from .portfolio.risk import size_position
from .providers import prices
from .providers.alpha_vantage import AlphaVantageClient
from .storage import db, features as feature_store

app = FastAPI(title="Investment Decision Engine", version=VERSION)
analyzer = StockAnalyzer()

PREFIX = "/api/v1"
DASHBOARD = Path(__file__).parent / "static" / "dashboard.html"
RESEARCH = Path(__file__).parent / "static" / "research.html"


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def dashboard():
    """Plain-English dashboard. The JSON API is still at /docs."""
    return HTMLResponse(DASHBOARD.read_text(encoding="utf-8"))


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "investment-decision-engine",
        "version": VERSION,
        "base_currency": settings.base_currency,
        "calibrated": False,
    }


@app.get(PREFIX + "/providers/prices")
def price_provider_probe(ticker: str = Query("AAPL", description="Any liquid ticker")):
    """Test every price source independently.

    Run this first if coverage is low. It tells you which providers your
    network can actually reach, so you can reorder PRICE_SOURCES in .env.
    """
    results = prices.probe(ticker)
    working = [k for k, v in results.items() if v["ok"]]
    return {
        "ticker": ticker.upper(),
        "configured_order": settings.price_sources,
        "working": working,
        "results": results,
        "advice": (
            f"Set PRICE_SOURCES={','.join(working)} in .env"
            if working else
            "No price source is reachable. Check your network/proxy, or add a "
            "keyed provider (Tiingo, EODHD, Twelve Data all have free tiers)."
        ),
    }


@app.get(PREFIX + "/stocks/{ticker}/diagnostics")
def diagnostics(ticker: str):
    out = {"ticker": ticker.upper()}
    try:
        df, meta = prices.daily(ticker)
        out["price_ok"] = True
        out["price_rows"] = len(df)
        out["price_source"] = meta.get("source")
        out["price_adjusted"] = meta.get("adjusted")
        out["price_first"] = str(df.date.iloc[0].date())
        out["price_last"] = str(df.date.iloc[-1].date())
        out["price_source_attempts"] = meta.get("attempts")
        out["price_error"] = None
    except Exception as exc:
        out.update({"price_ok": False, "price_rows": 0, "price_error": str(exc)})

    av = AlphaVantageClient()
    try:
        ov, cached = av.overview(ticker)
        out["overview_ok"] = bool(ov.get("Symbol"))
        out["overview_cached"] = cached
        out["sector"] = ov.get("Sector")
        out["overview_error"] = None
    except Exception as exc:
        out.update({"overview_ok": False, "overview_error": str(exc)})

    try:
        nw, cached = av.news(ticker, 50)
        out["news_ok"] = True
        out["news_count"] = len(nw.get("feed") or [])
        out["news_cached"] = cached
        out["news_error"] = None
    except Exception as exc:
        out.update({"news_ok": False, "news_count": 0, "news_error": str(exc)})

    return out


@app.get(PREFIX + "/stocks/{ticker}/context")
def context(ticker: str, sector: str | None = None):
    if sector is None:
        try:
            ov, _ = AlphaVantageClient().overview(ticker)
            sector = ov.get("Sector")
        except Exception:
            sector = None
    return ctx.get(sector)


@app.get(PREFIX + "/stocks/{ticker}/analyze")
def analyze(
    ticker: str,
    horizon_days: int = Query(None, ge=5, le=756,
                              description="Trading days. 21=1m, 63=3m, 126=6m, 252=1y"),
    log: bool = Query(True, description="Write this decision to the calibration log"),
):
    result = analyzer.analyze(ticker, horizon_days)
    if log and result.get("price") is not None:
        try:
            result["decision_id"] = db.log_decision(result)
        except Exception as exc:
            result["log_error"] = str(exc)
        try:
            snap_id, n = feature_store.save(result, result.get("decision_id"))
            result["feature_snapshot"] = {"id": snap_id, "features_stored": n}
        except Exception as exc:
            result["feature_store_error"] = str(exc)
    return result


@app.get(PREFIX + "/features/summary")
def features_summary():
    """How much training data has accumulated, and whether it is enough yet."""
    return feature_store.summary()


@app.get(PREFIX + "/features/{ticker}")
def features_history(ticker: str, limit: int = Query(60, ge=1, le=500)):
    """Stored feature vectors for one ticker, newest first."""
    return {"ticker": ticker.upper(), "snapshots": feature_store.history(ticker, limit)}


@app.get(PREFIX + "/macro")
def macro_regime():
    """Macro conditions: rates, curve, inflation, credit, volatility, dollar."""
    from .analysis import macro as macro_mod
    return macro_mod.regime()


@app.get(PREFIX + "/stocks/{ticker}/filings")
def filings(ticker: str):
    """Point-in-time fundamentals straight from SEC XBRL, with filing dates."""
    from datetime import date as _date

    from .analysis import filings as filings_mod
    from .providers import edgar
    try:
        return filings_mod.analyse(edgar.load(ticker), _date.today())
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc))


class Position(BaseModel):
    ticker: str
    value: float
    sector: str | None = None
    beta: float | None = None


class SizingRequest(BaseModel):
    model_config = {"json_schema_extra": {"example": {
        "portfolio_value": 100000,
        "positions": [{"ticker": "MSFT", "value": 12000, "sector": "TECHNOLOGY"}],
        "ticker": "AAPL", "entry": 232.5, "invalidation": 214.0,
        "confidence": 68, "sector": "TECHNOLOGY", "beta": 1.09,
        "max_position_pct": 0.10, "max_sector_pct": 0.30, "max_risk_pct": 0.0075,
    }}}

    portfolio_value: float = Field(gt=0)
    positions: list[Position] = []
    ticker: str
    entry: float = Field(gt=0)
    invalidation: float = Field(gt=0)
    confidence: float = Field(default=50, ge=0, le=100)
    sector: str | None = None
    beta: float | None = None
    max_position_pct: float = 0.10
    max_sector_pct: float = 0.30
    max_risk_pct: float = 0.0075


@app.post(PREFIX + "/portfolio/size")
def size(req: SizingRequest):
    try:
        return size_position(
            req.portfolio_value,
            [p.model_dump() for p in req.positions],
            {
                "ticker": req.ticker, "sector": req.sector, "entry": req.entry,
                "invalidation": req.invalidation, "confidence": req.confidence,
                "beta": req.beta,
            },
            req.max_position_pct, req.max_sector_pct, req.max_risk_pct,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


class BacktestRequest(BaseModel):
    model_config = {"json_schema_extra": {"example": {
        "universe": "diversified_60", "horizon_days": 63,
        "every_days": 21, "years": 15, "fit_weights": True,
    }}}
    universe: str | None = Field(
        default="diversified_60",
        description=("diversified_60, starter_10, or 'screen' to use the last "
                     "completed universe screen. Ignored if tickers given."))
    # Raised from 120. A screen produces several hundred names and the whole
    # point of running one is to backtest on it; a cap that forbids that makes
    # the screen decorative.
    tickers: list[str] | None = Field(default=None, max_length=1000)
    max_names: int = Field(
        default=250, ge=10, le=1000,
        description="Cap on names drawn from a screen. Larger is slower.")
    sectors: dict[str, str] | None = None
    horizon_days: int = Field(default=63, ge=5, le=504)
    every_days: int = Field(default=21, ge=5, le=126)
    # Raised from 10 in v3.0.4. The cap was set when the warehouse held five
    # years; it now holds forty-three, and the question that matters most is
    # whether the valuation effect survives 2008 and 2022. A cap that quietly
    # prevents asking the question is worse than no cap.
    years: int = Field(default=3, ge=1, le=40,
                       description="Backtest depth. 15+ spans several regimes.")
    include_records: bool = False
    simulate_portfolio: bool = Field(
        default=True,
        description="Also simulate a top-N long portfolio against equal-weight buy-and-hold.")
    top_n: int = Field(default=10, ge=1, le=50)
    fit_weights: bool = Field(
        default=True,
        description="Also derive weights on the first half and test on the second.")


@app.post(PREFIX + "/backtest")
def backtest(req: BacktestRequest):
    """Replay the engine over history with strict point-in-time discipline.

    Slow on first run (it pulls full price history and SEC facts for every
    ticker) and fast afterwards, since both are cached. Start with 8-15 tickers.
    """
    from datetime import date as _date, timedelta as _td

    from .backtest import attribution as bt_attr
    from .backtest import data_upgrade as bt_upgrade
    from .backtest import decomposition as bt_decomp
    from .backtest import event_study as bt_events
    from .backtest import portfolio as bt_portfolio
    from .backtest import metrics as bt_metrics
    from .backtest import universe as bt_universe
    from .backtest.replay import Replay

    if req.tickers:
        tickers, sectors = req.tickers, (req.sectors or {})
    elif (req.universe or "").lower() == "screen":
        # Use the last completed screen. This is the point of screening: a
        # 438-name cross-section gives sector cohorts of ~28 instead of the 6
        # a hand-picked 63-name list produced, which is the difference between
        # a suggestive within-sector null and a conclusive one.
        from .screener import store as screen_store
        res = screen_store.results(limit=req.max_names, order="score",
                                   require_critical=True)
        if res.get("status") != "ok" or not res.get("results"):
            raise HTTPException(
                status_code=409,
                detail=("No completed screen to draw from. Run "
                        "`python scripts/screen_universe.py --limit 1500` first."))
        sectors = {r["ticker"]: (r.get("sector") or "UNKNOWN")
                   for r in res["results"]}
        tickers = list(sectors)
    else:
        try:
            sectors = bt_universe.get(req.universe or "diversified_60")
        except KeyError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        tickers = list(sectors)

    end = _date.today() - _td(days=int(req.horizon_days * 1.5))
    replay = Replay(
        tickers, horizon_days=req.horizon_days, every_days=req.every_days,
        start=end - _td(days=365 * req.years), end=end,
    )
    replay.set_sectors(sectors)
    raw = replay.run()

    summary = bt_metrics.summarise(raw)
    if summary.get("status") != "ok":
        return summary

    n_dates = len({r["as_of"] for r in raw["records"]})
    names_per_date = round(len(raw["records"]) / max(n_dates, 1))
    summary["sample_adequacy"] = bt_universe.adequacy(names_per_date, n_dates)
    summary["universe"] = {
        "name": None if req.tickers else req.universe,
        "requested": len(tickers),
        "with_usable_data": len({r["ticker"] for r in raw["records"]}),
        "survivorship_warning": bt_universe.SURVIVORSHIP_WARNING,
    }
    summary["attribution"] = bt_attr.attribute(raw)

    # Where does the one significant component actually live: between sectors
    # (a rotation bet) or within them (company selection)?
    summary["signal_decomposition"] = {
        key: bt_decomp.decompose(raw["records"], key,
                                 horizon_days=req.horizon_days,
                                 every_days=req.every_days)
        for key in ("valuation", "score")
    }
    if req.simulate_portfolio:
        summary["portfolio_simulation"] = bt_portfolio.simulate(raw, top_n=req.top_n)
        # Same simulation driven by the peer-normalised valuation alone, so the
        # one component that measured a real effect can be judged on its own.
        summary["portfolio_simulation_valuation_peer_only"] = bt_portfolio.simulate(
            raw, top_n=req.top_n, score_key="__valuation_peer")
        # Sector-neutral: best name in each sector. If an edge survives this, it
        # is company selection; if it disappears, it was sector rotation.
        summary["portfolio_simulation_sector_neutral"] = bt_portfolio.simulate(
            raw, score_key="score", sector_neutral=True, per_sector=1)
    if req.fit_weights:
        summary["weight_fitting"] = bt_attr.fit_weights(raw)
    if req.include_records:
        summary["records"] = raw["records"]

    # Last section deliberately: read the result first, then decide whether the
    # remaining limit is worth paying to remove.
    # The last untested layer, and the only one that can be tested: filing
    # timestamps are exact, so an event study is point-in-time by construction.
    try:
        bt_events.attach_events(raw["records"], raw.get("filings_by_ticker") or {})
        # Label the sample so a hypothesis awaiting confirmation can tell
        # whether this run is independent of the one that produced it.
        sample_id = {
            "universe": (req.universe if not req.tickers else "custom"),
            "period": f"{raw['config']['start']} to {raw['config']['end']}",
            "horizon_days": req.horizon_days,
        }
        summary["event_study"] = bt_events.run(
            raw["records"], sample_id=sample_id,
            horizon_days=req.horizon_days, every_days=req.every_days)
    except Exception as exc:
        summary["event_study"] = {"status": "error", "note": str(exc)[:160]}

    summary["data_upgrade"] = bt_upgrade.note(has_survivorship_bias=True)
    return summary


@app.get(PREFIX + "/backtest/data-upgrade")
def data_upgrade():
    """What paid data would fix, and which providers to research."""
    from .backtest import data_upgrade as bt_upgrade
    from .backtest import decomposition as bt_decomp
    return bt_upgrade.note()


@app.get(PREFIX + "/stocks/{ticker}/events")
def corporate_events(ticker: str, window_days: int = Query(120, ge=7, le=730)):
    """Material corporate events from 8-K filings.

    Free, complete across every US registrant, and exactly timestamped — which
    makes it the one event source here that could actually be backtested. The
    news sentiment feed cannot, because no free provider archives history.
    """
    from datetime import date as _date

    from .analysis import events as events_mod
    from .providers import edgar
    try:
        return events_mod.classify(edgar.recent_filings(ticker),
                                   _date.today(), window_days)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/research", response_class=HTMLResponse, include_in_schema=False)
def research_dashboard():
    """Research view: whether the score works, in measured quantities only."""
    return HTMLResponse(RESEARCH.read_text(encoding="utf-8"))


@app.get(PREFIX + "/stocks/{ticker}/sector-model")
def sector_model(ticker: str):
    """Sector-specific fundamentals: NIM and loan growth for banks, FFO for
    REITs, cash runway for biotech, inventory divergence for goods makers.

    The generic model asks every company about margin and debt. For a bank that
    is close to meaningless — its balance sheet IS its business. These are
    diagnostics, not score inputs.
    """
    from datetime import date as _date

    from .analysis import sector_models as sector_mod
    from .providers import edgar
    try:
        profile = edgar.company_profile(ticker)
        facts = edgar.load(ticker)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return sector_mod.analyse(facts, profile.get("sector"), _date.today())


@app.get(PREFIX + "/warehouse")
def warehouse_coverage(gaps_for: str | None = None):
    """What historical price data is stored locally, and how good is it."""
    from .storage import warehouse as wh
    out = wh.coverage()
    if gaps_for:
        out["gaps"] = wh.detect_gaps(gaps_for)
    return out


@app.get(PREFIX + "/screen")
def screen_results(
    limit: int = Query(50, ge=1, le=500),
    sector: str | None = None,
    order: str = Query("score", pattern="^(score|valuation|sector_percentile)$"),
    ascending: bool = False,
    min_coverage: float = Query(0.0, ge=0.0, le=1.0),
    require_critical: bool = Query(
        True, description="Exclude names missing the components the backtest "
                          "found informative. Off puts the least-informed at the top."),
    run_id: int | None = None,
):
    """Ranked results from the last completed universe screen.

    Populate it with `python scripts/screen_universe.py`. Sort by
    sector_percentile to rank within industry rather than across the market —
    the backtest found the composite's only real effect was between sectors, so
    an overall ranking is largely a sector ordering in disguise.
    """
    from .screener import store as screen_store
    return screen_store.results(run_id=run_id, sector=sector, limit=limit,
                                order=order, ascending=ascending,
                                min_coverage=min_coverage,
                                require_critical=require_critical)


@app.get(PREFIX + "/peers")
def peer_table():
    """The sector peer table live analysis ranks against."""
    from .analysis import peers as peers_mod
    table = peers_mod.PeerTable.load()
    if table is None:
        return {
            "status": "not_built",
            "message": ("No peer table yet, so valuation and quality are scored "
                        "against absolute thresholds — which flatter some sectors "
                        "and penalise others. Build one with "
                        "`python scripts/build_peer_table.py`."),
        }
    return {"status": "ok", **table.summary()}


@app.get(PREFIX + "/backtest/universes")
def backtest_universes():
    """Preset universes, with the caveat that applies to all of them."""
    from .backtest import universe as bt_universe
    return {
        "presets": {k: {"n": len(v), "tickers": sorted(v)}
                    for k, v in bt_universe.PRESETS.items()},
        "survivorship_warning": bt_universe.SURVIVORSHIP_WARNING,
    }


@app.post(PREFIX + "/calibration/resolve")
def resolve():
    """Close out every decision whose horizon has elapsed, priced at its due date
    and measured against SPY over the same window."""
    from .storage import resolve as resolver
    resolved, failed, due = resolver.resolve_due()
    return {"due": due, "benchmark": resolver.BENCHMARK,
            "resolved": resolved, "failed": failed}


@app.get(PREFIX + "/calibration/report")
def report(bins: int = Query(5, ge=2, le=10)):
    return db.calibration_report(bins)

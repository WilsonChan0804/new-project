from pydantic_settings import BaseSettings, SettingsConfigDict

VERSION = "3.10.1"


class Settings(BaseSettings):
    # --- credentials -------------------------------------------------------
    alpha_vantage_api_key: str = ""
    # Free at fred.stlouisfed.org/docs/api/api_key.html. Enables the macro layer;
    # without it macro reports 'unavailable' rather than guessing a value.
    fred_api_key: str = ""
    # Optional and the only paid provider supported. It exists for one reason:
    # historical index membership + prices for delisted companies, i.e. the
    # survivorship fix. Probe it with scripts/check_eodhd.py before subscribing.
    eodhd_api_key: str = ""
    sec_user_agent: str = "InvestmentDecisionEngine/1.8 you@example.com"

    # --- price sources -----------------------------------------------------
    # Tried in order. yahoo is adjusted and needs no key; alpha_vantage is a
    # last resort because its free daily series is UNADJUSTED.
    price_sources: str = "yahoo,stooq,alpha_vantage"  # add 'eodhd' if subscribed  # probe with GET /api/v1/providers/prices

    # --- storage -----------------------------------------------------------
    db_path: str = "engine.db"
    # Local historical price store. Separate file from engine.db because it
    # grows large and is rebuilt on a different cadence.
    warehouse_path: str = "warehouse.db"
    use_warehouse: bool = True
    cache_dir: str = ".cache"
    cache_ttl_overview_hours: float = 24.0
    cache_ttl_news_hours: float = 2.0
    cache_ttl_prices_hours: float = 6.0
    cache_ttl_filings_hours: float = 24.0
    cache_ttl_macro_hours: float = 12.0

    # --- decision policy ---------------------------------------------------
    # Fraction of total scoring weight that must be backed by real data before
    # the engine is willing to emit a directional action at all.
    min_coverage: float = 0.60
    # Minimum confidence required for anything stronger than WATCH.
    min_confidence_for_action: float = 55.0

    # Components that must be present before a directional action is allowed,
    # regardless of overall coverage. Coverage alone is not enough: a run can
    # clear 65% while missing the one component the backtest found informative.
    # Valuation is here because it is the only component that measured a real
    # effect (+0.078, t=+3.09) in the 63-name replay. Revisit this list when
    # the attribution table changes, not before.
    critical_components: str = "valuation"

    # --- economics ---------------------------------------------------------
    base_currency: str = "GBP"          # what the user actually spends
    quote_currency: str = "USD"         # what the asset is priced in
    roundtrip_cost_bps: float = 25.0    # commission + spread, both ways
    fx_cost_bps: float = 50.0           # FX spread both ways; 0 if same ccy
    annual_fx_vol: float = 0.09         # GBP/USD ~9% annualised, for risk band

    # --- scenario engine ---------------------------------------------------
    default_horizon_days: int = 63      # ~3 months of trading days
    # How much the composite score is allowed to tilt scenario probabilities
    # away from an uninformative 1/3-1/3-1/3 prior.
    #
    # SET TO ZERO IN v3.0, on the engine's own evidence. The 63-name, 53-date
    # backtest measured the composite at IC -0.006 +/- 0.027 (t = -0.22) with a
    # detectable floor of 0.035 — wide enough for the null to mean something.
    # Weights refitted on the first half scored -0.022 out of sample on the
    # second; the unfitted weights scored -0.098. Reweighting cannot rescue
    # components that do not predict.
    #
    # A tilt of zero does not disable the engine. It stops the probabilities
    # claiming information the score has been measured not to have. Everything
    # that survived measurement — point-in-time filings, 8-K red flags, sector
    # models, the refusal logic, the reasons-against panel — is unaffected.
    #
    # Raise it only if a backtest on a wider universe shows a positive,
    # STABLE information coefficient. Sub-period ICs currently run
    # +0.057 -> +0.002 -> -0.069, which is a regime, not an edge.
    score_tilt_strength: float = 0.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()

from datetime import date, datetime, timezone

from ..config import settings, VERSION
from ..providers import edgar, prices
from ..providers.alpha_vantage import AlphaVantageClient
from . import context as ctx
from . import news as news_mod
from . import scenarios as scen
from .decision import choose_action, evaluate
from .features import atr, fundamentals, merge_fundamentals, money_flow, technical
from . import filings as filings_mod
from . import macro as macro_mod
from . import peers as peers_mod
from . import events as events_mod
from . import sector_models as sector_mod
from ..presentation import plain


class StockAnalyzer:
    def __init__(self):
        self.av = AlphaVantageClient()

    def analyze(self, ticker: str, horizon_days: int | None = None):
        ticker = ticker.upper().strip()
        horizon_days = horizon_days or settings.default_horizon_days
        errors = {}

        # --- prices: Stooq primary (adjusted, no key, no daily budget) -----
        price_meta = {}
        try:
            df, price_meta = prices.daily(ticker)
        except Exception as exc:
            df = None
            errors["price"] = str(exc)

        # --- stop a typo from burning the Alpha Vantage day budget ----------
        # A free AV key allows 25 requests/day. Spending three of them on a
        # mistyped ticker is avoidable: if no price source recognises the
        # symbol and the SEC has never heard of it either, it is not a ticker.
        if df is None:
            try:
                recognised = ticker in edgar.known_tickers()
            except Exception:
                recognised = True   # can't check -> don't block a real request
            if not recognised:
                return self._unresolved(ticker, errors)

        # --- fundamentals ---------------------------------------------------
        overview, ov_cached = {}, False
        try:
            overview, ov_cached = self.av.overview(ticker)
        except Exception as exc:
            errors["fundamentals"] = str(exc)

        # --- news ------------------------------------------------------------
        raw_news, news_cached = {"feed": []}, False
        try:
            raw_news, news_cached = self.av.news(ticker, 50)
        except Exception as exc:
            errors["news"] = str(exc)

        # --- company profile from SEC (free, survives an AV quota exhaustion) --
        profile = {}
        try:
            profile = edgar.company_profile(ticker)
        except Exception as exc:
            errors["profile"] = str(exc)

        # --- SEC filings: point-in-time fundamentals -------------------------
        as_of = date.today()
        filings = None
        facts_for_sector = None
        try:
            facts_for_sector = edgar.load(ticker)
            filings = filings_mod.analyse(facts_for_sector, as_of)
        except Exception as exc:
            errors["filings"] = str(exc)

        # --- corporate events from 8-K filings --------------------------------
        # Free, complete, exactly timestamped. Unlike the news feed, this one
        # can eventually be backtested, because filing dates are exact.
        corporate_events = {"status": "unavailable"}
        try:
            corporate_events = events_mod.classify(
                edgar.recent_filings(ticker), as_of)
        except Exception as exc:
            corporate_events = {"status": "unavailable", "score": None,
                                "note": str(exc)[:120]}
            errors["events"] = str(exc)

        # --- sector-specific fundamentals -------------------------------------
        # Diagnostics only. They do NOT enter the score: the composite already
        # measures an IC near zero, and adding unvalidated components would
        # repeat the mistake this engine exists to avoid.
        sector_detail = {"status": "not_applicable"}

        # --- macro conditions -------------------------------------------------
        try:
            macro = macro_mod.regime()
        except Exception as exc:
            macro = {"status": "unavailable", "risk_on_score": None,
                     "components": {}, "notes": [], "errors": {"macro": str(exc)}}
            errors["macro"] = str(exc)

        # --- features ---------------------------------------------------------
        t = technical(df) if df is not None else technical(_empty())
        mf = money_flow(df) if df is not None else {"status": "unavailable", "money_flow": None, "cmf": None}
        f = fundamentals(overview)
        n = news_mod.analyse(raw_news, ticker)
        # Sector: Alpha Vantage first, SEC SIC classification as the fallback.
        # Without this, an exhausted AV quota silently disabled both the sector
        # regime and the peer cohort.
        sector = f.get("sector") or profile.get("sector")
        sector_source = ("alpha_vantage" if f.get("sector")
                         else "sec_sic" if profile.get("sector") else None)

        market = ctx.get(sector)

        merged = merge_fundamentals(f, filings)

        sector_detail = sector_mod.analyse(
            facts_for_sector, f.get("sector") or profile.get("sector"), as_of)

        # --- peer-relative scoring, when a peer table has been built ---------
        # Absolute thresholds mark whole sectors cheap or expensive for reasons
        # unrelated to prospects. Ranking within sector fixes that, but needs a
        # cohort, which a single-ticker request does not have -- so it comes
        # from a table built once by scripts/build_peer_table.py. Without one,
        # the engine says so rather than pretending.
        peer = {"status": "unavailable",
                "note": ("No peer table built. Fundamental and valuation scores use "
                         "absolute thresholds, which flatter some sectors and "
                         "penalise others. Run scripts/build_peer_table.py.")}
        try:
            table = peers_mod.PeerTable.load()
            if table is not None and sector:
                raw = peers_mod.extract_metrics(filings, None, overview)
                p_scores = table.scores(sector, raw)
                if any(p_scores[k] is not None for k in
                       ("valuation_peer", "quality_peer", "growth_peer")):
                    peer = {"status": "available", "sector": sector,
                            "raw_metrics": raw, **p_scores}
        except Exception as exc:
            peer = {"status": "unavailable", "note": f"Peer table error: {exc}"}

        # Market regime = price trend of SPY/QQQ, blended with macro conditions
        # when FRED is configured. Without a key it stays pure price regime
        # rather than being padded with a guess.
        price_regime = market["market_score"]
        risk_on = macro.get("risk_on_score")
        if price_regime is not None and risk_on is not None:
            market_score = round(0.6 * price_regime + 0.4 * risk_on, 2)
            market["blend"] = {"price_regime": price_regime, "macro_risk_on": risk_on,
                               "weights": "60% price / 40% macro"}
        else:
            market_score = price_regime
            market["blend"] = {"price_regime": price_regime, "macro_risk_on": None,
                               "weights": "100% price (macro unavailable)"}
        market["market_score"] = market_score

        parts = {
            "market": market["market_score"],
            "sector": market["sector_score"],
            "fundamentals": merged["fundamentals"],
            "growth": merged["growth"],
            "valuation": f["valuation"],
            "technical": t["technical"],
            "money_flow": mf["money_flow"],
            "news": n["news"],
        }

        ev = evaluate(parts, n.get("freshness_pct"), n.get("unique_event_count"))

        # --- scenarios ---------------------------------------------------------
        scenarios, diag = scen.build(
            ev["opportunity_score"],
            t.get("vol_annualised"),
            horizon_days,
            cross_currency=settings.base_currency != settings.quote_currency,
        )
        scenario_note = None
        if scenarios is None:
            scenario_note, diag = diag, None

        rr = diag.get("reward_to_risk") if diag else None
        action, rationale = choose_action(
            ev["opportunity_score"], ev["confidence"], ev["coverage"], rr, parts
        )

        # --- invalidation level (makes position sizing reachable) -------------
        price = float(df.close.iloc[-1]) if df is not None and len(df) else None
        invalidation = None
        if price is not None and df is not None:
            a = atr(df)
            swing_low = float(df.close.tail(20).min()) if len(df) >= 20 else None
            candidates = [x for x in (
                price - 2.0 * a if a else None,
                swing_low,
            ) if x is not None and x < price]
            if candidates:
                invalidation = round(max(candidates), 4)

        # EDGAR knows the company name even when the AV quota is exhausted.
        name = f.get("name") or profile.get("name") or (filings or {}).get("entity")

        result = {
            "ticker": ticker,
            "name": name,
            "sector": sector,
            "sector_source": sector_source,
            "sic_description": profile.get("sic_description"),
            "as_of": datetime.now(timezone.utc).isoformat(),
            "engine_version": VERSION,
            "price": round(price, 4) if price is not None else None,
            "invalidation_price": invalidation,
            "invalidation_basis": "max(20-day close low, price - 2*ATR14)",

            "action": action,
            "action_rationale": rationale,
            "opportunity_score": ev["opportunity_score"],
            "confidence": ev["confidence"],
            "coverage": ev["coverage"],
            "signal_agreement": ev["agreement"],

            "score_breakdown": parts,
            "weights_used": ev["weights_used"],
            "missing_components": ev["missing_components"],

            "horizon": {
                "days": horizon_days,
                "label": scen.horizon_label(horizon_days),
                "note": (
                    "Every number below is scoped to this horizon. A stock can be "
                    "constructive on 200 days and stretched on 21 -- see "
                    "technical.horizons."
                ),
            },
            "scenarios": scenarios,
            "scenario_diagnostics": diag,
            "scenario_note": scenario_note,

            "technical": t,
            "money_flow": mf,
            # The status must describe the MERGED result, not just the Alpha
            # Vantage half. With AV rate-limited but SEC filings present, v2.1
            # reported status "unavailable" and fundamentals null while
            # score_breakdown carried 72.31 and the plain view said "Good".
            "fundamentals": {
                **f,
                **{k: merged[k] for k in
                   ("sub_scores", "sub_coverage", "sub_weights_used", "growth_source")},
                "fundamentals": merged["fundamentals"],
                "growth": merged["growth"],
                "status": ("available" if merged["fundamentals"] is not None
                           or merged["growth"] is not None else "unavailable"),
                "source": (
                    "alpha_vantage + sec_filings" if f.get("quality") is not None
                    and filings else
                    "sec_filings only" if filings else
                    "alpha_vantage only" if f.get("quality") is not None else "none"
                ),
            },
            "filings": filings,
            "macro": macro,
            "peers": peer,
            "corporate_events": corporate_events,
            "sector_model": sector_detail,
            "news": n,
            "market_context": market,
        }

        result["reasons_for"], result["reasons_against"] = self._why(result, parts)
        result["data_quality"] = {
            "price_source": price_meta.get("source", "unavailable"),
            "price_adjusted": price_meta.get("adjusted"),
            "price_from_cache": price_meta.get("from_cache"),
            "price_source_attempts": price_meta.get("attempts", {}),
            "price_warning": price_meta.get("warning"),
            "price_observations": int(len(df)) if df is not None else 0,
            "fundamentals_ok": f["status"] == "available",
            "fundamentals_cached": ov_cached,
            "news_ok": n["status"] == "available",
            "news_cached": news_cached,
            "news_articles": n["article_count"],
            "news_unique_events": n["unique_event_count"],
            "market_regime_ok": market["market_score"] is not None,
            "filings_ok": bool(filings and filings.get("status") == "available"),
            "filing_lag_days": (filings or {}).get("filing_lag_days"),
            "macro_ok": macro.get("status") == "available",
            "fundamental_sub_coverage": merged["sub_coverage"],
            "peer_normalised": peer.get("status") == "available",
            "corporate_events_ok": corporate_events.get("status") == "available",
            "sector_model": sector_detail.get("model"),
            "sector_regime_ok": market["sector_score"] is not None,
            "errors": errors,
        }
        result["caveats"] = [
            "Probabilities are an uncalibrated prior. Check /api/v1/calibration/report "
            "before sizing anything on them.",
            f"Expected return is net of {settings.roundtrip_cost_bps}bp dealing costs "
            f"and reported in {settings.quote_currency}; FX moves against "
            f"{settings.base_currency} are a separate, unhedged risk.",
            "Fundamentals are current-snapshot, not point-in-time, so any backtest "
            "built on them will be look-ahead biased.",
        ]
        result["plain"] = plain.build(result)
        return result

    # ------------------------------------------------------------------
    def _unresolved(self, ticker, errors):
        """Bail out early, before spending any API quota."""
        suggestions = edgar.suggest(ticker)
        hint = ""
        if suggestions:
            hint = " Did you mean " + " or ".join(
                f"{s['ticker']} ({s['name']})" for s in suggestions[:2]) + "?"
        return {
            "ticker": ticker,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "engine_version": VERSION,
            "action": "UNKNOWN TICKER",
            "action_rationale": (
                f"No price source recognises {ticker}, and the SEC has no company "
                f"registered under it.{hint}"
            ),
            "price": None, "opportunity_score": None, "confidence": 0.0,
            "coverage": 0.0, "signal_agreement": None,
            "score_breakdown": {}, "weights_used": {}, "missing_components": [],
            "suggestions": suggestions,
            "scenarios": None, "scenario_diagnostics": None,
            "reasons_for": [], "reasons_against": [],
            "data_quality": {"errors": errors, "api_quota_spent": False},
            "plain": {
                "action": "UNKNOWN TICKER", "tone": "unknown",
                "headline": f"{ticker} is not a ticker we can find.{hint}",
                "confidence_sentence": "Nothing was analysed.",
                "components": [], "counts": {"supportive": 0, "against": 0, "unknown": 0},
                "scenarios": None,
                "what_to_do": ["Check the spelling and try again."
                               + (f" Closest match: {suggestions[0]['ticker']}."
                                  if suggestions else "")],
                "caveat": "No API quota was spent on this request.",
            },
        }

    def _why(self, r, parts):
        """Both sides of the case. A BUY should have to survive its counterargument."""
        pro, con = [], []

        def check(key, label):
            v = parts.get(key)
            if v is None:
                con.append(f"{label}: no data — excluded from the score entirely.")
            elif v >= 65:
                pro.append(f"{label}: supportive ({v}).")
            elif v <= 35:
                con.append(f"{label}: negative ({v}).")

        for key, label in (
            ("market", "Market regime"), ("sector", "Sector regime"),
            ("technical", "Price trend"), ("money_flow", "Money flow"),
            ("fundamentals", "Business quality"), ("growth", "Growth"),
            ("valuation", "Valuation"), ("news", "News flow"),
        ):
            check(key, label)

        t = r.get("technical") or {}
        hz = t.get("horizons") or {}
        long_s, short_s = (hz.get("long") or {}).get("score"), (hz.get("short") or {}).get("score")
        if long_s is not None and short_s is not None and long_s - short_s > 20:
            con.append(
                f"Horizon conflict: long-term {long_s} vs short-term {short_s} — "
                "the trend is intact but near-term momentum has rolled over."
            )
        if t.get("pct_of_52w_range") is not None and t["pct_of_52w_range"] > 92:
            con.append(
                f"Price is at {t['pct_of_52w_range']}% of its 52-week range — "
                "little room below before support."
            )
        if t.get("vol_percentile") is not None and t["vol_percentile"] > 85:
            con.append(
                f"Volatility is in the {t['vol_percentile']}th percentile of its own "
                "history — position sizing should shrink accordingly."
            )

        nw = r.get("news") or {}
        if nw.get("concentration_pct") is not None and nw["concentration_pct"] > 40:
            con.append(
                f"{nw['concentration_pct']}% of articles are one story "
                f"({nw.get('dominant_event')}) — news breadth is thinner than the count suggests."
            )
        if (nw.get("catalyst_mix") or {}).get("earnings"):
            con.append("Earnings-related news present — an event may sit inside the horizon.")

        fl = r.get("filings") or {}
        for note in (fl.get("notes") or []):
            con.append(note)
        if fl.get("status") == "unavailable":
            con.append(
                "No SEC filing data, so cash flow, debt and earnings quality are "
                "unchecked. Business quality rests on summary ratios alone."
            )
        sm = r.get("sector_model") or {}
        for flag in (sm.get("flags") or [])[:3]:
            con.append(f"{sm.get('label', 'Sector')}: {flag}")

        ce = r.get("corporate_events") or {}
        for flag in (ce.get("red_flags") or [])[:3]:
            con.append(
                f"SEC filing: {flag['label'].lower()} ({flag['age_days']} days ago). "
                "This is a reported fact, not sentiment.")
        if ce.get("ambiguous_count"):
            con.append(
                f"{ce['ambiguous_count']} material event(s) filed recently with no "
                "inherent direction — check what actually happened.")

        pr = r.get("peers") or {}
        if pr.get("status") != "available":
            con.append(
                "Valuation and quality are scored against absolute thresholds, not "
                "against sector peers — this systematically flatters some industries "
                "and penalises others."
            )
        elif pr.get("valuation_peer") is not None and pr["valuation_peer"] < 30:
            con.append(
                f"Against its own sector this is in the {pr['valuation_peer']:.0f}th "
                "percentile on valuation — expensive relative to peers, not just in "
                "absolute terms."
            )
        elif pr.get("valuation_peer") is not None and pr["valuation_peer"] > 70:
            pro.append(
                f"Cheap relative to its own sector ({pr['valuation_peer']:.0f}th "
                "percentile), which absolute multiples alone would not show."
            )

        mac = r.get("macro") or {}
        for name, block in (mac.get("components") or {}).items():
            if block.get("score") is not None and block["score"] < 40:
                con.append(f"Macro — {name.replace('_', ' ')}: {block.get('reads')}.")
            elif block.get("score") is not None and block["score"] >= 65:
                pro.append(f"Macro — {name.replace('_', ' ')}: {block.get('reads')}.")

        if r.get("signal_agreement") is not None and r["signal_agreement"] < 45:
            con.append(
                f"Signals disagree with each other (agreement {r['signal_agreement']}/100); "
                "the composite average is hiding a genuine conflict."
            )

        if not pro:
            pro.append("No component reaches the 65 threshold; there is no positive case.")
        if not con:
            con.append("No specific objection found — which usually means the evidence is thin, not clean.")
        return pro, con


def _empty():
    import pandas as pd
    return pd.DataFrame(columns=["date", "open", "high", "low", "close", "volume"])

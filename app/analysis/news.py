"""News event intelligence.

The v1.4 ordering was backwards: sentiment was averaged over all 50 raw
articles, and deduplication ran *afterwards* purely for display. So the stated
goal -- telling 40 syndications of one story apart from 3 reports of a real
earnings surprise -- was never actually reached by the score.

Here, clustering happens first and each *event* gets one vote, weighted by the
best relevance inside its cluster. Fifty copies of one story therefore count
once.
"""
import re
from datetime import datetime, timezone

import numpy as np

# Macro stories move every stock on the same day by roughly the same amount.
# Company stories move one. That distinction turns out to matter a great deal:
# the backtest showed the `market` component could not rank stocks at all
# because it was identical for every name on a date. Macro news has exactly the
# same shape. Blending it into a per-stock news score repeats that error --
# it adds a timing signal to a ranking one and dilutes both.
MACRO_TERMS = [
    "fed", "federal reserve", "fomc", "interest rate", "rate cut", "rate hike",
    "inflation", "cpi", "ppi", "gdp", "recession", "unemployment", "jobs report",
    "payroll", "tariff", "trade war", "treasury", "yield curve", "dollar index",
    "election", "stimulus", "debt ceiling", "geopolit", "oil price", "opec",
    "s&p 500", "nasdaq composite", "dow jones", "market selloff", "market rally",
]

SECTOR_TERMS = [
    "sector", "industry", "peers", "rivals", "competitors", "chip sector",
    "bank stocks", "energy stocks", "tech stocks", "airlines", "retailers",
    "semiconductor industry", "pharmaceutical industry",
]

CATALYSTS = {
    "earnings": ["earnings", "eps", "profit", "revenue", "guidance", "quarter", "outlook"],
    "analyst": ["analyst", "upgrade", "downgrade", "price target", "rating", "initiates"],
    "regulatory": ["sec", "regulator", "antitrust", "lawsuit", "court", "fine", "probe", "investigation"],
    "m&a": ["acquire", "acquisition", "merger", "takeover", "stake", "divest"],
    "capital": ["buyback", "dividend", "offering", "repurchase", "debt", "split"],
    "macro": ["fed", "inflation", "interest rate", "tariff", "recession", "gdp", "jobs", "cpi"],
    "product": ["launch", "unveil", "release", "chip", "model", "partnership", "contract"],
    "management": ["ceo", "cfo", "resign", "appoint", "steps down", "insider"],
}

STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "as",
    "at", "by", "with", "from", "its", "it", "this", "that", "after", "amid",
    "says", "said", "will", "be", "are", "was", "new", "stock", "shares",
}


def _tokens(title: str):
    clean = re.sub(r"[^a-z0-9 ]+", " ", (title or "").lower())
    return {w for w in clean.split() if len(w) > 2 and w not in STOPWORDS}


def _scope(title: str, relevance: float) -> str:
    """company / sector / macro.

    Relevance is the tie-breaker: Alpha Vantage scores how much an article is
    about the ticker you asked for, so a macro headline that is nonetheless
    highly specific to one company is treated as company news.
    """
    t = (title or "").lower()
    if any(term in t for term in MACRO_TERMS) and relevance < 0.55:
        return "macro"
    if any(term in t for term in SECTOR_TERMS) and relevance < 0.55:
        return "sector"
    return "company"


def _classify(title: str) -> str:
    t = (title or "").lower()
    hits = {k: sum(1 for w in words if w in t) for k, words in CATALYSTS.items()}
    best = max(hits, key=hits.get)
    return best if hits[best] > 0 else "general"


def _age_hours(stamp, now):
    if not stamp:
        return None
    try:
        dt = datetime.strptime(str(stamp)[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        return max(0.0, (now - dt).total_seconds() / 3600.0)
    except Exception:
        return None


def _extract(article: dict, ticker: str):
    """Pull the sentiment entry for *our* ticker.

    v1.4 took ticker_sentiment[0], which is whichever ticker the article
    happened to list first -- often not the one you asked about.
    """
    entries = article.get("ticker_sentiment") or []
    mine = next(
        (e for e in entries if (e.get("ticker") or "").upper() == ticker.upper()),
        None,
    )
    if mine:
        sent = mine.get("ticker_sentiment_score")
        rel = mine.get("relevance_score")
        matched = True
    else:
        sent = article.get("overall_sentiment_score")
        rel = 0.15  # article is only loosely about this name
        matched = False
    try:
        sent = float(sent) if sent is not None else 0.0
    except (TypeError, ValueError):
        sent = 0.0
    try:
        rel = float(rel) if rel is not None else 0.0
    except (TypeError, ValueError):
        rel = 0.0
    return sent, rel, matched


def analyse(raw: dict, ticker: str, jaccard_threshold: float = 0.55):
    now = datetime.now(timezone.utc)
    feed = raw.get("feed") or []

    articles = []
    for a in feed:
        sent, rel, matched = _extract(a, ticker)
        articles.append({
            "headline": a.get("title", ""),
            "source": a.get("source", "Unknown"),
            "url": a.get("url"),
            "published_at": a.get("time_published"),
            "age_hours": _age_hours(a.get("time_published"), now),
            "sentiment": round(sent, 3),
            "relevance": round(rel, 3),
            "ticker_matched": matched,
            "catalyst": _classify(a.get("title", "")),
            "scope": _scope(a.get("title", ""), rel),
            "tokens": _tokens(a.get("title", "")),
        })

    if not articles:
        return {
            "status": "unavailable",
            "news": None,
            "article_count": 0,
            "unique_event_count": 0,
            "clusters": [],
            "catalyst_mix": {},
            "freshness_pct": None,
            "concentration_pct": None,
            "dominant_event": None,
        }

    # --- cluster near-duplicate headlines into events ----------------------
    clusters = []
    for art in articles:
        placed = False
        for cl in clusters:
            overlap = len(art["tokens"] & cl["tokens"]) / max(len(art["tokens"] | cl["tokens"]), 1)
            if overlap >= jaccard_threshold:
                cl["members"].append(art)
                cl["tokens"] |= art["tokens"]
                placed = True
                break
        if not placed:
            clusters.append({"tokens": set(art["tokens"]), "members": [art]})

    events = []
    for cl in clusters:
        members = cl["members"]
        lead = max(members, key=lambda m: m["relevance"])
        ages = [m["age_hours"] for m in members if m["age_hours"] is not None]
        scopes = [m["scope"] for m in members]
        events.append({
            "headline": lead["headline"],
            "catalyst": lead["catalyst"],
            "scope": max(set(scopes), key=scopes.count),
            "sentiment": round(float(np.mean([m["sentiment"] for m in members])), 3),
            "relevance": round(lead["relevance"], 3),
            "article_count": len(members),
            "sources": sorted({m["source"] for m in members})[:6],
            "age_hours": round(min(ages), 1) if ages else None,
            "ticker_matched": any(m["ticker_matched"] for m in members),
            "url": lead["url"],
        })

    events.sort(key=lambda e: (e["relevance"], e["article_count"]), reverse=True)

    # --- score on EVENTS, one vote each -----------------------------------
    scored = [e for e in events if e["ticker_matched"] and e["relevance"] > 0]
    if not scored:
        score = None
    else:
        # Weight by relevance and recency; a 3-week-old story is not news.
        weights, sents = [], []
        for e in scored:
            recency = 1.0
            if e["age_hours"] is not None:
                recency = float(np.exp(-e["age_hours"] / 168.0))  # 1-week half-life-ish
            weights.append(max(e["relevance"], 0.05) * max(recency, 0.05))
            sents.append(e["sentiment"])
        avg = float(np.average(sents, weights=weights))
        # AV sentiment is roughly [-1, 1] but rarely exceeds +/-0.5 in practice.
        score = round(float(50.0 + 50.0 * np.tanh(avg / 0.30)), 2)

    def _score_subset(subset):
        subset = [e for e in subset if e["ticker_matched"] and e["relevance"] > 0]
        if not subset:
            return None
        weights, sents = [], []
        for e in subset:
            recency = 1.0
            if e["age_hours"] is not None:
                recency = float(np.exp(-e["age_hours"] / 168.0))
            weights.append(max(e["relevance"], 0.05) * max(recency, 0.05))
            sents.append(e["sentiment"])
        return round(float(50.0 + 50.0 * np.tanh(
            float(np.average(sents, weights=weights)) / 0.30)), 2)

    micro_score = _score_subset([e for e in events if e["scope"] == "company"])
    macro_score = _score_subset([e for e in events if e["scope"] == "macro"])
    scope_mix = {}
    for e in events:
        scope_mix[e["scope"]] = scope_mix.get(e["scope"], 0) + 1

    fresh = [e for e in events if e["age_hours"] is not None and e["age_hours"] <= 48]
    mix = {}
    for e in events:
        mix[e["catalyst"]] = mix.get(e["catalyst"], 0) + 1

    dominant = events[0] if events else None
    concentration = round(100.0 * dominant["article_count"] / len(articles), 1) if dominant else None

    return {
        "status": "available" if score is not None else "low_relevance",
        "news": micro_score if micro_score is not None else score,
        "news_all_scopes": score,
        "news_company": micro_score,
        "news_macro": macro_score,
        "scope_mix": scope_mix,
        "scope_note": (
            "news_company is the only part that can rank one stock against "
            "another. news_macro moves every stock on the same day by roughly the "
            "same amount, so it is a timing signal, not a ranking one — the same "
            "distinction that made the `market` component unmeasurable "
            "cross-sectionally. The headline `news` figure now uses company news "
            "only, falling back to all scopes when no company-specific story exists."
        ),
        "article_count": len(articles),
        "unique_event_count": len(events),
        "scored_event_count": len(scored),
        "clusters": events[:15],
        "catalyst_mix": mix,
        "freshness_pct": round(100.0 * len(fresh) / max(len(events), 1), 1),
        "concentration_pct": concentration,
        "dominant_event": dominant["headline"] if dominant else None,
    }

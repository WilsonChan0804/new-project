"""Tiny on-disk TTL cache.

Alpha Vantage's free tier is a hard daily request budget. Without caching,
one /analyze call burns several requests and you run dry after a handful of
tickers. This keeps repeat lookups off the wire.
"""
import hashlib
import json
import os
import time

from ..config import settings


def _path(key: str) -> str:
    os.makedirs(settings.cache_dir, exist_ok=True)
    h = hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]
    return os.path.join(settings.cache_dir, f"{h}.json")


def get(key: str, ttl_hours: float):
    """Return cached value, or None if absent/expired."""
    p = _path(key)
    if not os.path.exists(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as fh:
            blob = json.load(fh)
        if time.time() - blob["stored_at"] > ttl_hours * 3600:
            return None
        return blob["value"]
    except Exception:
        return None


def put(key: str, value) -> None:
    try:
        with open(_path(key), "w", encoding="utf-8") as fh:
            json.dump({"stored_at": time.time(), "value": value}, fh)
    except Exception:
        pass  # cache failures must never break analysis


def age_hours(key: str):
    """How old the cached entry is, or None if not cached."""
    p = _path(key)
    if not os.path.exists(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as fh:
            blob = json.load(fh)
        return (time.time() - blob["stored_at"]) / 3600.0
    except Exception:
        return None

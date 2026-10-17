"""Enrich public stock snapshots with validated TSETMC symbol data.

TSETMC is used only as a read-only market-data source. Missing or rejected
provider values remain None; the public page must render them as an em dash.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
import logging
import math
from typing import Any

try:
    from .signal_client_type import enrich_signal_client_type
except ImportError:
    from signal_client_type import enrich_signal_client_type

import requests

LOGGER = logging.getLogger(__name__)
BASE = "https://cdn.tsetmc.com/api"
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://www.tsetmc.com/",
    "Origin": "https://www.tsetmc.com",
}
TIMEOUT = 12
WORKERS = 8


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return result if math.isfinite(result) else None


def _get_json(path: str) -> dict[str, Any] | None:
    try:
        response = requests.get(f"{BASE}/{path}", headers=HEADERS, timeout=TIMEOUT)
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, dict) else None
    except Exception as exc:
        LOGGER.warning("TSETMC request failed path=%s error=%s", path.split("/")[0], type(exc).__name__)
        return None


def _instrument_fields(stock: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    instrument = str(stock.get("instrument") or "").strip()
    if not instrument:
        return instrument, {}
    payload = _get_json(f"Instrument/GetInstrument/{instrument}") or {}
    row = payload.get("instrument")
    if not isinstance(row, dict):
        return instrument, {}
    shares = _number(row.get("zTitad"))
    return instrument, {
        "shares_outstanding": shares,
        "tsetmc_url": f"https://www.tsetmc.com/instInfo/{instrument}",
    }


def enrich_market_cap(stocks: list[dict[str, Any]]) -> None:
    """Attach TSETMC share count, market cap and deterministic market-cap rank."""
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(_instrument_fields, stock) for stock in stocks]
        by_instrument = {}
        for future in as_completed(futures):
            instrument, fields = future.result()
            if instrument:
                by_instrument[instrument] = fields

    ranked: list[tuple[float, dict[str, Any]]] = []
    for stock in stocks:
        fields = by_instrument.get(str(stock.get("instrument") or ""), {})
        shares = fields.get("shares_outstanding")
        close = _number(stock.get("close_price"))
        market_cap_toman = None if shares is None or close is None else shares * close / 10.0
        stock.update(fields)
        stock["market_cap_toman"] = market_cap_toman
        stock["market_cap_hmt"] = None if market_cap_toman is None else market_cap_toman / 1e12
        if market_cap_toman is not None:
            ranked.append((market_cap_toman, stock))

    ranked.sort(key=lambda pair: (-pair[0], str(pair[1].get("symbol") or "")))
    for position, (_, stock) in enumerate(ranked, 1):
        stock["market_cap_rank"] = position
    for stock in stocks:
        stock.setdefault("market_cap_rank", None)


def attach_turnover_metrics(stocks: list[dict[str, Any]]) -> None:
    """Add average volume/value ranks after the exporter attaches 15-day values."""
    value_rows = sorted(
        (stock for stock in stocks if _number(stock.get("avg15_trade_value_toman")) is not None),
        key=lambda stock: (-float(stock["avg15_trade_value_toman"]), str(stock.get("symbol") or "")),
    )
    for position, stock in enumerate(value_rows, 1):
        stock["avg15_trade_value_rank"] = position
    for stock in stocks:
        stock.setdefault("avg15_trade_value_rank", None)
        stock["avg15_trade_value_rank_total"] = len(value_rows)


def enrich_stocks(stocks: list[dict[str, Any]], now: datetime | date) -> list[dict[str, Any]]:
    """Enrich all current stocks while keeping failures explicit and safe."""
    enrich_market_cap(stocks)
    eligible = [stock for stock in stocks if str(stock.get("instrument") or "").strip()]
    if eligible:
        enrich_signal_client_type(eligible, now)
    for stock in stocks:
        stock.setdefault("tsetmc_url", None)
        stock.setdefault("shares_outstanding", None)
        stock.setdefault("market_cap_toman", None)
        stock.setdefault("market_cap_hmt", None)
        stock.setdefault("market_cap_rank", None)
        stock.setdefault("avg15_trade_value_rank", None)
        stock.setdefault("buy_per_capita_toman", None)
        stock.setdefault("sell_per_capita_toman", None)
        stock.setdefault("buyer_power", None)
        stock.setdefault("client_type_status", "missing_instrument")
    attach_turnover_metrics(stocks)
    return stocks


__all__ = ["enrich_stocks", "attach_turnover_metrics", "enrich_market_cap"]

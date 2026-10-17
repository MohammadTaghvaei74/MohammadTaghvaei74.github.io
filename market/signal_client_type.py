"""Fetch and validate same-day TSETMC client-type metrics for signal stocks.

TSETMC's client-type schema uses ``I`` for individual (حقیقی) and ``N`` for
non-individual/legal (حقوقی).  VALUE fields are rial values; this module
converts them to toman before calculating per-capita metrics.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
import logging
import math
from typing import Any, Iterable


LOGGER = logging.getLogger(__name__)
CLIENT_TYPE_URL = "https://cdn.tsetmc.com/api/ClientType/GetClientTypeHistory/{}"
LIVE_CLIENT_TYPE_URL = "https://cdn.tsetmc.com/api/ClientType/GetClientType/{}/1/0"
REQUEST_TIMEOUT_SECONDS = 10
MAX_WORKERS = 4
METRIC_FIELDS = (
    "buy_per_capita_toman",
    "sell_per_capita_toman",
    "buyer_power",
    "legal_buy_pct",
    "legal_sell_pct",
)


class _InvalidRow(ValueError):
    """The response contained a same-day row that failed validation."""


def _day_from_now(now: datetime | date) -> date:
    return now.date() if isinstance(now, datetime) else now


def _day_token(value: Any) -> date | None:
    """Parse the API's integer YYYYMMDD date without accepting malformed data."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(numeric) or numeric != int(numeric):
        return None
    token = str(int(numeric))
    if len(token) != 8:
        return None
    try:
        return datetime.strptime(token, "%Y%m%d").date()
    except ValueError:
        return None


def _numeric(row: dict[str, Any], name: str) -> float | None:
    """Return a validated non-negative numeric field; missing stays unknown."""
    if name not in row or row[name] is None:
        return None
    if isinstance(row[name], bool):
        raise _InvalidRow(f"boolean numeric field: {name}")
    try:
        value = float(row[name])
    except (TypeError, ValueError, OverflowError) as exc:
        raise _InvalidRow(f"non-numeric field: {name}") from exc
    if not math.isfinite(value) or value < 0:
        raise _InvalidRow(f"invalid numeric field: {name}")
    return value


def _per_capita(value_rial: float | None, count: float | None) -> float | None:
    if value_rial is None or count is None or count <= 0:
        return None
    value_toman = value_rial / 10.0
    result = value_toman / count
    return result if math.isfinite(result) else None


def _share_pct(legal_rial: float | None, total_rial: float | None) -> float | None:
    if legal_rial is None or total_rial is None or total_rial <= 0:
        return None
    result = 100.0 * legal_rial / total_rial
    return result if math.isfinite(result) else None


def _fetched_at() -> str:
    """Record the actual fetch instant; do not round it to a scan minute."""
    return datetime.now(timezone.utc).isoformat()


def _empty_metrics(stock: dict[str, Any]) -> None:
    for field in METRIC_FIELDS:
        stock[field] = None
    stock["client_type_date"] = None


def _payload_rows(payload: Any) -> list[dict[str, Any]] | None:
    if not isinstance(payload, dict) or "clientType" not in payload:
        return None
    rows = payload["clientType"]
    if rows is None:
        return []
    if isinstance(rows, dict):
        return [rows]
    if isinstance(rows, list) and all(isinstance(row, dict) for row in rows):
        return rows
    return None


def _latest_row(payload: Any, day: date, instrument: str) -> tuple[dict[str, Any] | None, date | None, bool]:
    """Return the latest available row not newer than the requested day.

    TSETMC's history endpoint often publishes client-type data with a delay
    during the next session. Rejecting yesterday's valid row as missing
    discarded data that the TSETMC UI already exposed. Future rows remain
    excluded, and the selected date is carried in the signal explicitly.
    """
    rows = _payload_rows(payload)
    if rows is None:
        raise _InvalidRow("unexpected clientType response shape")
    candidates: list[tuple[date, dict[str, Any]]] = []
    for row in rows:
        row_day = _day_token(row.get("recDate"))
        if row_day is not None and row_day <= day and str(row.get("insCode")) == instrument:
            candidates.append((row_day, row))
    if candidates:
        row_day, row = max(candidates, key=lambda item: item[0])
        return row, row_day, True
    return None, None, bool(rows)


def _apply_row(stock: dict[str, Any], row: dict[str, Any], day: date) -> None:
    expected_instrument = str(stock["instrument"])
    if "insCode" not in row or str(row["insCode"]) != expected_instrument:
        raise _InvalidRow("instrument mismatch")
    if _day_token(row.get("recDate")) != day:
        raise _InvalidRow("date mismatch")

    buy_i_value = _numeric(row, "buy_I_Value")
    buy_i_count = _numeric(row, "buy_I_Count")
    buy_n_value = _numeric(row, "buy_N_Value")
    buy_n_count = _numeric(row, "buy_N_Count")
    sell_i_value = _numeric(row, "sell_I_Value")
    sell_i_count = _numeric(row, "sell_I_Count")
    sell_n_value = _numeric(row, "sell_N_Value")
    sell_n_count = _numeric(row, "sell_N_Count")
    # Validate optional published volume fields too, but never use volume as a
    # substitute for VALUE or COUNT in any derived metric.
    for field in ("buy_I_Volume", "buy_N_Volume", "sell_I_Volume", "sell_N_Volume"):
        _numeric(row, field)
    # Validate all published VALUE/COUNT fields even when a derived metric does
    # not use the legal counts directly.
    del buy_n_count, sell_n_count

    # I = individual/real; N = non-individual/legal.  See evidence file.
    stock["buy_per_capita_toman"] = _per_capita(buy_i_value, buy_i_count)
    stock["sell_per_capita_toman"] = _per_capita(sell_i_value, sell_i_count)
    stock["buyer_power"] = (
        stock["buy_per_capita_toman"] / stock["sell_per_capita_toman"]
        if stock["buy_per_capita_toman"] is not None
        and stock["sell_per_capita_toman"] not in (None, 0)
        else None
    )
    stock["legal_buy_pct"] = _share_pct(buy_n_value, None if buy_i_value is None or buy_n_value is None else buy_i_value + buy_n_value)
    stock["legal_sell_pct"] = _share_pct(sell_n_value, None if sell_i_value is None or sell_n_value is None else sell_i_value + sell_n_value)
    stock["client_type_date"] = day.isoformat()


def _apply_live_row(stock: dict[str, Any], row: dict[str, Any], day: date) -> None:
    """Apply the current-session schema (volumes and participant counts)."""
    if not isinstance(row, dict):
        raise _InvalidRow("unexpected live clientType row")
    price = stock.get("last_price") or stock.get("close_price")
    if price is None or isinstance(price, bool):
        raise _InvalidRow("missing current price")
    try:
        price = float(price)
    except (TypeError, ValueError, OverflowError) as exc:
        raise _InvalidRow("invalid current price") from exc
    if not math.isfinite(price) or price <= 0:
        raise _InvalidRow("invalid current price")

    values = {name: _numeric(row, name) for name in (
        "buy_I_Volume", "buy_N_Volume", "sell_I_Volume", "sell_N_Volume",
        "buy_CountI", "buy_CountN", "sell_CountI", "sell_CountN",
    )}
    for field in ("buy_DDD_Volume", "sell_DDD_Volume"):
        ddd = _numeric(row, field)
        if ddd not in (None, 0):
            raise _InvalidRow("unsupported DDD volume")
    buy_i_volume = values["buy_I_Volume"]
    buy_n_volume = values["buy_N_Volume"]
    sell_i_volume = values["sell_I_Volume"]
    sell_n_volume = values["sell_N_Volume"]
    # Price and volume are provider units; keep the derived value in rial
    # because _per_capita/_share_pct convert and compare that unit consistently.
    buy_i_value = None if buy_i_volume is None else buy_i_volume * price
    buy_n_value = None if buy_n_volume is None else buy_n_volume * price
    sell_i_value = None if sell_i_volume is None else sell_i_volume * price
    sell_n_value = None if sell_n_volume is None else sell_n_volume * price
    stock["buy_per_capita_toman"] = _per_capita(buy_i_value, values["buy_CountI"])
    stock["sell_per_capita_toman"] = _per_capita(sell_i_value, values["sell_CountI"])
    stock["buyer_power"] = (
        stock["buy_per_capita_toman"] / stock["sell_per_capita_toman"]
        if stock["buy_per_capita_toman"] is not None
        and stock["sell_per_capita_toman"] not in (None, 0)
        else None
    )
    stock["legal_buy_pct"] = _share_pct(buy_n_value, None if buy_i_value is None or buy_n_value is None else buy_i_value + buy_n_value)
    stock["legal_sell_pct"] = _share_pct(sell_n_value, None if sell_i_value is None or sell_n_value is None else sell_i_value + sell_n_value)
    stock["client_type_date"] = day.isoformat()


def _fetch_one(index: int, stock: dict[str, Any], day: date, requester: Any) -> tuple[int, str]:
    _empty_metrics(stock)
    stock["client_type_fetched_at"] = None
    instrument = stock.get("instrument")
    if instrument is None or str(instrument).strip() == "":
        stock["client_type_status"] = "missing_instrument"
        return index, "missing_instrument"

    try:
        try:
            live_response = requester.get(LIVE_CLIENT_TYPE_URL.format(str(instrument)), timeout=REQUEST_TIMEOUT_SECONDS)
            live_response.raise_for_status()
            live_payload = live_response.json()
            live_row = live_payload.get("clientType") if isinstance(live_payload, dict) else None
            if isinstance(live_row, dict) and any(live_row.get(name) is not None for name in ("buy_I_Volume", "sell_I_Volume")):
                _apply_live_row(stock, live_row, day)
                stock["client_type_status"] = "ok"
                stock["client_type_fetched_at"] = _fetched_at()
                return index, "ok"
        except Exception:
            # The current-session endpoint can lag or fail independently of
            # the historical endpoint. Preserve a valid dated fallback.
            pass

        response = requester.get(CLIENT_TYPE_URL.format(str(instrument)), timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        stock["client_type_fetched_at"] = _fetched_at()
        row, row_day, had_rows = _latest_row(response.json(), day, str(instrument))
        if row is None:
            status = "invalid_row" if had_rows else "missing_row"
            stock["client_type_status"] = status
            if had_rows:
                LOGGER.warning("Client-type row rejected symbol=%s error=%s", stock.get("symbol", ""), "WrongDay")
            return index, status
        _apply_row(stock, row, row_day)
        stock["client_type_status"] = "ok" if row_day == day else "ok_stale"
        stock["client_type_fetched_at"] = _fetched_at()
        return index, stock["client_type_status"]
    except _InvalidRow as exc:
        stock["client_type_status"] = "invalid_row"
        stock["client_type_fetched_at"] = _fetched_at()
        LOGGER.warning("Client-type row rejected symbol=%s error=%s", stock.get("symbol", ""), type(exc).__name__)
        return index, "invalid_row"
    except Exception as exc:  # transport, HTTP, JSON, and provider failures
        stock["client_type_status"] = "error"
        stock["client_type_fetched_at"] = _fetched_at()
        # Deliberately log only a safe identifier and exception type, never URL or message.
        LOGGER.warning("Client-type fetch failed symbol=%s error=%s", stock.get("symbol", ""), type(exc).__name__)
        return index, "error"


def enrich_signal_client_type(
    stocks: list[dict[str, Any]],
    now: datetime | date,
    session: Any = None,
) -> list[dict[str, Any]]:
    """Mutate and return ``stocks`` with validated same-day client-type metrics.

    Every stock with an ``instrument`` is fetched once.  Requests are bounded
    to four workers, use a ten-second timeout, and only accept a row whose
    ``recDate`` and ``insCode`` match the requested day and instrument.
    """
    day = _day_from_now(now)
    if not isinstance(day, date):
        raise TypeError("now must be a datetime or date")

    if session is None:
        import requests

        requester = requests
    else:
        requester = session

    targets = [(index, stock) for index, stock in enumerate(stocks) if isinstance(stock, dict)]
    if not targets:
        return stocks
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(targets))) as pool:
        list(pool.map(lambda item: _fetch_one(item[0], item[1], day, requester), targets))
    return stocks


__all__ = ["enrich_signal_client_type", "CLIENT_TYPE_URL", "REQUEST_TIMEOUT_SECONDS", "MAX_WORKERS"]

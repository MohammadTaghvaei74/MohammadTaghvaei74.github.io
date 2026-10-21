"""Export the sanitized public signal feed from the authoritative event ledger."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
SOURCE = "telegram_event_delivery"
LIMIT = 10000
SIGNAL_MAX_AGE = timedelta(hours=36)
HEALTH_MAX_AGE = timedelta(minutes=15)
FUTURE_TOLERANCE = timedelta(minutes=5)
CATEGORIES = {"leader", "market", "pressure", "allocation", "other"}


def _empty(message: str, generated_at: str | None = None, health: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "status": "unavailable",
        "source": SOURCE,
        "generated_at": generated_at,
        "last_signal_at": None,
        "items": [],
        "count": 0,
        "has_more": False,
        "health": health or {"last_ok_at": None},
        "message": message,
    }
    return payload


def _connect(db_path: str | os.PathLike[str]) -> sqlite3.Connection:
    path = Path(db_path)
    conn = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn


def _category(event_key: str) -> str:
    prefix = event_key.split(":", 1)[0].lower()
    if prefix == "gap":
        return "allocation"
    return prefix if prefix in CATEGORIES else "other"


def _label(event_key: str, category: str) -> str:
    parts = event_key.split(":", 1)
    return parts[1] if len(parts) == 2 and parts[1] else (parts[0] if parts[0] else category)


def _experimental(text: str) -> bool:
    lowered = text.casefold()
    return any(token in text or token in lowered for token in ("🧪", "آزمایشی", "نمونه", "بازپخش", "هشدار زنده نیست", "experimental"))


def _stable_id(timestamp: str, event_key: str) -> str:
    return hashlib.sha256(f"{timestamp}\0{event_key}".encode("utf-8")).hexdigest()





def _timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _fresh(value: Any, now: datetime, maximum_age: timedelta) -> bool:
    parsed = _timestamp(value)
    return parsed is not None and -FUTURE_TOLERANCE <= now - parsed <= maximum_age


def _parse_sent(row: sqlite3.Row, delivery_id: str) -> dict[str, Any] | None:
    try:
        response = json.loads(row["provider_response"] or "")
    except (TypeError, ValueError):
        return None
    if not isinstance(response, dict):
        return None
    result = response.get("result")
    if response.get("ok") is not True or not isinstance(result, dict):
        return None
    provider_id = result.get("message_id")
    text = result.get("text")
    if provider_id is None or not isinstance(text, str) or not text:
        return None
    ids = (str(provider_id), str(row["provider_message_id"]) if row["provider_message_id"] is not None else None, delivery_id)
    if ids[1] != ids[0] or ids[2] != ids[0]:
        return None
    if _timestamp(row["timestamp"]) is None:
        return None
    category = _category(row["event_key"])
    return {
        "id": _stable_id(row["timestamp"], row["event_key"]),
        "timestamp": row["timestamp"],
        "category": category,
        "label": _label(row["event_key"], category),
        "text": text,
        "experimental": _experimental(text),
    }


def build_payload(db_path: str | os.PathLike[str]) -> dict[str, Any]:
    try:
        with _connect(db_path) as conn:
            observed = conn.execute("SELECT MAX(timestamp) AS timestamp FROM event_outbox").fetchone()["timestamp"]
            health_row = conn.execute("SELECT last_ok_at FROM event_health WHERE id=1").fetchone()
            health = {"last_ok_at": health_row["last_ok_at"] if health_row else None}
            rows = conn.execute(
                """
                SELECT o.*, d.provider_message_id AS delivery_provider_message_id
                FROM event_outbox AS o
                JOIN event_delivery AS d
                  ON d.timestamp = o.timestamp AND d.event_key = o.event_key
                WHERE o.status = 'sent'
                ORDER BY o.timestamp DESC, o.event_key DESC
                """
            ).fetchall()
    except (OSError, sqlite3.Error) as exc:
        return _empty(f"signal feed unavailable: {exc.__class__.__name__}")

    parsed = []
    today = datetime.now(ZoneInfo("Asia/Tehran")).date()
    for row in rows:
        stamped = _timestamp(row["timestamp"])
        if stamped is None or stamped.astimezone(ZoneInfo("Asia/Tehran")).date() != today:
            continue
        item = _parse_sent(row, row["delivery_provider_message_id"])
        if item is not None:
            parsed.append(item)
    if not parsed:
        return _empty("no corroborated sent signal data is available", observed, health)
    last_signal_at = parsed[0]["timestamp"]
    items = parsed[:LIMIT]
    now = datetime.now(timezone.utc)
    available = (_fresh(last_signal_at, now, SIGNAL_MAX_AGE)
                 and _fresh(health["last_ok_at"], now, HEALTH_MAX_AGE))
    payload = {
        "schema_version": SCHEMA_VERSION,
        "status": "ok" if available else "unavailable",
        "source": SOURCE,
        "generated_at": observed,
        "last_signal_at": last_signal_at,
        "items": items,
        "count": len(items),
        "has_more": len(parsed) > LIMIT,
        "health": health,
    }

    if not available:
        payload["message"] = "signal or health timestamp is missing, invalid, or stale; recorded items are retained"
    return payload


def _serialized(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=False) + "\n"


def export(db_path: str | os.PathLike[str], output_path: str | os.PathLike[str]) -> dict[str, Any]:
    payload = build_payload(db_path)
    target = Path(output_path)
    content = _serialized(payload)
    if target.exists() and target.read_text(encoding="utf-8") == content:
        return payload
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=target.name + ".", dir=target.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        os.replace(name, target)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    return payload


if __name__ == "__main__":
    export(os.environ.get("EVENT_DB", "/root/bourse-alert/event_live.db"), "data/signals.json")

__all__ = ["build_payload", "export"]

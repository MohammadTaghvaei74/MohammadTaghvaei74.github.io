import sqlite3
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from market.score_daily import load_daily


def test_read_only_connection_aggregates_without_materializing_tables(tmp_path):
    db = tmp_path / "scores.db"
    conn = sqlite3.connect(db)
    conn.execute(
        "CREATE TABLE stock_snapshots (symbol TEXT, timestamp TEXT, trading_date TEXT, valid INTEGER, score REAL)"
    )
    conn.executemany(
        "INSERT INTO stock_snapshots VALUES (?,?,?,?,?)",
        [
            ("AAA", "2026-11-01T10:00:00+03:30", "2026-11-01", 1, 2.0),
            ("AAA", "2026-11-01T11:00:00+03:30", "2026-11-01", 1, 4.0),
        ],
    )
    conn.commit()
    conn.close()

    read_only = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        result = load_daily(read_only, ["2026-11-01"])
    finally:
        read_only.close()

    assert result["AAA"][0]["score"] == 3.0
    assert not sqlite3.connect(db).execute(
        "SELECT name FROM sqlite_master WHERE name='score_daily_minutes'"
    ).fetchone()


def test_score_observations_uses_its_actual_schema(tmp_path):
    db = tmp_path / "observations.db"
    conn = sqlite3.connect(db)
    conn.execute(
        """CREATE TABLE score_observations (
            observed_minute TEXT NOT NULL,
            observed TEXT NOT NULL,
            symbol TEXT NOT NULL,
            instrument TEXT,
            score REAL NOT NULL,
            eligible_market_stock INTEGER NOT NULL,
            trade_volume REAL,
            source TEXT NOT NULL
        )"""
    )
    conn.executemany(
        "INSERT INTO score_observations VALUES (?,?,?,?,?,?,?,?)",
        [
            ("2026-11-01T10:00:00+03:30", "2026-11-01T10:00:05+03:30", "AAA", "AAA", 2.0, 1, 10, "collector"),
            ("2026-11-01T11:00:00+03:30", "2026-11-01T11:00:05+03:30", "AAA", "AAA", 6.0, 1, 10, "collector"),
        ],
    )
    conn.commit()

    try:
        result = load_daily(conn, ["2026-11-01"])
    finally:
        conn.close()

    assert result["AAA"][0]["score"] == 4.0
    assert result["AAA"][0]["minute_count"] == 2

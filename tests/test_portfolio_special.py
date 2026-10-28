import sqlite3

from market.portfolio_special import build_portfolio_special


def make_db():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE history(symbol TEXT, timestamp TEXT, score REAL)")
    return conn


def test_latest_same_day_history_and_explicit_untraded_zero():
    conn = make_db()
    conn.executemany(
        "INSERT INTO history VALUES (?,?,?)",
        [
            ("طلا", "2026-10-24T12:14:00+03:30", -1.44),
            ("طلا", "2026-10-24T12:30:01+03:30", -2.0),
            ("فارما کیان", "2026-10-24T12:30:01+03:30", 0.18),
            ("ابتکار", "2026-10-24T12:30:01+03:30", -1.42),
            ("شراز", "2026-10-23T12:30:01+03:30", -2.99),
        ],
    )

    result = build_portfolio_special(conn, "2026-10-24T12:30:01+03:30")

    assert result["source"] == "scores_history.db/history"
    assert result["reference_day"] == "2026-10-24"
    assert result["symbols"]["طلا"] == {
        "symbol": "طلا",
        "kind": "fund",
        "score": -2.0,
        "source": "history_current",
        "timestamp": "2026-10-24T12:30:01+03:30",
        "reference_day": "2026-10-24",
    }
    assert result["symbols"]["شراز"]["score"] == 0.0
    assert result["symbols"]["شراز"]["source"] == "untraded_zero"
    assert result["symbols"]["شراز"]["timestamp"] == "2026-10-24T12:30:01+03:30"


def test_fund_without_current_day_uses_previous_history():
    conn = make_db()
    conn.execute(
        "INSERT INTO history VALUES (?,?,?)",
        ("طلا", "2026-10-23T12:30:01+03:30", -1.5),
    )

    result = build_portfolio_special(conn, "2026-10-24T12:30:01+03:30")

    assert result["symbols"]["طلا"]["score"] == -1.5
    assert result["symbols"]["طلا"]["source"] == "history_previous"
    assert result["symbols"]["طلا"]["timestamp"] == "2026-10-23T12:30:01+03:30"
    assert result["symbols"]["شراز"]["score"] == 0.0


def test_leveraged_fund_uses_current_history_score_instead_of_missing_data():
    conn = make_db()
    conn.executemany(
        "INSERT INTO history VALUES (?,?,?)",
        [("اهرم", "2026-10-24T12:30:01+03:30", 4.25), ("شتاب", "2026-10-24T12:30:01+03:30", -1.5)],
    )

    result = build_portfolio_special(conn, "2026-10-24T12:30:01+03:30")

    assert result["symbols"]["اهرم"]["kind"] == "fund"
    assert result["symbols"]["اهرم"]["score"] == 4.25
    assert result["symbols"]["اهرم"]["source"] == "history_current"
    assert result["symbols"]["شتاب"]["score"] == -1.5

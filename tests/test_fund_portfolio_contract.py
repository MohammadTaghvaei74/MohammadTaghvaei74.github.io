import json
from pathlib import Path


FEED = Path(__file__).parents[1] / "market" / "data" / "funds.json"


def test_monthly_fund_portfolio_contract():
    payload = json.loads(FEED.read_text(encoding="utf-8"))
    rows = payload["rows"]
    assert len(rows) == payload["row_count"] == payload["eligible_count"]
    assert payload["portfolio_contract"]["refresh_cadence"] == "monthly"
    assert payload["portfolio_contract"]["liquidity_rule"] == "strictly greater than 20 billion toman"
    assert payload["portfolio_contract"]["last_portfolio_update_field"] == "portfolio_last_update"
    # The published table is fail-closed: no row with a missing score is shown.
    assert rows
    assert all(row.get("portfolio_score") is not None for row in rows)
    assert all(row.get("board_score") is not None for row in rows)
    assert all(row.get("score_diff") is not None for row in rows)


def test_dara_score_is_not_percentage_scaled():
    payload = json.loads(FEED.read_text(encoding="utf-8"))
    dara = next(row for row in payload["rows"] if row["symbol"] == "دارا یکم")
    assert 0 <= dara["matched_weight"] <= 1
    assert 0 <= dara["total_equity_weight"] <= 1
    assert -10 <= dara["portfolio_score"] <= 10
    assert abs(dara["portfolio_score"] - (-2.7502353072805766)) < 1e-9

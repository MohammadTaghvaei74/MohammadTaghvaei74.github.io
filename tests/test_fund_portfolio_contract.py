import json
from pathlib import Path


FEED = Path(__file__).parents[1] / "market" / "data" / "funds.json"


def test_monthly_fund_portfolio_contract():
    payload = json.loads(FEED.read_text(encoding="utf-8"))
    rows = payload["rows"]
    assert len(rows) == payload["row_count"] == 36
    assert payload["eligible_count"] == 36
    assert payload["portfolio_contract"]["refresh_cadence"] == "monthly"
    assert payload["portfolio_contract"]["liquidity_rule"] == "strictly greater than 20 billion toman"
    assert payload["portfolio_contract"]["last_portfolio_update_field"] == "portfolio_last_update"

    verified = [row for row in rows if row.get("portfolio_update_status") == "verified"]
    assert len(verified) == 35
    assert payload["codal_portfolio_notice_count"] == 35
    for row in verified:
        assert row["portfolio_last_update"]
        assert row["portfolio_source"] in {
            "codal",
            "fund_manager_site",
            "TSETMC_fund_page",
            "web_search",
        }
        assert row["portfolio_source_label"]
        assert row["portfolio_update_published_at"]

    bankpad = next(row for row in rows if row["symbol"] == "بانکپاد")
    assert bankpad["portfolio_update_status"] == "not_found"
    assert bankpad["portfolio_last_update"] is None
    assert bankpad["portfolio_disclosed_weight_pct"] is None

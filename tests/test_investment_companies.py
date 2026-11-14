import importlib.util
import json
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "build_investment_companies", ROOT / "market/build_investment_companies.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class InvestmentCompanyContractTests(unittest.TestCase):
    def test_weighted_score_keeps_cash_and_unlisted_in_denominator(self):
        score, coverage = MODULE.weighted_portfolio_score(
            [
                {"symbol": "A", "weight_pct": 20},
                {"symbol": "B", "weight_pct": 10},
                {"name": "cash", "weight_pct": 70},
                {"name": "unlisted", "weight_pct": 5},
            ],
            {"A": 4, "B": -2},
        )
        self.assertAlmostEqual(score, 0.6)
        self.assertEqual(coverage, 30)

    def test_missing_scores_are_not_zero(self):
        score, coverage = MODULE.weighted_portfolio_score(
            [{"symbol": "A", "weight_pct": 40}], {"A": None}
        )
        self.assertIsNone(score)
        self.assertEqual(coverage, 0)

    def test_effective_ownership_multiplies_layers(self):
        graph = {"X": [("Y", 20)], "Y": [("Z", 30)]}
        self.assertAlmostEqual(MODULE.effective_ownership(graph, "X")["Z"], 6)

    def test_industrial_holding_scope_includes_fars_and_multilayer_groups(self):
        self.assertTrue(MODULE.is_investment_company({"symbol": "فارس", "industry": "شیمیایی"}))
        self.assertTrue(MODULE.is_investment_company({"symbol": "شستا", "industry": "شرکتهای چند رشته ای"}))
        self.assertFalse(MODULE.is_investment_company({"symbol": "وبملت", "industry": "بانک", "description": "بانک ملت"}))

    def test_catalog_keeps_closed_investment_symbol(self):
        market = {
            "generated_at": "2026-11-08T10:00:00+03:30",
            "stocks": [{"symbol": "A", "industry": "سرمایه گذاریها", "last_pct": 1.0, "description": "A"}],
            "investment_catalog": [{"symbol": "B", "industry": "سرمایه گذاریها", "last_pct": None, "description": "B"}],
        }
        rows = MODULE.build_rows(market, as_of=date(2026, 11, 8))
        self.assertEqual([row["symbol"] for row in rows], ["A", "B"])
        self.assertEqual(rows[1]["trade_state"], "not_observed")
        self.assertIsNone(rows[1]["board_score"])
        self.assertIsNone(rows[1]["portfolio_score"])

    def test_generated_contract_has_all_current_rows_and_null_missing_values(self):
        data = json.loads((ROOT / "market/data/investment-companies.json").read_text(encoding="utf-8"))
        self.assertEqual(data["row_count"], len(data["rows"]))
        self.assertGreaterEqual(data["row_count"], 1)
        self.assertTrue(all("board_score" in row and "portfolio_score" in row for row in data["rows"]))
        self.assertTrue(any(row["portfolio_score"] is None for row in data["rows"]))
        self.assertTrue(data["portfolio_contract"]["no_renormalization"])

    def test_real_codal_checkpoint_is_present_and_fars_keeps_missing_score_honest(self):
        raw = json.loads((ROOT / "market/data/investment-codal-raw.json").read_text(encoding="utf-8"))
        verified = [row for row in raw["reports"].values() if row.get("status") == "verified"]
        self.assertGreaterEqual(len(verified), 1)
        fars = raw["reports"].get("فارس")
        self.assertEqual(fars["status"], "verified")
        self.assertGreater(len(fars["listed_holdings"]), 0)
        public = json.loads((ROOT / "market/data/investment-companies.json").read_text(encoding="utf-8"))
        fars_public = next(row for row in public["rows"] if row["symbol"] == "فارس")
        self.assertIsNotNone(fars_public["portfolio_report_date"])
        self.assertIsNotNone(fars_public["portfolio_score"])
        self.assertEqual(fars_public["portfolio_status"], "محاسبه شد")
        self.assertGreater(fars_public["total_investment_assets_million_rial"], 0)
        self.assertGreater(fars_public["listed_market_value_billion_toman"], 0)
        self.assertIsNotNone(fars_public["source_url"])
        self.assertIsNotNone(fars_public["market_cap_to_nav_pct"])
        self.assertIsNotNone(fars_public["avg15_trade_value_billion_toman"])

    def test_public_table_contract_uses_requested_persian_columns(self):
        html = (ROOT / "market/investments/index.html").read_text(encoding="utf-8")
        for label in ("اختلاف امتیازها", "لینک گزارش", "ارزش روز پرتفو بورسی (میلیارد تومان)", "مارکت‌کپ ÷ NAV", "میانگین ارزش معاملات ۱۵ روز اخیر (میلیارد تومان)"):
            self.assertIn(label, html)
        for removed in ("نام / شناسه", "وضعیت معامله", "فاصله", "سایر سرمایه‌گذاری", "جمع دارایی سرمایه‌گذاری", "تعداد دارایی"):
            self.assertNotIn(f">{removed}<", html)

    def test_report_age_uses_jalali_date_without_fabricating(self):
        self.assertEqual(MODULE.report_age_days("1405/07/30", date(2026, 11, 8)), 17)
        self.assertIsNone(MODULE.report_age_days("not-a-date", date(2026, 11, 8)))


if __name__ == "__main__":
    unittest.main()

# Keep the imported json module intentionally used above: this fixture also
# verifies the checked-in generated public contract, not only pure functions.

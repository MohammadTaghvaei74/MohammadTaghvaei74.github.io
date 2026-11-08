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
        self.assertIsNone(data["rows"][0]["portfolio_score"])
        self.assertTrue(data["portfolio_contract"]["no_renormalization"])


if __name__ == "__main__":
    unittest.main()

# Keep the imported json module intentionally used above: this fixture also
# verifies the checked-in generated public contract, not only pure functions.

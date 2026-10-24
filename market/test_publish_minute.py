import json
import tempfile
import unittest
from pathlib import Path

import publish_minute


class MinutePublishTests(unittest.TestCase):
    def test_writes_live_surfaces_without_touching_daily_options(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            options = root / "market/data/options.json"
            options.parent.mkdir(parents=True)
            options.write_text('{"generated_at":"daily"}\n', encoding="utf-8")
            market = {"generated_at": "2026-10-21T12:30:00", "stocks": [{"symbol": "AAA"}], "options": {"status": "connecting"}}
            comprehensive = {"schema_version": 1, "generated_at": market["generated_at"], "rows": [{"symbol": "AAA"}], "meta": {}}
            funds = {"status": "ready", "rows": []}
            signals = {"status": "ready", "rows": []}
            result = publish_minute.write_live_payload(root, market, comprehensive, funds, signals)
            self.assertEqual(result, "PUBLISHED")
            self.assertEqual(json.loads((root / "market/data/market.json").read_text())["stocks"][0]["symbol"], "AAA")
            self.assertEqual(json.loads((root / "market/data/comprehensive.json").read_text())["rows"][0]["symbol"], "AAA")
            self.assertEqual(json.loads((root / "market/data/signals.json").read_text())["status"], "ready")
            self.assertEqual(options.read_text(encoding="utf-8"), '{"generated_at":"daily"}\n')


if __name__ == "__main__":
    unittest.main()

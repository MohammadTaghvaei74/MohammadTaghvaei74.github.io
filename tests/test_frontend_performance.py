import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "market/app-fast-recovery-20261024-axis.js").read_text(encoding="utf-8")
INDEX = (ROOT / "market/index.html").read_text(encoding="utf-8")


class FrontendPerformanceContractTests(unittest.TestCase):
    def test_fetch_respects_cache_mode_and_only_cache_busts_no_store(self):
        self.assertIn('function liveDataUrl(path, cacheMode = "no-store")', APP)
        self.assertIn('if (cacheMode === "no-store") url.searchParams.set("ts", String(Date.now()));', APP)
        self.assertIn('fetch(liveDataUrl(path, cacheMode), { cache: cacheMode,', APP)

    def test_secondary_feeds_are_scheduled_after_first_paint_and_scoped(self):
        self.assertIn('window.requestIdleCallback(loadSecondaryFeeds, {timeout: 1200})', APP)
        self.assertIn('if (document.querySelector("#optionsPairs")) void fetchOptionsInBackground();', APP)
        self.assertNotIn('void fetchOptionsInBackground();\n      if (showToast)', APP)

    def test_sheetjs_is_non_blocking(self):
        self.assertNotIn('cdn.sheetjs.com', INDEX)


if __name__ == "__main__":
    unittest.main()

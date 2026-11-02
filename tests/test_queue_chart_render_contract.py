from pathlib import Path


ROOT = Path(__file__).parents[1]


def test_queue_count_chart_clears_loading_state_when_data_is_present():
    source = (ROOT / "market" / "app.js").read_text(encoding="utf-8")
    start = source.index("function renderQueueCountChart")
    end = source.index("function renderPriceDistributionChart", start)
    block = source[start:end]

    assert 'setChartState(svg, "ready")' in block
    assert 'setChartState(svg, "empty", "داده تعداد صف‌ها برای امروز موجود نیست؛ هیچ مقداری جایگزین نشده است.")' in block
    assert 'Array.isArray(data.queue_count_intraday)' in block


def test_market_page_busts_old_chart_bundle_cache():
    html = (ROOT / "market" / "index.html").read_text(encoding="utf-8")
    assert "canonical-dashboard-20261103-1" in html
    assert "rollout-2-summary-1" not in html

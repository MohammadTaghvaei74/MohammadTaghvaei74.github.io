from market.instrument_filters import filter_common_stocks, is_common_stock


def test_non_equity_rows_are_excluded_from_common_stock_list():
    rows = [
        {"symbol": "کپا ه 7", "instrument_type": "E1"},
        {"symbol": "سپا ه 7", "instrument_type": "E1"},
        {"symbol": "پا ه 8", "instrument_type": "E1"},
        {"symbol": "دحاوی4", "instrument_type": "P4"},
        {"symbol": "تپسی", "instrument_type": "Z1"},
        {"symbol": "فساپ", "instrument_type": "G1"},
    ]
    assert [r["symbol"] for r in filter_common_stocks(rows)] == ["تپسی", "فساپ"]


def test_missing_type_does_not_allow_contract_shaped_symbol():
    assert not is_common_stock({"symbol": "اراد1714", "instrument_type": ""})
    assert not is_common_stock({"symbol": "کپا ه 7", "instrument_type": ""})
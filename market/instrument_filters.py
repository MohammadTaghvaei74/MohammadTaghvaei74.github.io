"""Eligibility rules for the public common-stock market tables."""
from __future__ import annotations

import re


# TSETMC instrument families observed in the feed that are not common shares.
# Keep this deny-list in addition to the symbol-shape check: some provider
# rows have a generic/unknown type but still carry an instrument suffix.
NON_COMMON_TYPES = {
    "E1", "P4", "Q1", "I1", "47", "N4", "P2", "M1", "K2", "2Z",
    "O1", "C2", "QB", "QD", "H1", "TS", "TJ",
}


def is_common_stock(row: dict) -> bool:
    """Return true only for a plain, symbol-shaped common-stock row."""
    if not isinstance(row, dict):
        return False
    symbol = str(row.get("symbol") or "").strip()
    instrument_type = str(row.get("instrument_type") or "").strip().upper()
    if not symbol or instrument_type in NON_COMMON_TYPES:
        return False
    if not instrument_type:
        return not re.search(r"[0-9۰-۹]", symbol)
    # Contract/certificate/bond/option tickers in this feed carry a numeric
    # suffix. Keep spaces allowed because a small number of valid share names
    # are written with a space by the provider (for example فن آوا).
    if re.search(r"[0-9۰-۹]", symbol):        return False
    return True


def filter_common_stocks(rows):
    return [row for row in rows if is_common_stock(row)]
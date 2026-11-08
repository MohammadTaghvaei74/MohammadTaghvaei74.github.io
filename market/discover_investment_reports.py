#!/usr/bin/env python3
"""Discover latest Codal monthly portfolio workbooks without inventing rows."""
from __future__ import annotations
import concurrent.futures
import datetime as dt
import json
import re
import time
import urllib.parse
from pathlib import Path

import requests

DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
TITLE_RE = re.compile(r"گزارش\s*فعالیت\s*ماهانه|پرتفوی|پورتفوی|صورت\s*وضعیت\s*پورتفوی")
DATE_RE = re.compile(r"1[34]\d{2}/\d{2}/\d{2}")


def normalized(text):
    return re.sub(r"[\s\u200c\u200d\ufeff]+", "", str(text or "").translate(DIGITS))


def query(symbol, cache_dir):
    cache = cache_dir / f"{symbol}-search.json"
    try:
        if cache.exists():
            payload = json.loads(cache.read_text(encoding="utf-8"))
        else:
            params = {"Symbol": symbol, "PageNumber": 1, "Length": 100, "TracingNo": -1,
                      "LetterType": -1, "Category": -1, "CompanyType": -1,
                      "AuditorRef": -1, "Audited": True, "NotAudited": True,
                      "IsNotAudited": False, "Childs": True, "Mains": True,
                      "Publisher": False, "CompanyState": -1, "ReportingType": -1,
                      "Consolidatable": True, "NotConsolidatable": True}
            response = None
            for attempt in range(3):
                response = requests.get("https://search.codal.ir/api/search/v2/q", params=params,
                                        headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"}, timeout=90)
                if response.status_code != 429:
                    break
                # Codal rate-limits bursts. Do not turn a temporary block
                # into a false "report missing" result.
                time.sleep(10 * (attempt + 1))
            if response is not None and response.status_code == 429:
                return symbol, {"status": "blocked_or_rate_limited", "http_status": 429,
                                "retry_after": response.headers.get("Retry-After")}
            response.raise_for_status()
            payload = response.json()
            cache.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        letters = [x for x in payload.get("Letters", []) if TITLE_RE.search(x.get("Title", ""))]
        letters.sort(key=lambda x: (max(DATE_RE.findall(x.get("Title", "").translate(DIGITS)) or [""]), x.get("PublishDateTime", "")), reverse=True)
        if not letters:
            return symbol, {"status": "not_found", "error": "no monthly portfolio report"}
        letter = letters[0]
        detail = urllib.parse.urljoin("https://codal.ir", letter.get("AttachmentUrl") or letter.get("Url") or "")
        if not detail:
            return symbol, {"status": "not_found", "error": "report has no detail URL"}
        html = requests.get(detail, headers={"User-Agent": "Mozilla/5.0"}, timeout=90).text
        ids = list(dict.fromkeys(re.findall(r"DownloadFile\.aspx\?id=([^&'\"<>\s]+)", html)))
        if not ids:
            return symbol, {"status": "found_no_excel", "title": letter.get("Title"), "detail_url": detail}
        report_date = max(DATE_RE.findall(letter.get("Title", "").translate(DIGITS)) or [None])
        return symbol, {"status": "found", "title": letter.get("Title"), "detail_url": detail,
                        "report_date": report_date, "source_url": f"https://codal.ir/Reports/DownloadFile.aspx?id={ids[0]}"}
    except Exception as exc:
        return symbol, {"status": "error", "error": f"{type(exc).__name__}: {exc}"}


def main():
    root = Path(__file__).resolve().parent
    payload = json.loads((root / "data/investment-companies.json").read_text(encoding="utf-8"))
    symbols = sorted({row["symbol"] for row in payload.get("rows", []) if row.get("symbol")})
    cache_dir = root / "data/codal-investment-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    def paced(symbol):
        result = query(symbol, cache_dir)
        # Keep requests below Codal's burst threshold. This is deliberately
        # conservative because a blocked request yields no usable evidence.
        time.sleep(2)
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        found = dict(pool.map(paced, symbols))
    result = {"schema_version": 1, "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
              "row_count": len(symbols), "reports": found}
    (root / "data/investment-report-discovery.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    counts = {}
    for row in found.values(): counts[row.get("status", "unknown")] = counts.get(row.get("status", "unknown"), 0) + 1
    print(json.dumps({"rows": len(symbols), "status_counts": counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Publish the minute-critical market snapshot without heavy archive work."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

SITE = Path(os.environ.get("SITE_REPO", "/root/bourse-site"))
sys.path.insert(0, str(SITE))
from market import publish_snapshot as p  # noqa: E402

TEHRAN = ZoneInfo("Asia/Tehran")
PUBLISH_FILES = [
    "market/data/market.json",
    "market/data/comprehensive.json",
    "market/data/funds.json",
    "market/data/signals.json",
    "market/publish_minute.py",
]


def in_window(now: datetime) -> bool:
    if now.weekday() not in (0, 1, 2, 5, 6):
        return False
    start = now.replace(hour=8, minute=45, second=0, microsecond=0)
    end = now.replace(hour=12, minute=31, second=0, microsecond=0)
    return start <= now < end


def git(*args: str, check: bool = True):
    return subprocess.run(["git", "-C", str(SITE), *args], text=True,
                          capture_output=True, check=check)


def main() -> int:
    now = datetime.now(TEHRAN)
    if not in_window(now):
        print("SKIP_OUTSIDE_MARKET_WINDOW", flush=True)
        return 0

    # Keep client-type enrichment enabled: the comprehensive table must not
    # publish dashes when per-capita, power, and legal-flow data is available.
    # Market-cap enrichment is unrelated to this table and would add ~800
    # extra provider calls to every minute publication.
    os.environ["SKIP_TSETMC_MARKET_CAP"] = "1"
    with p.connect() as conn:
        market = p.build_market(conn)
        market["published_at"] = datetime.now(TEHRAN).isoformat()
        fund_report = p.load_fund_report()
        market["fund_report"] = fund_report
        comprehensive = {
            "schema_version": 1,
            "generated_at": market["generated_at"],
            "published_at": market["published_at"],
            "rows": market.pop("comprehensive_stocks", []),
            "meta": market.pop("comprehensive_meta", {}),
        }

    p.atomic_json(SITE / "market/data/market.json", market)
    p.atomic_json(SITE / "market/data/comprehensive.json", comprehensive)
    p.atomic_json(SITE / "market/data/funds.json", fund_report)

    event_db = Path(os.environ.get("EVENT_DB", "/root/bourse-alert/event_live.db"))
    signal_payload = p.export_signals(event_db, SITE / "market/data/signals.json")

    status = git("status", "--porcelain").stdout.splitlines()
    allowed = set(PUBLISH_FILES)
    unsafe = [line for line in status if line[3:].strip() not in allowed]
    if unsafe:
        print("MINUTE_PUBLISH_BLOCKED_UNSAFE_WORKTREE", unsafe, flush=True)
        return 2

    git("add", "--", *PUBLISH_FILES)
    staged = git("diff", "--cached", "--quiet", check=False)
    if staged.returncode == 2:
        raise RuntimeError("git diff --cached failed")
    if staged.returncode == 1:
        git("commit", "-m", "chore: publish minute market snapshot")
        git("pull", "--rebase", "--autostash", "origin", "main")
        git("push", "origin", "main")
        result = "PUBLISHED"
    else:
        result = "NO_CHANGE"
    print(result, market["generated_at"], "stocks", len(market.get("stocks", [])), "signals", signal_payload.get("status"), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

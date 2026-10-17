"""Fail-closed Bull Call Spread snapshot producer for the public market feed."""
from __future__ import annotations

import ast
import gzip
import json
import os
import re
import sqlite3
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 1
MAX_QUOTE_AGE = 120
MIN_AVG7 = 15_000_000_000


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        value = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value) if value is not None else None


def _fresh(value: Any, now: datetime) -> bool:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None: parsed = parsed.replace(tzinfo=timezone.utc)
        return 0 <= (now - parsed).total_seconds() <= MAX_QUOTE_AGE
    except (TypeError, ValueError):
        return False


def _load_leaders() -> list[str]:
    """Load the authoritative 40-symbol universe, never score-ranked top 10."""
    path = os.environ.get("OPTIONS_LEADERS_FILE", "/root/bourse-alert/event_engine.py")
    if not path or not Path(path).exists():
        return []
    try:
        tree = ast.parse(Path(path).read_text(encoding="utf-8"), filename=path)
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "LEADERS" for t in node.targets):
                value = ast.literal_eval(node.value)
                return [str(item) for item in value] if isinstance(value, (list, tuple)) else []
    except (OSError, SyntaxError, ValueError, TypeError):
        try:
            source = Path(path).read_text(encoding="utf-8")
            match = re.search(r"LEADERS\s*=\s*\[([^\]]*)\]", source, re.S)
            return re.findall(r"['\"]([^'\"]+)['\"]", match.group(1)) if match else []
        except (OSError, UnicodeError):
            return []
    return []


def _jalali_to_gregorian(jy: int, jm: int, jd: int) -> date:
    jy -= 979
    days = 365 * jy + jy // 33 * 8 + ((jy % 33) + 3) // 4
    days += (jm - 1) * (31 if jm <= 6 else 30) + (6 if jm > 6 else 0) + jd - 1 + 79
    gy = 1600 + 400 * (days // 146097); days %= 146097; leap = True
    if days >= 36525:
        days -= 1; gy += 100 * (days // 36524); days %= 36524
        if days >= 365: days += 1
        else: leap = False
    gy += 4 * (days // 1461); days %= 1461
    if days >= 366: leap = False; days -= 1; gy += days // 365; days %= 365
    gd = days + 1
    for gm, ml in enumerate([31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], 1):
        if gd <= ml: return date(gy, gm, gd)
        gd -= ml
    raise ValueError("invalid Jalali date")


def _dte(expiry: str, now: datetime) -> int | None:
    try:
        y, m, d = (int(x) for x in re.split(r"[/\\-]", expiry))
        return (_jalali_to_gregorian(y, m, d) - now.astimezone(timezone.utc).date()).days
    except (TypeError, ValueError): return None


def _empty(status: str, message: str, now: datetime, source_at: str | None, contracts=None, diagnostics=None):
    return {"schema_version": SCHEMA_VERSION, "strategy": "bull_call_spread", "generated_at": now.isoformat(),
            "source_at": source_at, "source": "TSETMC", "status": status, "message": message,
            "counts": {"contracts": len(contracts or []), "pairs": 0, "eligible_pairs": 0},
            "pairs": [], "contracts": contracts or [], "diagnostics": diagnostics or [],
            "risk": _risk_payload()}


def _risk_payload():
    raw_capital = os.environ.get("OPTION_TOTAL_CAPITAL_TOMAN")
    try:
        capital = float(raw_capital) if raw_capital is not None else None
    except (TypeError, ValueError):
        capital = None
    loss = capital * 0.015 if capital is not None and capital > 0 else None
    return {"max_risk_percent": 1.5, "capital_toman": capital,
            "max_strategy_loss_toman": loss, "multiplier_verified": False,
            "max_contracts": None}


def _history(db_path: os.PathLike[str] | str, symbol: str, before: str):
    try:
        with sqlite3.connect(f"file:{Path(db_path).resolve()}?mode=ro", uri=True) as c:
            cols = {r[1] for r in c.execute("pragma table_info(option_daily_values)")}
            if not {"trading_date", "symbol", "value_toman", "complete"} <= cols: return None, 0
            complete = " AND complete=1"
            rows = c.execute("SELECT trading_date,value_toman FROM option_daily_values WHERE symbol=? AND trading_date<?" + complete + " GROUP BY trading_date ORDER BY trading_date DESC", (symbol, before)).fetchall()
        if len(rows) < 7: return None, len(rows)
        values = [float(r[1]) for r in rows[:7]]
        return sum(values) / 7.0, 7
    except (OSError, sqlite3.Error): return None, 0


def build_snapshot(history_db, contracts: Iterable[dict], underlyings: dict[str, dict], now: datetime) -> dict:
    now = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    raw = list(contracts)
    if not Path(history_db).exists(): return _empty("unavailable", "منبع تاریخچه اختیار در دسترس نیست.", now, None)
    source_at = max((_iso(c.get("quote_timestamp")) for c in raw if c.get("quote_timestamp")), default=None)
    out_contracts, diagnostic_counts = [], {}
    enriched = []
    for c in raw:
        u = underlyings.get(c.get("underlying"), {})
        avg, days = _history(history_db, c.get("symbol"), now.date().isoformat())
        reasons = []
        if days < 7: reasons.append("تاریخچه کامل ۷ روزه موجود نیست")
        if avg is None or avg <= MIN_AVG7: reasons.append("میانگین ارزش معاملات ۷روزه کافی نیست")
        if not _fresh(c.get("quote_timestamp"), now): reasons.append("قیمت سرخط قدیمی یا نامعتبر است")
        if u.get("quote_timestamp") is not None and not _fresh(u.get("quote_timestamp"), now): reasons.append("قیمت پایه قدیمی یا نامعتبر است")
        if float(c.get("ask") or 0) <= 0 or float(c.get("bid") or 0) <= 0: reasons.append("Bid/Ask معتبر نیست")
        row = {"symbol": c.get("symbol"), "underlying": c.get("underlying"), "leader_rank": u.get("leader_rank"), "expiry": c.get("expiry"), "dte": _dte(c.get("expiry"), now), "strike_toman": c.get("strike"), "ask_toman": c.get("ask"), "bid_toman": c.get("bid"), "trade_value_toman": c.get("trade_value_toman"), "avg7d_toman": avg, "history_days": days, "quote_at": _iso(c.get("quote_timestamp")), "reasons": reasons}
        out_contracts.append(row); enriched.append((c, u, avg, days, reasons))
        for reason in reasons: diagnostic_counts[reason] = diagnostic_counts.get(reason, 0) + 1
    enriched.sort(key=lambda item: (str(item[0].get("underlying")), str(item[0].get("expiry")), float(item[0].get("strike") or 0)))
    pairs = []
    for i, (a, ua, aa, da, ra) in enumerate(enriched):
        for b, ub, ab, db, rb in enriched[i+1:]:
            if a.get("underlying") != b.get("underlying") or a.get("expiry") != b.get("expiry") or float(a.get("strike", 0)) >= float(b.get("strike", 0)): continue
            s = float(ua.get("last_price") or 0); k1=float(a.get("strike")); k2=float(b.get("strike")); ask=float(a.get("ask") or 0); bid=float(b.get("bid") or 0); dte=_dte(a.get("expiry"), now)
            reasons = list(dict.fromkeys(ra + rb))
            if not (1 <= int(ua.get("leader_rank") or 999) <= 10): reasons.append("لیدر در رتبه ۱ تا ۱۰ نیست")
            if dte is None or not (5 <= dte <= 20): reasons.append("DTE خارج از بازه ۵ تا ۲۰ است")
            if k1 <= 0 or s <= 0 or (k2-k1)/k1 <= .15: reasons.append("فاصله استرایک‌ها بیش از ۱۵٪ نیست")
            if s <= 0 or (s-k1)/s < .10: reasons.append("استرایک پایین حداقل ۱۰٪ زیر پایه نیست")
            if s <= 0 or (k2-s)/s >= .05: reasons.append("استرایک بالا کمتر از ۵٪ بالای پایه نیست")
            gross=ask-bid; fees=(ask+bid)*.001; net=gross+fees; profit=(k2-k1)-gross-fees
            if gross <= 0: reasons.append("Gross Debit معتبر نیست")
            if net <= 0 or profit <= 0: reasons.append("بازده ناخالص معتبر نیست")
            monthly=(profit/(dte/30))/net if dte and net > 0 else -1
            if monthly < .30: reasons.append("بازده ماهانه‌شده کمتر از ۳۰٪ است")
            eligible = not reasons
            pairs.append({"underlying": a.get("underlying"), "leader_rank": ua.get("leader_rank"), "underlying_price_toman": s, "expiry": a.get("expiry"), "dte": dte, "long_symbol": a.get("symbol"), "short_symbol": b.get("symbol"), "k1_toman": k1, "k2_toman": k2, "ask_toman": ask, "bid_toman": bid, "gross_debit_toman": gross, "fees_toman": fees, "net_debit_toman": net, "max_loss_toman": net, "max_profit_toman": profit, "break_even_toman": k1+net, "total_return_pct": profit/net*100 if net else None, "monthly_return_pct": monthly*100 if monthly >= 0 else None, "long_avg7d_toman": aa, "short_avg7d_toman": ab, "long_history_days": da, "short_history_days": db, "eligible": eligible, "reasons": reasons, "quote_at": _iso(a.get("quote_timestamp"))})
    for p in pairs:
        for reason in p["reasons"]: diagnostic_counts[reason] = diagnostic_counts.get(reason, 0) + 1
    diagnostics = [{"label": k, "count": v} for k, v in sorted(diagnostic_counts.items())]
    eligible = [p for p in pairs if p["eligible"]]
    has_stale_quote = any("قدیمی" in r for c in out_contracts for r in c["reasons"])
    status = "ready" if eligible else ("stale" if has_stale_quote else ("insufficient_data" if not raw or any("تاریخچه" in r for c in out_contracts for r in c["reasons"]) else "no_opportunity"))
    message = "اسنپ‌شات واقعی Bull Call Spread آماده است." if eligible else ("داده آپشن قدیمی است؛ جفتی صادر نمی‌شود." if status == "stale" else ("داده کافی برای بررسی کامل جفت‌ها وجود ندارد." if status == "insufficient_data" else "جفت واجد شرایطی یافت نشد؛ فیلترها تسهیل نشده‌اند."))
    return {"schema_version": 1, "strategy": "bull_call_spread", "generated_at": now.isoformat(), "source_at": source_at, "source": "TSETMC", "status": status, "message": message, "counts": {"contracts": len(out_contracts), "pairs": len(pairs), "eligible_pairs": len(eligible)}, "pairs": pairs, "contracts": out_contracts, "diagnostics": diagnostics, "risk": _risk_payload()}


def atomic_export(path, payload):
    target = Path(path); target.parent.mkdir(parents=True, exist_ok=True); fd, name = tempfile.mkstemp(prefix=target.name+'.', dir=target.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as f: json.dump(payload, f, ensure_ascii=False, separators=(',', ':')); f.write('\n')
        os.replace(name, target)
    finally:
        if os.path.exists(name): os.unlink(name)


def load_marketwatch(path):
    with gzip.open(path, 'rt', encoding='utf-8') if str(path).endswith('.gz') else open(path, encoding='utf-8') as f: data=json.load(f)
    return data


def _init_history(path):
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS option_daily_values (trading_date TEXT NOT NULL, symbol TEXT NOT NULL, value_toman REAL NOT NULL, complete INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(trading_date,symbol))")
        conn.commit()


def _record_history(path, contracts, source_at):
    _init_history(path)
    try:
        stamp = datetime.fromisoformat(source_at.replace("Z", "+00:00"))
        # TSETMC's persisted end-of-session snapshot is around 12:30 Tehran.
        # Use the source timezone instead of comparing UTC hours; 12:30+03:30
        # is 09:00 UTC and must still count as a completed trading session.
        local = stamp
        complete = int((local.hour, local.minute) >= (12, 30))
        day = stamp.date().isoformat()
    except (AttributeError, ValueError):
        return
    with sqlite3.connect(path) as conn:
        conn.executemany("INSERT INTO option_daily_values VALUES (?,?,?,?,?) ON CONFLICT(trading_date,symbol) DO UPDATE SET value_toman=excluded.value_toman,complete=excluded.complete,updated_at=excluded.updated_at", [(day, c["symbol"], float(c.get("trade_value_toman") or 0), complete, source_at) for c in contracts])
        conn.commit()


def export_from_scores_db(scores_db, output_path, now=None):
    """Read latest persisted TSETMC raw snapshot, persist history, and export JSON."""
    now = now or datetime.now(timezone.utc)
    history_db = Path(os.environ.get("OPTIONS_HISTORY_DB", str(Path(output_path).with_name("options_history.sqlite"))) )
    try:
        with sqlite3.connect(f"file:{Path(scores_db).resolve()}?mode=ro", uri=True) as conn:
            conn.row_factory = sqlite3.Row
            raw = conn.execute("SELECT * FROM raw_tse_snapshots ORDER BY timestamp DESC LIMIT 1").fetchone()
            if raw is None: payload = _empty("unavailable", "اسنپ‌شات خام بازار موجود نیست.", now, None)
            else:
                stock_rows = load_marketwatch(raw["stocks_path"])
                latest = conn.execute("SELECT symbol,last_price,score FROM stock_snapshots WHERE timestamp=? AND valid=1 ORDER BY score DESC", (raw["timestamp"],)).fetchall()
                leaders = {r["symbol"]: {"last_price": r["last_price"], "leader_rank": i + 1} for i, r in enumerate(latest[:10])}
                contracts = []
                leaders = {symbol: {"last_price": None, "leader_rank": rank, "quote_timestamp": raw["timestamp"]} for rank, symbol in enumerate(_load_leaders(), 1) if rank <= 40}
                for r in latest:
                    if r["symbol"] in leaders:
                        leaders[r["symbol"]].update(last_price=float(r["last_price"] or 0) / 10, quote_timestamp=raw["timestamp"])
                depth_by_code = {}
                for item in load_marketwatch(raw["depth_path"]):
                    fields = str(item).split(',')
                    if len(fields) >= 8 and fields[0] not in depth_by_code and fields[1] == "1":
                        depth_by_code[fields[0]] = fields
                for item in stock_rows:
                    fields = str(item).split(',')
                    if len(fields) < 22 or not fields[2].startswith('ض'): continue
                    match = re.search(r"اختیارخ\s+(.+?)-(\d+)-(\d{4}/\d{1,2}/\d{1,2})$", fields[3].replace('ي', 'ی').replace('ك', 'ک'))
                    if not match or match.group(1) not in leaders: continue
                    depth = depth_by_code.get(fields[0], [])
                    if len(depth) < 8: continue
                    contracts.append({"symbol": fields[2], "underlying": match.group(1), "expiry": match.group(3), "strike": float(match.group(2)) / 10, "ask": float(depth[4] or 0) / 10, "bid": float(depth[5] or 0) / 10, "trade_value_toman": float(fields[10] or 0) / 10, "quote_timestamp": raw["timestamp"]})
                _record_history(history_db, contracts, raw["timestamp"])
                # Ordinary-stock v2_days fences do not prove option-session completion.
                # Never manufacture option history from capture time alone.
                payload = build_snapshot(history_db, contracts, leaders, now)
                payload["source_at"] = raw["timestamp"]
    except (OSError, sqlite3.Error, ValueError, KeyError, IndexError, TypeError) as exc:
        payload = _empty("unavailable", f"داده اختیار در دسترس نیست: {type(exc).__name__}.", now, None)
    atomic_export(output_path, payload)
    return payload

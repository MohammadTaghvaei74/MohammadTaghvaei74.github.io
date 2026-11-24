"""Fail-closed Bull Call Spread snapshot producer for the public market feed."""
from __future__ import annotations

import ast
import gzip
import math
from zoneinfo import ZoneInfo
import json
import os
import re
import sqlite3
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 1
CHAIN_SCHEMA_VERSION = 1
MAX_QUOTE_AGE = 120
MIN_TODAY_VALUE = 15_000_000_000


def _option_type(symbol: Any) -> str | None:
    """Return the Iranian option family without guessing unknown prefixes."""
    prefix = str(symbol or "")[:1]
    if prefix == "ض":
        return "call"
    if prefix == "ط":
        return "put"
    return None


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


def build_chain_snapshot(contracts: Iterable[dict], underlyings: dict[str, dict], now: datetime) -> dict:
    """Build the strategy-independent watch/chain feed.

    This deliberately keeps every parsed contract, including incomplete or
    stale quotes.  The UI can explain why a row is not executable, while the
    strategy feed remains a separate consumer of this contract.
    """
    now = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    raw = list(contracts)
    normalized: list[dict] = []
    diagnostics: dict[str, int] = {}
    for item in raw:
        symbol = str(item.get("symbol") or "")
        kind = item.get("option_type") or _option_type(symbol)
        if kind not in {"call", "put"}:
            diagnostics["نوع قرارداد ناشناخته"] = diagnostics.get("نوع قرارداد ناشناخته", 0) + 1
            continue
        underlying = str(item.get("underlying") or "")
        expiry = str(item.get("expiry") or "")
        quote_at = _iso(item.get("quote_timestamp") or item.get("quote_at"))
        try:
            strike = float(item.get("strike"))
        except (TypeError, ValueError):
            strike = None
        u = underlyings.get(underlying, {})
        reasons: list[str] = []
        if not symbol or not underlying or not expiry or strike is None or strike <= 0:
            reasons.append("هویت قرارداد ناقص است")
        if not _fresh(quote_at, now):
            reasons.append("قیمت سرخط قدیمی یا نامعتبر است")
        try:
            bid = float(item.get("bid")) if item.get("bid") is not None else None
            ask = float(item.get("ask")) if item.get("ask") is not None else None
        except (TypeError, ValueError):
            bid = ask = None
        if bid is None or ask is None or bid <= 0 or ask <= 0:
            reasons.append("Bid/Ask معتبر نیست")
        if bid is not None and ask is not None and ask < bid:
            reasons.append("ترتیب Bid/Ask نامعتبر است")
        dte = _dte(expiry, now)
        normalized.append({
            "symbol": symbol,
            "underlying": underlying,
            "option_type": kind,
            "expiry": expiry,
            "dte": dte,
            "strike_toman": strike,
            "last_toman": item.get("last"),
            "close_toman": item.get("close"),
            "bid_toman": bid,
            "ask_toman": ask,
            "bid_volume": item.get("bid_volume"),
            "ask_volume": item.get("ask_volume"),
            "trade_volume": item.get("trade_volume"),
            "trade_value_toman": item.get("trade_value_toman"),
            "open_interest": item.get("open_interest"),
            "multiplier": item.get("multiplier"),
            "quote_at": quote_at,
            "data_quality": {
                "quote": "fresh" if "قیمت سرخط قدیمی یا نامعتبر است" not in reasons else "stale",
                "bid_ask": "valid" if not any("Bid/Ask" in r or "ترتیب" in r for r in reasons) else "invalid",
                "underlying": "fresh" if _fresh(u.get("quote_timestamp"), now) else "stale",
                "usable_for_analysis": not reasons,
                "reasons": reasons,
            },
        })
        for reason in reasons:
            diagnostics[reason] = diagnostics.get(reason, 0) + 1

    by_chain: dict[tuple[str, str], list[dict]] = {}
    for row in normalized:
        by_chain.setdefault((row["underlying"], row["expiry"]), []).append(row)
    chains = []
    for (underlying, expiry), rows in sorted(by_chain.items()):
        u = underlyings.get(underlying, {})
        calls = {r["strike_toman"]: r for r in rows if r["option_type"] == "call"}
        puts = {r["strike_toman"]: r for r in rows if r["option_type"] == "put"}
        strikes = sorted(set(calls) | set(puts))
        chain_rows = []
        for strike in strikes:
            call = calls.get(strike)
            put = puts.get(strike)
            underlying_price = float(u["last_price"]) if u.get("last_price") else None
            is_atm = bool(underlying_price and abs(strike - underlying_price) / underlying_price <= 0.02)
            chain_rows.append({
                "strike_toman": strike,
                "moneyness": "atm" if is_atm else None,
                "call_moneyness": "atm" if is_atm else ("itm" if underlying_price and strike < underlying_price else "otm"),
                "put_moneyness": "atm" if is_atm else ("itm" if underlying_price and strike > underlying_price else "otm"),
                "call": call,
                "put": put,
            })
        chains.append({
            "underlying": underlying,
            "expiry": expiry,
            "dte": _dte(expiry, now),
            "underlying_last_toman": u.get("last_price"),
            "underlying_close_toman": u.get("close_price"),
            "underlying_quote_at": _iso(u.get("quote_timestamp")),
            "calls_count": len(calls),
            "puts_count": len(puts),
            "rows": chain_rows,
        })

    underlyings_out = []
    for symbol in sorted({r["underlying"] for r in normalized}):
        rows = [r for r in normalized if r["underlying"] == symbol]
        expiries = sorted({r["expiry"] for r in rows})
        u = underlyings.get(symbol, {})
        underlyings_out.append({
            "symbol": symbol,
            "last_toman": u.get("last_price"),
            "close_toman": u.get("close_price"),
            "quote_at": _iso(u.get("quote_timestamp")),
            "contract_count": len(rows),
            "call_count": sum(r["option_type"] == "call" for r in rows),
            "put_count": sum(r["option_type"] == "put" for r in rows),
            "expiries": expiries,
        })
    source_at = max((r["quote_at"] for r in normalized if r.get("quote_at")), default=None)
    fresh = bool(source_at and _fresh(source_at, now))
    status = "ready" if normalized and fresh else ("stale" if normalized else "unavailable")
    return {
        "schema_version": CHAIN_SCHEMA_VERSION,
        "kind": "options_chain",
        "generated_at": now.isoformat(),
        "source_at": source_at,
        "source": "TSETMC",
        "status": status,
        "message": "زنجیره آپشن آماده است." if status == "ready" else ("آخرین زنجیره برای بررسی نمایش داده می‌شود؛ قیمت‌ها مبنای ورود نیستند." if status == "stale" else "داده زنجیره آپشن در دسترس نیست."),
        "counts": {
            "contracts": len(normalized),
            "underlyings": len(underlyings_out),
            "chains": len(chains),
            "calls": sum(r["option_type"] == "call" for r in normalized),
            "puts": sum(r["option_type"] == "put" for r in normalized),
            "fresh_contracts": sum(r["data_quality"]["quote"] == "fresh" for r in normalized),
        },
        "underlyings": underlyings_out,
        "chains": chains,
        "contracts": normalized,
        "diagnostics": [{"label": key, "count": value} for key, value in sorted(diagnostics.items())],
        "monetary_unit_note": "قیمت‌ها و ارزش‌ها بر حسب تومان هستند؛ مقادیر ناموجود null هستند.",
        "freshness_note": "داده قدیمی برای مشاهده حفظ می‌شود اما مبنای ورود یا سیگنال نیست.",
    }


def _history(db_path: os.PathLike[str] | str, symbol: str, before: str):
    try:
        with sqlite3.connect(f"file:{Path(db_path).resolve()}?mode=ro", uri=True) as c:
            cols = {r[1] for r in c.execute("pragma table_info(option_daily_values)")}
            if not {"trading_date", "symbol", "value_toman", "complete"} <= cols: return None, 0
            # Legacy complete flags were inferred from capture time, not verified.
            if "completion_source" not in cols: return None, 0
            complete = " AND complete=1 AND completion_source='tsetmc_verified_daily_final'"
            rows = c.execute("SELECT trading_date,value_toman FROM option_daily_values WHERE symbol=? AND trading_date<?" + complete + " GROUP BY trading_date ORDER BY trading_date DESC", (symbol, before)).fetchall()
        if len(rows) < 7: return None, len(rows)
        values = [float(r[1]) for r in rows[:7]]
        return sum(values) / 7.0, 7
    except (OSError, sqlite3.Error): return None, 0


def build_snapshot(history_db, contracts: Iterable[dict], underlyings: dict[str, dict], now: datetime) -> dict:
    now = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    raw = list(contracts)
    if not raw: return _empty("unavailable", "قرارداد اختیار موجود نیست.", now, None)
    source_at = max((_iso(c.get("quote_timestamp")) for c in raw if c.get("quote_timestamp")), default=None)
    out_contracts, diagnostic_counts = [], {}
    enriched = []
    for c in raw:
        u = underlyings.get(c.get("underlying"), {})
        try:
            today_value = float(c.get("trade_value_toman"))
            if not math.isfinite(today_value) or today_value < 0: today_value = None
        except (TypeError, ValueError):
            today_value = None
        reasons = []
        if today_value is None or today_value <= MIN_TODAY_VALUE: reasons.append("ارزش معاملات امروز کافی نیست")
        try:
            stamp = datetime.fromisoformat(str(c.get("quote_timestamp")).replace("Z", "+00:00"))
            same_day = stamp.tzinfo is not None and stamp.astimezone(ZoneInfo("Asia/Tehran")).date() == now.astimezone(ZoneInfo("Asia/Tehran")).date()
        except (ValueError, TypeError): same_day = False
        if not same_day: reasons.append("ارزش معاملات مربوط به امروز نیست")
        if not _fresh(c.get("quote_timestamp"), now): reasons.append("قیمت سرخط قدیمی یا نامعتبر است")
        if u.get("quote_timestamp") is not None and not _fresh(u.get("quote_timestamp"), now): reasons.append("قیمت پایه قدیمی یا نامعتبر است")
        if float(c.get("ask") or 0) <= 0 or float(c.get("bid") or 0) <= 0: reasons.append("Bid/Ask معتبر نیست")
        row = {"symbol": c.get("symbol"), "underlying": c.get("underlying"), "leader_rank": u.get("leader_rank"), "expiry": c.get("expiry"), "dte": _dte(c.get("expiry"), now), "strike_toman": c.get("strike"), "ask_toman": c.get("ask"), "bid_toman": c.get("bid"), "trade_value_toman": c.get("trade_value_toman"), "today_value_toman": today_value, "avg7d_toman": None, "history_days": 0, "quote_at": _iso(c.get("quote_timestamp")), "reasons": reasons}
        out_contracts.append(row); enriched.append((c, u, today_value, 0, reasons))
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
            pairs.append({"underlying": a.get("underlying"), "leader_rank": ua.get("leader_rank"), "underlying_price_toman": s, "expiry": a.get("expiry"), "dte": dte, "long_symbol": a.get("symbol"), "short_symbol": b.get("symbol"), "k1_toman": k1, "k2_toman": k2, "ask_toman": ask, "bid_toman": bid, "gross_debit_toman": gross, "fees_toman": fees, "net_debit_toman": net, "max_loss_toman": net, "max_profit_toman": profit, "break_even_toman": k1+net, "total_return_pct": profit/net*100 if net else None, "monthly_return_pct": monthly*100 if monthly >= 0 else None, "long_today_value_toman": aa, "short_today_value_toman": ab, "long_avg7d_toman": None, "short_avg7d_toman": None, "long_history_days": 0, "short_history_days": 0, "eligible": eligible, "reasons": reasons, "quote_at": _iso(a.get("quote_timestamp"))})
    for p in pairs:
        for reason in p["reasons"]: diagnostic_counts[reason] = diagnostic_counts.get(reason, 0) + 1
    diagnostics = [{"label": k, "count": v} for k, v in sorted(diagnostic_counts.items())]
    eligible = [p for p in pairs if p["eligible"]]
    has_stale_quote = any("قدیمی" in r for c in out_contracts for r in c["reasons"])
    status = "ready" if eligible else ("stale" if has_stale_quote else ("insufficient_data" if not raw or any("تاریخچه" in r for c in out_contracts for r in c["reasons"]) else "no_opportunity"))
    message = "اسنپ‌شات واقعی Bull Call Spread آماده است." if eligible else ("داده آپشن قدیمی است؛ جفتی صادر نمی‌شود." if status == "stale" else ("داده کافی برای بررسی جفت‌ها وجود ندارد." if status == "insufficient_data" else "جفت واجد شرایطی یافت نشد؛ فیلترها تسهیل نشده‌اند."))
    return {"schema_version": 1, "strategy": "bull_call_spread", "liquidity_basis": "today_trade_value", "liquidity_threshold_toman": MIN_TODAY_VALUE, "generated_at": now.isoformat(), "source_at": source_at, "source": "TSETMC", "status": status, "message": message, "counts": {"contracts": len(out_contracts), "pairs": len(pairs), "eligible_pairs": len(eligible)}, "pairs": pairs, "contracts": out_contracts, "diagnostics": diagnostics, "risk": _risk_payload()}


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
        # Persist provisional observations only; no verified finalization source yet.
        local = stamp
        complete = 0  # Capture time alone never proves option-session completion.
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
            if raw is None:
                payload = _empty("unavailable", "اسنپ‌شات خام بازار موجود نیست.", now, None)
                chain_payload = build_chain_snapshot([], {}, now)
            else:
                stock_rows = load_marketwatch(raw["stocks_path"])
                latest = conn.execute("SELECT symbol,last_price,score FROM stock_snapshots WHERE timestamp=? AND valid=1 ORDER BY score DESC", (raw["timestamp"],)).fetchall()
                # The chain/watch universe is all valid stock and fund bases
                # present in the same market snapshot.  Strategy feeds may use
                # a narrower universe later; the chain must not.
                all_underlyings = {
                    r["symbol"]: {
                        "last_price": float(r["last_price"] or 0) / 10,
                        "close_price": None,
                        "leader_rank": i + 1,
                        "quote_timestamp": raw["timestamp"],
                    }
                    for i, r in enumerate(latest)
                    if r["symbol"]
                }
                contracts = []
                leader_order = _load_leaders()
                leader_rank_by_symbol = {symbol: rank for rank, symbol in enumerate(leader_order, 1) if rank <= 40}
                strategy_underlyings = {
                    symbol: {**all_underlyings[symbol], "leader_rank": rank}
                    for symbol, rank in leader_rank_by_symbol.items()
                    if symbol in all_underlyings
                }
                depth_by_code = {}
                for item in load_marketwatch(raw["depth_path"]):
                    fields = str(item).split(',')
                    if len(fields) >= 8 and fields[0] not in depth_by_code and fields[1] == "1":
                        depth_by_code[fields[0]] = fields
                for item in stock_rows:
                    fields = str(item).split(',')
                    if len(fields) < 22 or fields[2][:1] not in {'ض', 'ط'}: continue
                    match = re.search(r"اختیار[خف]\s+(.+?)-(\d+)-(\d{4}/\d{1,2}/\d{1,2})$", fields[3].replace('ي', 'ی').replace('ك', 'ک'))
                    if not match or match.group(1) not in all_underlyings: continue
                    depth = depth_by_code.get(fields[0], [])
                    if len(depth) < 8: continue
                    contracts.append({
                        "symbol": fields[2],
                        "underlying": match.group(1),
                        "option_type": _option_type(fields[2]),
                        "expiry": match.group(3),
                        "strike": float(match.group(2)) / 10,
                        "last": float(fields[7] or 0) / 10,
                        "close": float(fields[8] or 0) / 10,
                        "trade_volume": float(fields[9] or 0),
                        "ask": float(depth[4] or 0) / 10,
                        "bid": float(depth[5] or 0) / 10,
                        "ask_volume": float(depth[6] or 0),
                        "bid_volume": float(depth[7] or 0),
                        "trade_value_toman": float(fields[10] or 0) / 10,
                        "multiplier": float(fields[21] or 0),
                        "quote_timestamp": raw["timestamp"],
                    })
                # Current-day liquidity does not depend on the history database.
                # Ordinary-stock v2_days fences do not prove option-session completion.
                # Never manufacture option history from capture time alone.
                # Keep the existing strategy feed isolated from the new chain
                # feed.  Bull-call logic currently consumes call contracts.
                call_contracts = [c for c in contracts if c.get("option_type") == "call"]
                strategy_contracts = [c for c in call_contracts if c.get("underlying") in strategy_underlyings]
                payload = build_snapshot(history_db, strategy_contracts, strategy_underlyings, now)
                chain_payload = build_chain_snapshot(contracts, all_underlyings, now)
                payload["source_at"] = raw["timestamp"]
                chain_payload["source_at"] = raw["timestamp"]
    except (OSError, sqlite3.Error, ValueError, KeyError, IndexError, TypeError) as exc:
        payload = _empty("unavailable", f"داده اختیار در دسترس نیست: {type(exc).__name__}.", now, None)
        chain_payload = build_chain_snapshot([], {}, now)
    atomic_export(output_path, payload)
    chain_output = os.environ.get("OPTIONS_CHAIN_OUTPUT", str(Path(output_path).with_name("options-chain.json")))
    atomic_export(chain_output, chain_payload)
    return payload

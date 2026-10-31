"""Explain immutable evidence, not the presentation-only leader MA distance."""
import json
import math
import re
import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo

DIGITS = str.maketrans('0123456789.-', '۰۱۲۳۴۵۶۷۸۹٫−')
def fa(value):
    return str(value).translate(DIGITS)
def number(value):
    value = float(value)
    if not math.isfinite(value):
        raise ValueError('non-finite evidence')
    return fa(f'{value:.2f}')
def clock(value):
    return fa(datetime.fromisoformat(value).astimezone(ZoneInfo('Asia/Tehran')).strftime('%H:%M'))

def explain_signal(conn, key, timestamp, text):
    if key.startswith('leader:'):
        if conn is not None:
            try:
                row = conn.execute('SELECT payload FROM signal_trigger_evidence WHERE timestamp=? AND event_key=?', (timestamp, key)).fetchone()
                if row:
                    ev = json.loads(row[0]); thresholds = ev['thresholds']
                    basis = ev.get('basis', 'recorded')
                    if basis not in ('recorded','reconstructed'):
                        raise ValueError('unknown provenance')
                    delta = float(ev['trigger_score']) - float(ev['start_score'])
                    elapsed = (datetime.fromisoformat(ev['trigger_at']) - datetime.fromisoformat(ev['start_at'])).total_seconds()/60
                    detail = (f"امتیاز از {number(ev['start_score'])} در {clock(ev['start_at'])} به {number(ev['trigger_score'])} در {clock(ev['trigger_at'])} رسید؛ تغییر {number(delta)} واحد در {number(elapsed)} دقیقه. "
                              f"تأیید در {clock(ev['confirmed_at'])} با امتیاز {number(ev['confirmed_score'])}. "
                              f"شرط حرکت: حداقل {fa(thresholds['minimum_change'])} واحد؛ کارایی مسیر {number(float(ev['efficiency'])*100)}٪ (حداقل {fa(float(thresholds['minimum_efficiency'])*100)}٪)؛ حفظ حداقل {fa(float(thresholds['retained_fraction'])*100)}٪ حرکت در نمونهٔ بعدی، با فاصلهٔ ۳۰ تا {fa(thresholds['maximum_gap_seconds'])} ثانیه.")
                    if basis == 'reconstructed':
                        detail = 'بازسازی از اسنپ‌شات‌های ثبت‌شده با قواعد بررسی‌شدهٔ فعلی (نسخهٔ قواعد زمان صدور ثبت نشده): ' + detail
                    else:
                        detail = 'شاهد ثبت‌شده هنگام تشخیص: ' + detail
                    return {'basis': basis, 'text': detail}
            except (sqlite3.Error, ValueError, TypeError, KeyError, OverflowError):
                pass
        return {'basis': 'unavailable', 'text': 'جزئیات دقیق تغییر امتیاز، بازه و شرط صدور در پیام ثبت نشده است. فاصله از میانگین فقط زمینهٔ آماری است و علت صدور نیست.'}
    # Provider text is authoritative. Strip Telegram HTML, never interpret it.
    clean = re.sub(r'<[^>]+>', '', text)
    return {'basis': 'message', 'text': 'جزئیات ثبت‌شده در پیام (آستانه یا بازهٔ ذکرنشده قابل تأیید نیست):\n' + clean}

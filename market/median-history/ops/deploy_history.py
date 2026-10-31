"""Scoped additive release; assert exact source anchors, backup before change."""
from pathlib import Path
import shutil, subprocess, hashlib, difflib
ROOT=Path('/root/bourse-history-release'); ops=ROOT/'market/median-history/ops'; live=Path('/root/bourse-alert/minute_chart_collector.py')
before=live.read_text()
old='''    if not intraday or intraday[-1].get("timestamp") != point["timestamp"]:
        intraday.append(point)
'''
new='''    # Keep one actual observation per minute, never a 240 raw-event ring.
    # Duplicate collector processes historically evicted the opening hour.
    by_minute = {item["timestamp"][:16]: item for item in intraday}
    by_minute[point["timestamp"][:16]] = point
    intraday = [by_minute[key] for key in sorted(by_minute)]
'''
assert old in before
updated=before.replace(old,new)
old='''    atomic_json(LIVE_PATH, handoff)
'''
new='''    # Isolated bounded history is persisted before archival DB work can block.
    try:
        from median_history import connect as history_connect, ingest as history_ingest
        with history_connect("/root/bourse-alert/median_history.sqlite") as history_db:
            history_ingest(history_db, [handoff["intraday"][-1]], observed, "collector-direct-v1")
    except Exception:
        logging.exception("MEDIAN_HISTORY_WRITE_FAILED; live handoff retained")
    atomic_json(LIVE_PATH, handoff)
'''
assert old in updated
updated=updated.replace(old,new)
tail=updated.index('if "--once" in sys.argv:')
updated=updated[:tail]+'if __name__ == "__main__":\n'+''.join('    '+line if line.strip() else line for line in updated[tail:].splitlines(keepends=True))
backup=live.with_name(live.name+'.before-median-history-20261031')
assert not backup.exists(),'release already applied; inspect instead of overwriting'
shutil.copy2(live,backup)
(ops/'collector.patch').write_text(''.join(difflib.unified_diff(before.splitlines(True),updated.splitlines(True),fromfile='minute_chart_collector.py',tofile='minute_chart_collector.py')))
shutil.copy2(ops/'median_history.py','/root/bourse-alert/median_history.py')
live.write_text(updated)
subprocess.run(['/root/bourse-alert/venv/bin/python','-m','py_compile',str(live),'/root/bourse-alert/median_history.py'],check=True)
# This exact orphan is the prior import-only QA process; never match by broad name.
proc=Path('/proc/1373663/cmdline')
if proc.exists():
 assert b'python3.12\x00-\x00' in proc.read_bytes()
 assert Path('/proc/1373661/task/1373661/children').read_text().strip()=='1373663'
 subprocess.run(['kill','-TERM','1373661','1373663'],check=True)
subprocess.run(['systemctl','restart','bourse-chart-collector.service'],check=True)
print('collector deployed; original SHA256',hashlib.sha256(before.encode()).hexdigest())

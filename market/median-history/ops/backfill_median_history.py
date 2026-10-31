"""Import only exact independently logged collector observations.
Never infer historical membership from today's leader list. Join contemporaneous
market and leader group aggregates, requiring exact matching medians/counts.
Conservative eligibility fence: current collector implementation since Oct27.
"""
import sqlite3, subprocess, re
from datetime import datetime
from median_history import connect,ingest,TZ

def main():
    log=subprocess.check_output(['journalctl','-u','bourse-chart-collector.service','--since','2026-10-27 00:00:00','--no-pager','-o','cat'],text=True)
    stamps=sorted(set(re.findall(r'LIVE_SNAPSHOT_SAVED observed=(\S+)',log)))
    src=sqlite3.connect('file:/root/bourse-alert/scores_history.db?mode=ro',uri=True)
    points=[]; rejected=0
    for ts in stamps:
        row=src.execute('SELECT m.median,m.count,l.median,l.count,g.median,g.count FROM market_snapshots m JOIN group_snapshots l ON l.timestamp=m.timestamp AND l.group_name=? JOIN group_snapshots g ON g.timestamp=m.timestamp AND g.group_name=? WHERE m.timestamp=?',('لیدرها','کل بازار',ts)).fetchone()
        if not row or row[0]!=row[4] or row[1]!=row[5]: rejected+=1; continue
        points.append(dict(timestamp=ts,median_score=row[0],market_score_count=row[1],leader_median_score=row[2],leader_score_count=row[3]))
    with connect('/root/bourse-alert/median_history.sqlite') as c: ingest(c,points,datetime.now(TZ),'journal-verified-collector+exact-group-snapshot')
    print({'logged_collector_timestamps':len(stamps),'matching_aggregates':len(points),'rejected':rejected})
if __name__=='__main__': main()

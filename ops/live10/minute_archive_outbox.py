"""Durable real-observation outbox; archive contention never blocks acquisition.

Only the minute collector enqueues. Retries preserve provider observation time;
no generated points/backfill. Writer must be idempotent (INSERT OR REPLACE).
"""
import json
import logging
import sqlite3
import threading
from contextlib import closing
from datetime import datetime


class Outbox:
    def __init__(self, path, writer):
        self.path = str(path)
        self.writer = writer
        self.wake = threading.Event()
        with closing(sqlite3.connect(self.path, timeout=2)) as db, db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS pending (stamp TEXT PRIMARY KEY, payload TEXT NOT NULL)')

    def enqueue(self, rows, observed):
        # Serialize before returning; later enrichment cannot mutate the capture.
        payload = json.dumps(rows, ensure_ascii=False, separators=(',', ':'))
        with closing(sqlite3.connect(self.path, timeout=2)) as db, db:
            db.execute('INSERT OR IGNORE INTO pending VALUES (?,?)', (observed.isoformat(), payload))
        self.wake.set()

    def pending(self):
        with closing(sqlite3.connect(self.path, timeout=2)) as db:
            return db.execute('SELECT COUNT(*) FROM pending').fetchone()[0]

    def drain_once(self):
        with closing(sqlite3.connect(self.path, timeout=2)) as db:
            item = db.execute('SELECT stamp,payload FROM pending ORDER BY stamp LIMIT 1').fetchone()
        if item is None:
            return False
        try:
            self.writer(json.loads(item[1]), datetime.fromisoformat(item[0]))
        except sqlite3.OperationalError as exc:
            if 'locked' not in str(exc).lower() and 'busy' not in str(exc).lower():
                raise
            logging.warning('MINUTE_ARCHIVE_RETRY observed=%s reason=%s', item[0], exc)
            return False
        with closing(sqlite3.connect(self.path, timeout=2)) as db, db:
            db.execute('DELETE FROM pending WHERE stamp=?', (item[0],))
        logging.info('MINUTE_ARCHIVE_COMMITTED observed=%s pending=%d', item[0], self.pending())
        return True

    def run(self):
        while True:
            try:
                if self.drain_once():
                    continue
            except Exception:
                logging.exception('MINUTE_ARCHIVE_FAILED; durable observation retained')
            self.wake.wait(1)
            self.wake.clear()

    def start(self):
        thread = threading.Thread(target=self.run, name='minute-archive', daemon=True)
        thread.start()
        return thread

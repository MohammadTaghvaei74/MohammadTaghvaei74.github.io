import importlib.util
import json
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'deploy/canonical_data_publisher.py'
spec = importlib.util.spec_from_file_location('publisher', SCRIPT)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def median(stamp, points=None, coverage=None):
    return json.dumps({'schema_version': 2, 'generated_at': stamp,
                       'points': points if points is not None else [{'minute': '09:15', 'market': 1.2}],
                       'coverage': coverage if coverage is not None else [{'date': '2026-11-02', 'observed_minutes': 1}]}).encode()


class MedianFreshnessTest(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 2, 10, 0, tzinfo=timezone.utc)

    def test_rejects_empty_points_and_coverage(self):
        for raw in (median(self.now.isoformat(), [], [{'date': 'x'}]), median(self.now.isoformat(), [{'minute': 'x'}], [])):
            with self.assertRaises(ValueError):
                publisher.convert_median_history(raw, now=self.now)

    def test_rejects_stale_source(self):
        with self.assertRaisesRegex(ValueError, 'stale'):
            publisher.convert_median_history(median((self.now - timedelta(minutes=16)).isoformat()), now=self.now)

    def test_rejects_source_older_than_public_artifact(self):
        old = median((self.now - timedelta(minutes=1)).isoformat())
        newer = median(self.now.isoformat())
        with self.assertRaisesRegex(ValueError, 'regression'):
            publisher.convert_median_history(old, previous=newer, now=self.now)

    def test_preserves_partial_coverage_without_interpolation(self):
        result = publisher.convert_median_history(median(self.now.isoformat()), now=self.now)
        self.assertEqual(result['coverage'][0]['observed_minutes'], 1)
        self.assertEqual(len(result['points']), 1)


if __name__ == '__main__':
    unittest.main()

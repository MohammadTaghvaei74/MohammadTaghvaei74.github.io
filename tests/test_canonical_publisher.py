"""Real Git integration tests; all repositories/data are temporary fixtures."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'deploy/canonical_data_publisher.py'
if not SCRIPT.exists():
    SCRIPT = Path(__file__).with_name('canonical_data_publisher.py')


def git(repo, *args, data=None):
    return subprocess.check_output(['git', '-C', str(repo), *args], input=data).decode().strip()


def payload(stamp='2026-11-01T12:29:01+03:30', key='stocks'):
    return json.dumps({'schema_version': 2, 'generated_at': stamp,
                       key: [{'symbol': 'TEST', 'timestamp': stamp, 'score': 1}]}).encode()


class PublisherTest(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.exists(), 'isolated canonical publisher must exist')
        spec = importlib.util.spec_from_file_location('publisher', SCRIPT)
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.remote, self.repo, self.source = [base / x for x in ('remote.git', 'repo', 'source')]
        self.source.mkdir()
        subprocess.run(['git', 'init', '--bare', '-q', str(self.remote)], check=True)
        subprocess.run(['git', 'init', '-q', '-b', 'main', str(self.repo)], check=True)
        git(self.repo, 'config', 'user.email', 'test@example.invalid')
        git(self.repo, 'config', 'user.name', 'Test')
        git(self.repo, 'remote', 'add', 'origin', str(self.remote))
        (self.repo / 'market/data').mkdir(parents=True)
        for name, key in [('market.json', 'stocks'), ('comprehensive.json', 'rows')]:
            (self.repo / 'market/data' / name).write_bytes(payload('2026-10-31T12:29:01+03:30', key))
            (self.source / name).write_bytes(payload(key=key))
        (self.repo / 'frontend.js').write_text('original frontend')
        git(self.repo, 'add', '.')
        git(self.repo, 'commit', '-qm', 'fixture')
        git(self.repo, 'push', '-q', 'origin', 'main')

    def test_data_only_publish_preserves_unmerged_index_and_worktree(self):
        blob = git(self.repo, 'hash-object', '-w', '--stdin', data=b'conflict')
        git(self.repo, 'update-index', '--index-info', data=(f'100644 {blob} 1\tconflict.txt\n100644 {blob} 2\tconflict.txt\n100644 {blob} 3\tconflict.txt\n').encode())
        (self.repo / 'conflict.txt').write_bytes(b'untouched conflict')
        (self.repo / 'frontend.js').write_bytes(b'unrelated user work')
        index = (self.repo / '.git/index').read_bytes()
        old_head = git(self.repo, 'rev-parse', 'HEAD')
        commit = self.mod.publish(self.repo, self.source)
        self.assertEqual(index, (self.repo / '.git/index').read_bytes())
        self.assertEqual(old_head, git(self.repo, 'rev-parse', 'HEAD'))
        self.assertEqual((self.repo / 'frontend.js').read_bytes(), b'unrelated user work')
        self.assertEqual((self.repo / 'conflict.txt').read_bytes(), b'untouched conflict')
        self.assertEqual(git(self.remote, 'rev-parse', 'main'), commit)
        changed = git(self.remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', commit).splitlines()
        self.assertEqual(set(changed), {'market/data/market.json', 'market/data/comprehensive.json'})
        for name in ('market.json', 'comprehensive.json'):
            actual = subprocess.check_output(['git', '-C', str(self.remote), 'show', f'main:market/data/{name}'])
            self.assertEqual(actual, (self.source / name).read_bytes())
        self.assertIsNone(self.mod.publish(self.repo, self.source))

    def test_rejects_invalid_or_regressing_core_without_push(self):
        original = (self.source / 'market.json').read_bytes()
        before = git(self.remote, 'rev-parse', 'main')
        bad = [b'{', b'{}', b'{"generated_at":"replay:2026-10-13","stocks":[{}]}',
               payload('2026-10-30T12:29:01+03:30'),
               payload('2099-11-01T12:29:01+03:30'),
               payload('2026-11-01T12:29:01'),
               json.dumps({'generated_at':'2026-11-01T12:29:01+03:30','stocks':[]}).encode(),
               original.replace(b'"score": 1', b'"score": NaN'),
               original.replace(b'"score": 1', b'"score": 1, "score": 2'),
               original.replace(b'TEST', b'DIFFERENT')]
        for raw in bad:
            with self.subTest(raw=raw):
                (self.source / 'market.json').write_bytes(raw)
                with self.assertRaises(ValueError):
                    self.mod.publish(self.repo, self.source)
                self.assertEqual(before, git(self.remote, 'rev-parse', 'main'))
        (self.source / 'market.json').write_bytes(original)

    def test_optional_feeds_monotonic_and_unknown_files_excluded(self):
        old = '2026-10-31T12:29:01+03:30'
        newer = '2026-11-01T12:29:01+03:30'
        (self.repo / 'market/data/options.json').write_bytes(payload(newer, 'contracts'))
        (self.repo / 'market/data/funds.json').write_bytes(payload(old, 'rows'))
        git(self.repo, 'add', '.')
        git(self.repo, 'commit', '-qm', 'optional fixture')
        git(self.repo, 'push', '-q', 'origin', 'main')
        (self.source / 'options.json').write_bytes(payload(old, 'contracts'))
        (self.source / 'funds.json').write_bytes(payload(newer, 'rows'))
        (self.source / 'signals.json').write_bytes(b'{}')
        self.mod.publish(self.repo, self.source)
        self.assertEqual(git(self.remote, 'show', 'main:market/data/options.json'), payload(newer, 'contracts').decode())
        self.assertEqual(git(self.remote, 'show', 'main:market/data/funds.json'), payload(newer, 'rows').decode())
        self.assertNotIn('signals.json', git(self.remote, 'ls-tree', '-r', '--name-only', 'main'))

    def test_concurrent_push_rebases_tree_preserving_frontend(self):
        from unittest.mock import patch
        real_run = self.mod.run
        pushes = []
        def race(repo, *args, **kwargs):
            if args[0] == 'push':
                pushes.append(1)
                if len(pushes) == 1:
                    (self.repo / 'frontend.js').write_text('concurrent frontend release')
                    git(self.repo, 'add', 'frontend.js')
                    git(self.repo, 'commit', '-qm', 'concurrent release')
                    git(self.repo, 'push', '-q', 'origin', 'main')
            return real_run(repo, *args, **kwargs)
        with patch.object(self.mod, 'run', side_effect=race):
            self.mod.publish(self.repo, self.source)
        self.assertEqual(len(pushes), 2)
        self.assertEqual(git(self.remote, 'show', 'main:frontend.js'), 'concurrent frontend release')

    def test_non_fast_forward_retry_is_bounded(self):
        from unittest.mock import patch
        real_run = self.mod.run
        pushes = []
        def race(repo, *args, **kwargs):
            if args[0] == 'push':
                pushes.append(1)
                git(self.repo, 'commit', '--allow-empty', '-qm', str(len(pushes)))
                git(self.repo, 'push', '-q', 'origin', 'main')
            return real_run(repo, *args, **kwargs)
        with patch.object(self.mod, 'run', side_effect=race):
            with self.assertRaises(RuntimeError):
                self.mod.publish(self.repo, self.source)
        self.assertEqual(len(pushes), 3)

    def test_auth_failure_is_not_retried(self):
        from unittest.mock import patch
        real_run = self.mod.run
        pushes = []
        def reject(repo, *args, **kwargs):
            if args[0] == 'push':
                pushes.append(1)
                return subprocess.CompletedProcess(args, 128, b'', b'Permission denied (publickey).')
            return real_run(repo, *args, **kwargs)
        with patch.object(self.mod, 'run', side_effect=reject):
            with self.assertRaises(RuntimeError):
                self.mod.publish(self.repo, self.source)
        self.assertEqual(len(pushes), 1)


if __name__ == '__main__':
    unittest.main()

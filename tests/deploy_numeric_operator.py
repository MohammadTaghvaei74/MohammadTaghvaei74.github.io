"""Apply only reviewed numeric-operator line edits; default is read-only preflight.
Run on VPS under publisher flock with payload JSON as argv[1], --apply to deploy.
Backs up original bytes, validates every target before writes, replaces atomically.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import time

payload = json.loads(Path(sys.argv[1]).read_text())
plans = []
for root in ['/root/bourse-site', '/srv/sorena']:
    for relative, edits in payload.get(root, payload).items():
        path = Path(root) / relative
        original = path.read_bytes()
        text = original.decode('utf-8')
        for old, new in edits:
            # Match line endings independently; preserve the server file's convention.
            if '\r\n' in text:
                old, new = old.replace('\n', '\r\n'), new.replace('\n', '\r\n')
            if text.count(old) != 1:
                raise RuntimeError(f'Expected one exact anchor in {path}: {old[:100]!r}; got {text.count(old)}')
            text = text.replace(old, new, 1)
        plans.append((path, original, text.encode('utf-8')))
        print('PREFLIGHT', path, hashlib.sha256(original).hexdigest(), '->', hashlib.sha256(text.encode('utf-8')).hexdigest())
if '--apply' in sys.argv:
    backup = Path('/root/numeric-operator-backup-' + str(int(time.time())))
    for path, original, updated in plans:
        assert path.read_bytes() == original, f'Concurrent update: {path}'
    for path, original, updated in plans:
        target = backup / str(path).lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        temp = path.with_name(path.name + '.numeric-operator-tmp')
        temp.write_bytes(updated)
        shutil.copystat(path, temp)
        os.replace(temp, path)
        assert path.read_bytes() == updated
        print('VERIFIED', path, hashlib.sha256(path.read_bytes()).hexdigest())
    print('BACKUP', backup)

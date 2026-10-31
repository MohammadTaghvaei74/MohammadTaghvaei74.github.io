"""Scoped VPS installation. Run from an extracted, reviewed release directory."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,sys
from datetime import datetime,timezone

stage=Path(sys.argv[1]).resolve()
backup=Path('/root/signal-explanations-backups')/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup.mkdir(parents=True)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def same_text(a,b):return a.read_text()==b.read_text()
checks=[('/root/bourse-site/market/export_signals.py','signal-evidence/export_signals.live.py'),('/root/bourse-alert/leader_signal.py','signal-evidence/leader_signal.py'),('/srv/sorena/market/signals/index.html','signal-evidence/index.live.html'),('/srv/sorena/market/signals/signals.js','signal-evidence/signals.live.js'),('/srv/sorena/market/signals/core.js','signal-evidence/core.live.js'),('/srv/sorena/market/signals/signals.css','signal-evidence/signals.live.css')]
for dst,baseline in checks:
    assert same_text(Path(dst),stage/baseline), 'Concurrent modification: '+dst
# Hash all tracked dirty files: verify unrelated edits survive installation.
repo='/root/bourse-site'
dirty=subprocess.check_output(['git','-C',repo,'diff','--name-only'],text=True).splitlines()
before={p:digest(Path(repo)/p) for p in dirty if (Path(repo)/p).is_file()}
(backup/'dirty-before.json').write_text(json.dumps(before,indent=2))
(backup/'status-before.txt').write_bytes(subprocess.check_output(['git','-C',repo,'status','--short']))
def install(dst,content):
    target=Path(dst)
    if target.exists():
        old=backup/dst.lstrip('/');old.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,old)
    target.parent.mkdir(parents=True,exist_ok=True)
    temp=target.with_name(target.name+'.signal-release.tmp');temp.write_bytes(content);temp.chmod(0o644);os.replace(temp,target)
    assert target.read_bytes()==content
    print('INSTALLED',dst,digest(target),flush=True)
# The source exporter had two pre-existing chmod fixes; both are retained.
assert 'target.chmod(0o644)' in (stage/'market/export_signals.py').read_text()
for rel,dst in [('market/signal_explanations.py','/root/bourse-site/market/signal_explanations.py'),('market/export_signals.py','/root/bourse-site/market/export_signals.py'),('deploy/leader_signal.py','/root/bourse-alert/leader_signal.py'),('deploy/replay_signal_evidence.py','/root/bourse-alert/replay_signal_evidence.py')]:
    compile((stage/rel).read_text(),rel,'exec')
    install(dst,(stage/rel).read_bytes())
for filename in ['core.js','signals.js','signals.css']:
    install('/srv/sorena/market/signals/'+filename,(stage/'market/signals'/filename).read_bytes())
# Preserve origin's existing nav, labels, options and all unrelated markup.
html=(stage/'signal-evidence/index.live.html').read_text()
html=html.replace('<th scope="col">ساعت تریگر</th>','<th scope="col">ساعت تریگر</th><th scope="col">توضیحات</th>').replace('colspan="3"','colspan="4"')
for name in ['core.js','signals.js','signals.css']:
    html=html.replace('"'+name+'"','"'+name+'?v=signal-explanations-1"')
html=html.replace('</head>','<script src="../observation-safety.js?v=1"></script></head>')
install('/srv/sorena/market/signals/index.html',html.encode())
safety=Path('/srv/sorena/market/observation-safety.js')
if not safety.exists():install(str(safety),(stage/'market/observation-safety.js').read_bytes())
for p,sha in before.items():
    if p!='market/export_signals.py':assert digest(Path(repo)/p)==sha, 'Unrelated dirty file changed: '+p
print('BACKUP',backup,flush=True)

from pathlib import Path
import hashlib,shutil,subprocess
app=Path('/root/bourse-alert'); release=Path('/root/bourse-live10-release/ops/live10'); stage=Path('/root/live10-remediation')
expected=hashlib.sha256((stage/'minute-before.py').read_bytes()).digest()
assert hashlib.sha256((app/'minute_chart_collector.py').read_bytes()).digest()==expected,'Concurrent collector change; abort'
backup=Path('/root/live10-backup/remediation');backup.mkdir(exist_ok=True)
shutil.copy2(app/'minute_chart_collector.py',backup/'minute_chart_collector.py')
for name in ['minute_chart_collector.py','minute_archive_outbox.py']:
 shutil.copy2(stage/name,app/(name+'.next')); (app/(name+'.next')).replace(app/name)
 shutil.copy2(stage/name,release/name)
for name in ['minute-before.py','test_minute_outbox.py','diagnose.py','deploy_remediation.py']:
 shutil.copy2(stage/name,release/name)
subprocess.run([str(app/'venv/bin/python'),'-m','py_compile',str(app/'minute_chart_collector.py'),str(app/'minute_archive_outbox.py')],check=True)
subprocess.run(['systemctl','restart','bourse-chart-collector.service'],check=True)
print(subprocess.check_output(['systemctl','show','bourse-chart-collector','bourse-fast-live','bourse-live-fast','-p','Id','-p','ActiveState','-p','MainPID','-p','UnitFileState'],text=True))

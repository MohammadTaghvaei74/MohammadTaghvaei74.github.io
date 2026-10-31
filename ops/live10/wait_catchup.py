import subprocess,time,shutil,json
from pathlib import Path
folder=Path('/root/live10-remediation')
for attempt in range(12):
 p=subprocess.run(['python3',str(folder/'verify_catchup.py')],capture_output=True,text=True)
 result=json.loads((folder/'catchup-verification.json').read_text())
 shutil.copy2(folder/'catchup-verification.json',folder/f'catchup-attempt-{attempt}.json')
 print(json.dumps({'attempt':attempt,'assertions':result['assertions'],'pending':result['pending'],'latest':result['committed'][-1:] }),flush=True)
 if p.returncode==0:break
 time.sleep(10)
else:raise SystemExit('Outbox did not drain within bounded observation; see exact pending timestamps')

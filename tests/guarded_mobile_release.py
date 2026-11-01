"""Release only after the exact candidate's cold mobile DOM gate passes.
Requires a read-only HTTP server over the isolated candidate checkout.
No personal browser profile is used. CI is additional monitoring, not a Pages deployment dependency.
"""
import argparse, subprocess, sys, shlex
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--candidate-url',required=True);p.add_argument('--browser');p.add_argument('--out',required=True);p.add_argument('--ssh-key',required=True);p.add_argument('--host',required=True);p.add_argument('--worktree',required=True);a=p.parse_args()
cmd=[sys.executable,str(Path(__file__).with_name('mobile_bootstrap_gate.py')),'--url',a.candidate_url,'--out',a.out]
if a.browser:cmd+=['--browser',a.browser]
subprocess.run(cmd,check=True)
subprocess.run(['ssh','-i',a.ssh_key,a.host,'git -C '+shlex.quote(a.worktree)+' diff --check && git -C '+shlex.quote(a.worktree)+' push origin HEAD:main'],check=True)

"""Scoped, idempotent HTML integration; never replaces dirty page contents.
Usage: python3 install_history_tab.py /path/to/repo-or-served-root [backup-dir]
Assets history-tab.js/css must already exist in ROOT/market.
"""
from pathlib import Path
import re, sys, shutil
root=Path(sys.argv[1]); backup=Path(sys.argv[2]) if len(sys.argv)>2 else None
routes=['index.html','symbols/index.html','industries/index.html','options/index.html','signals/index.html','portfolio/index.html','history/index.html']
for route in routes:
 p=root/'market'/route
 text=p.read_text(); original=text
 prefix='' if route=='index.html' else '../'
 if 'data-history-tab=' not in text:
  match=re.search(r'<nav\b[^>]*class="[^"]*main-nav[^>]*>.*?</nav>',text,re.S)
  assert match, f'Missing nav in {p}'
  nav=match.group().replace('</nav>',f'<a data-history-tab="true" href="{prefix}#history">تاریخچه</a></nav>')
  text=text[:match.start()]+nav+text[match.end():]
 if 'history-tab.css' not in text:
  text=text.replace('</head>',f'<link rel="stylesheet" href="{prefix}history-tab.css?v=1">\n</head>')
 if route=='index.html':
  text=re.sub(r'<a\b[^>]*class="median-history-entry"[^>]*>.*?</a>','',text,flags=re.S)
  if 'history-tab.js' not in text:
   text=text.replace('</body>','<script src="history-tab.js?v=1" defer></script>\n</body>')
 if text!=original:
  if backup:
   dest=backup/'market'/route;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest)
  temp=p.with_suffix('.html.history-tab-tmp');temp.write_text(text);shutil.copymode(p,temp);temp.replace(p)
  print(p)

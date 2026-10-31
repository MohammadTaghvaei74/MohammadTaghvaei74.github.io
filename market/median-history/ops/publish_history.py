from pathlib import Path
import shutil,subprocess
root=Path('/root/bourse-history-release'); page=root/'market/median-history'
for name in ['index.html','history.js','history.css']:
 shutil.copy2(page/name,Path('/srv/sorena/market/median-history')/name)
marker='<div class="chart-wrap"><svg id="marketChart"'
new='<a class="median-history-entry" href="median-history/" style="display:block;padding:10px 14px;color:#1763b5;font-weight:bold">تاریخچه ۳۰ روزه: کندل و خط ۱۰ دقیقه‌ای بازار و لیدرها ←</a>'+marker
for base in [root,Path('/root/bourse-site'),Path('/srv/sorena')]:
 p=base/'market/index.html';text=p.read_text()
 if 'class="median-history-entry"' not in text:
  assert text.count(marker)==1,str(p)
  if base!=root: shutil.copy2(p,p.with_name('index.html.before-median-history-20261031'))
  p.write_text(text.replace(marker,new))
for name in ['bourse-median-history.service','bourse-median-history.timer']:
 shutil.copy2(page/'ops'/name,Path('/etc/systemd/system')/name)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','bourse-median-history.timer'],check=True)
subprocess.run(['systemctl','start','bourse-median-history.service'],check=True)
print('Published dedicated history page and additive dashboard link; timer enabled')

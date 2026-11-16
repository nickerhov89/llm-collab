# Dated, first-run-only Polza VPS migration. Root required.
from pathlib import Path
import json,subprocess,shutil,os,socket
old='cowork.66.248.207.236.sslip.io';new='cowork.polza-portal.ru'
assert socket.gethostbyname(new)=='66.248.207.236'
folder=Path('/root/polza-domain-20261116');folder.mkdir(mode=0o700)
paths=[Path('/etc/caddy/Caddyfile'),Path('/etc/polza-team/config.json'),Path('/home/manager/.config/polza-media-browser.env'),Path('/home/manager/.config/systemd/user/yepanywhere.service.d/zzzz-polza-current-tunnel-host.conf'),Path('/home/manager/.config/systemd/user/polza-media-browser.service.d/zz-polza-current-origin.conf')]
paths += list(Path('/home/manager/.local/state/polza-media-browser/agents').glob('*.json'))
records=[]
for index,p in enumerate(paths):
 st=p.stat();backup=folder/(str(index)+'.backup');shutil.copy2(p,backup);backup.chmod(0o600);records.append({'path':str(p),'backup':str(backup),'uid':st.st_uid,'gid':st.st_gid,'mode':st.st_mode&0o777})
(folder/'manifest.json').write_text(json.dumps(records,indent=2));(folder/'manifest.json').chmod(0o600)
cmd=['runuser','-u','manager','--','env','XDG_RUNTIME_DIR=/run/user/1001','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus','systemctl','--user']
def userctl(*args):subprocess.run(cmd+list(args),cwd='/',check=True)
def restore():
 for r in records:
  p=Path(r['path']);shutil.copyfile(r['backup'],p);os.chmod(p,r['mode']);os.chown(p,r['uid'],r['gid'])
 userctl('daemon-reload');userctl('restart','yepanywhere','polza-media-browser');subprocess.run(['systemctl','restart','polza-team','caddy'],check=True)
p=paths[0];text=p.read_text();assert text.count(old+' {')==1
text=text.replace(old+' {',new+' {',1)+'\n'+old+' {\n redir https://'+new+'{uri} 308\n}\n'
stage=folder/'Caddyfile.next';stage.write_text(text)
subprocess.run(['caddy','fmt','--overwrite',str(stage)],check=True)
subprocess.run(['caddy','validate','--config',str(stage),'--adapter','caddyfile'],check=True,stdout=subprocess.DEVNULL)
try:
 p=paths[1];cfg=json.loads(p.read_text());assert cfg['realms']['owner']['host']==old;cfg['realms']['owner']['host']=new;p.write_text(json.dumps(cfg));p.chmod(0o640)
 p=paths[2];text=p.read_text();assert 'MEDIA_ORIGIN=https://'+old in text;p.write_text(text.replace('MEDIA_ORIGIN=https://'+old,'MEDIA_ORIGIN=https://'+new))
 paths[3].write_text('[Service]\nEnvironment=ALLOWED_HOSTS='+new+','+old+'\n')
 paths[4].write_text('[Service]\nEnvironment=MEDIA_ORIGIN=https://'+new+'\n')
 for p in paths[5:]:
  data=json.loads(p.read_text())
  def replace(obj):
   if isinstance(obj,dict):return {k:replace(v) for k,v in obj.items()}
   if isinstance(obj,list):return [replace(v) for v in obj]
   return 'https://'+new if obj=='https://'+old else obj
  p.write_text(json.dumps(replace(data),indent=2));p.chmod(0o600)
 userctl('daemon-reload');userctl('restart','yepanywhere','polza-media-browser')
 subprocess.run(['systemctl','restart','polza-team'],check=True)
 paths[0].write_text(stage.read_text());subprocess.run(['systemctl','restart','caddy'],check=True)
 print('DOMAIN_MIGRATED',new,'BACKUP',str(folder))
except BaseException:
 restore();raise

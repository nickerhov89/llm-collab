from pathlib import Path
import json,subprocess,socket,shutil
root=Path('/root/polza-isolation-20261114');items=json.loads((root/'inventory.json').read_text())
for i in items:
 assert socket.gethostbyname(i['host'])=='66.248.207.236'
 proof=json.loads((Path(i['home'])/'isolation-probe.json').read_text());assert all(proof.values()),i['username']
 subprocess.run(['systemctl','is-active','--quiet','polza-employee-'+i['username']+'.service'],check=True)
assert json.loads((root/'model-smoke-proof.json').read_text())['secondTurn']
assert json.loads((root/'real-tool-proof.json').read_text())['ownerReadable'] is False
p=Path('/etc/caddy/Caddyfile');original=p.read_text();backup=root/'Caddyfile.before';assert not backup.exists();shutil.copy2(p,backup)
assert 'cowork.66.248.207.236.sslip.io' in original and 'admin off' in original
extra='\n# Isolated employee Cowork instances, 2026-11-14\n'
for i in items:
 assert i['host'] not in original
 extra+=i['host']+' {\n reverse_proxy 127.0.0.1:'+str(i['port'])+'\n}\n'
stage=root/'Caddyfile.next';stage.write_text(original+extra)
subprocess.run(['/usr/bin/caddy','validate','--config',str(stage),'--adapter','caddyfile'],check=True,stdout=subprocess.DEVNULL)
p.write_text(original+extra)
try:subprocess.run(['systemctl','restart','caddy'],check=True)
except:
 p.write_text(original);subprocess.run(['systemctl','restart','caddy'],check=True);raise
print('Four isolated HTTPS entries published. Owner backend was not restarted.')

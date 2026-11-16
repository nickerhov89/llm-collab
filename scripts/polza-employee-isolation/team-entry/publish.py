# Run explicitly as root on the Polza Cowork VPS only.
from pathlib import Path
import subprocess,shutil
p=Path('/etc/caddy/Caddyfile');original=p.read_text();folder=Path('/root/polza-team-20261116');folder.mkdir(mode=0o700,exist_ok=True)
backup=folder/'Caddyfile.before';assert not backup.exists();shutil.copy2(p,backup);backup.chmod(0o600)
assert 'reverse_proxy 127.0.0.1:3400' in original
routing="""@team path / /team /team/* /team-entry
 handle @team {
  reverse_proxy 127.0.0.1:3460 {
   header_up X-Real-IP {remote_host}
  }
 }
 handle {
  reverse_proxy 127.0.0.1:3400
 }"""
next=original.replace('reverse_proxy 127.0.0.1:3400',routing,1)
for port in [3410,3411,3412,3413]:
 old='reverse_proxy 127.0.0.1:'+str(port)
 replacement="""handle /team-entry {
  reverse_proxy 127.0.0.1:3460 {
   header_up X-Real-IP {remote_host}
  }
 }
 handle {
  reverse_proxy 127.0.0.1:PORT
 }"""
 assert old in next;next=next.replace(old,replacement.replace('PORT',str(port)),1)
stage=folder/'Caddyfile.next';stage.write_text(next)
subprocess.run(['/usr/bin/caddy','fmt','--overwrite',str(stage)],check=True,stdout=subprocess.DEVNULL)
next=stage.read_text()
subprocess.run(['/usr/bin/caddy','validate','--config',str(stage),'--adapter','caddyfile'],check=True,stdout=subprocess.DEVNULL)
p.write_text(next)
try:subprocess.run(['systemctl','restart','caddy'],check=True)
except BaseException:
 p.write_text(original);subprocess.run(['systemctl','restart','caddy'],check=True);raise
print('TEAM_ENTRY_PUBLISHED')

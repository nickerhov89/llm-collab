# Run explicitly as root on the Polza Cowork VPS only.
from pathlib import Path
import json,subprocess,pwd,os
try:account=pwd.getpwnam('pcw-team')
except KeyError:subprocess.run(['useradd','--system','--uid','2011','--home-dir','/nonexistent','--shell','/usr/sbin/nologin','pcw-team'],check=True);account=pwd.getpwnam('pcw-team')
assert account.pw_uid==2011
folder=Path('/etc/polza-team');folder.mkdir(mode=0o750,exist_ok=True);os.chown(folder,0,account.pw_gid)
items=json.loads(Path('/root/polza-isolation-20261114/inventory.json').read_text());cards=json.loads(Path('/root/polza-isolation-20261114/admin-access.json').read_text())
realms={'owner':{'host':'cowork.66.248.207.236.sslip.io','port':3401,'frontPort':3400,'label':'Владелец'}}
labels={'ceo':'Директор','cfo':'Финансы','cto':'Технический отдел','marker':'Маркетолог'}
for i in items:
 card=next(c for c in cards if c['employee']==i['username']);realms[i['username']]={'host':i['host'],'port':i['port'],'label':labels[i['username']],'adminPassword':card['adminPassword']}
p=folder/'config.json';p.write_text(json.dumps({'realms':realms}));p.chmod(0o640);os.chown(p,0,account.pw_gid)
unit="""[Unit]
Description=Polza unified team sign-in and owner account administration
After=network-online.target
[Service]
User=pcw-team
Group=pcw-team
Environment=TEAM_CONFIG=/etc/polza-team/config.json
Environment=PORT=3460
ExecStart=/usr/local/bin/node /usr/local/lib/polza-team/server.mjs
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectProc=invisible
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
CapabilityBoundingSet=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
MemoryMax=192M
TasksMax=32
CPUQuota=50%
[Install]
WantedBy=multi-user.target
"""
Path('/etc/systemd/system/polza-team.service').write_text(unit)
p=Path('/etc/ssh/sshd_config.d/60-polza-employees.conf');text=p.read_text()
if 'pcw-team' not in text:p.write_text(text.rstrip()+' pcw-team\n')
subprocess.run(['/usr/sbin/sshd','-t'],check=True);subprocess.run(['systemctl','reload','ssh'],check=True)
subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','enable','--now','polza-team.service'],check=True)
print('TEAM_SERVICE_STARTED')

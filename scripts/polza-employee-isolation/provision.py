from pathlib import Path
import os,json,subprocess,secrets,hashlib,base64,pwd,shutil
from urllib.request import urlopen
base=Path('/var/lib/polza-employees');base.mkdir(mode=0o711,exist_ok=True);base.chmod(0o711)
conf=Path('/etc/polza-employees');conf.mkdir(mode=0o755,exist_ok=True)
audit=Path('/root/polza-isolation-20261114');audit.mkdir(mode=0o700,exist_ok=True)
source=Path('/home/manager/.yep-anywhere');users=json.loads((source/'limited-users.json').read_text())
assert set(users['users'])=={'ceo','cfo','cto','marker'}
shutil.copy2(source/'limited-users.json',audit/'shared-users-disabled.json')
runtime=Path('/opt/polza-employee-runtime');runtime.mkdir(mode=0o755,exist_ok=True)
def run(cmd):subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL)
def write(p,text,mode=0o600,owner=None):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text);p.chmod(mode)
 if owner:os.chown(p,*owner)
if not (runtime/'yepanywhere').exists():
 run(['rsync','-a','--exclude=client-dist.*','--exclude=*.backup-*','--exclude=*.tasker-next.mjs','/home/manager/.npm-global/lib/node_modules/yepanywhere/',str(runtime/'yepanywhere')+'/'])
 (runtime/'npm/node_modules/@openai').mkdir(parents=True,exist_ok=True)
 run(['rsync','-a','/home/manager/.npm-global/lib/node_modules/@openai/',str(runtime/'npm/node_modules/@openai')+'/'])
 run(['chown','-R','root:root',str(runtime)])
 run(['chmod','-R','a+rX,go-w',str(runtime)])
write(runtime/'bin/codex','#!/bin/sh\nexec /usr/local/bin/node /opt/polza-employee-runtime/npm/node_modules/@openai/codex/bin/codex.js "$@"\n',0o755)
# No upstream credentials, user home, git credentials or native history enter the runtime image.
model='qwen/qwen3-coder'
models=json.load(urlopen('https://openrouter.ai/api/v1/models',timeout=20))['data']
m=next(m for m in models if m['id']==model)
assert float(m['pricing']['prompt'])<0.000002 and float(m['pricing']['completion'])<0.000004
accounts={};inventory=[];roles={'ceo':'Management and KPIs','cfo':'Finance','cto':'Technology','marker':'Marketing'}
for index,name in enumerate(['ceo','cfo','cto','marker']):
 uid=2001+index;osname='pcw-'+name;home=base/name;port=3410+index
 try:record=pwd.getpwnam(osname);assert record.pw_uid==uid
 except KeyError:run(['useradd','--system','--uid',str(uid),'--home-dir',str(home),'--shell','/usr/sbin/nologin',osname]);record=pwd.getpwnam(osname)
 gid=record.pw_gid;owner=(uid,gid);home.mkdir(mode=0o700,exist_ok=True);os.chown(home,*owner);home.chmod(0o700)
 data=home/'.yep-anywhere';data.mkdir(mode=0o700,exist_ok=True);os.chown(data,*owner)
 assert not (data/'auth.json').exists(),'Refuse to overwrite existing employee state'
 work=home/'work';work.mkdir(mode=0o700,exist_ok=True);os.chown(work,*owner)
 project=work/'workspace';project.mkdir(mode=0o700);os.chown(project,*owner)
 projectid=base64.urlsafe_b64encode(str(project).encode()).decode().rstrip('=')
 token=secrets.token_urlsafe(40);accounts[name]={'token':token,'dailyLimit':2,'uid':uid}
 original=users['users'][name]
 employee={**original,'disabled':False,'newSessionProjects':[projectid],'joinProjects':[],'viewProjects':[],'pathGrants':[],'projectRoot':str(work),'allowNoProjectSessions':False,'allowPublicApps':False,'allowPrivateAppLinks':False,'templateCreation':{'mode':'none'},'lock':{'provider':'codex','model':model}}
 # Private owner break-glass password is random; employee password and login name are unchanged.
 subprocess.run(['/usr/local/bin/node','--input-type=module','-e',"import bcrypt from '/opt/polza-employee-runtime/yepanywhere/node_modules/bcrypt/bcrypt.js';import fs from 'node:fs';fs.writeFileSync(process.argv[1],JSON.stringify({version:2,enabled:true,localhostOpen:false,account:{passwordHash:await bcrypt.hash(fs.readFileSync(0,'utf8'),12),createdAt:new Date().toISOString()},sessions:{}}),{mode:384});",str(data/'auth.json')],input=secrets.token_urlsafe(50).encode(),check=True)
 auth=json.loads((data/'auth.json').read_text());session=secrets.token_hex(32);verifier=hashlib.sha256(('yep-anywhere-auth-session\0'+session).encode()).hexdigest();auth['sessions'][verifier]={'createdAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),'lastActiveAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),'username':name};write(data/'auth.json',json.dumps(auth),owner=owner);write(audit/(name+'-test-session'),session)
 write(data/'limited-users.json',json.dumps({'version':2,'users':{name:employee}}),owner=owner)
 settings={'limitedUsersEnabled':True,'publicSharingEnabled':False,'newSessionDefaults':{'provider':'codex','permissionMode':'bypassPermissions','sandboxLevel':'none','sandboxNetworkFirewall':False,'providers':{'codex':{'model':model,'thinking':'off'}}}}
 write(data/'server-settings.json',json.dumps({'version':2,'settings':settings}),owner=owner)
 codex=home/'.codex';codex.mkdir(mode=0o700);os.chown(codex,*owner)
 write(codex/'auth.json',json.dumps({'OPENAI_API_KEY':token}),owner=owner)
 write(codex/'config.toml','model_provider = "polza_employee"\nmodel = "'+model+'"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\nweb_search = "disabled"\n[model_providers.polza_employee]\nname = "Polza employee broker"\nbase_url = "http://127.0.0.1:3456/v1"\nwire_api = "responses"\nenv_key = "OPENAI_API_KEY"\nrequires_openai_auth = false\n',owner=owner)
 write(project/'README.md','# '+roles[name]+'\n\nThis is a private employee workspace. Owner chat history, credentials and client folders are not copied here.\n',owner=owner)
 # Preserve only this principal's Tasker records, when present.
 taskfile=hashlib.sha256(('user:'+name).encode()).hexdigest()+'.json';old=source/'polza-tasker'/taskfile
 if old.exists():write(data/'polza-tasker'/taskfile,old.read_text(),owner=owner);os.chown(data/'polza-tasker',*owner);(data/'polza-tasker').chmod(0o700)
 host='cowork-'+name+'.66.248.207.236.sslip.io'
 write(conf/(name+'.json'),json.dumps({'uid':uid,'home':str(home),'unit':'polza-employee-'+name+'.service','username':name}),0o644)
 write(conf/(name+'.env'),'OPENAI_API_KEY='+token+'\n')
 unit=f'''[Unit]
Description=Isolated Cowork employee {name}
Requires=polza-employee-firewall.service polza-employee-broker.service
After=network-online.target polza-employee-firewall.service polza-employee-broker.service
BindsTo=polza-employee-firewall.service polza-employee-broker.service
[Service]
User={osname}
Group={osname}
WorkingDirectory={home}
Environment=HOME={home}
Environment=POLZA_EMPLOYEE_NAME={name}
Environment=CODEX_HOME={codex}
Environment=YEP_DATA_DIR={data}
Environment=POLZA_EMPLOYEE_POLICY={conf}/{name}.json
Environment=HOST=127.0.0.1
Environment=PORT={port}
Environment=ALLOWED_HOSTS={host}
Environment=PATH={runtime}/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile={conf}/{name}.env
ExecStart=/usr/local/bin/node {runtime}/yepanywhere/dist/index.js
ExecStartPost=/usr/bin/python3 /usr/local/lib/polza-employee-isolation/probe.py
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths={home}
BindReadOnlyPaths=/etc/polza-employees/resolv.conf:/etc/resolv.conf
PrivateTmp=yes
PrivateDevices=yes
ProtectProc=invisible
ProcSubset=pid
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
CapabilityBoundingSet=
LockPersonality=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
SocketBindDeny=any
SocketBindAllow=ipv4:tcp:{port}
TasksMax=160
LimitNPROC=160
MemoryMax=1200M
CPUQuota=125%
KillMode=control-group
[Install]
WantedBy=multi-user.target
'''
 write(Path('/etc/systemd/system')/('polza-employee-'+name+'.service'),unit,0o644)
 inventory.append({'username':name,'uid':uid,'home':str(home),'port':port,'host':host,'projectId':projectid})
# A separate UID holds the upstream key; it never enters any employee home/environment.
try:broker=pwd.getpwnam('pcw-broker')
except KeyError:run(['useradd','--system','--uid','2010','--home-dir','/var/lib/polza-broker','--shell','/usr/sbin/nologin','pcw-broker']);broker=pwd.getpwnam('pcw-broker')
folder=Path('/var/lib/polza-broker');folder.mkdir(mode=0o700,exist_ok=True);os.chown(folder,broker.pw_uid,broker.pw_gid)
key=Path('/home/manager/.config/polza/openrouter-cowork.key').read_text().strip()
write(conf/'broker.json',json.dumps({'model':model,'upstreamKey':key,'accounts':accounts}),0o640,(0,broker.pw_gid))
owner_pid=int(subprocess.check_output(['runuser','-u','manager','--','env','XDG_RUNTIME_DIR=/run/user/1001','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus','systemctl','--user','show','yepanywhere.service','-p','MainPID','--value']))
write(conf/'probe.json',json.dumps({'owner_pid':owner_pid,'uids':{i['username']:i['uid'] for i in inventory}}),0o644)
write(Path('/home/manager/.polza-isolation-canary'),'non-sensitive owner canary\n')
for i in inventory:write(Path(i['home'])/'.isolation-canary','non-sensitive employee canary\n',owner=(i['uid'],pwd.getpwnam('pcw-'+i['username']).pw_gid))
write(conf/'resolv.conf','nameserver 1.1.1.1\nnameserver 9.9.9.9\n',0o644)
write(audit/'inventory.json',json.dumps(inventory,indent=2))
print(json.dumps({'prepared_users':[i['username'] for i in inventory],'model':model,'all_services_unpublished':True}))

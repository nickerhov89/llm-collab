from pathlib import Path
import json,secrets,subprocess,os,pwd
root=Path('/root/polza-isolation-20261114');items=json.loads((root/'inventory.json').read_text());cards=[]
units=['polza-employee-'+i['username']+'.service' for i in items]
subprocess.run(['systemctl','stop']+units,check=True)
for i in items:
 password=secrets.token_urlsafe(32)
 command=['/usr/local/bin/node','--input-type=module','-e',"import bcrypt from '/opt/polza-employee-runtime/yepanywhere/node_modules/bcrypt/bcrypt.js';import fs from 'node:fs';const file=process.argv[1];const state=JSON.parse(fs.readFileSync(file));state.account.passwordHash=await bcrypt.hash(fs.readFileSync(0,'utf8'),12);fs.writeFileSync(file,JSON.stringify(state),{mode:384});",i['home']+'/.yep-anywhere/auth.json']
 subprocess.run(command,input=password.encode(),check=True)
 os.chown(command[-1],i['uid'],pwd.getpwnam('pcw-'+i['username']).pw_gid)
 cards.append({'employee':i['username'],'url':'https://'+i['host'],'adminUsername':'','adminPassword':password,'employeePassword':'unchanged'})
p=root/'admin-access.json';p.write_text(json.dumps(cards,indent=2));p.chmod(0o600)
subprocess.run(['systemctl','start']+units,check=True)
print('Unique per-instance administrator credentials saved privately; employee password hashes preserved.')

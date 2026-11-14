from pathlib import Path
import json,subprocess,shutil,datetime,os
items=json.loads(Path('/root/polza-isolation-20261114/inventory.json').read_text());units=['polza-employee-'+i['username']+'.service' for i in items]
folder=Path('/root/polza-employee-snapshots')/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');folder.mkdir(mode=0o700,parents=True);folder.parent.chmod(0o700)
def run(cmd):subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL)
run(['systemctl','stop']+units)
try:
 for i in items:
  home=Path(i['home']);name=i['username']
  # Drop only fixture sessions; preserve any real browser session.
  p=home/'.yep-anywhere/auth.json';auth=json.loads(p.read_text());auth['sessions']={k:v for k,v in auth['sessions'].items() if v.get('userAgent') and not v['userAgent'].startswith('Python-urllib/')};p.write_text(json.dumps(auth))
  (home/'work/workspace/isolated-tool-proof.json').unlink(missing_ok=True)
  run(['umount',str(home)])
  try:run(['cp','--sparse=always','--reflink=auto','/var/lib/polza-employee-volumes/'+name+'.img',str(folder/(name+'.img'))])
  finally:run(['mount',str(home)])
 shutil.copytree('/etc/polza-employees',folder/'configuration')
 shutil.copy2('/etc/fstab',folder/'fstab.txt')
 shutil.copy2('/var/lib/polza-broker/ledger.json',folder/'broker-ledger.json')
 (folder/'README.txt').write_text('Initial COLD employee filesystem snapshots. Root only. No automatic daily schedule is installed. Restore unmounted, then chown/mount using the documented UID policy. Do not extract untrusted employee files as root into the host filesystem.\n')
 for p in folder.rglob('*'):p.chmod(0o700 if p.is_dir() else 0o600)
finally:run(['systemctl','start']+units)
print('COLD_SNAPSHOT',str(folder))

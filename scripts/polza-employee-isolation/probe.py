from pathlib import Path
import os,json,socket,subprocess,urllib.request,ctypes
home=Path.home();name=os.environ['POLZA_EMPLOYEE_NAME'];cfg=json.loads(Path('/etc/polza-employees/probe.json').read_text());checks={}
def denied(path):
 try:fd=os.open(path,os.O_RDONLY);os.close(fd);return False
 except (PermissionError,FileNotFoundError,NotADirectoryError):return True
checks['uid']=os.getuid()==cfg['uids'][name]
checks['owner_canary']=denied('/home/manager/.polza-isolation-canary')
checks['owner_auth']=denied('/home/manager/.yep-anywhere/auth.json')
checks['owner_ssh']=denied('/home/manager/.ssh/id_ed25519')
checks['root_archive']=denied('/root/cowork-retired-144.31.54.166-20261114/cowork-retired.tar.gz')
checks['upstream_key']=denied('/etc/polza-employees/broker.json')
for other in cfg['uids']:
 if other!=name:checks['other_'+other]=denied('/var/lib/polza-employees/'+other+'/.isolation-canary')
checks['owner_proc_env']=denied('/proc/'+str(cfg['owner_pid'])+'/environ')
checks['owner_proc_root']=denied('/proc/'+str(cfg['owner_pid'])+'/root/home/manager/.polza-isolation-canary')
checks['self_proc_root']=denied('/proc/self/root/home/manager/.polza-isolation-canary')
link=home/'work/escape-symlink';link.symlink_to('/home/manager/.polza-isolation-canary');checks['symlink']=denied(link);link.unlink()
try:os.link('/home/manager/.polza-isolation-canary',home/'work/escape-hardlink');checks['hardlink']=False
except OSError:checks['hardlink']=True
try:os.setuid(0);checks['setuid_root']=False
except PermissionError:checks['setuid_root']=True
checks['nested_namespace']=subprocess.run(['/usr/bin/unshare','-Ur','true'],capture_output=True).returncode!=0
for port in [3400,3401,3451]+[3410+i for i,n in enumerate(['ceo','cfo','cto','marker']) if n!=name]:
 with socket.socket() as sock:sock.settimeout(1);checks['local_port_'+str(port)]=sock.connect_ex(('127.0.0.1',port))!=0
with socket.socket() as sock:sock.settimeout(1);checks['metadata_network']=sock.connect_ex(('169.254.169.254',80))!=0
try:
 req=urllib.request.Request('http://127.0.0.1:3456/v1/models',headers={'Authorization':'Bearer '+os.environ['OPENAI_API_KEY']})
 with urllib.request.urlopen(req,timeout=5) as r:checks['scoped_model_access']=r.status==200
except Exception:checks['scoped_model_access']=False
p=home/'work/write-canary';p.write_text('own workspace');checks['own_write']=p.read_text()=='own workspace';p.unlink()
temp=Path('/tmp/employee-temp-canary');temp.write_text('private tmp');checks['private_tmp_write']=temp.read_text()=='private tmp';temp.unlink()
with socket.socket() as listener:
 try:listener.bind(('0.0.0.0',81));checks['privileged_bind_denied']=False
 except PermissionError:checks['privileged_bind_denied']=True
volume=os.statvfs(home);checks['bounded_disk']=0<volume.f_blocks*volume.f_frsize<=4*1024**3
checks['no_new_privs']='NoNewPrivs:\t1' in Path('/proc/self/status').read_text()
(home/'isolation-probe.json').write_text(json.dumps(checks,indent=2))
if not all(checks.values()):raise SystemExit('Isolation probe failed: '+','.join(k for k,v in checks.items() if not v))
print('ISOLATION_PASS '+name+' '+str(len(checks))+' checks')

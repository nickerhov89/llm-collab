from pathlib import Path
import os,json,subprocess,pwd,shutil
inventory=json.loads(Path('/root/polza-isolation-20261114/inventory.json').read_text())
units=['polza-employee-'+i['username']+'.service' for i in inventory]
def run(cmd):subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL)
run(['systemctl','stop']+units)
volumes=Path('/var/lib/polza-employee-volumes');volumes.mkdir(mode=0o700,exist_ok=True);volumes.chmod(0o700)
fstab=Path('/etc/fstab');backup=Path('/root/polza-isolation-20261114/fstab.before');assert not backup.exists();shutil.copy2(fstab,backup)
for i in inventory:
 home=Path(i['home']);name=i['username'];image=volumes/(name+'.img');assert not image.exists()
 with image.open('wb') as f:f.truncate(4*1024**3)
 image.chmod(0o600)
 run(['/usr/sbin/mkfs.ext4','-q','-m','0',str(image)])
 old=home.with_name('.pre-volume-'+name);assert not old.exists();home.rename(old);home.mkdir(mode=0o000)
 run(['mount','-o','loop,nodev,nosuid',str(image),str(home)])
 run(['rsync','-aHAX',str(old)+'/',str(home)+'/'])
 check=subprocess.check_output(['rsync','-aHAXnic','--delete',str(old)+'/',str(home)+'/']);assert not check, 'Volume copy differs'
 gid=pwd.getpwnam('pcw-'+name).pw_gid;os.chown(home,i['uid'],gid);home.chmod(0o700)
 shutil.rmtree(old)
 with fstab.open('a') as f:f.write('\n'+str(image)+' '+str(home)+' ext4 loop,nodev,nosuid,nofail 0 0\n')
 unit=Path('/etc/systemd/system')/('polza-employee-'+name+'.service');text=unit.read_text().replace('[Service]','RequiresMountsFor='+str(home)+'\n[Service]').replace('PrivateTmp=yes','PrivateTmp=yes\nTemporaryFileSystem=/tmp:size=128M,mode=1777 /var/tmp:size=64M,mode=1777').replace('UMask=0077','UMask=0077\nLogRateLimitIntervalSec=30s\nLogRateLimitBurst=200');unit.write_text(text)
run(['systemctl','daemon-reload']);run(['systemctl','start']+units)
print('Four private 4 GiB employee filesystems mounted; bounded private temporary storage; startup requires mounts.')

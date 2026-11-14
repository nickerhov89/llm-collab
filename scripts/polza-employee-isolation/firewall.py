import subprocess
uids='{ 2001, 2002, 2003, 2004 }'
exists=subprocess.run(['/usr/sbin/nft','list','table','inet','polza_employees'],capture_output=True).returncode==0
rules=('delete table inet polza_employees\n' if exists else '')+f'''table inet polza_employees {{
 chain input {{
  type filter hook input priority -10; policy accept;
  ct state established,related accept
  iifname lo accept
  meta l4proto {{icmp,ipv6-icmp}} accept
  tcp dport {{22,80,443}} accept
  udp dport {{68,546}} accept
  drop
 }}
 chain output {{
  type filter hook output priority -10; policy accept;
  ip daddr 127.0.0.1 tcp dport 3451 meta skuid != {{0,1001}} reject
  meta skuid {uids} ct state established,related accept
  meta skuid {uids} ip daddr 127.0.0.1 tcp dport 3456 accept
  meta skuid {uids} ip daddr {{0.0.0.0/8,10.0.0.0/8,100.64.0.0/10,127.0.0.0/8,169.254.0.0/16,172.16.0.0/12,192.168.0.0/16,198.18.0.0/15,224.0.0.0/4,240.0.0.0/4,66.248.207.236}} reject
  meta skuid {uids} ip6 daddr {{::/128,::1/128,fc00::/7,fe80::/10,ff00::/8}} reject
  meta skuid {uids} tcp dport {{53,80,443}} accept
  meta skuid {uids} udp dport 53 accept
  meta skuid {uids} reject
 }}
}}
'''
subprocess.run(['/usr/sbin/nft','-f','-'],input=rules.encode(),check=True)

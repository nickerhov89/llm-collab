# Dedicated Polza employee runtimes — 2026-11-14

This deployment isolates employee agents from the owner's files using separate
Linux UIDs and root-owned systemd policies. The ordinary project-write Bubblewrap
sandbox is a write boundary; enabling it alone does not hide owner credentials.
This change does not make other shared-UID deployments confidential.

## Live entry points

Host: `66.248.207.236`, Ubuntu 24.04. Owner Cowork remains at
`https://cowork.66.248.207.236.sslip.io` under manager UID 1001.

| Login | Linux user / UID | Private HTTPS entry | Loopback port |
|---|---|---|---|
| ceo | pcw-ceo / 2001 | https://cowork-ceo.66.248.207.236.sslip.io | 3410 |
| cfo | pcw-cfo / 2002 | https://cowork-cfo.66.248.207.236.sslip.io | 3411 |
| cto | pcw-cto / 2003 | https://cowork-cto.66.248.207.236.sslip.io | 3412 |
| marker | pcw-marker / 2004 | https://cowork-marker.66.248.207.236.sslip.io | 3413 |

Employee passwords are preserved. Their old accounts on the main owner instance
are disabled; do not reenable them there. Do not create additional employees via
shared owner settings: provision another OS realm and verify it first.
Each employee is still a limited web principal with one private project and
Tasker account key `user:<login>`. Their private instance has a separate random
break-glass administrator password. Credential cards are outside Git.

## Boundaries

* Private HOME `/var/lib/polza-employees/<login>` is mode 0700 on its own 4 GiB
  ext4 loop image. Images are root-only under `/var/lib/polza-employee-volumes`.
  Mounts are nodev/nosuid; underlying mountpoints are root-owned mode 000.
* Services require their home mount and broker/firewall services. Systemd hides
  `/home` and `/root`, makes the host read-only, gives private bounded `/tmp`
  and `/var/tmp`, hides other processes and removes privileges/namespaces.
  Each has MemoryMax=1200M, CPUQuota=125%, TasksMax/LimitNPROC=160.
* The dedicated nftables table blocks private networks, metadata, other staff
  backends and owner ports. Public model/web traffic remains available.
  Ingress accepts only SSH/HTTP/HTTPS, established traffic, loopback, ICMP and
  DHCP replies. Arbitrary employee listeners are not publicly reachable.
  SocketBindDeny is configured but was ineffective for high ports on this host;
  the verified ingress firewall is the enforcement for public listeners.
* SSH explicitly denies all four employee OS accounts plus the broker account,
  including key login and forwarding. They have locked passwords/nologin shells.
* `/opt/polza-employee-runtime` and policy/scripts are root-owned immutable to
  staff. Root, the host operator and kernel remain trusted; this is not a VM.

## App launch policy

`POLZA_EMPLOYEE_POLICY=/etc/polza-employees/<login>.json` enables the dedicated
boundary only when a root-owned non-symlink policy matches the process UID,
HOME and exact systemd cgroup. A malformed configured policy aborts startup.
Without that variable, shared-server limited launch restrictions are unchanged.
The dedicated path uses `sandboxLevel=none` because systemd/UID isolation is the
boundary; this is not an HTTP/user-configurable sandbox bypass.
Session authorization recognizes this boundary. Supervisor never mints an owner
agent-control API token for these runtimes. Remote executors, computer control
and router account overrides remain denied to limited principals.

## Model access and migrated data

Employees currently use `qwen/qwen3-coder` through a separate UID 2010 broker on
127.0.0.1:3456. Their readable capability authorizes only that broker, not the
owner gateway or upstream key. The broker allows models/responses only, fixes
the model, strips hosted web search and denies other hosted tools, caps output
at 2048 tokens, one request at a time and 300/day per employee. Conservative
persistent $0.10 reservations enforce a configured $2/day limit per employee;
unknown-cost failures retain their reservation. Timeout is 120 seconds.
The owner's provider/model routing is unchanged.

Employee spaces are fresh. Only their own limited-user record/password and own
Tasker file, if any, were copied. Owner histories, OAuth profiles, SSH keys,
Portal/Gmail/Telethon credentials and shared client folders were not copied.
Those integrations require separately scoped credentials and deliberate sharing.
Existing secrets in owner history have not been rotated by this deployment.

## Operations and evidence

Root services: `polza-employee-{ceo,cfo,cto,marker,broker,firewall}.service`.
Final service templates and deployment helpers are in
`scripts/polza-employee-isolation/`. These are deployment-specific root scripts,
not an unattended installer. Never run first-provisioning/password scripts over
existing realms. Review paths and preserve state before changing them.

Each start runs root-owned `probe.py` as the employee inside the service boundary.
All 29 checks must pass or startup fails. Evidence includes blocked absolute
paths, symlink/hardlink escapes, process roots/environments, UID escalation,
owner/colleague ports, metadata, key access and successful own workspace writes.
Do not treat the employee-writable JSON result as tamper-proof audit storage;
verify fresh startup journal output and rerun adversarial tests after changes.

On 14 November: 116 startup checks passed; a real native model performed a
terminal/Python call and could write only its own project; same-chat second turn
worked. Public HTTPS rejected anonymous requests and cross-realm cookies.
An employee listener bound to 0.0.0.0:12345 was reachable locally but timed out
from outside. Focused default auth regression suite: 9 tests passed; server
TypeScript check passed. This is targeted verification, not a penetration-test
or proof against kernel vulnerabilities.

## Backup / restore

Initial cold snapshot is `/root/polza-employee-snapshots/20261114T074032Z/`.
It contains four unmounted filesystem copies and root-only configuration.
No automatic daily employee backup schedule is installed. The owner's existing
backup cannot read these homes and must not be advertised as covering staff.
`cold-snapshot.py` stops only staff services, drops synthetic auth sessions,
unmounts/copies/remounts images and restarts services in finally blocks.
Run during a staff maintenance window; it does not stop owner Cowork.

Restore only a stopped realm, preserve newer writes first, validate the source
image, unmount the affected home, replace its backing image and mount it using
the recorded fstab/UID policy. Do not extract employee-controlled archives as
root into the host filesystem. Restore broker ledger conservatively; resetting
it can reset daily budget accounting. Re-run startup probes and HTTPS/auth checks.

On code updates, rebuild the server and deploy only to the root-owned staff
runtime; preserve the runtime's other existing Polza patches. Never change the
owner package to enable this dedicated runtime by default. Update broker and
firewall first, verify readiness, then restart staff and confirm all probes.

#!/bin/sh
# Review, then execute as root. No Docker or tunnel restart, no user-manager restart.
set -eu
test "$(id -u)" -eq 0
apt-get update
apt-get install -y bubblewrap
manager_uid=$(id -u manager)
manager_pid=$(pgrep -u manager -x systemd | head -n 1)
test -n "$manager_pid"
mkdir -p "/etc/systemd/system/user@${manager_uid}.service.d"
cat > "/etc/systemd/system/user@${manager_uid}.service.d/polza-process-limits.conf" <<'UNIT'
[Service]
LimitNPROC=4096
UNIT
cat > /etc/security/limits.d/90-polza-manager.conf <<'LIMITS'
manager soft nproc 4096
manager hard nproc 4096
LIMITS
systemctl daemon-reload
# Apply to the current user manager without killing other bots or the tunnel.
prlimit --pid "$manager_pid" --nproc=4096:4096
for unit in polza-media-browser.service yepanywhere.service; do
  pid=$(runuser -u manager -- env XDG_RUNTIME_DIR="/run/user/$manager_uid" systemctl --user show "$unit" -p MainPID --value)
  if [ "${pid:-0}" -gt 1 ]; then prlimit --pid "$pid" --nproc=4096:4096; fi
  unitdir="/home/manager/.config/systemd/user/$unit.d"
  install -d -o manager -g manager "$unitdir"
  printf '[Service]\nLimitNPROC=4096\n' > "$unitdir/zz-polza-process-limits.conf"
  chown manager:manager "$unitdir/zz-polza-process-limits.conf"
done
runuser -u manager -- env XDG_RUNTIME_DIR="/run/user/$manager_uid" systemctl --user daemon-reload
runuser -u manager -- bwrap --ro-bind / / --dev /dev --proc /proc --unshare-user --unshare-pid -- /usr/bin/true
echo 'Host dependencies and process limits installed. No service restarted. Test a new marker chat and polza-media CLI in SEO & PR.'

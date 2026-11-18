#!/bin/sh
# Run only after staging has passed. Automatic rollback preserves the existing tunnel URL.
set -eu
envfile="$HOME/.config/polza-media-browser.env"
dropin="$HOME/.config/systemd/user/yepanywhere.service.d/media-port.conf"
test -f "$envfile"
test ! -e "$dropin" || { echo 'Already activated; restart the media service for updates.'; exit 0; }
cp "$envfile" "$envfile.before-activation"
rollback() {
  rm -f "$dropin"
  cp "$envfile.before-activation" "$envfile"
  systemctl --user daemon-reload
  systemctl --user restart yepanywhere.service
  systemctl --user restart polza-media-browser.service
  echo 'Activation rolled back. Core is back on :3400.'
}
trap rollback HUP INT TERM
cat > "$dropin" <<EOF
[Service]
ExecStart=
ExecStart=$HOME/.npm-global/bin/yepanywhere --host 127.0.0.1 --port 3401
EOF
sed -i 's/MEDIA_PORT=3410/MEDIA_PORT=3400/;s/MEDIA_CORE=http:\/\/127.0.0.1:3400/MEDIA_CORE=http:\/\/127.0.0.1:3401/' "$envfile"
systemctl --user stop polza-media-browser.service
systemctl --user daemon-reload
if ! systemctl --user restart yepanywhere.service; then rollback; exit 1; fi
if ! systemctl --user restart polza-media-browser.service; then rollback; exit 1; fi
if ! /usr/bin/python3 - <<'PY'
import os,time,urllib.request,urllib.error
from pathlib import Path
env=dict(line.split('=',1) for line in (Path.home()/'.config/polza-media-browser.env').read_text().splitlines())
from urllib.parse import urlparse
host=urlparse(env['MEDIA_ORIGIN']).netloc
for attempt in range(20):
 try:
  for route in ['/media/health','/']:
   request=urllib.request.Request('http://127.0.0.1:3400'+route,headers={'Host':host,'X-Yep-Anywhere':'true'})
   with urllib.request.urlopen(request,timeout=3) as r:
    assert r.status==200
  break
 except Exception:
  if attempt==19: raise SystemExit(1)
  time.sleep(1)
PY
then rollback; exit 1; fi
trap - HUP INT TERM
echo 'Active: media front :3400 → Cowork core :3401. Tunnel unchanged.'

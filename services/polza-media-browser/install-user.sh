#!/bin/sh
# Run as manager, from the uploaded service directory. Does not restart cloudflared.
set -eu
service_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
origin=${MEDIA_ORIGIN:?Set MEDIA_ORIGIN to the current Cowork HTTPS origin}
case "$origin" in https://*[!a-zA-Z0-9./:-]*) echo 'Invalid MEDIA_ORIGIN'; exit 1;; https://*) ;; *) exit 1;; esac
mkdir -p "$HOME/.config/systemd/user/yepanywhere.service.d" "$HOME/.local/bin" "$HOME/.config"
umask 077
cat > "$HOME/.config/polza-media-browser.env" <<EOF
MEDIA_ORIGIN=$origin
MEDIA_PORT=3410
MEDIA_CORE=http://127.0.0.1:3400
MEDIA_SQLITE=$HOME/.npm-global/lib/node_modules/yepanywhere/bundled/@yep-anywhere/shared/dist/sqlite.js
MEDIA_PLAYWRIGHT=$HOME/work/polza-codex-ui/packages/client/package.json
EOF
if [ -n "${MEDIA_CHROMIUM:-}" ]; then printf 'MEDIA_CHROMIUM=%s\n' "$MEDIA_CHROMIUM" >> "$HOME/.config/polza-media-browser.env"; fi
cat > "$HOME/.config/systemd/user/polza-media-browser.service" <<EOF
[Unit]
Description=Polza media browser and Cowork front door
After=network-online.target yepanywhere.service
[Service]
Type=simple
WorkingDirectory=$service_dir
EnvironmentFile=$HOME/.config/polza-media-browser.env
ExecStart=/usr/local/bin/node $service_dir/server.mjs
Restart=on-failure
RestartSec=3
TimeoutStopSec=35
NoNewPrivileges=true
UMask=0077
MemoryMax=1800M
TasksMax=160
LimitNPROC=300
Environment=UV_THREADPOOL_SIZE=2
LimitNOFILE=8192
[Install]
WantedBy=default.target
EOF
cat > "$HOME/.local/bin/polza-media" <<EOF
#!/bin/sh
exec /usr/local/bin/node "$service_dir/cli.mjs" "\$@"
EOF
chmod 700 "$HOME/.local/bin/polza-media"
systemctl --user daemon-reload
systemctl --user enable --now polza-media-browser.service
printf 'Staging on loopback :3410. Test before activating. Current Cowork stays on :3400.\n'

#!/bin/sh
set -eu
[ "$(id -u)" = 2004 ] || exit 77
state=/var/lib/polza-employees/marker/.local/state/polza-site-build
mkdir -p "$state"
# Open as marker, never as PID 1/root: user-controlled symlinks cannot write root files.
exec >"$state/build.log" 2>&1
printf 'Build started: '
date -u +%FT%TZ
cd /var/lib/polza-employees/marker/work/polza-site
set +e
/usr/bin/timeout 390 /usr/local/bin/corepack pnpm exec next build --webpack
result=$?
printf '\nBuild finished: exit=%s at ' "$result"
date -u +%FT%TZ
exit "$result"

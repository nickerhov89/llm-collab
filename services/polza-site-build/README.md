# Bounded site builds for marker

The Next/Payload build peaked at 2.3 GiB, larger than the whole 1.2 GiB chat
realm. `polza-site-build start` queues one fixed Webpack build through a systemd
path watch; it does not grant sudo, root execution, an arbitrary command or a
larger agent memory budget. `status` and `log` are bounded read operations.
The unit runs as the same pcw-marker UID under its existing network firewall,
with private temp directories, NoNewPrivileges, a 2.5 GiB memory cap, 150% CPU,
120 tasks and a seven-minute limit. Path triggers are limited to two per five
minutes. Concurrent starts do not create another build. Logs are opened by
marker, never by privileged PID 1, and only this user's repository is writable.
No publish/push, credential copy or new public listener is performed.
The site pins pnpm 10.34.9; the runtime pnpm entry delegates to Corepack, which
honors project packageManager declarations. Other global pnpm users are unchanged.

#!/usr/bin/env python3
"""Historical first-run migration, retained for recovery reference only.

This predates Portal, Telegram, images and cross-chat configuration. It is not
a complete installer for the current broker. Do not run on an existing or new
production host; use the reviewed deployment runbooks and private snapshots.

Does not grant new integrations or rotate passwords. Preserves the four existing
corporate Docs grants while replacing readable cookie copies with UID mediation.
"""
import datetime
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess

raise SystemExit("Historical migration only; current deployment requires the reviewed runbook")

assert os.getuid() == 0
ACCOUNTS = {name: pwd.getpwuid(uid) for name, uid in {"ceo": 2001, "cfo": 2002, "cto": 2003, "marker": 2004}.items()}
assert all(a.pw_name == "pcw-" + name for name, a in ACCOUNTS.items())
SOURCE = Path(__file__).resolve().parent
LIB = Path("/usr/local/lib/polza-access")
BACKUP = Path("/root/polza-access-20261116")
assert not BACKUP.exists(), "First-run migration already executed; review existing state"
BACKUP.mkdir(mode=0o700)
manager = pwd.getpwnam("manager")
team = pwd.getpwnam("pcw-team")
team_config = Path("/etc/polza-team/config.json")
shutil.copy2(team_config, BACKUP / "team-config.before.json")
config = json.loads(team_config.read_text())
private = Path("/home/manager/.config/polza-access")
private.mkdir(mode=0o700, exist_ok=True)
os.chown(private, manager.pw_uid, manager.pw_gid)
state = Path("/home/manager/.local/state/polza-access")
state.mkdir(mode=0o700, exist_ok=True)
os.chown(state, manager.pw_uid, manager.pw_gid)
policy_dir = Path("/var/lib/polza-team")
policy_dir.mkdir(mode=0o2750, exist_ok=True)
os.chown(policy_dir, team.pw_uid, manager.pw_gid)
policy_dir.chmod(0o2750)
policy_file = policy_dir / "access-policy.json"
assert not policy_file.exists(), "Refusing to replace existing grants"
home = Path(manager.pw_dir)
seo = home / ".config/polza-site-seo"
connections = {
    "docs": {"configured": (home / ".config/polza-google/session.json").is_file(), "note": "info@polzaagency.com · чтение документов"},
    "gmail": {"configured": (home / ".config/polza-seo-pr-browser/gmail-api.json").is_file() and (home / ".config/polza-google-workspace/credentials.json").is_file(), "note": "info@polzaagency.com · вход проверяется при обращении"},
    "media": {"configured": (home / ".local/state/polza-media-browser/agents/owner.json").is_file(), "note": "Общие кабинеты СМИ · вход проверяется на каждой площадке"},
    "search_console": {"configured": (seo / "google-search-console.json").is_file(), "note": "polzaagency.ru · последнее OAuth-подключение требует проверки"},
    "metrika": {"configured": (seo / "metrika.json").is_file(), "note": "polzaagency.ru · чтение органической статистики"},
    "webmaster": {"configured": (seo / "yandex-webmaster.json").is_file(), "note": "polzaagency.ru · чтение поисковых запросов"},
    "telegram": {"configured": False, "note": "Сотрудникам пока не подключено"},
    "direct": {"configured": False, "note": "Аккаунт Директа пока не подключён"},
}
users = {name: {key: "read" if key == "docs" else "none" for key in connections} for name in ("ceo", "cfo", "cto", "marker")}
policy_file.write_text(json.dumps({"version": 1, "users": users, "connections": connections,
                                    "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}, ensure_ascii=False, indent=2) + "\n")
os.chown(policy_file, team.pw_uid, manager.pw_gid)
policy_file.chmod(0o640)
LIB.mkdir(mode=0o755, exist_ok=True)
for name in ("broker.py", "client.py", "proxy_access.py", "telegram_worker.py", "telegram_client.py", "image_access.py", "image_client.py", "media_cli.py"):
    shutil.copy2(SOURCE / name, LIB / name)
    (LIB / name).chmod(0o644)
original_reader = Path("/usr/local/bin/google-doc-read")
shutil.copy2(original_reader, BACKUP / "google-doc-read.before")
shutil.copy2(SOURCE / "google_doc_reader.py", LIB / "google-doc-read.py")
runtime = {
    "socket": "/run/polza-access/tools.sock", "policy": str(policy_file), "home": str(home),
    "state": str(state), "actors": {str(manager.pw_uid): "owner", **{str(ACCOUNTS[name].pw_uid): name for name in users}},
    "realms": {name: config["realms"][name] for name in users},
    "docsReader": str(LIB / "google-doc-read.py"),
    "gmailServer": str(home / "services/polza-corporate-gmail/server.py"),
    "mediaAgent": str(home / ".local/state/polza-media-browser/agents/owner.json"),
    "searchReport": str(home / "work/polza-seo-pr/scripts/seo-search-report.py"),
}
runtime_file = private / "runtime.json"
runtime_file.write_text(json.dumps(runtime))
os.chown(runtime_file, manager.pw_uid, manager.pw_gid)
runtime_file.chmod(0o600)
Path("/usr/local/bin/polza-integration").write_text('#!/bin/sh\nexec /usr/bin/python3 /usr/local/lib/polza-access/client.py "$@"\n')
Path("/usr/local/bin/polza-integration").chmod(0o755)
Path("/usr/local/bin/polza-media").write_text('#!/bin/sh\nexec /usr/bin/python3 /usr/local/lib/polza-access/media_cli.py "$@"\n')
Path("/usr/local/bin/polza-media").chmod(0o755)
unit = f"""[Unit]
Description=Polza UID-authenticated integration broker
After=network-online.target polza-team.service
[Service]
User=manager
Group=manager
Environment=HOME={home}
Environment=POLZA_ACCESS_CONFIG={runtime_file}
ExecStart=/usr/bin/python3 {LIB}/broker.py
RuntimeDirectory=polza-access
RuntimeDirectoryMode=0755
UMask=0077
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths={state} {home}/.local/state/polza-corporate-gmail
PrivateTmp=yes
PrivateDevices=yes
ProtectProc=invisible
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
CapabilityBoundingSet=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
MemoryMax=256M
TasksMax=20
CPUQuota=50%
[Install]
WantedBy=multi-user.target
"""
receipts = home / ".local/state/polza-corporate-gmail"
receipts.mkdir(mode=0o700, exist_ok=True)
os.chown(receipts, manager.pw_uid, manager.pw_gid)
Path("/etc/systemd/system/polza-access.service").write_text(unit)
dropin = Path("/etc/systemd/system/polza-team.service.d")
dropin.mkdir(exist_ok=True)
(dropin / "access-policy.conf").write_text("[Service]\nReadWritePaths=/var/lib/polza-team\n")
config["accessPolicy"] = str(policy_file)
team_config.write_text(json.dumps(config))
subprocess.run(["systemctl", "daemon-reload"], check=True)
subprocess.run(["systemctl", "enable", "--now", "polza-access.service"], check=True)
subprocess.run(["systemctl", "is-active", "polza-access.service"], check=True)
# Validate native account authorization before removing readable cookie copies.
# External Google sign-in can expire independently of the access-control service.
for name in users:
    subprocess.run(["runuser", "-u", ACCOUNTS[name].pw_name, "--", "/usr/local/bin/polza-integration", "docs.check"], check=True, stdout=subprocess.DEVNULL)
for name in users:
    account = ACCOUNTS[name]
    cookie = Path(account.pw_dir) / ".config/polza-google/session.json"
    if cookie.exists():
        shutil.copy2(cookie, BACKUP / (name + "-google-session.before.json"))
        (BACKUP / (name + "-google-session.before.json")).chmod(0o600)
        cookie.unlink()
    codex = Path(account.pw_dir) / ".codex/config.toml"
    text = codex.read_text()
    if "[mcp_servers.polza_integrations]" not in text:
        shutil.copy2(codex, BACKUP / (name + "-codex-config.before.toml"))
        with codex.open("a") as out:
            out.write('\n[mcp_servers.polza_integrations]\ncommand = "/usr/local/bin/polza-integration"\nargs = ["--mcp"]\n')
# Compatible CLI name; staff now go through live UID/grant checks.
original_reader.write_text('''#!/usr/bin/env python3
import json, os, subprocess, sys
if os.getuid() in (0, 1001):
    os.execv('/usr/bin/python3',['python3','/usr/local/lib/polza-access/google-doc-read.py',*sys.argv[1:]])
if len(sys.argv)!=2:
    print('Usage: google-doc-read --check | GOOGLE_DOC_URL');sys.exit(2)
from importlib.util import spec_from_file_location, module_from_spec
s=spec_from_file_location('polza_access','/usr/local/lib/polza-access/client.py');m=module_from_spec(s);s.loader.exec_module(m)
r=m.request({'tool':'docs.check' if sys.argv[1]=='--check' else 'docs.read','arguments':{'url':sys.argv[1]}})
if r.get('ok'):print(r['result']['text'],end='')
else:print('Google Docs access denied or session unavailable',file=sys.stderr)
sys.exit(0 if r.get('ok') else 1)
''')
original_reader.chmod(0o755)
subprocess.run(["systemctl", "restart", "polza-team.service"], check=True)
print("ACCESS_BROKER_INSTALLED; existing Docs grants preserved; other staff grants remain none")

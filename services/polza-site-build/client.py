#!/usr/bin/env python3
"""Only queues the fixed unprivileged site build; never accepts a command."""
from pathlib import Path
import json
import os
import subprocess
import sys
import uuid
import fcntl
import time

if os.getuid() != 2004:
    raise SystemExit('This build command belongs to marker')
state = Path('/var/lib/polza-employees/marker/.local/state/polza-site-build')
operation = sys.argv[1] if len(sys.argv) == 2 else 'help'
if operation == 'start':
    with (state / 'request.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        status = subprocess.check_output(['systemctl', 'show', 'polza-marker-site-build.service', '-p', 'ActiveState', '--value'], text=True).strip()
        request = state / 'request'
        recent = request.exists() and time.time() - request.stat().st_mtime < 5
        if status in ['active', 'activating'] or recent:
            print(json.dumps({'status': 'already_running_or_queued'}))
        else:
            request.write_text(str(uuid.uuid4()) + '\n')
            print(json.dumps({'status': 'queued', 'next': 'polza-site-build status; polza-site-build log'}))
elif operation == 'status':
    print(subprocess.check_output(['systemctl', 'show', 'polza-marker-site-build.service', '-p', 'ActiveState', '-p', 'Result', '-p', 'ExecMainStatus'], text=True))
elif operation == 'log':
    file = state / 'build.log'
    print('\n'.join(file.read_text(errors='replace').splitlines()[-100:]) if file.exists() else 'No build log yet')
else:
    print('polza-site-build start | status | log. Fixed site only, no publish or arbitrary commands.')

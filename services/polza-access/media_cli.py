#!/usr/bin/python3
"""Use the caller's existing UID grants. No bearer files or actor switching."""
import json,subprocess,sys
from pathlib import Path
args=sys.argv[1:]
if '--actor' in args:
 print(json.dumps({'error':'Role selection is unavailable. Run polza-media without --actor; the current user owns the access.'}));sys.exit(1)
commands={'status':'status','open':'open','snapshot':'snapshot','login':'login','job':'job','job-status':'job-status','resume':'resume','cancel':'cancel'}
if not args or args[0] not in commands:
 print('polza-media status | open SITE | snapshot SITE | login SITE | job FILE | job-status ID | resume ID | cancel ID');sys.exit(1)
try:
 op=args[0];body={}
 if op in ('open','snapshot','login'):body={'site':args[1]}
 elif op=='job':body=json.loads(Path(args[1]).read_text())
 elif op in ('job-status','resume','cancel'):body={'id':args[1]}
 result=subprocess.run(['/usr/local/bin/polza-integration','media.'+commands[op],json.dumps(body)],capture_output=True,text=True,timeout=55)
 data=json.loads(result.stdout)
 if data.get('ok'):
  print(json.dumps(data.get('result'),ensure_ascii=False,indent=2));sys.exit(0)
 print(json.dumps({'error':data.get('error','Media operation refused')},ensure_ascii=False));sys.exit(1)
except (ValueError,IndexError,OSError,subprocess.TimeoutExpired):
 print(json.dumps({'error':'Media CLI unavailable; no action was replayed'}));sys.exit(1)

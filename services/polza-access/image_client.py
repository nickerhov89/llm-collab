#!/usr/bin/env python3
"""Generate and save images as the invoking user; no upstream credential here."""
import base64
import io
import json
from pathlib import Path
import sys
from client import request as broker_request

def request(data):
    try:
        return broker_request(data)
    except (OSError, ValueError):
        return {"ok": False, "code": "unavailable", "error": "Image connector unavailable; do not replay paid generation automatically."}

if len(sys.argv) < 2:
    print('polza-image status | generate JSON OUTPUT | download JOB_ID OUTPUT\nGeneration JSON: {"prompt":"...","aspect_ratio":"16:9","idempotency_key":"article-cover-v1"}')
    sys.exit(0)
operation = sys.argv[1]
if operation == 'status':
    result = request({'tool': 'images.status', 'arguments': {}})
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get('ok') else 1)
if len(sys.argv) == 4 and Path(sys.argv[3]).expanduser().exists():
    raise SystemExit('Output already exists; choose a new file or download the existing job')
if operation == 'generate' and len(sys.argv) == 4:
    response = request({'tool': 'images.generate', 'arguments': json.loads(sys.argv[2])})
    if not response.get('ok'):
        print(json.dumps(response, ensure_ascii=False)); sys.exit(1)
    result = response['result']
    if result['status'] != 'completed':
        print(json.dumps(result, ensure_ascii=False)); sys.exit(1)
    job = result['job_id']
elif operation == 'download' and len(sys.argv) == 4:
    job = sys.argv[2]
else:
    raise SystemExit('Expected status, generate JSON OUTPUT, or download JOB_ID OUTPUT')
response = request({'tool': 'images.download', 'arguments': {'job_id': job}})
if not response.get('ok'):
    print(json.dumps(response, ensure_ascii=False)); sys.exit(1)
output = Path(sys.argv[3]).expanduser()
blob = base64.b64decode(response['result']['base64'], validate=True)
formats = {'.png': ('PNG', 'image/png'), '.webp': ('WEBP', 'image/webp'),
           '.jpg': ('JPEG', 'image/jpeg'), '.jpeg': ('JPEG', 'image/jpeg')}
target = formats.get(output.suffix.lower())
if target and target[1] != response['result']['media_type']:
    from PIL import Image
    with Image.open(io.BytesIO(blob)) as image:
        if image.width * image.height > 20_000_000:
            raise SystemExit('Image too large to convert safely')
        image.load()
        if target[0] == 'JPEG':
            image = image.convert('RGB')
        converted = io.BytesIO()
        image.save(converted, format=target[0])
        blob = converted.getvalue()
with output.open('xb') as f:
    f.write(blob)
print(json.dumps({'ok': True, 'file': str(output.resolve()), 'job_id': job}, ensure_ascii=False))

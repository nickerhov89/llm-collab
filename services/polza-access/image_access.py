"""UID-scoped image generation. Paid calls are never automatically replayed."""
import base64
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

MAX_IMAGE = 5 * 1024 * 1024
MAX_RESPONSE = 12 * 1024 * 1024
ASPECTS = {'1:1', '16:9', '9:16', '4:3', '3:4'}


def atomic(path, data):
    stage = path.with_suffix(path.suffix + '.next')
    with stage.open('wb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    stage.chmod(0o600)
    stage.replace(path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def image_call(config, actor, tool, args, generate=None):
    if actor not in {'owner', 'marker', 'ceo', 'cfo', 'cto'}:
        raise ValueError('Unknown image account')
    state = Path(config['state'])
    folder = state / actor
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    if tool == 'images.status' and not args:
        return {'model': config['model'], 'resolution': config.get('resolution', '1K'),
                'aspect_ratios': sorted(ASPECTS), 'daily_image_limit': config['dailyImages'],
                'requires_idempotency_key': True}
    if tool in {'images.status', 'images.download'}:
        if set(args) != {'job_id'} or not re.fullmatch('[a-f0-9]{64}', str(args.get('job_id', ''))):
            raise ValueError('Expected an image job_id')
        receipt = json.loads((folder / (args['job_id'] + '.json')).read_text())
        if tool == 'images.status':
            return receipt
        if receipt['status'] != 'completed':
            raise ValueError('Image not completed; do not resubmit an unconfirmed generation')
        return {'job_id': args['job_id'], 'media_type': receipt['media_type'],
                'base64': base64.b64encode((folder / (args['job_id'] + '.image')).read_bytes()).decode()}
    if tool != 'images.generate' or set(args) - {'prompt', 'aspect_ratio', 'idempotency_key'}:
        raise ValueError('Unsupported image operation or arguments')
    prompt, key, aspect = args.get('prompt'), args.get('idempotency_key'), args.get('aspect_ratio', '16:9')
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 6000:
        raise ValueError('Image prompt must contain 1..6000 characters')
    if not isinstance(key, str) or not 8 <= len(key) <= 150 or aspect not in ASPECTS:
        raise ValueError('Expected a stable idempotency_key and supported aspect_ratio')
    job = hashlib.sha256((actor + '\0' + key).encode()).hexdigest()
    fingerprint = hashlib.sha256(json.dumps([prompt, aspect, config['model']], ensure_ascii=False).encode()).hexdigest()
    target = folder / (job + '.json')
    with (state / 'generation.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('An image is already generating; wait and check its status')
        if target.exists():
            receipt = json.loads(target.read_text())
            if receipt['fingerprint'] != fingerprint:
                raise ValueError('Idempotency key already used for another prompt')
            return {**receipt, 'duplicate_suppressed': True}
        today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
        receipts = list(folder.glob('*.json'))
        if len(receipts) >= 200:
            raise ValueError('Image retention limit reached; ask owner to archive old jobs')
        count = sum(json.loads(p.read_text()).get('day') == today for p in receipts)
        if count >= config['dailyImages']:
            raise ValueError('Daily image generation limit reached')
        receipt = {'job_id': job, 'status': 'unconfirmed', 'day': today,
                   'model': config['model'], 'fingerprint': fingerprint}
        atomic(target, json.dumps(receipt).encode())
        payload = {'model': config['model'], 'prompt': prompt,
                   'aspect_ratio': aspect, 'n': 1,
                   'provider': {'sort': 'price', 'allow_fallbacks': False}}
        if config.get('resolution', '1K'):
            payload['resolution'] = config.get('resolution', '1K')
        if generate is None:
            def generate(body):
                req = urllib.request.Request('https://openrouter.ai/api/v1/images',
                    data=json.dumps(body).encode(), headers={'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + config['apiKey'], 'User-Agent': 'PolzaCowork/1.0'})
                with urllib.request.urlopen(req, timeout=200) as response:
                    data = response.read(MAX_RESPONSE + 1)
                if len(data) > MAX_RESPONSE:
                    raise ValueError('Image API response too large')
                return json.loads(data)
        try:
            result = generate(payload)
        except urllib.error.HTTPError as error:
            message = 'Image API returned HTTP ' + str(error.code)
            try:
                data = json.loads(error.read(8000))
                upstream = data.get('error', {})
                if isinstance(upstream, dict):
                    detail = str(upstream.get('message', ''))
                    message += ': ' + detail.replace(config.get('apiKey', '\0'), '[redacted]').replace(prompt, '[prompt]')[:700]
            except (ValueError, TypeError):
                pass
            receipt.update(status='failed', upstream_status=error.code, error=message)
            atomic(target, json.dumps(receipt).encode())
            return receipt
        images = result.get('data', [])
        if len(images) != 1:
            raise ValueError('Image provider did not return exactly one image')
        blob = base64.b64decode(images[0]['b64_json'], validate=True)
        if not blob or len(blob) > MAX_IMAGE:
            raise ValueError('Generated image exceeds file limit')
        if blob.startswith(b'\x89PNG\r\n\x1a\n'):
            mime = 'image/png'
        elif blob.startswith(b'\xff\xd8\xff'):
            mime = 'image/jpeg'
        elif blob.startswith(b'RIFF') and blob[8:12] == b'WEBP':
            mime = 'image/webp'
        else:
            raise ValueError('Unsupported generated image format')
        atomic(folder / (job + '.image'), blob)
        receipt.update(status='completed', media_type=mime, bytes=len(blob),
                       cost_usd=result.get('usage', {}).get('cost'))
        atomic(target, json.dumps(receipt).encode())
        return receipt

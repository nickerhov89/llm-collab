#!/usr/bin/env python3
"""Import this UID's DOCX as a new Google Doc using its existing Docs write grant."""
import base64
import json
from pathlib import Path
import sys
from client import request


def main():
    if len(sys.argv) != 4:
        print('polza-docx FILE.docx TITLE IDEMPOTENCY_KEY', file=sys.stderr)
        return 2
    with Path(sys.argv[1]).open('rb') as source:
        blob = source.read(8 * 1024 * 1024 + 1)
    if len(blob) > 8 * 1024 * 1024:
        print('DOCX exceeds the 8 MiB file limit', file=sys.stderr)
        return 2
    result = request({'tool': 'docs.create', 'arguments': {
        'title': sys.argv[2], 'docx_base64': base64.b64encode(blob).decode('ascii'),
        'idempotency_key': sys.argv[3]}})
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get('ok') and result.get('result', {}).get('status') == 'completed' else 1


if __name__ == '__main__':
    raise SystemExit(main())

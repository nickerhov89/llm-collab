#!/usr/bin/env python3
"""Telegram CLI through current UID/grants; no Telethon credentials are exposed."""
import json
import sys
from client import request

operations = {'profile', 'dialogs', 'messages', 'search', 'links', 'similar', 'search_chats', 'send'}
if len(sys.argv) < 2 or sys.argv[1] not in operations:
    print('polza-telegram profile | dialogs | messages JSON | search JSON | links JSON | similar JSON | search_chats JSON | send JSON\nSearch example: {"query":"B2B","limit":10}; similar: {"chat":"@channel","limit":10}; links: {"chat":"@channel","limit":20}.\nCheck profile first. No local Telethon import/session file is required. Only Telegram-accessible chats can be read. Send needs explicit recipient/text instruction and stable idempotency_key.')
    sys.exit(0)
try:
    result = request({'tool': 'telegram.' + sys.argv[1], 'arguments': json.loads(sys.argv[2]) if len(sys.argv) == 3 else {}})
except (OSError, ValueError):
    result = {'ok': False, 'code': 'unavailable', 'error': 'Telegram connector unavailable; no automatic replay'}
print(json.dumps(result, ensure_ascii=False, indent=2))
sys.exit(0 if result.get('ok') else 1)

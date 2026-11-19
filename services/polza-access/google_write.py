"""Native Docs/Sheets writes with scoped OAuth and durable no-replay receipts."""
import base64
import binascii
import io
import zipfile
import uuid
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

OPERATIONS = {'docs.create', 'docs.update', 'docs.create_sheet',
              'docs.write_sheet', 'docs.format_sheet'}


def api(url, token=None, body=None, form=None):
    headers = {'Accept': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    data = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(body).encode()
    if form is not None:
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
        data = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            data = response.read(5 * 1024 * 1024 + 1)
            if len(data) > 5 * 1024 * 1024:
                raise ValueError('Google response exceeds limit')
            return json.loads(data)
    except urllib.error.HTTPError as error:
        # Never relay token responses or user content into logs/receipts.
        raise ValueError('Google API refused the operation (HTTP %s)' % error.code) from None


DOCX_LIMIT = 8 * 1024 * 1024


def docx_bytes(encoded):
    if not isinstance(encoded, str) or len(encoded) > (DOCX_LIMIT + 2) // 3 * 4:
        raise ValueError('DOCX exceeds the 8 MiB file limit')
    try:
        blob = base64.b64decode(encoded, validate=True)
        if not 1 <= len(blob) <= DOCX_LIMIT:
            raise ValueError('DOCX exceeds the 8 MiB file limit')
        with zipfile.ZipFile(io.BytesIO(blob)) as package:
            entries = package.infolist()
            names = {item.filename for item in entries}
            if (len(entries) > 512 or len(names) != len(entries) or
                    not {'[Content_Types].xml', '_rels/.rels', 'word/document.xml'} <= names or
                    sum(item.file_size for item in entries) > 64 * 1024 * 1024 or
                    any(item.flag_bits & 1 or item.filename.startswith('/') or
                        '..' in item.filename.split('/') or
                        'vbaProject' in item.filename for item in entries)):
                raise ValueError('Expected a bounded macro-free DOCX package')
    except (binascii.Error, zipfile.BadZipFile):
        raise ValueError('Expected a valid base64 DOCX package') from None
    return blob


def import_docx(token, title, blob):
    # Convert an uploaded DOCX to a new native, private Google Doc. No image URLs
    # or sharing/permissions operation, and never replace an existing document.
    boundary = 'polza-' + uuid.uuid4().hex
    metadata = json.dumps({'name': title, 'mimeType': 'application/vnd.google-apps.document'}).encode()
    payload = (('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n').encode() +
               metadata + ('\r\n--' + boundary + '\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n').encode() +
               blob + ('\r\n--' + boundary + '--\r\n').encode())
    req = urllib.request.Request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,mimeType,webViewLink',
        data=payload, headers={'Authorization': 'Bearer ' + token,
                              'Content-Type': 'multipart/related; boundary=' + boundary})
    # Uploads must not redirect an authenticated multipart body to another host.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError('Unexpected Google upload redirect')
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=25) as response:
            body = response.read(1024 * 1024 + 1)
            if len(body) > 1024 * 1024:
                raise ValueError('Google upload response exceeds limit')
            result = json.loads(body)
    except urllib.error.HTTPError as error:
        raise ValueError('Google upload refused (HTTP %s); inspect the pending receipt' % error.code) from None
    return result


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{10,200}', value):
        raise ValueError('Expected a Google document or spreadsheet ID')
    return value


def verified_token(config):
    credentials = json.loads(Path(config['googleWriteCredentials']).read_text())
    if credentials.get('account') != 'info@polzaagency.com':
        raise ValueError('Unexpected corporate Google account')
    token = api('https://oauth2.googleapis.com/token', form={
        'client_id': credentials['client_id'], 'client_secret': credentials['client_secret'],
        'refresh_token': credentials['refresh_token'], 'grant_type': 'refresh_token'})['access_token']
    who = api('https://openidconnect.googleapis.com/v1/userinfo', token)
    if who.get('email') != 'info@polzaagency.com' or who.get('email_verified') is not True:
        raise ValueError('Google identity mismatch')
    return token


def read_native(config, url):
    from google_doc_reader import export_url, GoogleRedirect, LIMIT
    validated = export_url(url)
    match = re.search(r'/(document|spreadsheets)/d/([A-Za-z0-9_-]+)', validated)
    if not match:
        raise ValueError('Expected a Google Docs or Sheets link')
    mime = 'text/csv' if match[1] == 'spreadsheets' else 'text/plain'
    if match[1] == 'spreadsheets' and 'gid' in urllib.parse.parse_qs(urllib.parse.urlsplit(validated).query):
        # Drive CSV export selects the first worksheet; do not silently return
        # that sheet when the caller explicitly selected another one.
        raise urllib.error.HTTPError(validated, 403, 'Use worksheet-aware browser export', {}, None)
    token = verified_token(config)
    endpoint = 'https://www.googleapis.com/drive/v3/files/' + match[2] + '/export?'
    request = urllib.request.Request(endpoint + urllib.parse.urlencode({'mimeType': mime}),
                                     headers={'Authorization': 'Bearer ' + token})
    with urllib.request.build_opener(GoogleRedirect()).open(request, timeout=10) as response:
        if response.headers.get_content_type() != mime:
            raise ValueError('Google returned an unexpected document format')
        body = response.read(LIMIT + 1)
    if len(body) > LIMIT:
        raise ValueError('Document exceeds the 5 MiB text limit')
    return body.decode('utf-8-sig')


def write_call(config, actor, tool, args):
    if tool not in OPERATIONS:
        raise ValueError('Unsupported Google write operation')
    key = args.get('idempotency_key')
    if not isinstance(key, str) or not 1 <= len(key) <= 200:
        raise ValueError('Google writes require a stable idempotency_key')
    title = args.get('title', '')
    if tool in ('docs.create', 'docs.create_sheet') and (not isinstance(title, str) or not 1 <= len(title) <= 300):
        raise ValueError('Expected a title of 1–300 characters')
    docx = None
    if tool == 'docs.create' and 'docx_base64' in args:
        if 'text' in args:
            raise ValueError('Choose text or docx_base64, not both')
        docx = docx_bytes(args['docx_base64'])
    if tool == 'docs.create' and not isinstance(args.get('text', ''), str):
        raise ValueError('Document text must be a string')
    if tool == 'docs.create_sheet':
        values = args.get('values', [])
        if not isinstance(values, list) or len(values) > 10000 or any(
            not isinstance(row, list) or len(row) > 200 or any(
                not isinstance(cell, (str, int, float, bool)) and cell is not None
                for cell in row) for row in values):
            raise ValueError('Expected a bounded matrix of scalar cells')
    if tool in ('docs.update', 'docs.format_sheet'):
        requests = args.get('requests')
        if not isinstance(requests, list) or not 1 <= len(requests) <= 100:
            raise ValueError('Expected 1–100 native batchUpdate requests')
    if tool not in ('docs.create', 'docs.create_sheet'):
        identifier(args.get('document_id'))
    if tool == 'docs.write_sheet':
        if not isinstance(args.get('data'), list) or not 1 <= len(args['data']) <= 100:
            raise ValueError('Expected 1–100 range/value entries')
        if args.get('value_input_option', 'RAW') not in ('RAW', 'USER_ENTERED'):
            raise ValueError('Expected RAW or USER_ENTERED')
    root = Path(config['state']) / 'google-write-receipts'
    root.mkdir(mode=0o700, exist_ok=True)
    path = root / (hashlib.sha256((actor + ':' + key).encode()).hexdigest() + '.json')
    digest = hashlib.sha256(json.dumps([tool, args], sort_keys=True).encode()).hexdigest()
    if path.exists():
        saved = json.loads(path.read_text())
        if saved['request_hash'] != digest:
            raise ValueError('Idempotency key conflicts with an earlier request')
        return {k: v for k, v in saved.items() if k != 'request_hash'}
    if sum(1 for _ in root.glob('*.json')) >= 5000:
        raise ValueError('Google receipt limit reached; ask the owner to archive receipts')
    # Refresh and verify identity before creating a pending write receipt.
    token = verified_token(config)
    receipt = {'request_hash': digest, 'status': 'needs_review', 'operation': tool}
    def save():
        tmp = path.with_suffix('.next')
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as out:
            json.dump(receipt, out)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
    save()
    # A failed/uncertain write is never repeated automatically, including an
    # interrupted create whose upstream resource ID has not been received.
    if tool == 'docs.create':
        doc = import_docx(token, title, docx) if docx is not None else api(
            'https://docs.googleapis.com/v1/documents', token, {'title': title})
        resource = identifier(doc['id'] if docx is not None else doc['documentId'])
        receipt.update(document_id=resource, url='https://docs.google.com/document/d/' + resource + '/edit')
        save()
        if docx is not None and doc.get('mimeType') != 'application/vnd.google-apps.document':
            raise ValueError('Google did not confirm native document conversion; inspect the receipt')
        if args.get('text'):
            api('https://docs.googleapis.com/v1/documents/' + resource + ':batchUpdate', token,
                {'requests': [{'insertText': {'location': {'index': 1}, 'text': args['text']}}]})
    elif tool == 'docs.create_sheet':
        def cell_value(cell):
            if cell is None:
                return {}
            if isinstance(cell, bool):
                return {'boolValue': cell}
            if isinstance(cell, (int, float)):
                return {'numberValue': cell}
            return {'stringValue': cell}
        rows = [{'values': [{'userEnteredValue': cell_value(cell)} for cell in row]}
                for row in values]
        sheet = api('https://sheets.googleapis.com/v4/spreadsheets', token, {
            'properties': {'title': title},
            'sheets': [{'properties': {'title': 'Лист1', 'gridProperties': {
                'rowCount': max(1000, len(rows)),
                'columnCount': max(26, max((len(r) for r in values), default=0))}},
                'data': [{'startRow': 0, 'startColumn': 0, 'rowData': rows}]}]})
        receipt.update(document_id=identifier(sheet['spreadsheetId']), url=sheet['spreadsheetUrl'])
    elif tool == 'docs.update':
        body = {'requests': args['requests']}
        if args.get('write_control'):
            body['writeControl'] = args['write_control']
        updated = api('https://docs.googleapis.com/v1/documents/' + args['document_id'] + ':batchUpdate', token, body)
        # addDocumentTab returns the new tab ID here. Preserve it in the receipt
        # so a retry can inspect IDs without repeating a mutating request.
        receipt['replies'] = updated.get('replies', [])
        if updated.get('writeControl'):
            receipt['write_control'] = updated['writeControl']
    elif tool == 'docs.write_sheet':
        api('https://sheets.googleapis.com/v4/spreadsheets/' + args['document_id'] + '/values:batchUpdate', token,
            {'valueInputOption': args.get('value_input_option', 'RAW'), 'data': args['data']})
    elif tool == 'docs.format_sheet':
        api('https://sheets.googleapis.com/v4/spreadsheets/' + args['document_id'] + ':batchUpdate', token,
            {'requests': args['requests']})
    receipt['status'] = 'completed'
    if tool not in ('docs.create', 'docs.create_sheet'):
        kind = 'document' if tool == 'docs.update' else 'spreadsheets'
        receipt.update(document_id=args['document_id'],
                       url='https://docs.google.com/' + kind + '/d/' + args['document_id'] + '/edit')
    save()
    return {k: v for k, v in receipt.items() if k != 'request_hash'}

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import google_write as g


class GoogleWriteReceipts(unittest.TestCase):
    def test_partial_create_and_conflict_never_repeat_a_write(self):
        with tempfile.TemporaryDirectory() as folder:
            creds = Path(folder) / 'oauth.json'
            creds.write_text(json.dumps({'account': 'info@polzaagency.com',
                'client_id': 'test', 'client_secret': 'test', 'refresh_token': 'test'}))
            config = {'state': folder, 'googleWriteCredentials': str(creds)}
            calls = []
            def api(url, token=None, body=None, form=None):
                calls.append(url)
                if url.endswith('/token'): return {'access_token': 'test'}
                if url.endswith('/userinfo'): return {'email': 'info@polzaagency.com', 'email_verified': True}
                if url.endswith('/documents'): return {'documentId': 'document_12345'}
                raise OSError('Connection lost after possible write')
            args = {'idempotency_key': 'same-request', 'title': 'Test', 'text': 'Hello'}
            with patch.object(g, 'api', api):
                with self.assertRaises(OSError):g.write_call(config, 'marker', 'docs.create', args)
                count = len(calls)
                result = g.write_call(config, 'marker', 'docs.create', args)
                self.assertEqual(result['status'], 'needs_review')
                self.assertIn('document_12345', result['url'])
                self.assertEqual(count, len(calls))
                with self.assertRaises(ValueError):
                    g.write_call(config, 'marker', 'docs.create', {**args, 'text': 'Different'})

    def test_identity_mismatch_refuses_before_receipt_or_mutation(self):
        with tempfile.TemporaryDirectory() as folder:
            creds = Path(folder) / 'oauth.json'
            creds.write_text(json.dumps({'account': 'info@polzaagency.com',
                'client_id': 'test', 'client_secret': 'test', 'refresh_token': 'test'}))
            config = {'state': folder, 'googleWriteCredentials': str(creds)}
            with patch.object(g, 'api', side_effect=[{'access_token': 'test'},
                {'email': 'someone@example.com', 'email_verified': True}]) as api:
                with self.assertRaises(ValueError):
                    g.write_call(config, 'owner', 'docs.create_sheet', {'title': 'Test', 'idempotency_key': 'test'})
                self.assertEqual(api.call_count, 2)
                self.assertEqual(list((Path(folder) / 'google-write-receipts').glob('*.json')), [])

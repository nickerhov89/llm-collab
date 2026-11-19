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


class RichGoogleDocuments(unittest.TestCase):
    def package(self):
        import io
        import zipfile
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as docx:
            for name in ('[Content_Types].xml', '_rels/.rels', 'word/document.xml'):
                docx.writestr(name, '<fixture/>')
        return out.getvalue()

    def test_tab_replies_survive_idempotent_replay_without_duplicate_tab(self):
        with tempfile.TemporaryDirectory() as folder:
            config = {'state': folder}
            args = {'document_id': 'document_12345', 'idempotency_key': 'add-article-tab',
                    'requests': [{'addDocumentTab': {'tabProperties': {'title': 'Article'}}}]}
            reply = {'replies': [{'addDocumentTab': {'tabProperties': {'tabId': 'tab_test'}}}],
                     'writeControl': {'requiredRevisionId': 'revision_test'}}
            with patch.object(g, 'verified_token', return_value='private'), patch.object(g, 'api', return_value=reply) as api:
                first = g.write_call(config, 'owner', 'docs.update', args)
                second = g.write_call(config, 'owner', 'docs.update', args)
                self.assertEqual(first, second)
                self.assertEqual(first['replies'][0]['addDocumentTab']['tabProperties']['tabId'], 'tab_test')
                self.assertEqual(api.call_count, 1)
                self.assertNotIn('private', json.dumps(first))

    def test_native_docx_import_is_private_and_uncertain_writes_are_not_replayed(self):
        import base64
        with tempfile.TemporaryDirectory() as folder:
            args = {'title': 'Rich document', 'idempotency_key': 'rich-fixture',
                    'docx_base64': base64.b64encode(self.package()).decode()}
            config = {'state': folder}
            with patch.object(g, 'verified_token', return_value='private'), patch.object(
                    g, 'import_docx', side_effect=OSError('Upload outcome unknown')) as upload:
                with self.assertRaises(OSError):g.write_call(config, 'marker', 'docs.create', args)
                receipt = g.write_call(config, 'marker', 'docs.create', args)
                self.assertEqual(receipt['status'], 'needs_review')
                self.assertEqual(upload.call_count, 1)
                self.assertNotIn('docx_base64', json.dumps(receipt))
                self.assertNotIn('private', json.dumps(receipt))

    def test_invalid_and_macro_packages_are_rejected_before_oauth(self):
        import base64
        import io
        import zipfile
        with tempfile.TemporaryDirectory() as folder, patch.object(g, 'verified_token') as token:
            valid = self.package()
            for blob in (b'not docx', valid + b''):
                if blob == valid:
                    out = io.BytesIO(valid)
                    with zipfile.ZipFile(out, 'a') as docx:docx.writestr('word/vbaProject.bin', 'macro')
                    blob = out.getvalue()
                with self.assertRaises(ValueError):
                    g.write_call({'state': folder}, 'owner', 'docs.create', {
                        'title': 'Rejected', 'idempotency_key': 'reject',
                        'docx_base64': base64.b64encode(blob).decode()})
            token.assert_not_called()

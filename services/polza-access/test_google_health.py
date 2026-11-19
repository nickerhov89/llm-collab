import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import broker
import google_write


class GoogleConnectionHealth(unittest.TestCase):
    def test_oauth_writes_survive_expired_cookie_and_respect_read_grant(self):
        with tempfile.TemporaryDirectory() as folder:
            policy = Path(folder) / 'policy.json'
            policy.write_text(json.dumps({'version': 1, 'connections': {
                'docs': {'configured': True}}, 'users': {'marker': {'docs': 'read'}}}))
            b = broker.Broker({'actors': {'1001': 'owner', '2004': 'marker'}, 'policy': str(policy), 'home': folder, 'docsReader': '/reader'})
            with patch.object(broker, 'google_token', return_value='private'), patch.object(
                    broker.subprocess, 'run', return_value=type('Exit', (), {'returncode': 1})()):
                status = b.dispatch('marker', 'docs.check', {})
                self.assertTrue(status['oauth_connected'])
                self.assertFalse(status['browser_session_connected'])
                self.assertFalse(status['native_write_available'])
                self.assertNotIn('private', json.dumps(status))
                self.assertTrue(b.dispatch('owner', 'docs.check', {})['native_write_available'])

    def test_both_connections_missing_is_actionable(self):
        b = broker.Broker({'actors': {'1001': 'owner'}, 'home': '/tmp', 'docsReader': '/reader'})
        with patch.object(broker, 'google_token', side_effect=ValueError('revoked')), patch.object(
                broker.subprocess, 'run', side_effect=OSError('unavailable')):
            with self.assertRaises(broker.ConnectorError) as error:
                b.dispatch('owner', 'docs.check', {})
            self.assertEqual(error.exception.code, 'google_reauthorization_required')

    def test_native_read_validates_destination_before_using_credentials(self):
        with patch.object(google_write, 'verified_token') as token:
            for url in ['https://evil.example/document/d/document_12345',
                        'https://docs.google.com@evil.example/document/d/document_12345']:
                with self.assertRaises(ValueError):
                    google_write.read_native({}, url)
            token.assert_not_called()

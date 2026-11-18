import http.server
import json
import threading
import unittest
from cowork_access import cowork_call, CoworkError


class NativeBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.events = []
        cls.revoked = False
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def handle_api(self):
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
                path = self.path.split('?')[0]
                cls.events.append((self.command, path, self.headers.get('Cookie', '')))
                code, value, cookies = 200, {}, []
                if path == '/api/auth/login':
                    cookies = ['yep-anywhere-session=private; HttpOnly']
                elif path == '/api/users/switch':
                    if body.get('username') != 'marker' or cls.revoked:
                        code = 403
                    else:
                        cookies = ['yep-anywhere-acting-user=marker; HttpOnly']
                elif path == '/api/auth/logout':
                    pass
                elif 'yep-anywhere-acting-user=marker' not in self.headers.get('Cookie', ''):
                    code = 403
                elif path == '/api/users/me':
                    value = {'username': 'marker', 'superuser': True, 'switched': True, 'grants': {'viewProjects': ['visible']}}
                elif path == '/api/projects':
                    value = {'projects': [{'id': 'visible', 'name': 'Marketing'}]}
                elif path in ('/api/sessions', '/api/projects/visible/sessions'):
                    value = {'sessions': [{'id': 'chat', 'projectId': 'visible', 'customTitle': 'YouTube', 'updatedAt': '2026-11-18T00:00:00Z'}, {'id': 'secret', 'projectId': 'hidden'}, {'id': 'chat-b', 'projectId': 'visible', 'title': 'Other', 'updatedAt': '2026-11-18T00:00:00Z'}], 'hasMore': False}
                elif path == '/api/projects/visible/sessions/chat/metadata':
                    value = {'session': {'id': 'chat'}}
                elif path == '/api/projects/visible/sessions/chat':
                    value = {'session': {'title': 'YouTube'}, 'messages': [
                        {'type': 'system', 'uuid': 's', 'message': {'content': 'HIDDEN_SYSTEM'}},
                        {'type': 'user', 'uuid': 'meta', 'isMeta': True, 'message': {'content': 'HIDDEN_META'}},
                        {'type': 'user', 'uuid': 'user', 'message': {'content': [{'type': 'text', 'text': 'YouTube sources'}, {'type': 'tool_result', 'content': 'HIDDEN_TOOL'}]}},
                        {'type': 'assistant', 'uuid': 'answer', 'message': {'content': [{'type': 'thinking', 'thinking': 'HIDDEN_THINKING'}, {'type': 'text', 'text': 'Article ' * 1000}]}}
                    ], 'pagination': {'hasOlderMessages': True}}
                else:
                    code = 404
                raw = json.dumps(value).encode()
                self.send_response(code)
                for cookie in cookies:
                    self.send_header('Set-Cookie', cookie)
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers(); self.wfile.write(raw)
            do_GET = do_POST = handle_api
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.worker.start()
        cls.config = {'realms': {'marker': {'host': 'cowork-marker.test', 'port': cls.server.server_port, 'adminPassword': 'fixture'}}}

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.worker.join()

    def setUp(self):
        self.events.clear(); type(self).revoked = False

    def test_catalog_pages_equal_timestamps_without_skipping_and_rejects_stale_scope(self):
        first = cowork_call(self.config, 'marker', 'cowork.chats', {'limit': 1})
        second = cowork_call(self.config, 'marker', 'cowork.chats', {'limit': 1, 'cursor': first['next_cursor']})
        self.assertEqual({first['chats'][0]['session_id'], second['chats'][0]['session_id']}, {'chat', 'chat-b'})
        self.assertFalse(second['has_more'])
        with self.assertRaises(ValueError):
            cowork_call(self.config, 'marker', 'cowork.chats', {'query': 'changed', 'cursor': first['next_cursor']})

    def test_read_never_returns_hidden_or_tool_content_and_pages_long_text(self):
        result = cowork_call(self.config, 'marker', 'cowork.read', {'project_id': 'visible', 'session_id': 'chat', 'max_chars': 100})
        self.assertNotIn('HIDDEN_', json.dumps(result))
        row = result['messages'][-1]; self.assertEqual(row['next_offset'], 100)
        next_part = cowork_call(self.config, 'marker', 'cowork.read', {'project_id': 'visible', 'session_id': 'chat', 'message_id': row['message_id'], 'offset': 100, 'max_chars': 100})
        self.assertEqual(next_part['messages'][0]['offset'], 100)
        self.assertTrue(result['history_partial'])
        reads = [e for e in self.events if e[0] == 'GET']
        self.assertTrue(all('yep-anywhere-acting-user=marker' in e[2] for e in reads))
        self.assertTrue(all(e[1] in ('/api/auth/login', '/api/users/switch', '/api/auth/logout') for e in self.events if e[0] == 'POST'))

    def test_denied_project_unknown_session_and_actor_override_fail_closed(self):
        with self.assertRaises(CoworkError):
            cowork_call(self.config, 'marker', 'cowork.projects', {'workspace': 'owner'})
        type(self).revoked = True
        with self.assertRaises(CoworkError):
            cowork_call(self.config, 'marker', 'cowork.projects', {})
        type(self).revoked = False
        with self.assertRaises(CoworkError):
            cowork_call(self.config, 'marker', 'cowork.read', {'project_id': 'hidden', 'session_id': 'secret'})
        self.assertFalse(any('/sessions/secret' in e[1] for e in self.events))
        with self.assertRaises(CoworkError):
            cowork_call(self.config, 'marker', 'cowork.read', {'project_id': 'visible', 'session_id': 'secret'})
        with self.assertRaises(ValueError):
            cowork_call(self.config, 'marker', 'cowork.projects', {'actor': 'owner'})
        with self.assertRaises(ValueError):
            cowork_call(self.config, 'marker', 'cowork.send', {})
        type(self).revoked = True
        with self.assertRaises(CoworkError):
            cowork_call(self.config, 'marker', 'cowork.projects', {})

    def test_catalog_defense_and_incomplete_search_are_explicit(self):
        catalog = cowork_call(self.config, 'marker', 'cowork.chats', {'query': 'YouTube'})
        self.assertEqual([r['session_id'] for r in catalog['chats']], ['chat'])
        result = cowork_call(self.config, 'marker', 'cowork.search', {'project_id': 'visible', 'session_id': 'chat', 'query': 'YouTube'})
        self.assertEqual(result['matches'][0]['message_id'], 'user')
        self.assertTrue(result['has_older_messages'])
        self.assertTrue(result['next_before_message_id'])
        empty = cowork_call(self.config, 'marker', 'cowork.search', {'project_id': 'visible', 'session_id': 'chat', 'query': 'not here'})
        self.assertEqual(empty['matches'], [])
        self.assertTrue(empty['has_older_messages'])

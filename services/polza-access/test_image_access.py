import base64
import tempfile
from pathlib import Path
import unittest
from image_access import image_call


class Images(unittest.TestCase):
    def test_paid_replay_is_suppressed_and_other_actor_cannot_read(self):
        with tempfile.TemporaryDirectory() as root:
            config = {'state': root, 'model': 'example/image', 'dailyImages': 1}
            args = {'prompt': 'a sketch', 'idempotency_key': 'example-001'}
            calls = []
            def generate(body):
                calls.append(body)
                return {'data': [{'b64_json': base64.b64encode(b'\x89PNG\r\n\x1a\nexample').decode()}]}
            result = image_call(config, 'marker', 'images.generate', args, generate)
            duplicate = image_call(config, 'marker', 'images.generate', args, generate)
            self.assertTrue(duplicate['duplicate_suppressed'])
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0]['n'], 1)
            self.assertEqual(calls[0]['resolution'], '1K')
            with self.assertRaises(FileNotFoundError):
                image_call(config, 'ceo', 'images.download', {'job_id': result['job_id']})
            with self.assertRaises(ValueError):
                image_call(config, 'marker', 'images.generate', {**args, 'prompt': 'other'}, generate)
            with self.assertRaises(ValueError):
                image_call(config, 'marker', 'images.generate', {**args, 'idempotency_key': 'example-002'}, generate)
            self.assertFalse(any('a sketch' in p.read_text() for p in Path(root).rglob('*.json')))

    def test_ambiguous_failure_is_not_replayed_and_options_fail_closed(self):
        with tempfile.TemporaryDirectory() as root:
            config = {'state': root, 'model': 'example/image', 'dailyImages': 20}
            args = {'prompt': 'a sketch', 'idempotency_key': 'example-001'}
            def fail(body):
                raise TimeoutError('upstream accepted, response lost')
            with self.assertRaises(TimeoutError):
                image_call(config, 'marker', 'images.generate', args, fail)
            receipt = image_call(config, 'marker', 'images.generate', args, lambda b: self.fail('replayed'))
            self.assertEqual(receipt['status'], 'unconfirmed')
            for extra in [{'model': 'arbitrary'}, {'url': 'http://localhost'}, {'n': 99}]:
                with self.assertRaises(ValueError):
                    image_call(config, 'marker', 'images.generate', {**args, **extra}, fail)
            with self.assertRaises(ValueError):
                image_call(config, 'marker', 'images.download', {'job_id': '../other'})


if __name__ == '__main__':
    unittest.main()

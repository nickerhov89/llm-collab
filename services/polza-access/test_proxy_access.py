import json
from pathlib import Path
import socket
import tempfile
import unittest
from proxy_access import public_url, proxy_call


class ProxyBoundary(unittest.TestCase):
    def resolve(self, host, port, **kwargs):
        address = {"private.test": "127.0.0.1", "metadata.test": "169.254.169.254",
                   "cowork.test": "66.248.207.236"}.get(host, "93.184.216.34")
        return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", (address, port))]

    def test_public_target_and_private_redirect_validation(self):
        self.assertEqual(public_url("https://example.com/a", self.resolve), "https://example.com/a")
        for url in ["https://private.test/", "http://metadata.test/", "https://cowork.test/",
                    "file:///etc/passwd", "https://user:pass@example.com/", "http://example.com:22/",
                    "https://example.com/\r\nAuthorization: secret"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                public_url(url, self.resolve)

    def test_status_does_not_disclose_provider_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / "proxy.json"
            p.write_text(json.dumps({"host": "proxy.test", "port": 1234,
                                     "username": "private-user", "password": "private-password"}))
            value = json.dumps(proxy_call(p, "proxy.status", {}))
            self.assertNotIn("private-user", value)
            self.assertNotIn("private-password", value)
            self.assertIn("proxy.test:1234", value)


if __name__ == "__main__":
    unittest.main()

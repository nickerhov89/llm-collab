import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("broker", Path(__file__).with_name("broker.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AccessBoundary(unittest.TestCase):
    def test_images_generation_requires_write_and_revocation_is_immediate(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "policy.json"
            policy = {"version": 1, "connections": {"images": {"configured": True}},
                      "users": {"marker": {"images": "read"}}}
            file.write_text(json.dumps(policy))
            broker = module.Broker({"actors": {"2004": "marker"}, "policy": str(file)})
            broker.allowed("marker", "images.status")
            with self.assertRaises(module.Denied):
                broker.allowed("marker", "images.generate")
            policy["users"]["marker"]["images"] = "write"
            file.write_text(json.dumps(policy))
            broker.allowed("marker", "images.generate")
            policy["users"]["marker"]["images"] = "none"
            file.write_text(json.dumps(policy))
            with self.assertRaises(module.Denied):
                broker.allowed("marker", "images.download")

    def test_telegram_read_cannot_send(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "policy.json"
            policy = {"version": 1, "connections": {"telegram": {"configured": True}},
                      "users": {"marker": {"telegram": "read"}}}
            file.write_text(json.dumps(policy))
            broker = module.Broker({"actors": {"2004": "marker"}, "policy": str(file)})
            broker.allowed("marker", "telegram.profile")
            broker.allowed("marker", "telegram.messages")
            with self.assertRaises(module.Denied):
                broker.allowed("marker", "telegram.send")
            policy["users"]["marker"]["telegram"] = "write"
            file.write_text(json.dumps(policy))
            broker.allowed("marker", "telegram.send")

    def test_revocation_and_actor_spoofing(self):
        with tempfile.TemporaryDirectory() as folder:
            policy = Path(folder) / "policy.json"
            document = {"version": 1, "users": {"marker": {"gmail": "read"}},
                        "connections": {"gmail": {"configured": True}}}
            policy.write_text(json.dumps(document))
            broker = module.Broker({"actors": {"2004": "marker"}, "policy": str(policy), "state": folder})
            broker.active = lambda actor: True
            calls = []
            broker.dispatch = lambda actor, tool, args: calls.append((actor, tool)) or {"read": True}
            self.assertEqual(broker.handle(2004, {"tool": "gmail.search", "actor": "owner"}), {"read": True})
            self.assertEqual(calls, [("marker", "gmail.search")])
            with self.assertRaises(module.Denied):
                broker.handle(2004, {"tool": "gmail.send", "actor": "owner"})
            document["users"]["marker"]["gmail"] = "none"
            policy.write_text(json.dumps(document))
            with self.assertRaises(module.Denied):
                broker.handle(2004, {"tool": "gmail.search"})
            with self.assertRaises(module.Denied):
                broker.handle(12345, {"tool": "gmail.search", "actor": "marker"})
            document["users"]["marker"]["gmail"] = "write"
            policy.write_text(json.dumps(document))
            broker.active = lambda actor: False
            with self.assertRaises(module.Denied):
                broker.handle(2004, {"tool": "gmail.send"})
            self.assertEqual(len(calls), 1)

    def test_fail_closed_corrupt_policy_and_arbitrary_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            policy = Path(folder) / "policy.json"
            policy.write_text('invalid')
            broker = module.Broker({"actors": {"2004": "marker"}, "policy": str(policy)})
            broker.active = lambda actor: True
            with self.assertRaises(ValueError):
                broker.handle(2004, {"tool": "gmail.search"})
            with self.assertRaises(module.Denied):
                broker.handle(2004, {"tool": "exec", "arguments": {"command": "id"}})


if __name__ == "__main__":
    unittest.main()

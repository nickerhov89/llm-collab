import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("corporate_gmail", Path(__file__).with_name("server.py"))
mail = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mail)


class MailBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.project = self.root / "seo"
        self.project.mkdir()
        self.arguments = {"to": ["editor@example.com"], "subject": "Проверка»,", "body": "Текст статьи", "idempotency_key": "one"}
        for name, value in [("PROJECT", self.project), ("STATE", self.root / "state")]:
            patcher = patch.object(mail, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_mime_headers_and_project_attachment_boundary(self):
        bad = {**self.arguments, "subject": "Story\r\nBcc: hidden@example.com"}
        with self.assertRaises(ValueError):
            mail.compose(bad)
        outside = self.root / "private.txt"
        outside.write_text("secret")
        link = self.project / "public.txt"
        link.symlink_to(outside)
        with self.assertRaises(ValueError):
            mail.compose({**self.arguments, "attachments": [str(link)]})
        cover = self.project / "cover.jpg"
        cover.write_bytes(b"fixture")
        args = {**self.arguments, "attachments": [str(cover)]}
        raw = mail.compose(args)
        self.assertEqual(raw, mail.compose(args))
        self.assertIn(b"Content-Disposition: attachment", raw)
        self.assertIn(b"info@polzaagency.com", raw)

    def test_no_duplicate_send_or_conflicting_key(self):
        with patch.object(mail, "profile"), patch.object(mail, "verify_sender"), patch.object(mail, "gmail", return_value={"id": "abcd", "threadId": "ef01"}) as api:
            first = mail.send(self.arguments)
            second = mail.send(self.arguments)
            self.assertEqual(first["id"], second["id"])
            self.assertTrue(second["duplicate_prevented"])
            self.assertEqual(api.call_count, 1)
            with self.assertRaises(ValueError):
                mail.send({**self.arguments, "body": "Changed text"})
            self.assertEqual(api.call_count, 1)

    def test_ambiguous_send_is_never_retried(self):
        with patch.object(mail, "profile"), patch.object(mail, "verify_sender"), patch.object(mail, "gmail", side_effect=TimeoutError) as api:
            with self.assertRaises(RuntimeError):
                mail.send(self.arguments)
            with self.assertRaises(RuntimeError):
                mail.send(self.arguments)
            self.assertEqual(api.call_count, 1)

    def test_different_account_is_rejected(self):
        with patch.object(mail, "gmail", return_value={"emailAddress": "someone@example.com"}):
            with self.assertRaises(RuntimeError):
                mail.profile()
        with patch.object(mail, "access_token", return_value="not-a-real-token"), patch.object(mail, "request_json", return_value={"user": {"emailAddress": "someone@example.com"}}):
            with self.assertRaises(RuntimeError):
                mail.verify_sender()


if __name__ == "__main__":
    unittest.main()

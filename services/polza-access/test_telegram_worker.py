import asyncio
from pathlib import Path
import tempfile
import unittest
from telegram_worker import chat_id, send_once, OperationError, query_arguments, links_from_message, bounded_operation
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


class TelegramBoundary(unittest.IsolatedAsyncioTestCase):
    async def test_read_reconnect_is_bounded_and_sends_never_replay(self):
        with patch('telegram_worker.operation', new=AsyncMock(side_effect=[ConnectionError(), {'connected': True}])) as call, patch('telegram_worker.asyncio.sleep', new=AsyncMock()):
            result = await bounded_operation({}, {'tool': 'telegram.profile'})
            self.assertTrue(result['read_reconnected'])
            self.assertEqual(call.await_count, 2)
        for tool, count in [('telegram.send', 1), ('telegram.profile', 2)]:
            with patch('telegram_worker.operation', new=AsyncMock(side_effect=ConnectionError())) as call, patch('telegram_worker.asyncio.sleep', new=AsyncMock()):
                with self.assertRaises(ConnectionError):
                    await bounded_operation({}, {'tool': tool})
                self.assertEqual(call.await_count, count)

    def test_explicit_target(self):
        self.assertEqual(chat_id("@example_bot"), "@example_bot")
        self.assertEqual(chat_id("-10012345"), -10012345)
        self.assertEqual(chat_id("me"), "me")
        self.assertEqual(chat_id("https://t.me/example_bot"), "@example_bot")
        for value in [True, 0, "+79660000000", "https://t.me/+invite", "../../config.json"]:
            with self.subTest(value=value), self.assertRaises(OperationError):
                chat_id(value)

    def test_search_bounds_and_hidden_links_with_utf16_offsets(self):
        self.assertEqual(query_arguments({"query": "B2B", "limit": 5}), "B2B")
        self.assertEqual(query_arguments({}, links=True), "")
        for args in [{}, {"query": "x", "limit": 51}, {"query": "x", "offset_id": -1},
                     {"query": "x", "join": True}]:
            with self.assertRaises(OperationError):
                query_arguments(args)
        entity = type('MessageEntityUrl', (), {'offset': 3, 'length': 14})()
        message = SimpleNamespace(message='😀 t.me/example_a', entities=[entity,
            SimpleNamespace(url='https://t.me/hidden_link')])
        self.assertEqual(links_from_message(message), ['t.me/example_a', 'https://t.me/hidden_link'])

    async def test_duplicate_conflict_and_actor_separation(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            calls = []
            async def send(chat, text, reply, random_id):
                calls.append((chat, text, random_id))
                return {"message_id": len(calls)}
            args = {"chat": "@example_bot", "text": "Fixture only", "idempotency_key": "same-key"}
            first = await send_once(state, "marker", args, send)
            second = await send_once(state, "marker", args, send)
            self.assertEqual(first["message_id"], second["message_id"])
            self.assertTrue(second["duplicate_suppressed"])
            self.assertEqual(len(calls), 1)
            with self.assertRaises(OperationError):
                await send_once(state, "marker", {**args, "text": "Changed"}, send)
            await send_once(state, "ceo", args, send)
            self.assertNotEqual(calls[0][2], calls[1][2])

    async def test_ambiguous_send_is_not_replayed(self):
        with tempfile.TemporaryDirectory() as folder:
            calls = []
            async def lost_response(*args):
                calls.append(args)
                raise TimeoutError("Simulated response loss after acceptance")
            args = {"chat": "me", "text": "Fixture only", "idempotency_key": "lost"}
            for _ in range(2):
                with self.assertRaises(OperationError) as error:
                    await send_once(Path(folder), "marker", args, lost_response)
                self.assertEqual(error.exception.code, "send_unconfirmed")
            self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()

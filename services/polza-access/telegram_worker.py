"""One bounded Telegram operation, using a private shared session and proxy.

Only this subprocess imports the existing Telethon environment. A process lock
serializes the SQLite session across all people; idle workers do not persist.
"""
import asyncio
import contextlib
import datetime
import fcntl
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import re
import sys
import tempfile
import warnings

ACTORS = {"owner", "ceo", "cfo", "cto", "marker"}
TOOLS = {"telegram.profile", "telegram.dialogs", "telegram.messages", "telegram.send", "telegram.search", "telegram.links", "telegram.similar", "telegram.search_chats"}


class OperationError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def chat_id(value):
    if type(value) is int and value != 0:
        return value
    if isinstance(value, str):
        public = re.fullmatch(r"https?://(?:t\.me|telegram\.me)/([A-Za-z][A-Za-z0-9_]{3,31})/?", value)
        if public:
            return "@" + public.group(1)
        if value == "me":
            return "me"
        if re.fullmatch(r"-?[1-9][0-9]{0,19}", value):
            return int(value)
        if re.fullmatch(r"@[A-Za-z][A-Za-z0-9_]{3,31}", value):
            return value
    raise OperationError("invalid_arguments", "Use a chat ID from dialogs, @username, or me; phone imports and invite links are not supported")


def bounded_limit(arguments, default):
    value = arguments.get("limit", default)
    if type(value) is not int or not 1 <= value <= 50:
        raise OperationError("invalid_arguments", "limit must be 1..50")
    return value


def atomic_json(file, data):
    fd, temporary = tempfile.mkstemp(prefix=".telegram-", dir=file.parent)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(data, output, ensure_ascii=False)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, file)
        directory = os.open(file.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def query_arguments(arguments, links=False):
    allowed = {"query", "chat", "limit", "before_id", "offset_rate", "offset_peer", "offset_id"}
    if set(arguments) - allowed:
        raise OperationError("invalid_arguments", "Unsupported Telegram search arguments")
    query = arguments.get("query", "")
    if not isinstance(query, str) or len(query) > 200 or (not links and not query.strip()):
        raise OperationError("invalid_arguments", "query must contain 1..200 characters (empty allowed for links)")
    bounded_limit(arguments, 20)
    for key in ["before_id", "offset_rate", "offset_id"]:
        if type(arguments.get(key, 0)) is not int or arguments.get(key, 0) < 0:
            raise OperationError("invalid_arguments", key + " must be non-negative")
    if arguments.get("chat") is not None and any(k in arguments for k in ["offset_rate", "offset_peer", "offset_id"]):
        raise OperationError("invalid_arguments", "Use before_id for a single-chat search")
    if arguments.get("chat") is None and arguments.get("before_id", 0):
        raise OperationError("invalid_arguments", "Use next_offset for account-wide search")
    return query


def links_from_message(message):
    text = (message.message or "")[:8192]
    urls = re.findall(r"(?:https?://|tg://|(?<![\w.])t\.me/)[^\s<>]+", text)
    encoded = text.encode("utf-16-le")
    for entity in getattr(message, "entities", None) or []:
        if getattr(entity, "url", None):
            urls.append(entity.url)
        elif type(entity).__name__ == "MessageEntityUrl":
            urls.append(encoded[entity.offset * 2:(entity.offset + entity.length) * 2].decode("utf-16-le", errors="ignore"))
    return list(dict.fromkeys(u.rstrip(".,;:!?)]}") for u in urls if isinstance(u, str)))[:20]


def peer_summary(entity):
    from telethon import utils
    username = getattr(entity, "username", None)
    return {"id": utils.get_peer_id(entity), "title": getattr(entity, "title", None),
            "username": username, "url": "https://t.me/" + username if username else None,
            "participants_count": getattr(entity, "participants_count", None)}


def search_message(message, peers):
    from telethon import utils
    peer = utils.get_peer_id(message.peer_id)
    entity = peers.get(peer)
    username = getattr(entity, "username", None)
    return {"id": message.id, "chat_id": peer, "chat_title": getattr(entity, "title", None),
            "chat_username": username, "date": message.date.isoformat() if message.date else None,
            "text": (message.message or "")[:8192], "urls": links_from_message(message),
            "message_url": "https://t.me/" + username + "/" + str(message.id) if username else None}


async def send_once(state, actor, arguments, send):
    if set(arguments) - {"chat", "text", "idempotency_key", "reply_to"}:
        raise OperationError("invalid_arguments", "Only plain-text messages and reply_to are supported; attachments and other actions are not connected")
    target = chat_id(arguments.get("chat"))
    text = arguments.get("text")
    key = arguments.get("idempotency_key")
    reply = arguments.get("reply_to")
    if not isinstance(text, str) or not text.strip() or len(text.encode("utf-16-le")) // 2 > 4096:
        raise OperationError("invalid_arguments", "text must contain 1..4096 Telegram characters")
    if not isinstance(key, str) or not 1 <= len(key) <= 200:
        raise OperationError("invalid_arguments", "A stable idempotency_key is required")
    if reply is not None and (type(reply) is not int or reply < 1):
        raise OperationError("invalid_arguments", "reply_to must be a positive message ID")
    digest = hashlib.sha256((actor + "\0" + key).encode()).hexdigest()
    content_hash = hashlib.sha256(json.dumps([target, text, reply], ensure_ascii=False).encode()).hexdigest()
    receipt = state / ("send-" + digest + ".json")
    if receipt.exists():
        previous = json.loads(receipt.read_text())
        if previous.get("content_hash") != content_hash:
            raise OperationError("idempotency_conflict", "This key was used for another message; do not silently change it")
        if previous.get("status") == "sent":
            return {**previous, "duplicate_suppressed": True}
        raise OperationError("send_unconfirmed", "Previous send is pending or unconfirmed. Inspect the chat before retrying; no automatic replay")
    if sum(1 for _ in state.glob("send-*.json")) >= 5000:
        raise OperationError("receipt_limit", "Send receipt store is full; ask the owner to archive it")
    pending = {"status": "pending", "actor": actor, "content_hash": content_hash,
               "at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    # A second process cannot pass admission even if it skipped the outer lock.
    try:
        fd = os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as output:
            json.dump(pending, output)
            output.flush()
            os.fsync(output.fileno())
        directory = os.open(state, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except FileExistsError:
        raise OperationError("send_unconfirmed", "Another send with this key is in progress; inspect its receipt") from None
    random_id = int.from_bytes(bytes.fromhex(digest[:16]), "little", signed=True)
    try:
        result = await send(target, text, reply, random_id)
    except BaseException:
        atomic_json(receipt, {**pending, "status": "unconfirmed"})
        raise OperationError("send_unconfirmed", "Send outcome is unconfirmed. Inspect the chat before any new send; automatic replay refused") from None
    result = {**pending, "status": "sent", **result}
    atomic_json(receipt, result)
    return result


async def operation(config, request):
    from opentele.tl import TelegramClient
    from opentele.api import API
    from telethon import utils
    from telethon.tl.functions.messages import SendMessageRequest, SearchGlobalRequest
    from telethon.tl.functions.channels import GetChannelRecommendationsRequest
    from telethon.tl.functions.contacts import SearchRequest
    from telethon.tl.types import InputMessagesFilterEmpty, InputMessagesFilterUrl, InputPeerEmpty
    from telethon.tl.types import InputReplyToMessage
    import socks

    tool = request["tool"]
    arguments = request.get("arguments", {})
    p = json.loads(Path(config["proxy_config"]).read_text())
    proxy = (socks.HTTP, p["host"], int(p["port"]), True, p["username"], p["password"])
    client = TelegramClient(config["session"], api=API.TelegramDesktop, proxy=proxy,
                            connection_retries=0, request_retries=0, auto_reconnect=False,
                            timeout=10, flood_sleep_threshold=0, receive_updates=False)
    try:
        await asyncio.wait_for(client.connect(), 18)
        if not await client.is_user_authorized():
            raise OperationError("login_required", "Telegram session was revoked or expired; ask the owner to reconnect")
        me = await client.get_me()
        if me.id != config["expected_user_id"]:
            raise OperationError("account_mismatch", "Telegram account differs from the approved shared session")
        if tool == "telegram.profile":
            return {"connected": True, "id": me.id, "username": me.username,
                    "display_name": " ".join(x for x in [me.first_name, me.last_name] if x),
                    "phone_last4": (me.phone or "")[-4:], "through_proxy": True,
                    "premium": bool(getattr(me, "premium", False)),
                    "capabilities": ["dialogs", "messages", "search", "links", "similar", "search_chats", "send"]}
        if tool == "telegram.dialogs":
            dialogs = []
            async for d in client.iter_dialogs(limit=bounded_limit(arguments, 20)):
                dialogs.append({"id": d.id, "name": d.name,
                    "username": getattr(d.entity, "username", None), "unread_count": d.unread_count,
                    "type": "channel" if d.is_channel else "group" if d.is_group else "user"})
            return {"dialogs": dialogs, "marks_read": False}
        if tool == "telegram.messages":
            chat = chat_id(arguments.get("chat"))
            before = arguments.get("before_id", 0)
            if type(before) is not int or before < 0:
                raise OperationError("invalid_arguments", "before_id must be a non-negative message ID")
            messages = await client.get_messages(chat, limit=bounded_limit(arguments, 20), max_id=before)
            return {"chat": chat, "marks_read": False, "messages": [
                {"id": m.id, "date": m.date.isoformat() if m.date else None,
                 "sender_id": m.sender_id, "out": m.out, "text": (m.message or "")[:8192],
                 "media_type": type(m.media).__name__ if m.media else None}
                for m in messages]}
        if tool == "telegram.search_chats":
            if set(arguments) - {"query", "limit"}:
                raise OperationError("invalid_arguments", "Use query and limit")
            query = query_arguments(arguments)
            result = await client(SearchRequest(q=query, limit=bounded_limit(arguments, 20)))
            return {"chats": [peer_summary(c) for c in result.chats][:bounded_limit(arguments, 20)],
                    "joined": False, "marks_read": False}
        if tool == "telegram.similar":
            if set(arguments) - {"chat", "limit"}:
                raise OperationError("invalid_arguments", "Use chat and limit")
            entity = await client.get_entity(chat_id(arguments.get("chat")))
            if not getattr(entity, "broadcast", False):
                raise OperationError("invalid_arguments", "Similar recommendations require a broadcast channel")
            result = await client(GetChannelRecommendationsRequest(channel=entity))
            return {"source": peer_summary(entity),
                    "channels": [peer_summary(c) for c in result.chats][:bounded_limit(arguments, 20)],
                    "total": getattr(result, "count", None), "premium": bool(getattr(me, "premium", False)),
                    "joined": False, "marks_read": False}
        if tool in {"telegram.search", "telegram.links"}:
            query = query_arguments(arguments, links=tool == "telegram.links")
            limit = bounded_limit(arguments, 20)
            filter_ = InputMessagesFilterUrl() if tool == "telegram.links" else InputMessagesFilterEmpty()
            if arguments.get("chat") is not None:
                chat = chat_id(arguments["chat"])
                entity = await client.get_entity(chat)
                messages = await client.get_messages(entity, limit=limit, search=query, filter=filter_,
                                                     max_id=arguments.get("before_id", 0))
                peers = {utils.get_peer_id(entity): entity}
                next_offset = {"before_id": messages[-1].id} if messages else None
                total = getattr(messages, "total", None)
            else:
                offset_peer = await client.get_input_entity(chat_id(arguments["offset_peer"])) if arguments.get("offset_peer") is not None else InputPeerEmpty()
                result = await client(SearchGlobalRequest(q=query, filter=filter_, min_date=None, max_date=None,
                    offset_rate=arguments.get("offset_rate", 0), offset_peer=offset_peer,
                    offset_id=arguments.get("offset_id", 0), limit=limit))
                messages = result.messages
                peers = {utils.get_peer_id(e): e for e in [*result.chats, *result.users]}
                next_offset = {"offset_rate": getattr(result, "next_rate", 0) or 0,
                    "offset_peer": utils.get_peer_id(messages[-1].peer_id), "offset_id": messages[-1].id} if messages else None
                total = getattr(result, "count", None)
            return {"messages": [search_message(m, peers) for m in messages], "total": total,
                    "next_offset": next_offset, "marks_read": False, "scope": "chat" if arguments.get("chat") is not None else "account_history"}
        if tool == "telegram.send":
            chat = chat_id(arguments.get("chat"))
            # Resolve before creating a pending send; a bad recipient sends nothing.
            peer = await client.get_input_entity(chat)
            async def send(target, text, reply, random_id):
                response = await client(SendMessageRequest(peer=peer, message=text, random_id=random_id,
                    no_webpage=True, reply_to=InputReplyToMessage(reply) if reply else None))
                message_id = getattr(response, "id", None)
                for update in getattr(response, "updates", []):
                    if getattr(update, "random_id", None) == random_id:
                        message_id = update.id
                    elif getattr(update, "message", None) is not None:
                        message_id = message_id or getattr(update.message, "id", None)
                return {"message_id": message_id, "chat": target}
            return await send_once(Path(config["state"]), request["actor"], arguments, send)
        raise OperationError("invalid_arguments", "Unsupported Telegram operation")
    finally:
        try:
            await asyncio.wait_for(client.disconnect(), 3)
        except Exception:
            pass


async def bounded_operation(config, request):
    for attempt in range(2):
        try:
            result = await operation(config, request)
            return {**result, **({"read_reconnected": True} if attempt else {})}
        except (ConnectionError, TimeoutError):
            if request["tool"] == "telegram.send" or attempt:
                raise
            await asyncio.sleep(0.25)


def main():
    request = json.loads(sys.stdin.readline(256 * 1024 + 1))
    if request.get("actor") not in ACTORS or request.get("tool") not in TOOLS or not isinstance(request.get("arguments", {}), dict):
        raise OperationError("invalid_arguments", "Unknown actor or operation")
    config = json.loads(Path(sys.argv[1]).read_text())
    state = Path(config["state"])
    state.mkdir(mode=0o700, exist_ok=True)
    with (state / "session.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise OperationError("busy", "Shared Telegram is processing another operation; no action was started") from None
        return asyncio.run(asyncio.wait_for(bounded_operation(config, request), 35))


if __name__ == "__main__":
    os.umask(0o077)
    logging.disable(logging.CRITICAL)
    warnings.filterwarnings("ignore")
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = main()
        answer = {"ok": True, "result": result}
    except OperationError as error:
        answer = {"ok": False, "code": error.code, "error": error.message}
    except Exception as error:
        kind = type(error).__name__
        if kind in {"FloodWaitError", "FloodPremiumWaitError"}:
            seconds = getattr(error, "seconds", None)
            answer = {"ok": False, "code": "rate_limited", "retry_after_seconds": seconds, "error": "Telegram rate limit; retry_after_seconds=" + str(seconds) + "; no automatic retry"}
        elif kind in {"ChannelPrivateError", "ChatAdminRequiredError", "UserNotParticipantError"}:
            answer = {"ok": False, "code": "chat_access_denied", "error": "This Telegram account cannot access that chat; other authorized chats remain available"}
        elif kind == "PremiumAccountRequiredError":
            answer = {"ok": False, "code": "premium_required", "error": "This specific Telegram operation requires Premium"}
        else:
            code = "login_required" if kind in {"AuthKeyUnregisteredError", "AuthKeyDuplicatedError", "SessionRevokedError", "UserDeactivatedBanError", "UserDeactivatedError"} else "unavailable"
            answer = {"ok": False, "code": code, "error": "Telegram operation unavailable (" + kind + "); no automatic retry"}
    print(json.dumps(answer, ensure_ascii=False))

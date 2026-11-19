#!/usr/bin/env python3
"""Private Unix-socket connector broker; Linux peer UID authenticates the caller.

Never accepts a caller-supplied actor, executable, URL endpoint or credential.
Each operation re-reads owner-controlled grants and the native account's status.
"""
import concurrent.futures
import datetime
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import socket
import socketserver
import struct
import subprocess
import threading
import urllib.error
import urllib.parse
import urllib.request
from proxy_access import proxy_call
from image_access import image_call
from cowork_access import cowork_call, CoworkError
from portal_access import portal_call
from google_write import write_call as google_write_call, OPERATIONS as GOOGLE_WRITES
from google_write import verified_token as google_token, read_native as google_read

LIMIT = 512 * 1024
OUTPUT_LIMIT = 8 * 1024 * 1024
READ_TOOLS = {
    "portal.status", "portal.projects", "portal.project",
    "cowork.workspaces", "cowork.projects", "cowork.chats", "cowork.read", "cowork.search",
    "docs.check", "docs.read", "gmail.profile", "gmail.search", "gmail.read",
    "gmail.thread", "media.status", "media.snapshot", "media.job-status",
    "metrika.report", "search_console.report", "webmaster.report",
    "proxy.status", "proxy.check", "proxy.fetch",
    "telegram.profile", "telegram.dialogs", "telegram.messages",
    "telegram.search", "telegram.links", "telegram.similar", "telegram.search_chats",
    "images.status", "images.download",
}
WRITE_TOOLS = {"gmail.send", "media.open", "media.login", "media.close", "media.job", "media.cancel", "media.resume", "telegram.send", "images.generate"}
TOOLS = READ_TOOLS | WRITE_TOOLS
WRITE_TOOLS |= GOOGLE_WRITES
TOOLS |= GOOGLE_WRITES


class Denied(ValueError):
    pass


class ConnectorError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def load_json(file):
    raw = Path(file).read_bytes()
    if len(raw) > 1024 * 1024:
        raise ValueError("Configuration exceeds limit")
    return json.loads(raw)


def remote_json(url, authorization=None, body=None):
    headers = {"Accept": "application/json"}
    if authorization:
        headers["Authorization"] = authorization
    payload = None
    if body is not None:
        payload = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=payload, headers=headers)
    with urllib.request.urlopen(request, timeout=25) as response:
        data = response.read(OUTPUT_LIMIT + 1)
        if len(data) > OUTPUT_LIMIT:
            raise ValueError("Connector response exceeds limit")
        return json.loads(data)


class Broker:
    def __init__(self, config):
        self.config = config
        self.locks = {name: threading.Lock() for name in config["actors"].values()}
        self.module_lock = threading.Lock()
        self.audit_lock = threading.Lock()
        self.gmail_module = None

    def actor(self, uid):
        actor = self.config["actors"].get(str(uid))
        if not actor:
            raise Denied("Unknown caller UID")
        return actor

    def active(self, actor):
        if actor == "owner":
            return True
        realm = self.config["realms"][actor]
        # Host/Origin binding is the same as the existing trusted team entry.
        connection = http.client.HTTPConnection("127.0.0.1", realm["port"], timeout=8)
        headers = {"Host": realm["host"], "Origin": "https://" + realm["host"],
                   "X-Yep-Anywhere": "true", "Content-Type": "application/json"}
        try:
            connection.request("POST", "/api/auth/login", json.dumps({"password": realm["adminPassword"]}), headers)
            response = connection.getresponse()
            cookie = response.getheader("Set-Cookie", "").split(";", 1)[0]
            response.read()
            if response.status != 200 or not cookie.startswith("yep-anywhere-session="):
                return False
            headers["Cookie"] = cookie
            connection.request("GET", "/api/users", headers=headers)
            response = connection.getresponse()
            data = json.loads(response.read(LIMIT))
            return response.status == 200 and data.get("enabled") is True and any(
                u.get("username") == actor and not u.get("disabled")
                for u in data.get("users", [])
            )
        finally:
            # Do not leave a new break-glass web session behind per tool call.
            if "Cookie" in headers:
                try:
                    connection.request("POST", "/api/auth/logout", "{}", headers)
                    connection.getresponse().read()
                except (OSError, http.client.HTTPException):
                    pass
            connection.close()

    def allowed(self, actor, tool):
        if tool not in TOOLS:
            raise Denied("Unknown connector operation")
        policy = load_json(self.config["policy"])
        if policy.get("version") != 1:
            raise Denied("Invalid access policy")
        integration = tool.split(".", 1)[0]
        if not policy.get("connections", {}).get(integration, {}).get("configured"):
            raise Denied("Integration is not connected")
        mode = "write" if actor == "owner" else policy.get("users", {}).get(actor, {}).get(integration, "none")
        if mode not in ("read", "write") or (tool in WRITE_TOOLS and mode != "write"):
            raise Denied("Integration access denied")

    def handle(self, uid, request):
        actor = self.actor(uid)
        if not self.active(actor):
            raise Denied("Account is disabled or unavailable")
        if request.get("operation") == "list":
            p = load_json(self.config["policy"])
            grants = p.get("users", {}).get(actor, {})
            return {"actor": actor, "integrations": [
                {"id": key, "mode": "write" if actor == "owner" else grants.get(key, "none"), **value}
                for key, value in p["connections"].items()
            ]}
        tool = request.get("tool")
        self.allowed(actor, tool)
        arguments = request.get("arguments", {})
        if not isinstance(arguments, dict):
            raise ValueError("Arguments must be an object")
        if not self.locks[actor].acquire(blocking=False):
            raise Denied("Another connector operation is active; do not replay a send")
        try:
            # Check again after admission; revocation affects the next operation.
            self.allowed(actor, tool)
            result = self.dispatch(actor, tool, arguments)
            self.audit(actor, tool, "ok")
            return result
        except Exception:
            self.audit(actor, tool, "failed")
            raise
        finally:
            self.locks[actor].release()

    def audit(self, actor, tool, outcome):
        with self.audit_lock:
            self._audit(actor, tool, outcome)

    def _audit(self, actor, tool, outcome):
        path = Path(self.config["state"]) / "audit.jsonl"
        # Bounded, content-free log. No mail bodies, URLs, tokens or tool arguments.
        if path.exists() and path.stat().st_size > 2 * 1024 * 1024:
            path.replace(path.with_suffix(".previous.jsonl"))
        with path.open("a") as log:
            log.write(json.dumps({"at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                  "actor": actor, "tool": tool, "outcome": outcome}) + "\n")

    def dispatch(self, actor, tool, arguments):
        if tool.startswith("portal."):
            return portal_call(tool, arguments)
        if tool.startswith("cowork."):
            try:
                return cowork_call(self.config, actor, tool, arguments)
            except CoworkError as error:
                raise ConnectorError(error.code, str(error)) from error
        if tool.startswith("images."):
            return image_call(load_json(self.config["imagesConfig"]), actor, tool, arguments)
        if tool.startswith("telegram."):
            result = subprocess.run([self.config["telegramPython"], self.config["telegramWorker"], self.config["telegramConfig"]],
                input=json.dumps({"actor": actor, "tool": tool, "arguments": arguments}),
                text=True, capture_output=True, timeout=39,
                env={"HOME": self.config["home"], "PATH": "/usr/bin:/bin"})
            if result.returncode or len(result.stdout) > OUTPUT_LIMIT:
                raise ConnectorError("unavailable", "Telegram worker did not complete; do not replay a send")
            data = json.loads(result.stdout)
            if not data.get("ok"):
                raise ConnectorError(data.get("code", "unavailable"), data.get("error", "Telegram operation unavailable"))
            return data["result"]
        if tool.startswith("proxy."):
            return proxy_call(self.config["proxyConfig"], tool, arguments)
        if tool.startswith("docs."):
            if tool in GOOGLE_WRITES:
                return google_write_call(self.config, actor, tool, arguments)
            if tool == "docs.check":
                oauth = False
                try:
                    google_token(self.config)
                    oauth = True
                except (OSError, ValueError, KeyError):
                    pass
                try:
                    check = subprocess.run(["/usr/bin/python3", self.config["docsReader"], "--check"],
                        capture_output=True, timeout=8,
                        env={"HOME": self.config["home"], "PATH": "/usr/bin:/bin"})
                    browser = check.returncode == 0
                except (OSError, subprocess.TimeoutExpired):
                    browser = False
                if not oauth and not browser:
                    raise ConnectorError("google_reauthorization_required", "Corporate Google OAuth and browser session require reconnection")
                write_granted = True
                try:
                    self.allowed(actor, "docs.create")
                except Denied:
                    write_granted = False
                return {"account": "info@polzaagency.com", "authenticated": True,
                    "oauth_connected": oauth, "browser_session_connected": browser,
                    "native_write_available": oauth and write_granted,
                    "oauth_file_scope": "files created by or explicitly authorized for the app",
                    "note": "Expired browser cookies do not disable native OAuth writes. Use docs.create/docs.update for native Google Docs."}
            value = "--check" if tool == "docs.check" else arguments.get("url")
            if not isinstance(value, str) or len(value) > 2000:
                raise ValueError("Expected a Google Docs URL")
            if self.config.get("googleWriteCredentials"):
                try:
                    return {"text": google_read(self.config, value), "transport": "oauth"}
                except urllib.error.HTTPError as error:
                    if error.code not in (403, 404):
                        raise ConnectorError("google_read_failed", "Google refused the read; check OAuth or retry a read later") from None
                    # drive.file does not authorize arbitrary existing files.
                    # The separately scoped browser session may still read them.
            result = subprocess.run(["/usr/bin/python3", self.config["docsReader"], value],
                                    capture_output=True, timeout=35, env={"HOME": self.config["home"], "PATH": "/usr/bin:/bin"})
            if result.returncode:
                raise ValueError("Google Docs session expired or document access denied")
            if len(result.stdout) > OUTPUT_LIMIT:
                raise ValueError("Document exceeds output limit")
            return {"text": result.stdout.decode()}
        if tool.startswith("gmail."):
            with self.module_lock:
                if self.gmail_module is None:
                    spec = importlib.util.spec_from_file_location("corporate_gmail", self.config["gmailServer"])
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)
                    self.gmail_module = module
                names = {"profile": "corporate_gmail_profile", "search": "search_corporate_email",
                         "read": "read_corporate_email", "thread": "read_corporate_thread", "send": "send_corporate_email"}
                # Staff cannot select files in the owner's private filesystem.
                if arguments.get("attachments"):
                    raise ValueError("Attachment transfer is not connected; send without attachments or ask the owner")
                args = dict(arguments)
                if tool == "gmail.send":
                    key = args.get("idempotency_key")
                    if not isinstance(key, str) or not key:
                        raise ValueError("Sending requires a stable idempotency_key")
                    args["idempotency_key"] = actor + "-" + hashlib.sha256(key.encode()).hexdigest()
                return self.gmail_module.call(names[tool.split(".")[1]], args)
        if tool.startswith("media."):
            return self.media(actor, tool, arguments)
        if tool.endswith(".report"):
            return self.analytics(tool.split(".")[0], arguments)
        raise Denied("Connector is not implemented")

    def media(self, actor, tool, arguments):
        cfg = load_json(self.config["mediaAgent"])
        command = tool.split(".")[1]
        body = None
        site = arguments.get("site", "")
        if command in ("open", "snapshot", "login", "close"):
            if site not in cfg.get("sites", []):
                raise Denied("Media platform is not granted")
            route = "/sites/" + urllib.parse.quote(site, safe="") + "/" + command
            if command != "snapshot":
                body = {"url": arguments["url"]} if command == "open" and arguments.get("url") else {}
        elif command == "status":
            route = "/status"
        elif command == "job":
            # Receipts are needed for actor isolation; refuse new jobs when the
            # bounded store is full instead of forgetting another user's owner.
            if sum(1 for _ in Path(self.config["state"]).glob("job-*.json")) >= 5000:
                raise ValueError("Job receipt limit reached; ask the owner to archive receipts")
            if arguments.get("site") not in cfg.get("sites", []):
                raise Denied("Media platform is not granted")
            if any(step.get("type") == "upload" for step in arguments.get("steps", [])):
                raise ValueError("Media attachment transfer is not connected")
            body = dict(arguments)
            key = body.get("idempotencyKey")
            if not isinstance(key, str) or not key:
                raise ValueError("Publishing requires a stable idempotencyKey")
            body["idempotencyKey"] = actor + "-" + hashlib.sha256(key.encode()).hexdigest()
            route = "/jobs"
        else:
            job_id = arguments.get("id", "")
            if not isinstance(job_id, str) or not job_id or len(job_id) > 100 or not all(c.isalnum() or c in "-_" for c in job_id):
                raise ValueError("Invalid job ID")
            receipt = Path(self.config["state"]) / ("job-" + hashlib.sha256(job_id.encode()).hexdigest() + ".json")
            if actor != "owner" and (not receipt.exists() or load_json(receipt).get("actor") != actor):
                raise Denied("Job belongs to another user")
            route = "/jobs/" + urllib.parse.quote(job_id, safe="")
            if command in ("resume", "cancel"):
                route += "/" + command
                body = {}
        # Origin is trusted operator configuration, never supplied by the agent.
        result = remote_json(cfg["origin"].rstrip("/") + "/media/agent" + route, "Bearer " + cfg["token"], body)
        if command == "job":
            job_id = result.get("id") or result.get("job", {}).get("id")
            if job_id:
                receipt = Path(self.config["state"]) / ("job-" + hashlib.sha256(str(job_id).encode()).hexdigest() + ".json")
                receipt.write_text(json.dumps({"actor": actor, "id": job_id}))
        return result

    def analytics(self, integration, arguments):
        days = arguments.get("days", 28)
        if type(days) is not int or not 1 <= days <= 90:
            raise ValueError("days must be 1..90")
        end = datetime.date.today() - datetime.timedelta(days=3 if integration == "search_console" else 1)
        start = end - datetime.timedelta(days=days - 1)
        profile = Path(self.config["home"]) / ".config/polza-site-seo"
        if integration == "metrika":
            c = load_json(profile / "metrika.json")
            query = urllib.parse.urlencode({"ids": c["counter_id"], "metrics": "ym:s:visits,ym:s:users,ym:s:bounceRate",
                "dimensions": "ym:s:startURL", "date1": str(start), "date2": str(end),
                "filters": "ym:s:isRobot=='No' AND ym:s:lastTrafficSource=='organic'", "limit": 100, "accuracy": "full"})
            return remote_json("https://api-metrika.yandex.net/stat/v1/data?" + query, "OAuth " + c["oauth_token"])
        # Reuse the deployed, domain-restricted read-only implementation.
        spec = importlib.util.spec_from_file_location("polza_search_report", self.config["searchReport"])
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if integration == "search_console":
            c = load_json(profile / "google-search-console.json")
            result = module.google(c, start, end)
            return {"site": "https://polzaagency.ru/", "start": str(start), "end": str(end), "impressions_clicks": result}
        if integration == "webmaster":
            c = load_json(profile / "yandex-webmaster.json")
            # Bound pagination here; the existing reporter intentionally scans all rows.
            if c.get("host_id") != "https:polzaagency.ru:443":
                raise ValueError("Unexpected Webmaster property")
            url = "https://api.webmaster.yandex.net/v4/user/" + str(int(c["user_id"])) + "/hosts/" + urllib.parse.quote(c["host_id"], safe="") + "/query-analytics/list"
            return remote_json(url, "OAuth " + c["token"], {"offset": 0, "limit": 100,
                "device_type_indicator": "ALL", "search_location": "WEB_LOCATION", "text_indicator": "QUERY"})
        raise Denied("Analytics connector is not implemented")


class Server(socketserver.UnixStreamServer):
    request_queue_size = 8

    def __init__(self, path, broker):
        self.broker = broker
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)
        self.slots = threading.BoundedSemaphore(4)
        super().__init__(path, Handler)

    def process_request(self, connection, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(connection)
            return
        self.pool.submit(self.process_bounded, connection, address)

    def process_bounded(self, connection, address):
        try:
            self.finish_request(connection, address)
        finally:
            self.shutdown_request(connection)
            self.slots.release()


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.request.settimeout(45)
        try:
            _, uid, _ = struct.unpack("3i", self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            line = self.rfile.readline(LIMIT + 1)
            if len(line) > LIMIT:
                raise ValueError("Request exceeds limit")
            result = self.server.broker.handle(uid, json.loads(line))
            answer = {"ok": True, "result": result}
        except Denied as error:
            answer = {"ok": False, "code": "access_denied", "error": str(error)}
        except ConnectorError as error:
            answer = {"ok": False, "code": error.code, "error": error.message}
        except urllib.error.HTTPError as error:
            answer = {"ok": False, "code": "upstream_error", "error": "Connector returned HTTP " + str(error.code) + "; verify sign-in. No automatic replay."}
        except (ValueError, KeyError, TypeError):
            answer = {"ok": False, "code": "invalid_or_unavailable", "error": "Invalid arguments, missing configuration or expired session; no automatic replay."}
        except Exception:
            answer = {"ok": False, "code": "unavailable", "error": "Connector unavailable. Do not replay publishing or mail automatically."}
        raw = json.dumps(answer, ensure_ascii=False).encode()
        if len(raw) > OUTPUT_LIMIT:
            raw = b'{"ok":false,"error":"Connector response exceeds limit"}'
        self.wfile.write(raw + b"\n")


if __name__ == "__main__":
    os.umask(0o077)
    config = load_json(os.environ["POLZA_ACCESS_CONFIG"])
    path = Path(config["socket"])
    path.unlink(missing_ok=True)
    with Server(str(path), Broker(config)) as server:
        path.chmod(0o666)  # Private runtime directory + SO_PEERCRED; UID is authority.
        server.serve_forever()

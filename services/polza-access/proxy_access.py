"""Shared authenticated HTTP proxy, with no provider secrets in tool responses."""
import ipaddress
import json
import socket
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

MAX_BODY = 1024 * 1024


def public_url(raw, resolver=socket.getaddrinfo):
    if not isinstance(raw, str) or len(raw) > 8000 or any(ord(c) < 32 for c in raw):
        raise ValueError("Invalid proxy target")
    u = urllib.parse.urlsplit(raw)
    if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password:
        raise ValueError("Public HTTP(S) URL required")
    port = u.port or (443 if u.scheme == "https" else 80)
    if port not in (80, 443):
        raise ValueError("Only public web ports are supported")
    addresses = {item[4][0] for item in resolver(u.hostname, port, type=socket.SOCK_STREAM)}
    if not addresses or any(not ipaddress.ip_address(a).is_global or a == "66.248.207.236" for a in addresses):
        raise ValueError("Private, local and Cowork control targets are forbidden")
    return raw


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 3
    max_repeats = 1

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def proxy_call(config_file, tool, arguments):
    c = json.loads(Path(config_file).read_text())
    if tool == "proxy.status":
        return {"configured": True, "endpoint": c["host"] + ":" + str(c["port"]),
                "protocol": "http-connect", "credentials": "private-server-storage"}
    target = "https://api.ipify.org?format=json" if tool == "proxy.check" else arguments.get("url")
    public_url(target)
    proxy = "http://" + urllib.parse.quote(c["username"], safe="") + ":" + urllib.parse.quote(c["password"], safe="") + "@" + c["host"] + ":" + str(c["port"])
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": proxy, "https": proxy}), PublicRedirect())
    request = urllib.request.Request(target, headers={"User-Agent": "Polza-Cowork/1.0"})
    try:
        with opener.open(request, timeout=25) as response:
            body = response.read(MAX_BODY + 1)
            if tool == "proxy.check":
                if len(body) > 4096:
                    raise ValueError("Unexpected proxy check response")
                ip = str(ipaddress.ip_address(json.loads(body)["ip"]))
                return {"connected": True, "egress_ip": ip}
            return {"status": response.status, "host": urllib.parse.urlsplit(response.url).hostname,
                    "content_type": response.headers.get_content_type(),
                    "truncated": len(body) > MAX_BODY,
                    "text": body[:MAX_BODY].decode(response.headers.get_content_charset() or "utf-8", errors="replace")}
    except (OSError, urllib.error.HTTPError, urllib.error.URLError) as error:
        # urllib exceptions can contain the credential-bearing proxy URI.
        raise ValueError("Proxy request unavailable") from None

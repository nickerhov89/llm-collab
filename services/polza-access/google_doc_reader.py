#!/usr/bin/env python3
"""Read Docs text or one Sheets worksheet using the shared corporate session."""
import http.cookiejar
import json
import os
from pathlib import Path
import re
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request

ACCOUNT = "info@polzaagency.com"
LIMIT = 5 * 1024 * 1024
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
)


def google_host(host):
    return bool(host) and any(
        host == domain or host.endswith("." + domain)
        for domain in ("google.com", "googleusercontent.com")
    )


class GoogleRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if parsed.scheme != "https" or not google_host(parsed.hostname):
            raise ValueError("Unexpected redirect outside Google")
        if parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError("Unexpected redirect authority")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def session_opener():
    path = Path.home() / ".config/polza-google/session.json"
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "r") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError("Session owner does not match current user")
        if stat.S_IMODE(info.st_mode) & 0o077:
            raise ValueError("Session must have private permissions (0600)")
        data = json.load(source)
    if data.get("account") != ACCOUNT:
        raise ValueError("Corporate account mismatch")
    jar = http.cookiejar.CookieJar()
    for cookie in data["cookies"]:
        domain = cookie["domain"]
        if not google_host(domain.lstrip(".")):
            raise ValueError("Session contains a non-Google cookie")
        expires = cookie["expires"]
        jar.set_cookie(http.cookiejar.Cookie(
            0, cookie["name"], cookie["value"], None, False,
            domain, domain.startswith("."), domain.startswith("."),
            cookie["path"], True, cookie["secure"],
            None if expires < 0 else int(expires), expires < 0,
            None, None, {"HttpOnly": cookie.get("httpOnly", False)}, False,
        ))
    opener = urllib.request.build_opener(
        GoogleRedirect(), urllib.request.HTTPCookieProcessor(jar)
    )
    opener.addheaders = [("User-Agent", USER_AGENT)]
    return opener


def export_url(raw):
    parsed = urllib.parse.urlsplit(raw)
    if (parsed.scheme != "https" or parsed.hostname != "docs.google.com"
            or parsed.username or parsed.password or parsed.port not in (None, 443)):
        raise ValueError("Expected an HTTPS docs.google.com document link")
    match = re.fullmatch(r"/(document|spreadsheets)/(?:u/\d+/)?d/([A-Za-z0-9_-]{10,})(?:/[^/]*)?/?", parsed.path)
    if not match:
        raise ValueError("Expected a Google Docs document link")
    kind, document_id = match.groups()
    query = {"format": "csv" if kind == "spreadsheets" else "txt"}
    if kind == "spreadsheets":
        gid = urllib.parse.parse_qs(parsed.query).get("gid", [None])[0]
        if gid is None:
            gid = urllib.parse.parse_qs(parsed.fragment).get("gid", [None])[0]
        if gid is not None:
            if not re.fullmatch(r"[0-9]{1,20}", gid):
                raise ValueError("Invalid spreadsheet worksheet")
            query["gid"] = gid
        return "https://docs.google.com/spreadsheets/d/" + document_id + "/export?" + urllib.parse.urlencode(query)
    tab = urllib.parse.parse_qs(parsed.query).get("tab", [None])[0]
    if tab:
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,160}", tab):
            raise ValueError("Invalid document tab")
        query["tab"] = tab
    return "https://docs.google.com/document/d/" + document_id + "/export?" + urllib.parse.urlencode(query)


def fetch(opener, url, expected_type):
    with opener.open(url, timeout=25) as response:
        host = urllib.parse.urlsplit(response.url).hostname
        if host == "accounts.google.com":
            raise ValueError("Corporate Google session requires sign-in")
        accepted_types = (expected_type,) if isinstance(expected_type, str) else expected_type
        if response.headers.get_content_type() not in accepted_types:
            raise ValueError("Google did not return the requested content; check session and sharing")
        content = response.read(LIMIT + 1)
        if len(content) > LIMIT:
            raise ValueError("Document exceeds the 5 MiB text limit")
        return content, host


def main(args):
    if len(args) != 1 or args[0] in ("-h", "--help"):
        print("Usage: google-doc-read --check | GOOGLE_DOCS_OR_SHEETS_URL")
        return 0 if args and args[0] in ("-h", "--help") else 2
    opener = session_opener()
    if args[0] == "--check":
        content, host = fetch(opener, "https://docs.google.com/document/u/0/", "text/html")
        if host != "docs.google.com" or ACCOUNT.encode() not in content:
            raise ValueError("Corporate Google identity was not confirmed")
        print(json.dumps({"account": ACCOUNT, "authenticated": True}))
    else:
        url = export_url(args[0])
        content, _ = fetch(opener, url, ("text/csv", "text/plain") if "/spreadsheets/" in url else "text/plain")
        sys.stdout.write(content.decode("utf-8-sig"))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except urllib.error.HTTPError as error:
        print(f"Google returned HTTP {error.code}; verify document access or refresh the corporate session.", file=sys.stderr)
    except (OSError, ValueError, KeyError, UnicodeError):
        print("Google Docs read failed: session unavailable/expired, invalid link, or document access denied. No request was replayed.", file=sys.stderr)
    sys.exit(1)

# Polza media browser

Optional deployment in `services/polza-media-browser`; not part of the default
Cowork listener. Explicitly enabled for Polza's owner and `marker` in SEO & PR.

## Authority and transport

The loopback service fronts the existing Cowork listener. `/media` is a separate
UI; all other HTTP and WebSocket paths are proxied unchanged. Activation moves
the core from 3400 to 3401 without restarting the existing cloudflared tunnel.
Its current origin remains the public entry point. Quick-tunnel URLs are not
stable across a tunnel restart; update MEDIA_ORIGIN and rotate CLI configs then.

Human requests authenticate against the core `/api/users/me` using the original
cookie and Host. Only the real owner (not an impersonated limited identity) or
enabled `marker` with a current new-session grant on the configured project can
operate media. The broker also reads current limited-user grants on every
request and job step. Mutation requests require the Cowork custom header and a
same-origin browser request. No public CDP, raw socket or arbitrary JS endpoint.

Agent capabilities are separate, hashed, actor/site scoped, expiring in 30 days,
and revoked by rotation or a current-grant removal. They authenticate only the
`/media/agent` API. They cannot call the general Cowork API. CLI configs are
private files on the VPS; human UI never returns the raw key. They are not a
cross-UID confidentiality boundary. See ROOT-SERGEY.md for the remaining host
isolation requirement before admitting untrusted actors.

## Chat tools and credentials

Project-scoped MCP polza-media-browser is the primary interface: status, open,
snapshot, login, submit_job, job_status, resume and close. CLI remains a fallback.
In the UID-isolated deployment, use `polza_integrations` with `media.*` or
`/usr/local/bin/polza-media`. This CLI delegates to the existing UID broker,
does not read bearer files and refuses `--actor`; current user grants remain
authoritative. It supports status, open, snapshot, login, job, job-status,
resume and cancel. Older project MCP workers can retain the legacy marker
capability and return `agent_access_denied` even while the caller's UID
connector works. Use the UID CLI fallback in those active chats; do not change
roles or rotate website cookies to repair that error. On 18 November the
owner and marker UID calls succeeded and the ungranted CFO call was refused.
The plan covers 18 channels: 17 browser profiles and the separate T-Business
Telegram bot. Editorial email routes use the corporate Gmail MCP. Catalog
membership does not assert registration, correct credentials or live login.

Six current credential records are resolved server-side by platform alias.
media_login fills only a unique visible password/login form on that platform's
allowed domain, never returning password values. A unique named login submit
can scope the form when a registration form is also visible; a unique Email
placeholder is accepted when the login field has no name. Registration password
fields and consent boxes are left untouched. It refuses ambiguous forms,
does not check consent boxes or solve challenges, submits only a unique named
login button and limits repeated submissions to one per five minutes per site
for the service lifetime. It reports submitted/unverified; identity still needs inspecting.

New project chats discover tools from .codex/config.toml or .mcp.json. The
operator configurator preserves unrelated MCP entries and secret-free docs;
token rotation does not run startup recovery against active jobs.

## Browser and concurrency

One persistent Chromium profile per media site, reusing the existing VPS profile
directories. Opening a profile does not prove login. UI explicitly reports
unverified, login-required or challenge. Saved credentials can be filled by the
server; verification stays with the human. Site controls remain authoritative.

Configurable context ceiling (one on the current process-limited VPS), 10 minute
idle close, 90 second controller lease.
A lease includes a random browser-tab ID, not just the Cowork username. Read-only
viewing does not acquire control. A human takeover stops an agent before its
next step; the current in-flight browser action may finish. No automatic
publication replay after takeover, action failure, timeout or process restart.
A strongly detected CAPTCHA before a step records waiting_for_human, its resume
index and a protected same-profile handoff link. Resume verifies the challenge
has cleared and queues only unexecuted steps. Ambiguous failures stay needs_review.
Returning to chat releases the human view's control lease. An idle unlocked
non-waiting profile can be closed to open the next platform, preserving cookies.
Profiles persist on disk after closing or restarting the worker.

Manual view uses authenticated JPEG frames and mouse/keyboard input. It needs
no direct access to a challenge solver. Human mouse/touch drags forward down,
bounded move batches and up while the gesture is in progress; the remote slider
must move before the human releases the pointer. Frames continue updating during
the gesture. Movement has at most one in-flight request and 32 queued points.
Cancellation releases the held button outside the page without completing a drop.
Release, takeover and expired leases also cancel a held pointer; controller checks
apply to every move batch. Legacy completed-path drag requests remain accepted.
It needs
no VNC/CDP port and works headlessly; the root runbook enables a private Xvfb
display if a platform rejects headless. The local typing field is independent
of frame and queue polling, with sequential key acknowledgements below 100 ms.
Hidden/closed pages stop screenshot polling; expired leases release control.

Top-level navigation is restricted to the platform's configured HTTPS domains.
Resource requests reject private IPs/hostnames and resolve DNS before allowing
public hosts. This is application-level filtering, not kernel-enforced network
isolation or a complete DNS-rebinding defense. Chromium itself is trusted under
the current manager UID. No claim of sandboxing arbitrary hostile sites.

## Durable jobs and evidence

Jobs have an actor, media site, explicit intent (`draft`, `submit_review`,
`publish`), title, idempotency key and declarative ordered steps. No arbitrary
JavaScript or shell actions. Passwords in action plans are refused; the dedicated
server-side login helper uses the vault, while CAPTCHA/OTP remain manual.
Intent records the operator's requested outcome; selectors still need review
against the platform and are not a semantic guarantee that a click saves a draft.

Every plan ends with a visible-text assertion. A completed job records the URL,
assertion and private screenshot; completed does not mean a platform has approved
moderation or published an article. Interrupted jobs retain the completed step
count and require inspection. Startup marks running jobs `needs_review`, never
requeues them. Queued jobs are idempotent per actor and may be cancelled.

Uploads are copied from regular files inside the canonical SEO project only,
maximum 15 MiB, PNG/JPEG/WebP/GIF/PDF/DOCX. Traversal, escaped symlinks, hidden
and credential-like file paths are refused. Step values and Playwright error
traces are omitted from API job receipts and logs. Profile and task database
contain sensitive account content: state directories 0700, files 0600.

## Verification and operations

`node --test services/polza-media-browser/service.test.mjs` exercises actual
HTTP auth/proxy boundaries, revoked grants, upload confinement, idempotency,
real Chromium DOM fill/upload/save/assertion, profile persistence, controller
takeover and desktop/phone sequential typing under live polling.

Deploy the service directory to `~/services/polza-media-browser`, run
`install-user.sh` with MEDIA_ORIGIN and MEDIA_CHROMIUM, verify staging :3410,
then `activate-user.sh`. Activation probes media and core, rolling back the port
change on failure. No source rebuild/replacement of Cowork is required.

Rollback: stop `polza-media-browser`, remove only
`yepanywhere.service.d/media-port.conf`, daemon-reload and restart `yepanywhere`.
The existing tunnel still points at 3400. Preserve profiles/state for inspection.
Service updates restart only `polza-media-browser`; warn operators that active
jobs will require review. Logs: `journalctl --user -u polza-media-browser`.

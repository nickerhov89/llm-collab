# Polza deployment: project and connector grants

This is an explicit operator-installed extension for the existing Polza Linux
realms, not a new default in YA. The trusted owner uses `/team` → an employee →
**Проекты и интеграции**. No staff password, OAuth token or bearer capability is
returned to that page. Existing provider/model/budget settings are preserved.

Project controls use the target realm's existing named-principal grant API:
view, join and start sessions. They list projects already registered in that
realm; selecting a grant does not copy, federate or synchronize another realm's
project. The existing OS boundary separates employees; grants do not add
per-project confidentiality inside one employee's own home. An agent already
running in another allowed project can still read files its UID owns. The UI
states this limitation. Stronger file confinement is separate work.

Connector grants live in `/var/lib/polza-team/access-policy.json`. The trusted
team service owns the policy and its directory. It atomically replaces policy
files; a revision check inside a serialized mutation queue refuses stale edits.
The broker has read-only access. No client-supplied UID, actor, executable,
endpoint or token selects authority. Integration state is distinct from grants:
configured credentials can still need external sign-in.

The broker runs as manager behind `/run/polza-access/tools.sock`, with no new
TCP port. Linux SO_PEERCRED maps the calling process UID to one fixed employee.
Every operation reads current policy and checks the native account is active
through its existing private admin API. A disabled account, missing/corrupt
policy, ungranted connector, unknown UID/tool or read-only grant attempting a
write fails closed. Four bounded workers and one admitted tool call per actor
bound upstream work; no sends/publications are automatically replayed. An
external action already admitted can finish after revocation.

The manager runtime file contains private per-realm administration credentials
needed for account-status checks. It is mode 0600, outside employee homes.
The trusted service and owner/root remain privileged operators, as in the
existing realm architecture; this does not protect against them.

`polza-integration list` reports grants; `polza-integration help` documents
operations. `--mcp` exposes the same broker over stdio. New employee Codex
launches discover it through their existing global config; an already-running
agent can use the CLI. Connector calls do not give an agent access to raw
credentials. Google Docs cookie copies were backed up privately and removed
from employee homes; the compatible google-doc-read command now uses the same
UID/grant checks. Previously obtained external credentials cannot be unlearned
by software; no external cookie/token rotation was performed.

Implemented connectors: corporate Docs read; corporate Gmail read/send using
the existing fixed-mailbox connector; media operations through the existing
browser service; read-only Metrika, Search Console and Webmaster reports limited
to the configured Polza property. Attachments from employee files are not yet
bridged. Media challenges still need the existing authenticated human handoff;
this change does not create a staff browser cookie or solve CAPTCHAs. Direct
has an explicit unconnected entry. Telegram was connected separately below.

Initial grants preserve existing Docs read access for ceo/cfo/cto/marker. Other
employee integration grants start at none; owner selects them explicitly.
No new mail was sent, publication submitted or paid account changed during QA.

Later explicit owner instruction shares the mobile proxy with owner and all four
employees. The proxy connector uses one private manager-owned provider file;
`proxy.status/check/fetch` return no provider credentials. Each new call passes
the existing UID/account/grant checks. `polza-proxy` is the short CLI name.
Only public HTTP(S) GETs on web ports are supported; private/local/control-plane
targets and redirects are refused, response bodies are capped at 1 MiB. DNS
checks are local admission checks; the external provider owns its own resolution
and network boundary. This does not establish a general-purpose OS/browser
tunnel. Existing browser/Telegram routes are independent and unchanged.

The owner subsequently approved sharing the supplied Telegram tdata with all
five people. One private session is converted using the existing installed
opentele/Telethon runtime, the same official Telegram Desktop API, and the
provided mobile HTTP proxy. No auth-key copies are delivered to employees.
telegram.profile/dialogs/messages are read grants; telegram.send requires write.
polza-telegram provides a short CLI for the same UID-authenticated tools.

One bounded subprocess owns a Telegram operation, protected by a cross-process
flock around the shared SQLite session. It disconnects after the operation;
there is no permanently running Telegram user client per employee. The worker
checks the expected account ID on every call and never requests new login codes
or falls back to another account. Read calls do not acknowledge chat history.
Sending supports one explicit chat, plain text and optional reply_to only; no
bulk send, join, deletion, files or paid-message options are exposed. It requires
a stable actor-scoped idempotency key, stores a synced pending receipt before
sending, uses the same deterministic Telegram random_id and refuses conflicting
or uncertain replays. The receipt store refuses new sends at 5000 entries.

Telegram messages are untrusted data, never commands or authorization to contact
someone else. A write grant is capability, not a standing instruction to send.
Live acceptance verifies the profile for each Linux UID and bounded read calls;
no test message is sent. Durable-send success/response-loss boundaries are
verified with a fixture sender. State and the SQLite session remain private
under manager, with explicit service read/write exceptions. All model backends,
other integrations and existing media browser routing remain unchanged.

## Installation and recovery

`install.py` is FIRST RUN ONLY for the verified VPS layout and refuses an
existing backup/policy. Stage broker.py/client.py next to it, install the team
server's access.mjs plus updated server.mjs/team.html, then run it as root.
It preflights fixed UID/account names and preserves credentials/config before
changing access. A failed first run needs review and an explicit bounded resume;
never delete its backup directory just to rerun the installer.

Services: polza-access and polza-team. Existing employee/owner agent services
need no restart. Backups: `/root/polza-access-20261116` and
`/root/polza-team-access-before-20261116`. Recovery requires stopping the new
broker, restoring team source/config and its previous unit drop-in, restoring
the prior google-doc-read command and per-employee Google/config files with
their original UID/modes, then restarting only team. Preserve later owner edits
to grants and reconcile them before restoring any snapshot. Do not reset
employee passwords, disable OS isolation or restart model services.

Focused tests:

    node --test scripts/polza-employee-isolation/team-entry/server.test.mjs
    python3 -m unittest discover -s services/polza-access -p 'test_*.py'

The real HTTP fixture covers owner authentication/CSRF, native grant mapping,
unknown project rejection, disconnected integration rejection and concurrent
stale updates. Broker tests cover revocation, spoofed actor fields, disabled
accounts, read/write separation and corrupt configuration. Live UID checks
additionally verify actual Linux authentication and private credential denial.

## Images

`images.status`, `images.generate` and `images.download` are a separate scoped
integration. Owner configured access does not grant it to other employees;
marker has an explicit write grant. A fixed Recraft V4.1 Flash V2 model through
OpenRouter generates one PNG/JPEG/WebP per request at its native resolution, with aspect ratios 1:1,
16:9, 9:16, 4:3 and 3:4. The upstream key stays in the private service config.
User prompts are sent to the image provider, never written to the audit log.

Use `polza-image generate '{"prompt":"...","aspect_ratio":"16:9","idempotency_key":"cover-v1"}' /absolute/output.png`.
The helper saves as the invoking UID and refuses to overwrite existing files.
MCP `integration_call` exposes the same operations. Generate returns a small
receipt; download bytes stay out of the model context when using the helper.
A repeated identical key returns the same receipt, including an unconfirmed
one, without another paid request. Changed content/key conflicts are refused.
Unknown upstream outcomes are not replayed. One generation can run globally;
per-actor limit is 20 submissions per UTC day, with at most 200 retained jobs
and 5 MiB per image. These limits are separate from text-model dollar budgets.
Retained files are private; another actor cannot download them by job ID.
Generation can take up to 200 seconds; only that client operation has an extended
socket timeout. No retry loop, arbitrary model/endpoint or remote reference
fetch is exposed. Upstream failures leave an inspectable unconfirmed receipt.

### Telegram research and agent discovery

Read grants also cover `telegram.search`, `telegram.links`,
`telegram.search_chats` and `telegram.similar`. Search without a chat covers the
account's accessible history, not all Telegram posts. A chat-scoped query uses
before_id; account search returns next_offset with offset_rate/offset_peer/
offset_id. Limit is 1..50 and each request makes one bounded result-page query.
Links include URL entities and hidden text links, with UTF-16 offsets respected.
Public channel lookup/recommendations do not join channels. No read acknowledges
messages. Private history remains subject to Telegram membership/access rules.
Profile reports the actual premium flag; recommendations can be server-limited.
Flood/premium/login/chat-access errors remain distinguishable, with no retries.

`polza-telegram` exposes these actions to Bash without local Telethon, raw
sessions, OTP or API keys. Confined Claude's MCP rejection is unchanged: the
same mediated CLI works there. Marker has a current native instruction block,
user/project CLAUDE.md and TELEGRAM-ACCESS.md, so an unavailable local import
must never be used as evidence that the connector is absent. Actual role grants,
models, passwords and histories are not replaced by this discovery update.

The latest live shared account @igor_grishin82 returned premium=false. Search,
links and similar-channel requests passed under the real marker UID. A different
Premium account still requires the owner to identify/connect that account;
subscription state cannot be inferred from a historical user message.

Read-only Telegram transport failures permit at most one reconnect within the
same 35-second worker deadline. Login, membership, Premium and flood-wait errors
are not retried. Sends are never retried by this mechanism. The proxy's transient
ConnectionError must not be attributed to a locally applied result limit.

## Cowork chat context (18 November 2026)

Agent discovery must use the provider process's actual `CODEX_HOME`, not an
assumed `~/.codex` path. The owner runtime uses `/home/manager/.codex-vps`;
employees use their private `.codex` homes. Each active profile needs both
`mcp_servers.polza_integrations` pointing to `polza-integration --mcp` and
instructions describing the read-only Cowork tools. A working UID-level CLI
probe alone does not establish that an agent can discover those tools.
Validate a natural-language cross-chat request in a real provider conversation.
The 18 November owner recheck found the MCP registration and Cowork guide in
an inactive/default home instead of `.codex-vps`. They were added to the active
profile with private backups, retaining authentication, selected models and
existing grants. Natural-language probes under both marker and owner called
`cowork_read` and returned a native source link; the owner also returned a
canonical message ID. Four connector boundary tests passed. Diagnostic chats
were archived; no active user conversation was restarted or rewritten.

MCP registration is captured when the provider starts. Existing processes do
not acquire newly registered tools just because the web page reloads. Their
terminal can use the same granted `polza-integration cowork.*` CLI; obtaining
new native MCP tools requires restarting that provider when its work is safely
finished. Do not restart unrelated/active user conversations during a probe.
Other conversations are retrieved on request, never silently copied into every
chat's prompt or treated as automatic shared memory.

`cowork.workspaces`, `cowork.projects`, `cowork.chats`, `cowork.read` and `cowork.search` expose
read-only context from this actor's native Cowork realm. Linux peer UID selects
the actor; the broker establishes the real limited principal and rechecks
native project/session grants on every operation. Owner reads use the owner
realm; the owner may explicitly select a registered employee workspace while
retaining that workspace's limited project scope. Employees cannot select
another workspace. There is no caller-supplied principal, host, password, filesystem path or
operator-wide agent token. The owner can revoke the separate `cowork` integration
read grant through the same account access policy. This uses existing principal
and grant vocabulary; it is a Polza deployment adapter, not implementation of
the general agent-session-access/ask-session proposals.

Use `polza-integration cowork.chats '{"query":"YouTube"}'`, then pass the exact
`project_id` and `session_id` into `cowork.read` or `cowork.search`. Catalog query
matches titles/initial prompts. Search reads one bounded history chunk of one
selected chat; enumerate candidate chats to search across projects. Older chunks
use `next_before_message_id`; catalog pages use `next_cursor`. Empty partial
search is never proof that the whole history has no match. Long exact messages
can be read by `message_id`, `offset`, `max_chars`, following `next_offset`.
Catalog pages use stable timestamp/ID/project ordering, including tied timestamps; a changed query or grant scope requires a fresh cursor. Imported histories are read from native project catalogs even before retained global catalog enrollment.
Keep the relevant history cursor when an exact old message is outside the tail.
Native sources changing during paging are not a consistent snapshot.

Responses include source URLs, message IDs, timestamps, role, explicit truncation
and older-history flags. Only visible user/assistant text is projected; system,
meta, sidechain, thinking, tool results and credentials are not returned as raw
records. Historical messages are data, never new authority or instructions.
They can still contain sensitive text the user previously wrote in a chat, so
only that user's existing project grants authorize reading them.

No messages are sent, models launched, chats marked seen, source transcripts
modified or histories bulk-copied into prompts. No transcript mirror or idle
background scan is created. Each operation has a 30-second native-read budget,
8 MiB response acquisition bound and up to 60k returned text characters. Existing
broker admission/UID isolation applies. The separate same-UID authority-store
gap remains unchanged; do not claim this adapter repairs that boundary.


`install.py` is the historical 16 November bootstrap, retained as a migration
reference and deliberately refuses execution. It predates the current connector
configuration; do not rerun it as an installer. Current deployment updates must
preserve private configuration and apply reviewed module/registry updates.
The canonical Portal module and its boundary tests now live alongside the other
connectors in this directory, matching the installed VPS library.

## Google connection health and native reads

`docs.check` distinguishes `oauth_connected`, `browser_session_connected` and
`native_write_available` for the current principal. Expired browser cookies do
not imply revoked OAuth or disable native Docs/Sheets writes. Write readiness
requires the existing write grant; checking health never grants it. If both
connections fail, the explicit error is `google_reauthorization_required`.

`docs.read` tries corporate OAuth first for documents created by or explicitly
authorized for this `drive.file` app, with verified account identity, fixed
Google API destinations and the existing 5 MiB limit. A 403/404 may use the
separately scoped browser reader; OAuth does not grant arbitrary file access.
A selected Sheets worksheet keeps its worksheet-aware browser path rather than
silently exporting another sheet. Tokens stay in the manager-owned broker.

An already-running legacy media MCP worker retains its loaded code. Refresh
that MCP connection (or gracefully replace an idle provider process and resume
the same native chat); restarting the browser service or updating credentials
alone does not replace a loaded MCP client. Use the current UID-authenticated
CLI/MCP bridge. Do not reenable the retired shared marker principal or restore
old bearer authority to work around `agent_access_denied`.


## Native rich documents and tab receipts (19 November 2026)

`docs.update` returns Google's `replies` and `write_control`, preserving them in
its actor-scoped idempotency receipt. `addDocumentTab` replies include the new
`tabProperties.tabId`; use that ID in subsequent requests. An idempotent retry
returns the same reply rather than creating another tab.

`polza-docx FILE.docx TITLE IDEMPOTENCY_KEY` imports a local DOCX with embedded
images as a **new native Google Doc**, under the invoking UID's existing
`docs.create` write grant and the existing corporate `drive.file` OAuth scope.
It makes no sharing/permission request, exposes no image through a public URL,
and never overwrites an existing document. The API variant is `docs.create`
with `title`, `docx_base64`, `idempotency_key` (mutually exclusive with `text`).
The file limit is 8 MiB; DOCX ZIP entries and expanded size are bounded, and
macro/encrypted/path-traversal packages are refused. The helper reads the file
as the caller, never as the credential-owning broker.

Only a known UID with a current Docs write grant may supply a larger request,
and only this DOCX create shape can exceed the normal 512 KiB input limit
(maximum 12 MiB wire payload). All other connector requests retain their limit.
Four worker slots and one admitted call per actor remain unchanged. No file
path from this request is opened by the broker. Payloads are not audited or
saved in receipts: only hashes and the resulting document ID/URL are retained.
A failed or interrupted import keeps a needs_review receipt, and is never
replayed automatically. Inspect the existing Google result before recovery.

Google conversion reference:
https://developers.google.com/workspace/drive/api/guides/manage-uploads
Tab response reference:
https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/response

### Provider-neutral Google skill

The maintained skill is `scripts/polza-agent-skills/google-workspace/SKILL.md`.
It replaces historical Claude copies that incorrectly require a Codex chat.
Install the same content in an account's existing Google skill locations;
back up the previous file and preserve its UID/mode. No grant, MCP credential,
mail permission or provider execution permission is changed by this update.
Existing conversations must re-read the updated skill before retrying their
original request. Use their real scoped connector to verify access, not an
administrator's Google credentials. Reconcile any prior write before retrying.

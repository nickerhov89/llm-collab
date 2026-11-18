# Dedicated Polza employee runtimes — 2026-11-14

This deployment isolates employee agents from the owner's files using separate
Linux UIDs and root-owned systemd policies. The ordinary project-write Bubblewrap
sandbox is a write boundary; enabling it alone does not hide owner credentials.
This change does not make other shared-UID deployments confidential.

## Live entry points

Host: `66.248.207.236`, Ubuntu 24.04. Owner Cowork remains at
`https://cowork.66.248.207.236.sslip.io` under manager UID 1001.

| Login | Linux user / UID | Private HTTPS entry | Loopback port |
|---|---|---|---|
| ceo | pcw-ceo / 2001 | https://cowork-ceo.66.248.207.236.sslip.io | 3410 |
| cfo | pcw-cfo / 2002 | https://cowork-cfo.66.248.207.236.sslip.io | 3411 |
| cto | pcw-cto / 2003 | https://cowork-cto.66.248.207.236.sslip.io | 3412 |
| marker | pcw-marker / 2004 | https://cowork-marker.66.248.207.236.sslip.io | 3413 |

Employee passwords are preserved. Their old accounts on the main owner instance
are disabled; do not reenable them there. Do not create additional employees via
shared owner settings: provision another OS realm and verify it first.
Each employee is still a limited web principal with one private project and
Tasker account key `user:<login>`. Their private instance has a separate random
break-glass administrator password. Credential cards are outside Git.

## Boundaries

* Private HOME `/var/lib/polza-employees/<login>` is mode 0700 on its own 4 GiB
  ext4 loop image. Images are root-only under `/var/lib/polza-employee-volumes`.
  Mounts are nodev/nosuid; underlying mountpoints are root-owned mode 000.
* Services require their home mount and firewall service; the model broker is
  wanted/ordered but is not a BindsTo/Requires dependency. Systemd hides
  `/home` and `/root`, makes the host read-only, gives private bounded `/tmp`
  and `/var/tmp`, hides other processes and removes privileges/namespaces.
  Each has MemoryMax=1200M, CPUQuota=125%, TasksMax/LimitNPROC=160.
* The dedicated nftables table blocks private networks, metadata, other staff
  backends and owner ports. Public model/web traffic remains available.
  Ingress accepts only SSH/HTTP/HTTPS, established traffic, loopback, ICMP and
  DHCP replies. Arbitrary employee listeners are not publicly reachable.
  SocketBindDeny is configured but was ineffective for high ports on this host;
  the verified ingress firewall is the enforcement for public listeners.
* SSH explicitly denies all four employee OS accounts plus the broker account,
  including key login and forwarding. They have locked passwords/nologin shells.
* `/opt/polza-employee-runtime` and policy/scripts are root-owned immutable to
  staff. Root, the host operator and kernel remain trusted; this is not a VM.

## App launch policy

`POLZA_EMPLOYEE_POLICY=/etc/polza-employees/<login>.json` enables the dedicated
boundary only when a root-owned non-symlink policy matches the process UID,
HOME and exact systemd cgroup. A malformed configured policy aborts startup.
Without that variable, shared-server limited launch restrictions are unchanged.
The dedicated path uses `sandboxLevel=none` because systemd/UID isolation is the
boundary; this is not an HTTP/user-configurable sandbox bypass.
Session authorization recognizes this boundary. Supervisor never mints an owner
agent-control API token for these runtimes. Remote executors, computer control
and router account overrides remain denied to limited principals.

## Model access and migrated data

Employees select OpenRouter text models through the UID-scoped broker on
127.0.0.1:3456. The native Codex transport remains locked for new employee
sessions; compatible imported Claude histories use its Messages route. Qwen is
the initial default, not a model lock. Owner subscriptions and model choices
are unchanged. Readable employee capabilities never authorize the owner gateway
or disclose the upstream key. Hosted web search is stripped and other hosted tools are denied; native local
tools still obey the employee OS/grant boundary.

Current bounds: $10 per UTC day and 3000 model calls per employee, 8192 output
tokens, 16 MiB per request and 24 MiB aggregate admitted request-body reservations.
Four model requests per employee / sixteen globally may run concurrently. Six
additional requests per employee can wait up to 90 seconds, without retaining
full JSON/image bodies. Admission is FIFO among eligible accounts; an account
at its four-slot limit cannot block another account's free slots. Memory
pressure can still serialize large image/history requests. Queue cancellation
releases its entry; duplicate settlement cannot free another request's slot.
Overload, queue timeout and insufficient daily budget have distinct messages.
Automatic inference retries are not added. Provider timeout remains 120 seconds.
Auto routing reserves at most $1 per request by default, rather than taking the
entire remaining daily budget and starving concurrent chats.

Employee spaces are fresh. Only their own limited-user record/password and own
Tasker file, if any, were copied. Owner histories, OAuth profiles, SSH keys,
Portal/Gmail/Telethon credentials and shared client folders were not copied.
Those integrations require separately scoped credentials and deliberate sharing.
Existing secrets in owner history have not been rotated by this deployment.

## Operations and evidence

Root services: `polza-employee-{ceo,cfo,cto,marker,broker,firewall}.service`.
Final service templates and deployment helpers are in
`scripts/polza-employee-isolation/`. These are deployment-specific root scripts,
not an unattended installer. Never run first-provisioning/password scripts over
existing realms. Review paths and preserve state before changing them.

Each start runs root-owned `probe.py` as the employee inside the service boundary.
All 29 checks must pass or startup fails. Evidence includes blocked absolute
paths, symlink/hardlink escapes, process roots/environments, UID escalation,
owner/colleague ports, metadata, key access and successful own workspace writes.
Do not treat the employee-writable JSON result as tamper-proof audit storage;
verify fresh startup journal output and rerun adversarial tests after changes.

On 14 November: 116 startup checks passed; a real native model performed a
terminal/Python call and could write only its own project; same-chat second turn
worked. Public HTTPS rejected anonymous requests and cross-realm cookies.
An employee listener bound to 0.0.0.0:12345 was reachable locally but timed out
from outside. Focused default auth regression suite: 9 tests passed; server
TypeScript check passed. This is targeted verification, not a penetration-test
or proof against kernel vulnerabilities.

## Backup / restore

Initial cold snapshot is `/root/polza-employee-snapshots/20261114T074032Z/`.
It contains four unmounted filesystem copies and root-only configuration.
No automatic daily employee backup schedule is installed. The owner's existing
backup cannot read these homes and must not be advertised as covering staff.
`cold-snapshot.py` stops only staff services, drops synthetic auth sessions,
unmounts/copies/remounts images and restarts services in finally blocks.
Run during a staff maintenance window; it does not stop owner Cowork.

Restore only a stopped realm, preserve newer writes first, validate the source
image, unmount the affected home, replace its backing image and mount it using
the recorded fstab/UID policy. Do not extract employee-controlled archives as
root into the host filesystem. Restore broker ledger conservatively; resetting
it can reset daily budget accounting. Re-run startup probes and HTTPS/auth checks.

On code updates, rebuild the server and deploy only to the root-owned staff
runtime; preserve the runtime's other existing Polza patches. Never change the
owner package to enable this dedicated runtime by default. Update broker and
firewall first, verify readiness, then restart staff and confirm all probes.

## Unified sign-in and account management — 2026-11-16

The deployment now provides `/team` on the main owner origin as the common
sign-in and owner-only administration page. Anonymous root visits redirect
there; existing authenticated owner root visits keep their workspace. Users
sign in with their previous credentials and are handed off automatically to
their separate realm origin. The browser storage, runtime and filesystem
boundaries remain separate. This is a common entry point, not a shared-origin
multi-tenant app server.

The owner can open a realm administratively, enable/disable its employee or
set their password without a VPS shell. Named staff login explicitly revokes
the prior main owner session in that browser and clears privileged cookies.
Owner management accepts only an owner password-session validated at the main
backend. See `scripts/polza-employee-isolation/team-entry/README.md` for the
observable auth/handoff contract, trust boundaries, tests and rollback.
This opt-in front door does not close the generic desktop-session fallback gap
in all shared installations; it prevents that inheritance in its own sign-in
flow while preserving the separate OS boundaries.


## Canonical owner domain — 2026-11-16

The common entry is now https://cowork.polza-portal.ru/team; the previous
cowork.66.248.207.236.sslip.io origin redirects with HTTP 308. Owner Host/Origin
allowlists, media origin, active media agent configs and team owner mapping
were migrated together. Existing passwords and server Tasker/chat data stay
unchanged; browsers need a new-domain login. Employee origins stay separate
at their existing sslip hosts because only the common hostname has DNS for
this VPS. No wildcard or employee DNS records were assumed or modified.
Live HTTPS owner login, four-realm administration, media status, secure
cookies and authenticated WebSocket frames were verified on the new domain.

## Imported-session resume inside the dedicated boundary

Existing sessions resumed or reactivated in a verified dedicated employee
service use that service's OS boundary. Legacy imported `project-write`,
network-firewall and sandbox-state settings are normalized at the Supervisor
resume boundary instead of attempting a nested Bubblewrap/slirp namespace.
The caller's current private project path is preserved, not an imported
sandbox path. The opt-in still requires the root-owned policy and matching
UID/HOME/systemd cgroup. No HTTP option enables it.

Ordinary shared-server sessions retain their frozen sandbox rules and continue
to reject attempts to weaken them. This does not authorize dropping sandbox
requirements on the owner/shared instance, changing employee model locks or
copying owner provider credentials. The effective scope remains the employee
OS account; no additional isolation among projects of that same account is
claimed. Regression cases exercise both dedicated resume/reactivate and the
unchanged shared-server refusal paths.

## Native provider identity on imported Codex chats

Employee Codex processes retain the saved thread's native provider ID as a
process-level alias. Every alias is explicitly routed to the same scoped
employee broker at `127.0.0.1:3456`; endpoint, wire protocol and authentication
are never inherited from imported history. New threads use `polza_employee`.
This applies to resume, fork and fork-backed summary helpers. No transcript
rewrite, account key transfer, model unlock or new user-facing chat is needed.
Missing or invalid native identity fails before launching the provider.
Owner/shared runtime routing is unchanged.

This addresses the installed Codex 0.167.0 provider-selection check, which
compares saved identity with current process config on resume and on input.
The pinned 0.164.0 reference lacks that exact input check; both tagged source
versions were inspected for this targeted deployment fix. This is not a full
provider refresh or a new audited-through version declaration.

The broker wire-size ceiling is 16 MiB, separately from the model's token
window. The previous 100 KB ceiling rejected ordinary native history plus
tool schemas. Daily dollar/call caps, reservation accounting, one active
request per employee, model allowlist and output limits remain enforced.
Oversized requests still receive 413; malformed or unauthorized routing is
not retried through a different provider.
All retained request buffers also share a 24 MiB admission ceiling. Pressure
returns a terminal busy response before spending and is released on rejection,
disconnect and completion. Inline image and history bytes are forwarded intact;
raising the transport ceiling never changes daily budgets or model context.
Employee aliases also disable WebSocket transport (the broker implements
HTTP/SSE only) and set native request/stream retries to zero. Broker deadlines
and visible terminal errors govern failures instead of native retry cycles.

## Legacy Claude histories — 16 November 2026

Imported native Claude transcripts can now continue in their original session
through the scoped Qwen/OpenRouter broker's Anthropic Messages transport.
This does not authorize an Anthropic subscription or copy an owner credential.
The limited-user compatibility exception applies only to existing `claude`
histories inside a verified dedicated runtime whose lock is Codex plus
`qwen/qwen3-coder`. Explicit other models, remote executors, gateway variants
and new Claude sessions remain refused. The native Claude runtime pins model
and environment even for the private realm's admin; owner/shared auth and
routing are unchanged. Its catalog advertises Qwen, and it offers no Claude
OAuth login in this mode.

The broker shares the same actor budget, active-request slot, call/output and
payload caps between both wire formats. Messages accepts local function tools,
not hosted tools or arbitrary state/fallback options. Claude Code's inline and
by-reference tool additions/removals are materialized into the final active
function-tool inventory for Qwen. Other history text and tool-use/result rows
are preserved; the native transcript is not rewritten. Unknown references fail
closed. Anthropic-transport quota/upstream failures use 424 so the native CLI
cannot turn them into hidden 429/5xx retry cycles.

Two consecutive real replies were verified on a temporary clone of the exact
failing Telegram chat under limited `marker`. The clone was archived and the
original session reactivated without a diagnostic prompt. The shared Telegram
profile itself also passed a read-only check under the real marker UID.

### Catalog and stale browser hints

Native employee Claude histories remain classified as `claude` after Qwen
replies. The normal non-Claude-model → Ollama heuristic remains enabled only
outside dedicated employee runtimes. Persisted employee summaries previously
classified as `claude-ollama` reparse once on index load; a corrected summary
reuses the cache on subsequent restarts. Transcript bytes remain unchanged.
Existing dedicated Codex/Qwen-locked sessions also normalize a stale
`claude-ollama` browser hint to the scoped native Claude transport, retaining
model, project, OS-boundary and other-provider checks. The Supervisor performs
the same normalization for the private realm admin. This is not a general
Ollama or alternate-model grant.

Browser QA covers ordinary Send, reload, process shutdown and opening from the
sidebar as limited marker. A real reply arrived without changing session URL;
the original business draft was not edited. Diagnostics used a temporary clone
which was archived afterward. Scoped cache repair and shared-runtime behavior
are covered by an integration fixture with unchanged transcript bytes and no
repeated parsing after the repair.

### All employee models — authorized policy update, 2026-11-16

The owner's explicit instruction supersedes the earlier Qwen-only policy for
ceo/cfo/cto/marker. Their model locks are removed; the provider transport lock
remains. The scoped broker exposes the OpenRouter text-model catalog (383 models
observed), validates selected IDs, and routes both native wire formats to the
chosen model. Qwen remains the default for old aliases and new sessions.

Dedicated employee model/config process APIs now resolve their process to its
session and require join access to that session's project. Unknown processes,
other projects, view-only grants and other operator APIs remain denied. Shared
runtimes retain their existing operator policy. This fixes Auto's pre-send model
change being rejected as an operator action.

The existing $2/day per-account budget remains. Reservations and server-owned
OpenRouter price ceilings depend on the selected model's pricing; caller price
overrides are ignored. Unknown completion costs retain the reservation. No owner
OAuth, upstream key, host administration or cross-user access is granted.

Deployment backup: /root/polza-all-employee-models-20261116/ (private; includes
authentication state). All four realms passed 116 isolation checks in total.
Server validation: 286 tests passed, 5 existing skips; broker HTTP fixture also
passed, including alternate-model forwarding and price override rejection.

### Cold-session automatic handoff — 2026-11-17

A dedicated employee's cold-session redirect follows the same launch policy as
new-session creation: its verified OS boundary replaces nested Bubblewrap/slirp
settings. The successor runs in the current private project, ignoring imported
sandbox working paths. Its recorded boundary matches that policy. Shared
runtimes retain mandatory project-write/network-firewall behavior.

The route previously discarded the policy's sandbox result and hard-coded a
nested sandbox, producing a slirp4netns dependency error before Send could
complete. Regression coverage exercises both dedicated and shared handoffs,
including an imported obsolete project path.

The dedicated Codex catalog alias `codex-oss` retains the source requested model
and effort when creating a Codex handoff. A catalog label difference must not
reset the employee's explicit model choice to the default.

### Same-chat continuation — owner correction, 2026-11-17

Dedicated employees may resume authorized chats after any idle duration. The
limited-user freshness gate and Project Queue freshness callback no longer
reject their turns or trigger an automatic handoff. Project/session grants,
provider constraints and the verified OS boundary still apply; shared runtimes
retain their existing freshness policy. Manual handoff remains available.

Imported native OpenAI-provider Codex histories preserve their thread ID and
recorded provider. The native built-in provider is not redeclared: the supported
openai_base_url override pins inference to the scoped broker, and an ephemeral
API-key login contains only the employee's broker capability. Owner OAuth and
upstream credentials are never copied. Custom native aliases keep their scoped
provider definitions and bounded retries. Native startup diagnostics include
the actual error message.

Responses requests exclude historical additional_tools catalogs: only the
current scoped tools may execute. Conversation messages and native transcripts
are not rewritten. This avoids duplicate function names and prevents obsolete
tools from being reintroduced by history. Broker output is bounded at 8192
tokens, with matching monetary reservations; the later owner update sets $10/day account caps.
Known upstream HTTP400/422 validation failures release their reservation;
unknown outcomes remain charged conservatively. Broker denials retain their
reason in a terminal response rather than becoming a generic retry-limit error.
The active slot is released and accounting persisted before successful response
completion, so the next tool-result request does not race ledger persistence.

Maintenance correction (17 November): employee services no longer bind to or
require the model broker. A broker restart preserves their processes. Their
fail-closed firewall binding and private home-mount requirement remain. Publish
backend changes only after checking native turns are idle; a backend restart
still stops its own workers.


### Owner budget update and marketing tools — 2026-11-17

The owner explicitly raised ceo/cfo/cto/marker to $10 per UTC day each. This
supersedes the earlier $2 deployment setting; active requests, monetary
reservations and upstream account credit still apply. The multichannel update
below raises the independent internal call ceiling to 3000/day.
Other grants and model choices remain unchanged.

Marker's site uses pnpm 10.34.9 through its packageManager declaration and the
root-owned runtime Corepack wrapper. Pillow/CairoSVG are installed as distro
packages. Memory-intensive Next builds are requested with polza-site-build: a
single bounded systemd path watch starts a fixed same-UID Webpack build, outside
the chat's 1.2 GiB cgroup. It adds no sudo, arbitrary command or root execution.
See services/polza-site-build/README.md for bounds and ownership.

Images are independently granted to marker through the existing UID-authenticated
connector; owner is implicit, other staff remain denied. The upstream key is
private. Paid requests need a stable key, never automatically replay on unknown
outcomes, and are limited separately from text-model dollars. See
services/polza-access/README.md for commands, formats and retention.


### Billing and visible counters — 2026-11-17

The Polza sidebar displays Codex, Claude and OpenRouter in owner and employee
realms. Subscription percentages appear only when the native provider reports
a quota. Employee Codex/Claude API transports are labelled separately, with
per-transport request counts and confirmed cost since tracking began. Absent
quota/billing data is shown as unavailable, never as a fabricated zero.
The Polza build flag remains the UI gate; vanilla/older servers retain their
existing behavior and an unavailable optional billing route is nonfatal.

`GET /api/providers/model-usage` reads the fixed loopback broker with the
runtime's own capability. It returns only that employee's budget, active/queued
counts and transport accounting, plus the shared upstream key's API-reported
spend and account credit balance. The owner uses a separate status-only
capability, which cannot invoke inference or enumerate individual employee
ledgers. Keys are never returned to browsers. The owner runtime overlay also
needs the existing `auth/dedicatedEmployeeRuntime.js` dependency, with its opt-in
disabled in the owner service; do not copy an employee policy into that service.

Router facts come from `GET /api/v1/key` and `/credits`, with a 60-second
single-flight cache. An unavailable refresh retains a timestamped stale result
or returns unavailable; it never turns missing data into zero. Refresh is
explicit/view-owned, with no endless idle poll. A configured employee daily
budget is distinct from the upstream key's own cap and the account credit
balance; reaching either upstream limit can still prevent inference.

Request reservations are not invoices. Terminal Responses/Anthropic SSE billing
is parsed incrementally before forwarding the terminal bytes: a native SDK may
cancel immediately after `response.completed`/`message_stop`, before HTTP EOF.
Confirmed `usage.cost` is retained even then. If cost is absent but a recognized
generation id exists, one bounded read of `/generation` can confirm `total_cost`.
An unknown outcome retains its conservative reservation and is labelled
unverified. Partial usage without a terminal event is not treated as a complete
bill. Known provider validation failures release their reservation.

The pre-tracking ledger has no per-request attribution. Its legacy upper bound
is displayed separately from confirmed costs; it must not be called actual
employee spending. On 17 November the marker legacy charge was safely capped
by the actual cumulative spend of the shared upstream key, not reset to zero
or falsely assigned a precise daily invoice. Twenty-four subsequent native
requests were individually verified through OpenRouter generation records;
their exact per-employee totals replaced only those known tracking-period
reservations, preserving request counts and the legacy bound.

Production verification: sixteen real native chats (four per ceo/cfo/cto/marker)
completed, with a measured sixteen global/four per-account peak. All four native
terminal probes passed 29 OS checks each. An initial cold parallel launch saw
two Codex startup exits; the underlying cause was not established. After
warming/restarting those runtimes, both the repeat pair and the final sixteen
completed without that failure. This is evidence for current realms, not a
claim that arbitrary future cold provisioning is proven. Diagnostic chats were
archived. Scoped API reads passed in all five realms; a status-only token was
rejected for inference. Focused broker/accounting tests cover early SSE client
cancellation, queue cancellation, memory pressure and both wire formats.

### Resource-selection audit — 2026-11-17

The current boundary isolates employee UIDs from owner/other-employee state. It
must not be advertised as fine-grained folder, exact-chat or per-external-account
isolation inside an employee realm. Backend and worker share that UID; production
metadata and a non-writing mount-namespace probe confirmed that its auth/grant
stores and their parent are writable by it. See
[authority-store gap](../gaps/polza-agent-writable-authority-store.md).

The existing team admin edits projects and integration families for four
preprovisioned realms; it is not a reusable isolated-employee creation flow.
Native project view/join/new-session and path grants are not exact-chat grants or
OS read/write folder mounts. Media has internal site scopes but its current
connector uses one shared owner capability, without per-employee account choices
in the admin. A native disable is not a single revocation action for inference,
browser leases, filesystem workers and connector capabilities.

[Managed employee/resource access](../docs/tactical/polza-managed-employee-access.md)
records the requested target and migration/acceptance plan. It is a proposal,
not a claim that the resource-selection wizard or separated execution identity
has shipped. The audit did not provision users, change grants or restart services.

### Production specialist account — 2026-11-17

The owner requested `dimak_spec` for client project management and launch control.
Native usernames currently accept hyphens but not underscores: the actual login
is `dimak-spec`; its label remains `dimak_spec`. The new realm uses UID 2005,
`pcw-dimak-spec`, port 3414 and `polza-employee-dimak-spec.service`. Its HOME is
`/var/lib/polza-employees/dimak_spec`, on a separate 4 GiB loop filesystem.
The four existing realms, histories and password hashes were preserved.

`work/production` is a service-namespace bind of the existing production tree
`/home/manager/аутрич-контур`. Named/default ACLs grant UID 2005 access only to
that tree, not manager HOME. File edits are shared; historical owner chats were
not migrated or synchronized. New employee chats are in this realm and the owner
can open that same realm through team administration. Do not describe this as
universal cross-realm chat sharing.

The configured connector principal `dimak-spec` maps from UID 2005 and receives
Telegram write (explicit recipient/text request and idempotency still required)
and Portal read. It has no corporate Gmail, media, Docs, finance or deployment
grant. The actual shared Telegram account checked as `@igor_grishin82`, without
Premium. The model budget is $10/day UTC; the existing per-account concurrency
and shared global admission limits remain in force.

Portal exposes only `portal.status`, `portal.projects {limit,offset}`, and
`portal.project {project_id}` via the UID broker. The fixed existing owner-only
`portal-ro` helper holds credentials and opens a read-only transaction. The
employee never receives a DSN, SSH key or arbitrary-SQL interface. Reports include
bounded production fields, periods and campaign statuses, excluding finance and
credentials. Project IDs must parse as UUIDs; list pagination is limited to 100
rows and text fields are truncated. There are no campaign start/stop or project
write operations. This is live querying, not a background data mirror.

Acceptance: public limited login, unified team handoff, single project visibility,
31 OS/network/filesystem probe checks, actual Telegram profile, Portal list/detail,
negative Gmail/media/Docs/admin/project checks, and one real native Codex worker
running `polza-integration portal.status`. The diagnostic chat was archived.
Root-only rollback/configuration receipts are in
`/root/polza-dimak-spec-20261117/`; credentials must never enter Git or this topic.
The existing worker-writable realm authority-store gap remains unresolved.

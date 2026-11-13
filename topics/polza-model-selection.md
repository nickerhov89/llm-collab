# Polza model selection

The branded in-chat OpenRouter action reactivates the **same** session through
a compatible harness: Claude → Claude Gateway, Codex → CodexOSS. It does not
create, fork, hand off, rewrite a transcript, or navigate to a new-session URL.
Other native transcript families do not offer this action. The connected
process provider is authoritative in every watching tab.

The client requires the existing message-less reactivation capability. Before
switching it fetches the target provider catalog and requires an authenticated,
enabled installation advertising `openrouter/auto` (including service-qualified
IDs). Missing support, a busy session, or a rejected activation leaves the chat
and the previous Auto/manual preference intact. The server retains ownership,
limited-user policy, permission and sandbox enforcement. In particular, a
missing Bubblewrap dependency remains a blocker for limited users.

Auto is evaluated again before each ordinary idle continuation using the new
message and at most six recent main-conversation user messages (12,000 chars).
Architecture/migration/security-audit context can retain a stronger model for a
short continuation. Failure escalation uses the current message only. Manual
model selection disables this policy per chat. Slash/local controls, steering
an active turn and server-owned deferred queues retain their existing semantics;
they do not reconfigure an in-flight provider. OpenRouter Auto independently
routes each upstream inference using the native conversation it receives.

The local OpenRouter proxy forwards Anthropic Messages as well as the existing
OpenAI routes. Requests bearing the local dummy credential resolve the operator's private key file
(`POLZA_OPENROUTER_KEY_FILE`, default under the service user's home); the key
never enters the browser or logs. It stays bound to loopback. Existing Codex
Bearer authentication is preserved. Claude Gateway must also be included in
operator `ENABLED_PROVIDERS`; merely configuring its URL is insufficient.

Codex now enforces the rollout's native `model_provider` on resume. For the
explicit deployment opt-in `POLZA_OPENROUTER_GATEWAY_SERVICE_ID`, the OSS harness
reads that key from the original transcript and uses the documented per-launch `openai_base_url` for the built-in
`openai` key (reserved IDs cannot be redefined), or endpoint overrides under
the original custom key. It never rewrites session metadata or messages.
`POLZA_OPENROUTER_GATEWAY_TOKEN=dummy` is the local proxy credential; the documented per-invocation `CODEX_API_KEY`
selects it instead of saved OAuth, so the original OpenAI credential is not
forwarded to the new endpoint. Modern Codex JSONL resume is enabled only for this
opt-in, preserving legacy endpoint behavior. Nonzero CLI exits become visible
errors instead of a successful empty turn.

## Verification

2026-11-13: focused routing/picker tests cover transcript-family choice,
continuation context, and an activation conflict retaining the manual choice.
Client TypeScript passes. Live deployment and native multi-turn verification
must be recorded after completion; local tests alone do not establish them.

The earlier correction (7237c90) only removed the cross-provider new-chat
launcher. It did not implement a compatible in-place gateway transition.
The adjacent native Claude model-control gap remains separately tracked.

Official configuration references: [built-in proxy URL](https://learn.chatgpt.com/docs/config-file/config-advanced), [per-run API-key authentication and resume](https://learn.chatgpt.com/docs/non-interactive-mode).

# Polza Requesty deployment migration

An operator can opt the existing native gateway into Requesty with
`POLZA_ROUTER_UPSTREAM_KIND=requesty`,
`POLZA_ROUTER_UPSTREAM_BASE=https://router.requesty.ai` and the existing private
key-file setting pointing at a Requesty credential. Defaults remain OpenRouter.
`VITE_POLZA_ROUTER_LABEL=Requesty` changes the deployment's visible router brand.

The gateway keeps native session/provider IDs, URLs, transcripts, approval
policies and live tool declarations. The legacy `openrouter/auto` identifier is
accepted for existing sessions. In Requesty mode it is a local per-request
selection from the operator's available text/vision pools: first available
configured model for ordinary/image input; GLM-5.3 for explicit high/max effort
when configured and suitable. It is not Requesty's dashboard Auto policy and
makes no separate classifier calls. Native Responses, Messages and Chat
Completions retain their wire endpoints and streaming formats.

Catalog discovery uses Requesty's authenticated `/v1/models`, maps declared
context/vision/tool capabilities, and excludes non-chat and unrelated account
policies. Same-model naming changes are translated at the wire. Removed legacy
Qwen3 Coder selects the available Qwen3.8 Max migration target; removed Qwen
vision/flash identifiers select Gemini 2.5 Flash. These deliberate deployment
migration aliases are visibly named with their targets in the catalog; they do
not rewrite historical messages. Other unavailable models end with an explicit
same-chat selection error rather than silently inventing a model or creating
a handoff. The compatibility module owns the audited mapping.

Requesty credentials are resolved server-side, including callers carrying old
local credentials. They never enter browser storage. Explicit Auto restrictions
must admit the chosen target. Context, tool results and opaque replay records
are not truncated to accomplish migration. OpenRouter credit-specific output
recovery is disabled in the Requesty deployment; bounded quota errors identify
Requesty and retain the existing same-chat retry behavior. No accepted stream
or executed tool is replayed by this migration.

The deployment-local employee broker routes directly to Requesty, through its
existing scoped capability, byte/admission/daily-budget boundary. It must not
reach the owner-only loopback gateway or share owner browser/session data.
Requesty model prices normalize to per-token broker prices; unknown prices
remain unknown and fail the existing employee pricing check. Completed usage
costs remain supported by the existing SSE accountant. The OpenRouter-specific
balance/generation reader is disabled for Requesty; unavailable account balance
is shown as unavailable, never zero or the previous service's balance. Existing
account grants and daily ledger are preserved.

Verification includes real Requesty catalog and all three inference endpoints,
streaming, an existing native Claude session resumed twice with remembered
context, and an existing scoped Codex session with a real terminal tool result.
Focused loopback cases preserve replay/tool payloads and manual selections,
visible unavailable-model handling and bounded correctly branded quota errors.

### Native marketing replay regression, 23 November 2026

Simple sessions did not cover the owner's long marketing chat. Its full native
Responses replay contained opaque `compaction` items and array-valued
`custom_tool_call_output`. Requesty returned `400 unknown unmarshal error` for
each of these independently. The wire adapter now wraps opaque compaction as
explicit historical assistant text and serializes custom output blocks into the
string accepted by Requesty. Original records, visible history, IDs and call IDs
remain intact; opaque vendor state is retained as data, not claimed decrypted.
Native rollouts are never rewritten.

The next provider error exposed Gemini's incompatible combination of built-in
Search and function tools. Text Auto requests containing that combination now
choose GLM from the configured pool, preserving tool declarations. Explicit
manual model selections are still not silently changed. A full private replay
with this adapter and GLM returned the expected technical reply. This does not
establish that every catalog model accepts every possible tool combination.

## Bounded quota failover for Requesty Auto

With the existing cooldown option enabled, a 429 HTTP rejection before any
accepted stream makes Auto try at most one different model from the configured,
permitted pool. The whole replay, tool results, tool declarations and output
limits survive; history is not shortened. Failed models are excluded until the
Retry-After cooldown expires, without background polling. With both routes
exhausted, subsequent requests return the bounded rate-limit response without
calling the upstream again during that cooldown.

The alternate must preserve vision and tool compatibility. In particular,
Gemini is not an alternate for mixed built-in Search/function-tool input.
A successful retry exposes `x-polza-route-fallback: quota` and the chosen model
in response metadata, and logs only route IDs/status. An explicitly chosen model,
account-level 402 balance failure, policy/auth refusal, accepted SSE stream or
streamed tool call is never automatically replayed through this recovery.
Employee admission and spending limits are not changed by this behavior.

Fault-injection verification covers all three native inference endpoints,
model cooldown, both routes exhausted, vision/mixed tools, preserved context and
call IDs, manual selection, account-credit denial and a late SSE quota error.

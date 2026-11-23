# Polza OpenRouter output-budget recovery

The local gateway keeps its existing defaults unless the operator enables
`POLZA_OPENROUTER_ADAPT_OUTPUT_BUDGET=1` (with the gateway's limit handling).
A manually selected model is never replaced. Requests are never stripped of context or
tools, or given weaker sandbox/approval policy by this recovery.

For an HTTP 402 response before streaming starts, the gateway reads at most
64 KiB and recognizes the numeric requested/affordable output-token refusal.
It resubmits at most once, and only when OpenRouter identifies its own
`openrouter_credits` preflight as the limit source. The ordinary same-model retry preserves all
request fields except the output ceiling, reduced to 95% of the reported
allowance rounded down to 128 tokens. An allowance below 128, ambiguous output
fields, or an explicit thinking budget that would not fit gets no automatic
retry. Anthropic `max_tokens`, Responses `max_output_tokens`, and Chat
Completions `max_completion_tokens` use the same rule.

An accepted/streaming response is never replayed, even if a later SSE event
reports a credit error. A second refusal ends with a visible error rather
than another attempt; there is no tool replay.

For Auto only, the operator can additionally configure
`POLZA_OPENROUTER_AUTO_COST_TIER=low` for its injected router policy and
`POLZA_OPENROUTER_AUTO_BUDGET_MODEL=<model-id>` for that single rejected-preflight
retry. The budget model must belong to the configured pool for the input
(text or image). This lane keeps context, tools and explicit reasoning settings,
uses at most 4096 output tokens, and can recover an unaffordable input request
without trimming history. It never overrides a manual model or a caller-supplied
Auto plugin/restriction. All settings are deployment opt-ins; vanilla defaults
remain unchanged.

A recognized unaffordable output reservation is request-specific, so it does
not populate the account-wide cooldown: a smaller request can still succeed.
Output and input-context credit refusals get distinct messages. Their errors
explain the requested and affordable token counts without exposing
the upstream message, workspace/key URLs, credentials, or prompt. Generic
402/429 cooldown handling remains as before. No retry history or raw error
bodies are retained by this feature.

Verified by loopback gateway integration tests: all three token fields,
unchanged model/context/tools, default-off behavior, a small request after a
large refusal, a second 402, explicit thinking budgets, provider-origin limits,
a 200 stream containing a later error, input limits without context truncation,
operator cheap routing, and preservation of manual models/custom Auto policies.

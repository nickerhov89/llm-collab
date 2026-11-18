# Polza OpenRouter model catalog

The explicitly configured owner gateway serves its agent-model catalog from
OpenRouter's live `/api/v1/models` metadata, instead of two hard-coded entries.
Only text-output models advertising tools are offered; batch variants and
non-agent/image/embedding models are omitted. OpenRouter Auto remains first.
Display names and context limits come from the advertised metadata, while the
stable upstream model ID remains the value applied to the current process.

The gateway caches metadata for five minutes, coalesces concurrent first reads
and serves the last successful catalog during a failed background refresh.
A cold failure returns 503 with an explicit catalog error, not a fabricated
short fallback. Metadata fetches send no operator key and generate no model
completion. Catalog membership does not establish account/provider access:
provider permission errors, including the separately observed Anthropic 403,
remain ordinary upstream errors. No identity/region/header workaround is added.

The owner gateway supports an optional comma-separated
`POLZA_OPENROUTER_AUTO_ALLOWED_MODELS` deployment setting. When configured, it
adds OpenRouter's documented `auto-router` plugin `allowed_models` to Auto
inference requests only. It does not replace Auto with a fixed model, change
manual selections, retry rejected work, or modify an explicit per-request
`auto-router` plugin. Without this setting, request bodies retain the previous
streaming pass-through. With it, inference JSON is buffered with a 64 MiB limit;
larger bodies return 413 before any upstream request. HTTP statuses, upstream
error bodies and request IDs remain unchanged, including provider 403 refusals.
Configure the owner gateway with the comma-separated environment variable
`POLZA_OPENROUTER_AUTO_ALLOWED_MODELS`; leave it empty to disable this policy.
The candidate restriction uses the provider's
[documented Auto Router settings](https://openrouter.ai/blog/announcements/introducing-the-new-auto-router/).

On 18 November the owner's selected `openrouter/auto` failed with the provider
Terms Of Service 403. The same existing key accepted harmless Qwen, GLM and
DeepSeek probes, while an Anthropic probe reproduced the refusal. The owner
deployment opts Auto into the three tested model IDs, using the provider's
normal routing controls. This is a mitigation for Auto's candidate selection,
not evidence that the failed Auto request's exact chosen model is known, nor a
fix for upstream access to manually selected restricted models. Model catalog
membership and a successful health check still do not guarantee inference.
The deployed owner gateway returned a successful Auto Messages reply from
DeepSeek V3.1. A separate native `claude-gateway` Auto chat completed with the
expected diagnostic marker through GLM 5.3 and was archived. The original
conversation was neither replayed nor restarted. Broker/employee configuration
is outside this owner-gateway mitigation.

The owner OpenRouter service uses maxModels=1000 (the supported per-service
limit), replacing its prior value 2. This is deployment configuration, not a
change to the shared provider defaults. Automatic effort probes remain off as
previously configured. Employee broker catalogs, model locks and budgets stay
unchanged. The existing owner key and manually selected model are preserved.

The Polza in-chat quick menu offers a case-insensitive search over display
name and full ID, preserves input while filtering and uses the existing
same-process configuration route. No match is explicit. Selecting a model
retains the chat identity; the catalog change does not start a new chat.

Validation: HTTP catalog integration (deduplication, filtering, stale fallback,
cold error), client picker test with 321 choices and same-process selection,
client typecheck and exact-file lint/format. Repository-wide CSS/console gates
have separate existing debt in gaps/polza-model-picker-global-check-debt.md.

Deployment must preserve concurrent server-side client source changes. The
2026-11-16 build used a local isolated copy with the deployed Tasker/project/
settings sources overlaid, then changed only the picker and its strings.
The owner static build retains the prior hashed assets for existing open tabs.
Rollback gateway code and owner service maxModels from the private deployment
backup, and restore the old owner client-dist directory. Do not roll back
unrelated staff data or server source changes.

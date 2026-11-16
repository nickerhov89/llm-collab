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

# Catalog process: validation scope and existing broad gates

Found 19 November 2026 while adding the requested recurring model-list process
inside Cowork. Contract: [account catalog maintenance](../topics/polza-model-selection.md#account-catalog-maintenance).

Three real Node HTTP integration cases pass (~0.2s total), covering account
credentials on the upstream-only path, background refresh without gateway
readers, force-refresh authorization, safe status, retained last-good models,
deduplicated reads, and unchanged explicit-model/refusal forwarding. Exact-file
Biome lint/format and node syntax checks pass; whole tracked formatter passes.
No client source, CSS, provider runtime, dependency or permission change.
The existing CSS/console/full-suite limits remain described in
polza-model-picker-global-check-debt.md and
polza-inline-schedule-validation-20261119.md; full-suite success is not claimed.

Live diagnostics used two synthetic non-PII requests to GLM-5.3: text returned
200; an artificial 1x1 image returned 404 with "No endpoints found that support
image input". The model was present in public and authenticated account catalogs.
Thus refreshing the catalog does not repair that image capability mismatch.
No user transcript or attachment was submitted to a model for these probes.

Gateway source matched the committed baseline before patching. Restarted only
polza-openrouter-gateway.service after refusing to proceed while established
connections existed. Owner and staff native Cowork services were not restarted.
The live account-filtered agent list has 324 models, 220 image-capable. After
the first agent check at 08:53:30 UTC, a later health read showed an independent
background success at 09:07:34 UTC: no manual refresh caused that later update.

A real owner maintenance chat ran the CLI and returned the actual counts.
The native scheduler manifest and UI both confirm an enabled 360-minute
interval and its next occurrence. The initial check was a normal chat turn,
not a completed scheduled occurrence; a future six-hour dispatch was not
awaited in this verification. No dispatch result is inferred from assistant
prose. Desktop 1000x600 and phone 375x812 screenshots were inspected separately
and delivered through writeCapturePreview. Phone has no document-wide
horizontal overflow. The user's browser extensions overlay small icons;
browser console was not collected. The schedule editor was closed and its
agent-created draft cleared after capture; recurrence remained enabled.

Operational details and the actual chat URL are in the parent workspace's
research/company/COWORK_MODEL_CATALOG_PROCESS_2026-11-19.md. Gateway rollback
backup: /root/cowork-catalog-refresh-before-20261119/gateway.mjs. Keep the
scheduler paused before retiring its command or rollbacking the local refresh
endpoint. Concurrent Claude Goal worktree edits were preserved.

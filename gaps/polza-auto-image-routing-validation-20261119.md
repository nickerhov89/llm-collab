# Auto image routing: verification scope

Found 19 November 2026 while restoring the owner's existing capabilities-map
chat. Contract: [Auto image routing](../topics/polza-model-selection.md#auto-with-images-in-conversation-history).

The prior configured Auto pool consisted of Qwen3 Coder, DeepSeek Chat v3.1
and GLM-5.3, all text routes. Switching from GLM to Auto therefore did not
resolve the image remaining in native history. A distinct configured vision
pool now routes image-bearing Auto requests without changing the text pool.

Four Node HTTP integration cases pass (~0.22s runner wall time). Regression
coverage includes historical images followed by a text continuation, image
blocks nested inside tool results, OpenAI image_url and Responses input_image,
unchanged manual requests/explicit router overrides and a missing vision pool
returning 422 before any upstream call. Existing catalog/auth/refusal cases
also pass. Exact-file lint/format, Node syntax and diff whitespace checks pass.
No client code/styles/provider protocol/dependencies were changed. The existing
broad-check limits remain recorded in polza-model-picker-global-check-debt.md
and polza-inline-schedule-validation-20261119.md; full-suite success is not claimed.

Live synthetic Auto + image returned HTTP 200 via GLM-5.3 Flash after deployment.
Then a no-tools diagnostic was submitted through the supported resume endpoint
to the exact existing owner session a6f0c218-05ee-454f-b249-375b659d4ff3 under
project L3RtcA. The native assistant returned COWORK_AUTO_IMAGE_OK; the owning
process became idle, requestedModel remained openrouter/auto, and the loaded
recent continuation had no model-availability errors. The same session URL,
old image attachment and successful reply were verified in the browser at
1000x600 and 375x812. Both captures were inspected separately and delivered
through writeCapturePreview. Phone has no document-wide horizontal overflow.
No original business task/tool execution was requested by this diagnostic;
response success does not claim those tasks were completed. The browser console
was not collected. No transcript was dumped into logs or rewritten manually.

Only polza-openrouter-gateway.service restarted, after checking for established
connections. No native Cowork service, employee identity, permission or
credential changed. Existing metadata refresh and native maintenance schedule
remain. Persistent image-pool drop-in:
~manager/.config/systemd/user/polza-openrouter-gateway.service.d/zzzz-polza-auto-image-pool.conf.
Gateway source rollback backup: /root/cowork-auto-image-before-20261119/gateway.mjs.
A rollback must coordinate removal of this newly introduced drop-in and wait
for active gateway requests before restart. Concurrent Goal files were preserved.

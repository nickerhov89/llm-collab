# Routine Auto notices: validation and existing broad gates

19 November 2026. Contract: [Polza model selection](../topics/polza-model-selection.md#routine-auto-notices-in-the-polza-transcript).

Only two complete native warning messages naming openrouter/auto are omitted
by the existing branded quiet-transcript presentation. Native sources,
provider configuration and model-metadata fallback behavior are unchanged.

Client typecheck, full formatter check, exact-file lint and production Polza
build pass. Focused policy/presentation tests cover both branded and vanilla
rendering, retaining real errors, other models' warnings and warning messages
with additional error text. Existing conversation-height regressions pass.
Authenticated owner chat “Маркетинг — план на 30 дней” was inspected at
1000×600 and 375×812: zero matching routine warning cards, no document-wide
horizontal overflow; native no-output status is still visible. Captures were
inspected individually and delivered through writeCapturePreview. Browser
console was not collected. Provider response delays are outside this change.

Full lint remains blocked by pre-existing PolzaProjectActions.css and global
CSS ceilings. Console scan retains the known 61 warn sites against a ceiling
of 60; this change adds no logging. css:touched defers extracting the renderer's
321 owned lines because of shared/generated vocabulary and 55 coupled rules.
No CSS or baseline was changed. Full-suite success is not claimed; the existing
broad-test limits are recorded in polza-inline-schedule-validation-20261119.md.

Both owner and employee assets were updated from the verified previous Polza
build, preserving deployment-local file-drop code and older hashed assets.
No provider or user service restarted and no chat message was submitted.
Rollback: client-dist.auto-notices-before-20261119 in each runtime; source
backup /root/cowork-auto-notices-before-20261119. Native transcripts retained.

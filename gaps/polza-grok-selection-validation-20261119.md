# Gateway selection: deployment and remaining runtime activation

Found 19 November 2026 while correcting Grok being displayed as Auto.
Contract: [Polza model selection](../topics/polza-model-selection.md).

The owner and staff Polza clients now derive the gateway Auto state from the
confirmed model rather than a browser-local default. The same-session picker
and composer show saved Grok, including after reload with no manual browser
flag. The full settings tab clears Auto after accepted manual changes. The
Auto action submits the actual gateway model change before closing; failures
remain visible and do not pretend selection succeeded.

22 focused client tests, client TypeScript, exact-file lint/format and the
production Polza build (31.43 seconds) pass. Desktop 1000x600 and phone 375x812
captures were inspected individually and delivered with writeCapturePreview:
outputs/grok-selection-20261119/{desktop,phone}.jpg in the parent workspace.
Saved Grok has the checkmark and composer label, Auto has no checkmark, the
same URL survives reload, and the phone has no document-wide horizontal
scroll. Sequential search typing remained intact against the live large
catalog. Keystroke latency was not instrumented. Browser console was not
collected. Provider inference success is not established: the single synthetic
QA turn returned a visible gateway exit error, which was not hidden.

Live switching exposed an independent existing CodexOSS abort defect: an idle
adapter waits on MessageQueue while abort only signals the CLI. Its provider
iterator never exits, so the server correctly refuses restart with
"Timed out waiting for provider iterator to stop". The companion server fix
cancels only that iterator wait and removes its listener on completion; it
does not weaken verified-stop or fork/handoff rules. 24 provider lifecycle
and endpoint tests and server TypeScript pass. The source patch is prepared
in /home/manager/work/polza-codex-ui, but is NOT active in the owner/staff
server processes. Installed owner/staff dist modules are staged after an
isolated TypeScript transpile and node syntax check. Runtime restart
must be coordinated after the active owner video-to-articles task drains;
restarting it now would interrupt the user's work. Source and prior installed adapter backups:
/root/grok-selection-backend-before-20261119/.
Do not report the live switching timeout as fixed before activating/retesting.

Full lint retains existing PolzaProjectActions.css and the global CSS ceilings
(1590/220 and 557/129). Console scan retains 61 warn sites against a limit of
60; this change adds no logging. css:touched defers ModelSwitchModal,
MessageInputToolbar and SessionPage extraction because of 55/111/49 coupled
rules and dynamic/shared vocabulary. No styles or baselines changed. Full
formatter check passes (4254 files before adding this note). Full-suite
success is not claimed; the earlier broad-test failure is recorded in
polza-inline-schedule-validation-20261119.md. Concurrent claude-goal.ts and
Supervisor.ts edits were preserved and are outside these commits.

Frontend rollback: client-dist.grok-selection-before-20261119 in each runtime;
source backup /root/cowork-grok-selection-before-20261119. Both clients were
built from the verified auto-notices stage, preserving deployment-local file
drop behavior, and retain older hashed assets. No user service was restarted. All three dedicated QA chats were archived
through the supported API; only aborted QA input waits were awakened during
cleanup. User chats and active work were not changed.

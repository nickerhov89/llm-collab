# Shared checkout checks outside the production specialist account slice

The 2026-11-17 `dimak-spec` operations change passes its two-file Biome check,
Node team entry/auth test, four Portal boundary tests, git diff --check and real
VPS limited-user/native-tool/OS verification. Full repository commands were also
invoked, but this shared checkout contains concurrent work outside those files.

`pnpm lint` stops on existing non-module PolzaProjectActions.css and frozen global
CSS limits: polza-codex.css 1568/220, polza-transcript.css 460/129.
`pnpm format:check` reports 22 diagnostics in other files, including
AttachmentButton.tsx, MessageInput.tsx, UsersSettings.tsx and
scripts/polza-model-router.mjs. Do not mechanically format these concurrent edits
into the account deployment. The exact edited team-entry source files are clean.
The full test run also exposed AuthRoutes/provider-host timeouts and
MessageInput/Sidebar failures in untouched files. The broad test and parallel
typecheck processes were stopped after about three minutes; typecheck completion
is not claimed. This gap does not claim the general repository gate is green.

Fix the CSS ownership/format debt with its owning changes; do not relax the
frozen limits or conceal warnings for this provisioning task.

Current recheck: formatter diagnostics were resolved on 18 November 2026;
remaining broad gates are recorded in [cleanup validation](polza-backlog-cleanup-validation.md).

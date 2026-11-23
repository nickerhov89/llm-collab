# Remaining broad checks after Cowork backlog cleanup

Rechecked 18 November 2026 while the owner requested committing/pushing the
outstanding Cowork work. Full `pnpm typecheck` passed, including tool-display
and client E2E TypeScript gates. The 22 baseline formatter diagnostics were
fixed in a separate mechanical commit; full `pnpm format:check` now passes.
Exact-file Biome checks for all 44 changed/new JS/TS/JSON/CSS paths passed.

Full `pnpm lint` still stops on the existing PolzaProjectActions.css non-module
stylesheet and the frozen polza-codex.css / polza-transcript.css global limits.
These require a CSS ownership migration, not a limit increase or mechanical
rewrite folded into publishing the already deployed backlog. Existing detailed
validation notes describe the earlier state; their formatter failures have now
been resolved, while this CSS boundary remains open.

Full `pnpm test` was attempted with the existing installed dependencies and
stopped after 180 seconds; completion/pass is not claimed. The partial server
run includes expected negative-path WARN output and highlight-worker failure
fixtures. No inference is made that each such warning is a product failure.
The scoped gate passed: 19 Node integration/runtime cases, 21 access-connector
Python cases, 4 Gmail cases, 3 sidebar client cases and 86 native Tasker/limited
user cases. Portal's four cases are now included in the 21 connector cases.

The media-browser Node slice emits Node's ExperimentalWarning for built-in
SQLite under the tested Node runtime. This is the supported runtime's module
status, not an application deprecation; replacing the persistence layer solely
to hide it is outside this Git cleanup. No warning filter or timeout increase
was added, and neither the full test suite nor full lint is reported green.

Found 2026-11-18 while cleaning and publishing the Cowork source backlog.

20 November 2026, first-turn Claude billing-error recovery: full format and
TypeScript checks passed; the server build and 130 focused resume/metadata
cases passed. Full lint still fails at the same three CSS ownership boundaries
above. Full workspace tests were attempted and stopped after about 200 seconds
once unrelated failures appeared (auth/setup timing, provider-host replacement,
projectFileCompletion, new-session bootstrap, client seeded model selection,
and Codex goal streaming). Shared (964), relay (139), and push-broker (45) cases
completed. Full workspace success is not claimed. The resume repair edits no
client/CSS/auth/provider-host/Codex code, and this shared checkout contains
other client edits; folding their fixes into this recovery change would not
be an isolated cleanup. A real Claude SDK loopback test additionally verified
two billing failures followed by same-ID recovery retaining both user prompts,
without provider credit usage.

The later 20 November output-budget repair passed 21 focused gateway checks,
full TypeScript and formatter checks. Full lint hits the same CSS debt. A new
full test attempt was stopped after roughly 150 seconds when unrelated
MessageInput client, provider-host-system and new-session-bootstrap failures
appeared. No changes to those surfaces are part of the gateway repair.

23 November 2026, Requesty migration: 27 gateway/compatibility cases, 16 client
selector/sidebar cases, direct client TypeScript check and Polza production
build passed. Full formatter check passed. The CSS architecture entry gate still
fails on the same three global-style ownership limits above, before full lint
can proceed. Console scan also reports the existing 61 warn sites against a
limit of 60; the migration adds no warn sites. No full workspace test pass is
claimed. Native same-chat Claude continuation with remembered context and
scoped Codex tool execution both succeeded through real Requesty requests.

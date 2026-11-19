# Inline chat schedule: verification and broad check limits

Verified 19 November 2026 against the existing account-scoped scheduler.
Contract: [Polza chat execution](../topics/polza-chat-execution.md).

Passing checks: full workspace typecheck (including tool-display and E2E
TypeScript), full formatter check, exact-file Biome, new CSS Module ESLint,
11 focused client tests (8.36 seconds without competing full-suite work),
seven scheduler integration tests (1.53 seconds), production Polza build
(31.65 seconds). No provider/session protocol or scheduler engine changes.

Real authenticated owner browser: scheduling from the composer produced a
header badge in the same chat and cleared only the submitted draft. Reopening
restored its prompt; pause and removal succeeded. A private API read confirmed
recurrence removed (paused one-time config), zero occurrences, and the dedicated
QA chat was archived. No work message or model request was submitted by this
check. Weekly Mon/Fri selection updated the next occurrence; sequential typing
remained intact. Final 1000×600 and 375×812 captures were reviewed individually
and delivered through writeCapturePreview. No modal or horizontal phone overflow.
The user's browser extension overlays are visible; its console was not collected.

Full lint remains blocked by existing global CSS ceilings/non-module
PolzaProjectActions.css. Module scan separately reports eight existing findings
in MessageInputToolbar, MessageList, PolzaNewSession and SessionSearch. Console
scan retains the existing 61 warn sites against its ceiling of 60. This feature
adds no console calls. css:touched defers extraction of MessageInput and
SessionPage because their generated/shared vocabulary and coupled rules exceed
this feature's boundary. Do not raise those baselines.

Full pnpm test did not pass: shared binary-framing's large-message reassembly
case exceeded its 5-second timeout during the broad run (963 other shared tests
passed). An isolated unchanged retry passed in 1.90 seconds (2.51 seconds total),
but that retry does not establish full-suite success. Transport code and test
budgets were not changed. These unrelated broad failures were not folded into
the UI task.

The obsolete, unreachable chat-mode modal and its three modal-only tests were
removed. Their native Goal dialog paths no longer ship; native provider behavior
is unchanged. The replacement tests cover partial save/activation failure,
revision-safe retry, duplicate submission and preservation of newer draft text.

Deployment preserves server-local file-drop behavior and existing translation
keys when reconciling source differences. Owner and staff clients use the Polza
profile; older hashed assets and rollback directories are retained. No service,
native chat worker, credentials, grants or existing user schedules were changed.

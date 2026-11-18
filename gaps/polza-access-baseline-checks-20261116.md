# Polza access extension: remaining checkout checks

Deployment-only files touched in scripts/polza-employee-isolation/team-entry and
services/polza-access. Focused HTTP/broker tests and exact-file Biome checks pass;
whole-checkout TypeScript typecheck also passes on 16 November 2026.

Whole-checkout lint stops before JS lint on existing CSS architecture violations:
PolzaProjectActions.css is a new non-module stylesheet, polza-codex.css is
1568/220 lines and polza-transcript.css is 460/129. The access extension adds no
client stylesheet and does not alter these component owners. Repairing these
would be a separate application CSS migration, unsafe to fold into an access
control deployment.

format:check reports 23 formatting diagnostics across existing client UI files
and polza-model-router.mjs. Exact touched JS files are clean. Those other files
are concurrent/unrelated application work and are deliberately not rewritten.

The broad test run passed 963 shared tests and timed out after 5 seconds on
binary-framing.test.ts: reassembles a message larger than one physical chunk.
That test passes alone in 1.24 seconds (1.45 seconds total), without increasing
its timeout. This is narrower evidence, not a claim that the full test command
passed. No framing/protocol code was changed. The initial pnpm invocations also
tried auto-installing dependencies and refused a non-TTY purge; checks were
rerun with pnpm_config_verify_deps_before_run=false, preserving the checkout's
installed modules. Do not replace the shared node_modules merely for this task.

Current recheck: formatter diagnostics were resolved on 18 November 2026;
remaining broad gates are recorded in [cleanup validation](polza-backlog-cleanup-validation.md).

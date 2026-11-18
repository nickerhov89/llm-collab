# Tasker newest-first validation scope

The change reverses a filtered task-array copy in PolzaTaskerPage; no task
storage, schema, account grants or backend code was changed. Exact-file Biome,
client TypeScript (checkout and production overlay), production Vite build,
four existing storage-hook tests (0.917 seconds), and browser checks passed.
The browser checked a 40-task fixture, sequential typing (maximum 47 ms per
key acknowledgement), new-task insertion, save/reload and Today filtering.
Desktop/phone captures were inspected. Live owner order matched all 43 active
tasks, with all 48 stored tasks and revision unchanged. Four employee realms
opened correctly as their limited principals, with empty personal lists.

Required broad pnpm commands initially refused automatic dependency purging
without a TTY; reruns used pnpm_config_verify_deps_before_run=false without
changing installed modules. Repository lint still fails on existing global
CSS boundaries: PolzaProjectActions.css and the 1568/220 and 460/129 stylesheet
limits. Whole-tree format reports 22 existing diagnostics. Console scan has
61 method.warn sites vs its limit of 60; this change adds no logging. These
concurrent, unrelated surfaces were not reformatted or baselined upward.

The broad test run exposed failures outside Tasker in AuthRoutes (temporary
auth file ENOENT and 5-second timeouts), git-status (large rewritten file),
and provider-runtime-host (bounded turn). No auth, Git or provider behavior
was changed. Passing focused Tasker checks is narrower evidence than passing
the entire repository suite; do not claim the broad gates are green.

The whole-workspace typecheck was stopped without a result after over three
minutes of broad concurrent validation. Both relevant client TypeScript runs
(source and deployment overlay) completed successfully. This is not a claim
that the complete workspace typecheck passed.

Current recheck: formatter diagnostics were resolved on 18 November 2026;
remaining broad gates are recorded in [cleanup validation](polza-backlog-cleanup-validation.md).

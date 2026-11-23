# Existing Polza CSS and console gates block repository-wide checks

While expanding the OpenRouter model picker on 2026-11-16, client typecheck
and the focused picker tests passed, but global CSS and console checks failed:

- `PolzaProjectActions.css` is a non-module authored stylesheet.
- `styles/polza-codex.css`: 1568 lines, frozen limit 220.
- `styles/polza-transcript.css`: 460 lines, frozen limit 129.
- Console scan: method.warn 61, budget 60; 108 ungated sites remain at the
  existing 108 budget. The current picker/catalog patch adds no console calls.

Current input styles are contained in ModelSwitchModal.module.css and do not
increase the global stylesheets or change the ratchet. The deployed client has
additional concurrent Tasker/project/settings changes; extracting their global
style ownership or deleting a warn site without reviewing its intended
operational signal would mix unrelated product changes into this bounded fix.
A separate CSS migration and warn-site audit must reconcile those exact gates;
do not raise the limits or suppress diagnostics merely to mark the check green.

Found 2026-11-16 while expanding the Polza OpenRouter model catalog and search.

Rechecked 2026-11-18 for the owner Auto candidate-pool mitigation: the same
CSS ownership gate fails with polza-codex.css at 1590/220 and
polza-transcript.css at 557/129. The gateway change touches no client CSS.
Whole-repository non-writing Biome format passes (4245 files), as do exact-file
gateway lint and the two HTTP integration scenarios (~0.2 s runner wall time).
The `pnpm` dependency preflight initially refused a noninteractive install;
checks can run against the existing dependencies with
`--config.verify-deps-before-run=false`, without replacing shared node_modules.
The previously recorded full-suite failures/time budget in
[chat execution validation](polza-chat-execution-validation-20261118.md) remain outside
this standalone gateway fix; full-suite success is not claimed here.

## Native CLI handoffs — 2026-11-23

Scoped picker, restart form and new-session suites pass (141 tests); client
TypeScript and the Polza production bundle pass. The scoped Biome check still
reports existing `NewSessionForm.tsx` accessibility findings: `autoFocus` on the
project-search input and the decorative hero SVG without a title. Neither
finding is in a changed line. No baseline or unrelated UI was changed.

Native escape actions no longer wait on router catalogs. A late router probe
must not apply after a native handoff was chosen; a partial aggregate catalog
must not silently replace the explicit destination with another provider.
Native installation, authentication, grant and sandbox checks remain enforced.

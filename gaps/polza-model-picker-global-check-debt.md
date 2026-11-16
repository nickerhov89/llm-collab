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

# Existing Polza validation debt encountered by Tasker

Tasker changes typecheck and its new TSX/CSS files pass focused lint. Existing
repository gates are not clean: CSS architecture reports the pre-existing
PolzaProjectActions.css global file and polza-codex.css (1568/220 lines) and
polza-transcript.css (460/129 lines) limits. Module scanning reports existing
unused selectors in MessageInputToolbar/MessageList and missing globals in
PolzaNewSession/session-search. Whole-tree Biome lint/format and console scan
also report broad existing Polza debt. Reformatting or rewriting these concurrent
surfaces would exceed the Tasker switch boundary. No baselines were increased.

Local pnpm commands attempt automatic dependency reconciliation and abort without
TTY; validation used the installed TypeScript/Biome/ESLint/Vitest binaries.
Two existing integration-boundary test files (prefill and acting principal)
passed, 10 tests. Production build performs TypeScript and Vite validation.

Found 2026-11-12 while adding the Polza Tasker workspace switch.

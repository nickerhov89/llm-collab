# Chat Goal and schedule validation

Verified 18 November 2026 for the owner's request to place execution modes in
conversation headers, independently of Tasker. Contract:
[Polza chat execution modes](../topics/polza-chat-execution.md).

## Passing checks

- Full workspace typecheck, including shared build, tool-display and client E2E
  TypeScript gates; full formatter check; exact-file Biome; both touched CSS
  Modules lint with zero warnings. Production frontend build passes.
- Seven scheduler tests (~0.4 s) cover calendar/DST behavior, daily caps,
  permissions/revision conflicts, uncertain delivery/restart, exact chat
  binding, recurring completed answers without Tasker reviews, archive stop and
  100-occurrence retention. Three client tests (~1.6 s including setup) protect
  fast native completion without duplicate submission, refused command/draft
  retention and cold-chat activation. Native Goal/Tasker/grant slices pass
  36 tests (~1.8 s total runner wall time).
- Real limited marker identity: native Goal invoked from the chat dialog,
  provider called `update_goal`, metadata reported `complete`, and the process
  returned idle. No second ordinary objective message was submitted.
- Real one-minute timer: three completed scheduled answers returned to the
  same chat, including repeated occurrences after a scheduler-only restart.
  Queued diagnostic entries were cancelled on pause. No Tasker card was made.
- Daily 09:00 Europe/Moscow saved paused, enabled with the correct next date,
  then paused. Monday/Friday selection survived closing/reopening settings.
  A dirty prompt survived focus/status refresh during real sequential typing.
  The final 34-key browser keydown-to-animation-frame sample peaked at 30.5 ms;
  this is scoped interaction evidence, not a general performance benchmark.
- Header/modal checked at desktop 1000×600 and phone 375×812. No horizontal
  document overflow. The dialog scrolls to its controls on phone.
- Authenticated chat-settings reads succeed for owner, ceo, cfo, cto, marker
  and dimak-spec using each identity's own granted project/conversation.

The update preserves existing scheduler state and capability tokens, changes no
native provider protocol, and does not restart native chat workers. Frontend
assets are updated for both owner and employee runtimes while retaining old
hashed assets for open tabs. Source snapshot updates are restricted to this
feature's files. Diagnostic schedules are paused and test chats archived.

## Limits and remaining broad gates

OpenRouter returned provider HTTP 403 for two OpenAI model diagnostics and an
Anthropic model diagnostic; Goal completion was verified using a fresh Qwen
Codex conversation. A prior instruction forbidding all tools prevented that
model from calling the native completion tool; that diagnostic was paused.
The UI reports native blocked/limit states instead of inferring success from
assistant text. No claim is made that every upstream model is available.

Full lint remains blocked by the existing global CSS ownership/size debt in
PolzaProjectActions.css, polza-codex.css and polza-transcript.css. Console scan
also reports the existing 61 warn sites against a baseline of 60; this change
introduces no console calls. Do not raise either baseline for this feature.
The earlier full-suite run did not complete within 180 seconds; full test-suite
success is not claimed. See [backlog validation](polza-backlog-cleanup-validation.md).
Scoped tests and real Linux deployment flows above are the change-specific
verification; the tests also ran locally on macOS. Windows was not exercised.

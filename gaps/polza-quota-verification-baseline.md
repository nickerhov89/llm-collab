# Existing Cowork quality gates block a clean global quota check

Quota-recovery verification exposed pre-existing errors outside its behavior:
NewSessionForm has noAutofocus on project search and noSvgWithoutTitle on its
hero decoration; the CSS architecture gate rejects PolzaProjectActions.css and
the existing polza-codex/polza-transcript global stylesheet sizes. The console
scan reports 61 warn calls against its 60-call budget without any new console
calls in this change. These need separate focus/accessibility, styling and
logging cleanup; broad automatic rewriting would mix unrelated UI behavior into
the quota-routing change. New recovery styling uses a CSS Module.

The ProjectQueueScheduler real-time readiness test once observed 8470ms left
where it requires >9000ms, during concurrent compilation. Its isolated rerun
passed without changing timers or the assertion. This wall-clock check should
use a controlled clock without weakening its real subprocess readiness test.

Found 2026-11-23 while verifying server-owned quota recovery.

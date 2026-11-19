# Polza chat execution modes

In the Polza deployment, **Goal** in the composer **+** menu prepares `/goal `
directly in the message composer, preserving the existing draft and focusing
the input. Selecting it again does not duplicate the command prefix. It opens
no modal and submits nothing; the user writes/reviews the objective and sends
it explicitly. **Schedule** opens a compact editor inside the existing message composer, never a modal. Both apply
to the existing conversation; creating a Tasker card is not required.

## Goal

Goal uses the provider's existing native `/goal` control and reported goal
state. The user supplies an objective and completion criteria after `/goal`
and sends the message. This sends one native goal command; it does not also
send the objective as an ordinary message. Native providers start/continue
their own goal work. A fast provider-confirmed completion is accepted even if
it occurs before the confirmation read.

The header flag reports the authoritative objective/status. It never infers goal
completion from an assistant's prose or from the number of accepted outputs.
Pause, resume and clear use the existing provider controls. An idle/cold chat
can be activated without submitting work before checking Goal support. A
provider without native Goal support reports it unavailable; there is no fake
success or timer-based emulation. Starting/resuming waits for a running turn to
finish. Pausing future goal work does not promise to abort an active turn.

Goal work continues with the tab closed under the native provider's lifecycle,
permissions and account limits. Human input, blocked work and usage/budget
limits can stop it. Model errors remain visible in the chat. An instruction
forbidding all tools also forbids the goal-completion tool; objectives must
allow the native control tools. Reopening/resuming after a service interruption
uses the native chat lifecycle rather than replaying a guessed submission.

## Schedule

The ordinary composer holds the prompt for each occurrence. A compact row below
it summarizes recurrence and time; expanding that row reveals daily, weekday,
selected-weekday, hourly/custom-minute interval, local time and IANA timezone
controls. A calendar preview uses the scheduler's exact DST calculation and
shows the first occurrence before confirmation. New schedules default to
weekdays at 09:00 in the browser's timezone, with a daily attempt cap of 24.
Existing caps are preserved. Interval bounds remain 1 minute–7 days.

**Schedule** saves the configuration paused, confirms that native Goal is
paused when necessary, and enables recurrence in one explicit user action.
It never submits a run-now message. If any step fails, the prompt and editor
remain available and the error is visible; an enable failure leaves the saved
configuration paused. A retry uses that saved revision. Concurrent edits fail
rather than silently overwrite settings. The composer draft is cleared only on
successful activation, and only if no newer text has been typed during saving.
Double clicks do not duplicate writes. Attachments must be removed before
scheduling; they are not silently discarded or lost. Enter uses scheduling
while the inline editor is open, rather than ordinary chat delivery.

A header badge displays recurrence/time and paused state. Clicking it opens
the inline editor and exposes next-run information, pause/resume and removal.
Removal clears recurrence using the existing paused one-time configuration,
preserving occurrence receipts; it does not erase the chat or its history.
Active-run configuration restrictions remain enforced by the backend. Cancelling
editing preserves the composer draft. Selecting Goal exits schedule editing.
A failed settings load blocks saving and offers an explicit refresh. Refreshing
server status never replaces an open configuration or prompt draft.

An enabled schedule runs on the server with the browser closed, submits to the
same native Project Queue and returns results to the same conversation. The
queue retains its own pause, quiet-hour, concurrency and authorization rules.
A finished scheduled answer records a completed occurrence without requiring
Tasker's result acceptance. Approval of an article's final text/destinations
before publication/editorial submission remains required. Default manual chat
behavior and ordinary Tasker review semantics are unchanged.

At most one occurrence of a configured schedule can be active or uncertain.
Missed occurrences coalesce instead of replaying in a burst. Calendar times
respect the selected zone; DST gaps are skipped. Daily caps defer to the next
local day. The last 100 finished occurrence receipts/results are retained;
uncertain/human-input runs are not silently discarded. A lost dispatch receipt
is not automatically replayed after retries or restart.

Pause cancels this schedule's queued entries and stops future occurrences; an
active turn may finish. Archive or loss of chat/project/account access prevents
future work. Cancelling the inline editor does not pause an existing schedule.
Enabling a schedule pauses an active native Goal. Dispatch also rejects an
active Goal if changed elsewhere.

Settings and private result files use the existing account-scoped scheduler,
not project files. The backend resolves the actor and the service revalidates
native grants; client-supplied account selectors are not accepted. Schedules
are account-specific even when a conversation is shared. Different people
should not enable duplicate schedules for the same shared chat.

See the [execution adapter runbook](../scripts/polza-task-automation/README.md)
for storage, restart/recovery and service operations. The native provider owns
Goal; the scheduler owns recurring occurrences.

## Research and planning in the composer

Deep Research is a provider skill for the next submitted message, not a model
selection. Its add-menu checkbox inserts one leading canonical skill token and
preserves the research brief. Selecting it again removes only that token.
Changing models leaves the brief and Research selection intact. On a provider
change the leading token adapts to its advertised skill prefix. Temporary loss
of the skill inventory retains the draft, and an active marker can still be
removed. A missing skill is not advertised as available. Merely selecting
Research never submits a turn or changes model/permissions.

The deployment supplies the same small, versioned research skill in each
account's global Codex and Claude skill directories. It researches with the
actual available tools, cites evidence and reports unavailable sources. It
provides no additional credentials, permissions or external publication rights.
Source: `scripts/polza-agent-skills/deep-research/SKILL.md`.

Plan mode uses the existing provider permission selector. Toggling it on
remembers the preceding permission choice for this composer; toggling off
restores that choice when supported, including after an in-place model change.
An explicit different permission choice replaces that remembered return mode.
A newly mounted composer already in Plan has no previous choice and falls back
to Ask for approval. Native next-turn/pending mode semantics remain visible.
The add menu retains at least 44px touch targets and scrolls when necessary;
its mode descriptions and icons occupy separate, consistently aligned columns.

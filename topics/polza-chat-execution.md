# Polza chat execution modes

In the Polza deployment, each conversation header offers **Chat mode**. The
settings apply to that existing conversation; creating a Tasker card is not
required. Modes start disabled. Opening settings or selecting a mode does not
submit a turn. Manual work uses the normal composer.

## Goal

Goal uses the provider's existing native `/goal` control and reported goal
state. The user supplies an objective and completion criteria, then selects
**Set goal and start**. This sends one native goal command; it does not also
send the objective as an ordinary message. Native providers start/continue
their own goal work. A fast provider-confirmed completion is accepted even if
it occurs before the confirmation read.

The dialog reports the authoritative objective/status. It never infers goal
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

The user sets a prompt for each occurrence, daily/weekday/selected-weekday wall
time or an hourly/custom-minute interval, an IANA timezone and a daily attempt
cap (1–24). Interval bounds are 1 minute–7 days. Weekly days default to Monday.
Saving persists a paused configuration; **Enable** explicitly activates it.
**Run now** is a separate manual occurrence. Next run, enabled/paused status,
errors and run history appear in the dialog. Invalid times/zones are rejected.
Edits retain the revision from the start of editing; concurrent saves fail
rather than silently overwrite settings. Status refresh does not replace a
dirty input draft.

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
future work. Manual mode pauses both the schedule and active native Goal.
Starting Goal pauses the chat schedule; enabling/running a schedule pauses an
active native Goal. Dispatch also rejects an active Goal if changed elsewhere.

Settings and private result files use the existing account-scoped scheduler,
not project files. The backend resolves the actor and the service revalidates
native grants; client-supplied account selectors are not accepted. Schedules
are account-specific even when a conversation is shared. Different people
should not enable duplicate schedules for the same shared chat.

See the [execution adapter runbook](../scripts/polza-task-automation/README.md)
for storage, restart/recovery and service operations. The native provider owns
Goal; the scheduler owns recurring occurrences.

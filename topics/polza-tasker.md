# Polza Tasker

The header shows the active workspace first in bold, then a slash and a
direct link to the other workspace: Tasker / Cowork or Cowork / Tasker.
Switching takes one click, without a menu.
Tasker lives at `/tasker` (also beneath the active relay base path). Switching
back returns to the prior Cowork route in this tab; it never stops a provider
process or submits a message.

Tasker stores tasks and the optional Habitica snapshot on the active server,
partitioned by the authenticated acting account. `/api/tasker` GET returns
`{revision, accountKey, data}`; PUT requires that revision and account key plus
`data`. The account comes only from the resolved principal, never a URL or body
selector. Limited users can access their own tasks. Authentication is required.
Files live under `polza-tasker/` in the app data directory, with private directory
and file permissions, atomic replacement, and per-account write serialization.
Stale writes return 409; corrupt/unavailable storage returns 503 without reset.
The service is a single backend writer; multiple processes require shared locking.

The client saves through the active source transport and shows loading, saving,
saved and error states. Concurrent changes never silently overwrite server data.
On sync failure it keeps a scoped browser recovery draft, blocks further edits,
and offers retry or loading the server copy. Export before discarding conflicting
edits. Focus refresh does not interrupt typing or overwrite pending edits.
On first load it imports absent ids from the same-origin, same-source/account
legacy browser store, preserving server records and tombstones. Browser storage
on another hostname is inaccessible: use JSON export/import from that browser.
There is no bundled personal task data or Habitica API synchronization.
JSON imports use `{version: 1, tasks: [...]}` with unique ids; existing ids are
skipped. Export retains all tasks including Trash. Work KPI profiles remain in
the existing profile store; task priority assessments are part of task records.

Ordinary lists display newly added tasks first, including existing tasks.
Storage and exports keep insertion order; filtering reverses a copy, so editing,
completion and restoration do not change a task's position. Legacy tasks have
no creation timestamps: their stored insertion order is used. Prioritize keeps
score order, with newest first when scores are equal.

Inbox, Today, Completed and area views share the same task records. New tasks,
completion, planning flags and notes survive reload. Delete task moves the task
to persistent Trash and offers Undo. Deleted tasks leave active, completed and
area lists; Trash keeps their notes and original completion/planning flags.
Restore returns them to Inbox or Completed. Trashed tasks cannot be edited or
started in Cowork. Export retains Trash; duplicate imports do not resurrect it. Notes acknowledge typing
immediately and defer storage writes; pending writes flush on unmount/pagehide to the recovery cache; server saves resume on the next mount if the page closes before acknowledgement.

Start in Cowork prefills the existing new-session composer with the task title
and note. The user still chooses/reviews the project and submits the message.
Starting a Cowork chat does not award XP. Tasker has its own completion ledger:
the first incomplete-to-complete transition awards 25 XP and records a timestamp
on that task. Reopening, checking again, moving to Trash and restoring do not
award more XP or erase the first reward. Previously completed/imported tasks
without this ledger are not credited automatically. JSON export/import preserves
completion markers and unlocked badge IDs; duplicate task IDs are still skipped.
An imported Habitica profile is a separate, collapsed static snapshot.

At phone widths, the area list becomes a select control. Selecting a task
opens its detail view in place of the list, with an explicit Back to tasks
control. This prevents a 40-task list from pushing task actions offscreen.
Narrow desktop task rows omit repeated area names to preserve title width.

Tasker shares the Polza Cowork palette, system typography, muted sidebar,
rounded selection surfaces and primary action styling.

Business KPI assessments and the Prioritize view are described in
[Polza work profiles](polza-work-profiles.md).

Clicking a task selects its details and focuses the editable title. Title, area
and notes acknowledge typing immediately and use the same debounced account save.
A blank title is held only in the editor; leaving it restores the last nonblank
title instead of submitting invalid task data. Trash remains read-only.

Levels use cumulative thresholds 50 * level * (level - 1): level 2 starts at
100 XP, level 3 at 300 XP. The next level requires 100 * current level XP.
Completion shows a short +25 XP celebration; crossing a threshold shows a level-up
burst. Reduced-motion preference removes movement. The progress button opens a
keyboard-accessible collection of 24 badges with visible requirements and earned
states: eight completion milestones, three daily-volume milestones, five daily
streaks, early/night/weekend work, three/five areas, five Today tasks, and levels
5/10. Earned badges remain unlocked. Calendar achievements use browser local time.
The progress and badge collection are available at desktop and phone widths.

## Automatic execution (Polza deployment)

Each saved active task can choose Once, On a schedule, or Until a result. Select
an existing granted project/chat; save settings, then explicitly Run now or
Enable. Saving/importing does not start work. Schedule uses local time and IANA
timezone; a goal counts human-accepted results, not provider self-declarations.
The default is three attempts/day and at most three pending reviews. Tasker
completion/XP remains independent from accepting automation results.

The authenticated `/api/tasker/automation` adapter uses the same native Project
Queue with the employee's real limited identity. No caller-selected account,
credentials or cookies enter UI task data. Automation manifests/results live
separately from `/api/tasker`, so worker progress cannot overwrite notes being
typed. Config writes are revision guarded from the first local edit.

Pause stops future/queued work while a running turn can finish; closing or
trashing a task stops future runs. Human-input and uncertain-delivery states
require inspection before continuation. A lost enqueue receipt is never blindly
retried. Prepared articles require approval before publication or editorial
sending. Settings on an unconfigured server report unavailable.

See [execution adapter/runbook](../scripts/polza-task-automation/README.md) for
storage, deployment, caps, restart/recovery and scheduling semantics.

Chat-header Goal and recurring chat runs are separate from Tasker cards; see
[Polza chat execution modes](polza-chat-execution.md).

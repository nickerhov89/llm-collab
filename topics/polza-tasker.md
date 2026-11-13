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

Inbox, Today, Completed and area views share the same task records. New tasks,
completion, planning flags and notes survive reload. Delete task moves the task
to persistent Trash and offers Undo. Deleted tasks leave active, completed and
area lists; Trash keeps their notes and original completion/planning flags.
Restore returns them to Inbox or Completed. Trashed tasks cannot be edited or
started in Cowork. Export retains Trash; duplicate imports do not resurrect it. Notes acknowledge typing
immediately and defer storage writes; pending writes flush on unmount/pagehide to the recovery cache; server saves resume on the next mount if the page closes before acknowledgement.

Start in Cowork prefills the existing new-session composer with the task title
and note. The user still chooses/reviews the project and submits the message.
Neither starting a chat nor checking a task awards simulated XP. An optional
imported Habitica profile is a static snapshot, clearly labeled as such.

At phone widths, the area list becomes a select control. Selecting a task
opens its detail view in place of the list, with an explicit Back to tasks
control. This prevents a 40-task list from pushing task actions offscreen.
Narrow desktop task rows omit repeated area names to preserve title width.

Tasker shares the Polza Cowork palette, system typography, muted sidebar,
rounded selection surfaces and primary action styling.

Business KPI assessments and the Prioritize view are described in
[Polza work profiles](polza-work-profiles.md).

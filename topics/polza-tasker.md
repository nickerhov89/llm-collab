# Polza Tasker

The header shows the active workspace first in bold, then a slash and a
direct link to the other workspace: Tasker / Cowork or Cowork / Tasker.
Switching takes one click, without a menu.
Tasker lives at `/tasker` (also beneath the active relay base path). Switching
back returns to the prior Cowork route in this tab; it never stops a provider
process or submits a message.

Tasker stores tasks in this browser, partitioned by source and resolved acting
principal. It does not sync tasks across devices or change Habitica. There is
no bundled personal task data. JSON imports use `{version: 1, tasks: [...]}`;
each task has a unique string id and title, optional note/group, and boolean
done/today. Existing ids are skipped. Invalid imports leave existing data
intact. Export provides a backup in the same format. Storage errors are shown
and block further edits until a successful import/recovery.

Inbox, Today, Completed and area views share the same task records. New tasks,
completion, planning flags and notes survive reload. Notes acknowledge typing
immediately and defer storage writes; pending writes flush on unmount/pagehide.

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

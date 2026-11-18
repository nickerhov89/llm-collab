# Cowork Tasker execution modes

Deployment-specific adapter for the existing Polza Cowork native Project Queue.
This is **not** the Polza Portal or Codex desktop's automations service.

Tasker cards support `once`, `schedule`, and `goal`. Select a granted project
and an existing chat. `Start in Cowork` still opens the normal composer to create
that first chat; the scheduler never creates an empty provider session.

Saving/importing tasks or saving settings does not activate work. Explicit
`Run now` starts one run; `Enable` activates a recurring schedule or goal.
Goal runs prepare one result each, up to 100 accepted results. Only explicit
human acceptance increments progress; provider claims are not completion.
Default bounds: three attempts per local calendar day, three results awaiting
review. No new run starts while this task has an active/uncertain run, while its
review cap is reached, or when accepted + pending results reach its goal.
Native model budgets, permission requests and project quiet windows still apply.

Articles remain drafts for approval of text and destinations. The generated
instructions prohibit automatic publication/editorial sending. The scheduler
is not a sandbox for arbitrary agent actions: existing project and tool policy
continues to govern the chat. Review does not dispatch a publishing action.

## Conversation schedules

Chat-header settings use `subject: "chat"` plus the native project/session IDs.
The engine derives the internal subject key and revalidates the exact binding.
No Tasker record is created or read. The prompt belongs to the configuration.
Successful chat occurrences are completed without a Tasker review gate; their
history rotates at 100 terminal runs. Uncertain work still blocks continuation.
The chat UI uses native provider Goal, not this adapter's Tasker goal counter.

See [chat execution modes](../../topics/polza-chat-execution.md) for the public
contract, control behavior, intervals and selected weekly days.

## Scheduling and lifecycle

- Hourly means one hour from activation/last enqueue. Daily/weekday/Monday
  schedules use the chosen IANA zone and local wall time; DST gaps are skipped,
  overlaps produce at most one run per local day. Missed occurrences coalesce.
- Pause cancels this task's still-queued native items; an active provider turn
  may finish. Completed/trashed/removed tasks cannot start another run.
- A paused native Project Queue stays paused. It must be resumed through its
  own controls; the scheduler never resumes unrelated queue items.
- Human-input states stop automatic continuation. Answer in the chat, then
  use Check result; this observes the same run without re-enqueuing it.
- Failed native handoffs stop for inspection. An ambiguous enqueue is persisted
  as unknown and never replayed, including after service restart. Check the chat
  and queue before acknowledging it. Acknowledgment is not success.
- Completed/reviewing runs can still be reviewed after a task is closed.
- Progress, previews, next occurrence and history appear in the task card.
  Changing a goal/project/chat after accepting or preparing results requires a
  new task. Config writes require the revision captured when editing began.

## Authority and storage

`polza-tasker-automation.ts` forwards authenticated requests via a Unix socket.
The backend overwrites caller identity with its resolved principal. Per-realm
capability tokens select a fixed account; clients cannot choose another account.
On employee realms, physical-server superusers must first Act as the employee.

The trusted scheduler logs in internally, switches to the real limited employee,
revalidates that identity, and submits to the same native authenticated queue.
Owner dispatch stays in the owner realm. Project/chat grants are checked at save
and native dispatch. Workers receive no admin password from this service.

Private root configuration: `/etc/polza-task-automation/config.json` (0640,
root:pcw-team, private parent). Fields: `directory`, `socket`, `accounts` keyed
by owner/employee. Each account contains `host`, `port`, `username` (null for
owner), existing `adminPassword`, and independent random `token`.
Backend env: `POLZA_TASK_AUTOMATION_TOKEN`, `POLZA_TASK_AUTOMATION_SOCKET`.
Never commit these values. Tokens must agree with their fixed configured realm.

State: `/var/lib/polza-task-automation` (0700), manifests/results 0600. A single
service PID lock, per-account serialized writes and atomic manifest replacement
protect progress. Max 64 configured tasks/account, 100 runs/task, 8 MiB manifest;
results are separate bounded files. Ordinary Tasker task data is not modified by
worker progress. Unconfigured/paused/review-blocked work has no recurring poll;
one next-deadline timer observes only eligible or active work. UI polling exists
only for an opened active card in a visible tab.

The existing worker/backend same-UID authority-store limitation remains recorded
in `gaps/polza-agent-writable-authority-store.md`; this adapter does not solve it.

## Production operations

Host: **66.248.207.236**, service `polza-task-automation.service`, UID pcw-team.
Installed code: `/usr/local/lib/polza-task-automation/{server,engine,model,native}.mjs`.
The service binds `/run/polza-task-automation/http.sock` only; capability checks
are mandatory even on the socket. Its systemd policy allows loopback networking
only and bounds memory/tasks/CPU. Existing native backends remain the only model
execution/queue authority.

Check with `systemctl status polza-task-automation` and
`journalctl -u polza-task-automation --since '-10 minutes'`.
Use the authenticated `/api/tasker/automation?operation=context` per realm to
verify grants. Never dump private configuration or cookies in logs/reports.

For an update: back up code and private state; run node syntax/tests locally;
copy these four modules, then restart only the scheduler. In-flight native queue
work survives, known receipts are observed, interrupted dispatch intents become
unknown and require review. Do not wipe state to clear an uncertain handoff.
Backend route changes require rebuilding the helper and registering it in
`polza-tasker`, plus the exact limited-user GET/POST allowlist exception.
Restart each native backend only after checking that realm's active processes.

For rollback: pause configured work first, retain state/config privately, restore
backed-up backend/client files, stop the scheduler. Do not replay old queued work.
A disabled/unconfigured adapter must report unavailable rather than fake success.

## Verification

`node --test scripts/polza-task-automation/automation.test.mjs` covers accepted
result counting/stop, duplicate acceptance, lost-write receipt and restart,
pause cancellation, revision conflicts, revoked access, Moscow calendars and DST.
Native Tasker and limited-user tests cover transport revision/authority rules.
A real limited-identity run must additionally pass queue -> transcript -> review
-> human accept -> goal stopped; mocks alone do not verify provider integration.

# Polza priorities, KPIs and Tasker ranking

Business role is separate from the authorization principal and grants. Sales
uses new-sales and renewal revenue; specialists use renewal revenue on their
assigned projects only; marketing uses qualified leads; directors and admins
use revenue and margin. Targets stay blank until entered, with explicit units
and a planning period. KPI weights range from 1 to 5.

Employee profiles are stored as one versioned, validated instruction block in
the existing per-user instruction collection. Existing blocks are preserved.
The profile form owns that block; the generic instruction editor hides it in
Polza mode. It is included in the user's launch context through the existing
instruction mechanism. Applying presets by account name skips existing valid
profiles and ambiguous names. It never changes project or authorization grants.
The owner has no limited-user account: their profile is browser-local and
partitioned by source, with a visible notice. Employee targets persist on the
server. There is no actual KPI ledger, CRM import or invented performance data.

The active principal's grants expose a detached copy of their own existing
instructionBlocks field. This does not expose another user's records, permit
limited users to write profiles, or add a new endpoint. Older servers may omit
this optional field; Tasker then shows that the employee profile is unavailable
and does not pretend to rank by custom KPIs. Updating employee profile support
requires the server change, in addition to the client publication.

Tasker assessments are browser-local with tasks, including JSON backups. An
assessment records a KPI, expected impact (1–3), estimated hours, optional due
date, blocking status, and an impact rationale. The Prioritize view sorts only
active, non-deleted tasks by impact × KPI weight / sqrt(hours) plus deadline
urgency: overdue/today +12, within 3 days +6, within 7 days +3. Dates compare
calendar days, not local-midnight timestamps across DST. Unassessed, unmapped
and blocked tasks have no score and stay below assessed work. The rationale
and score are visible; the formula is available under Why this order. This is
an explicit heuristic, not an AI revenue forecast. Completion never records
revenue or leads. Ordinary Inbox and Today order stays unchanged.

Validation: client TypeScript, focused source/CSS checks, profile/ranking unit
cases, UsersSettings tests, and limited-user service/instruction integration
cases. A real-component Vite fixture uses 40 synthetic tasks and the Sales
profile for desktop/phone layout, sequential typing, blocking, ranking and
reload persistence checks. It does not establish live deployment.

Review priorities in Cowork explicitly prefills the existing new-session
composer with the profile and up to 50 active task records (notes capped at
1000 characters each). It excludes completed/deleted tasks, flags the truncation,
and asks for recommendations grounded in KPI evidence. It neither submits the
message nor imports generated assessments, changes tasks, or executes actions.

Operational note (2026-11-12): source and local validation do not establish
that live profiles were assigned. Deployment and live account-name inspection
were blocked by SSH refusing exec channels. Existing profile records were not
changed during this implementation.

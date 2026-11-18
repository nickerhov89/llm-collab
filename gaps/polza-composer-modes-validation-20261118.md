# Goal/Schedule in the add menu; Research/Plan transitions

The owner requested moving the header action into the composer add menu and
checking Research, model selection and Plan mode. Contract:
[chat execution modes](../topics/polza-chat-execution.md).

The existing header Chat mode button is removed. Goal/Schedule directly select
the requested settings tab; opening either does not submit or alter the draft.
Research toggles the leading skill marker without losing the brief or adding
duplicates. Plan restores the preceding permission choice in the same composer
instead of always switching to default. Existing providers/protocols and the
scheduler engine are unchanged.

Full typecheck (including tool-display and E2E TypeScript) and formatter pass.
Exact-file Biome and the two touched CSS Module lint checks pass warning-free.
Nine focused tests pass (~3.4 s including setup): toolbar interactions and Plan
return state across a model rerender, skill-prefix transitions/draft retention,
and native Goal controls. Production build passes. The existing broad CSS lint
and full-suite debt remains in polza-backlog-cleanup-validation.md; global
console scan still reports 61 warn calls against its 60-call baseline.

Live verification uses a dedicated limited marker conversation, not employee
work. Goal/Schedule open the correct settings view from +, without a header
button. Research stays selected and retains the brief across Qwen/DeepSeek
changes; turning it off restores the brief. Full access -> Plan -> model switch
-> Plan off restores Full access, confirmed by native ownership metadata.
The actual provider invocation loads the deployed research skill. Desktop
1000x600 and phone 375x812 captures use the repository artifact facility.

The source deployment preserves unrelated production files and old hashed
assets; neither the native backends nor live employee processes are restarted.
A SHA-256-verified archive installs one built index/assets snapshot for owner
and employee runtimes. The research skill is installed per user for Codex
(~/.agents/skills) and Claude (~/.claude/skills), matching the official
[agent skill installation locations](https://developers.openai.com/api/reference/cli).
The existing provider refresh discovers it without restarting active work.
The skill manifest passes skill-creator validation; it grants no extra access.

The diagnostic conversation is archived after checking that it is idle. No
external publication or communication is performed by the checks. Concurrent
Tasker progress edits and their topic changes are outside this commit.

Full workspace typecheck (including E2E and tool-display TypeScript gates),
formatter check, touched-file Biome and CSS Module lint pass. The nine focused
Research/Plan/Goal tests pass in about 3.4 seconds including runner startup.
Real sequential input with Research active retained all 41 characters; the
browser keydown-to-next-frame sample peaked at 16.4 ms. This is a scoped input
check, not a general performance benchmark. The browser reported no page errors.

Full lint still has the existing Polza global CSS containment failures, and
console scan has the previously recorded 61 warn sites against 60. Neither
baseline was increased; this feature adds no console calls. Full-suite success
is not claimed; see the earlier broad-check debt in
[backlog validation](polza-backlog-cleanup-validation.md).

An expanded MessageInput slice passed 212/225 cases and failed 13 existing queue,
steering and compact-toolbar expectations. A read-only Vite transform overlaid
HEAD's original MessageInput/Toolbar/AttachmentButton without changing checkout
files: the baseline passed 203/216 and failed the exact same 13 case names.
Thus the new nine cases pass and the expanded slice introduces no additional
failures, but the editor suite is not reported green. The baseline overlay was
an ignored test artifact; runtime provider code was not changed.

# Full-chat quota recovery is not a server-owned Auto transition

The bounded task helper and Requesty Auto can recover a rejected inference.
The running Cowork chat itself does not yet automatically move to a different
CLI when its subscription becomes exhausted. `SessionPage.tsx` evaluates Auto
before sending and offers explicit context handoffs; the helper does not own
or migrate that process. These must not be presented as full-chat failover.

A complete implementation needs persisted opt-in/route policy, a server-owned
attempt ledger keyed to the accepted user turn, duplicate suppression across
watching tabs, eligible authenticated destinations respecting grants/budgets,
and a terminal stop after the allowed families fail. A failure after accepted
output/tool activity needs a continuation checkpoint, not blind prompt replay.
Closed-tab recovery cannot depend on a browser effect. Preserve plan, sandbox,
permissions, attachments and the latest request in any successor session.

Found 2026-11-23 while fault-testing quota-based automatic routing.

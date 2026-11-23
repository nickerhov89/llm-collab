# Quota continuation after accepted output needs a checkpoint

Server-owned pre-output recovery now implements the configured other-CLI →
Requesty order with durable attempts, duplicate suppression, actual sender
identity and Project Queue authorization. It works without a watching tab.

Remaining: a failed turn with substantive assistant output/tool activity stops
with a checkpoint notice; an inline-media request also stops rather than losing
its attachment. Fully automatic recovery here needs a durable continuation
checkpoint that distinguishes completed external actions from pending work and
transfers attachments faithfully. It must not blindly replay a tool-producing
prompt, implicitly restart goal budgets or use the chat creator's authority.
Remote executors also require a matching, authorized recovery destination.

Found 2026-11-23 while fault-testing quota-based automatic routing.

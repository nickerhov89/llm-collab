# Polza worker UID can write its realm's auth and grant stores

Production read-only audit on 17 November 2026: ceo/cfo/cto/marker backend and
native agents share pcw-* UIDs 2001..2004. Each service has its full employee HOME
in ReadWritePaths and no per-file ReadOnlyPaths. auth.json and limited-users.json
are owned by that same UID, mode 0600. A mount-namespace/DAC probe, without
reading secret contents or modifying files, returned writable=true for both
stores and their parent directory under each employee UID.

This does not demonstrate a cross-employee/owner-host escape. It means native
project/UI grants and the realm's disabled flag are not a trusted authority
boundary against its own code-executing agent. Merely protecting a child file
inside a worker-writable parent does not solve path replacement. Connector
active-user checks currently consult this realm state; model capabilities also
have an independent lifecycle from native web sessions.

Keep current cross-UID/systemd/firewall protections. Separate trusted backend
state and its owning OS identity from worker identities, place authority state
outside writable ancestors, and route launches through a bounded trusted
launcher. See docs/tactical/polza-managed-employee-access.md. This is a boundary
change requiring staged migration/real-worker checks, not a safe chmod or UI-only
fix to fold into the audit. No production auth or grants were changed by the probe.

Found 2026-11-17 while auditing managed employee creation and resource selection.

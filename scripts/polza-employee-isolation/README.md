# Deployment-specific root helpers

Read `topics/polza-employee-isolation.md` first. These scripts target the verified
Polza VPS layout; they are not generic or safe-to-rerun bootstrap commands.

* `provision.py`: FIRST RUN ONLY; copies immutable runtime, creates private users,
  credentials and manifests. Requires the compiled dedicated runtime auth changes
  and Supervisor token exclusion in the copied server before staff are started.
* `units/`: final verified live unit files; authoritative over the early unit
  template inside provision.py. Mount/volume setup must precede service startup.
* `volumes.py`: FIRST RUN ONLY; stop staff, create private 4 GiB images, migrate
  their state and mount through root fstab. Refuses existing images.
* `firewall.py`, `broker.mjs`, `ready.py`, `probe.py`: live root-owned boundary
  components installed under `/usr/local/lib/polza-employee-isolation/`.
* `admin-cards.py`: rotates private realm admin passwords; do not rerun merely to
  inspect status. Does not change the employee password.
* `publish.py`: FIRST PUBLICATION ONLY; validates Caddy and restores config on
  failed restart. Preserve existing domains; never replace the entire Caddyfile.
* `cold-snapshot.py`: explicit maintenance action, no schedule; stops staff,
  removes fixture sessions and takes offline filesystem snapshots.

Retain `/etc/polza-employees`, nft policy, loop mounts, SSH DenyUsers and complete
systemd hardening together. Copying only the TypeScript opt-in is insufficient.
Never commit capability tokens, broker.json, password cards or real transcripts.

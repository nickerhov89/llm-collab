# Unified Polza team entry (deployment opt-in)

Public entry: `https://cowork.66.248.207.236.sslip.io/team`.
This is an optional front door for the existing separate Linux realms. It does
not combine their processes, data, app cookies, browser storage or permissions.
After login it redirects to the correct private origin. Existing direct URLs
and owner sessions remain usable. The main root verifies the current owner
password-session before serving the existing owner front door HTML; missing,
expired or old employee cookies redirect to /team instead of the shared login.

Root-owned service code lives in `/usr/local/lib/polza-team`; configuration in
`/etc/polza-team/config.json` (root:pcw-team, 0640, parent 0750). The config maps
fixed role names to hosts/loopback ports and contains only the private realm
break-glass admin credentials, never the owner's password. `pcw-team` UID 2011
is trusted infrastructure, not an agent user, has no SSH or agent runtime and
cannot be used as an employee identity. Only Caddy can expose the loopback
listener 3460; employee UID firewall rules block it.

`install.py` is specific to the verified root inventory and private credential
cards on this VPS. Install server.mjs/team.html before running it. It creates
the local account, config and systemd unit, then enables the service. To update
code, validate it and restart only polza-team; owner/employee backends do not
need restart. `publish.py` is FIRST PUBLICATION ONLY and refuses to overwrite
its previous backup. It validates staged Caddy config before applying and
restores the prior config on failed restart. Do not blindly rerun it.

## Authentication contract

* Passwords are verified by the selected backend's ordinary auth API. A named
  employee never falls back to the owner's password. Only owner/admin/blank
  names select owner auth. No credentials or prompts are logged.
* Successful sign-in creates a random, 45-second, one-use, host-bound handoff.
  It travels in a URL fragment, not query parameters. The receiving page erases
  the fragment, exchanges it via same-origin POST and sets host-only app cookies.
  Tickets are in memory; restart loses pending tickets and requires signing in
  again. Passwords and backend cookie values are never returned to page scripts.
* Named staff sign-in clears main-origin owner/desktop/acting cookies and
  revokes the current main owner session before redirecting. The target realm
  clears desktop and acting cookies too. Owner/admin Open workspace is a
  deliberate admin entry and retains the owner's main management session.
* State-changing requests require exact HTTPS Origin and JSON content type.
  Caddy overwrites X-Real-IP; login attempts are bounded per client address.
* Management verifies only the genuine owner password-session cookie against
  the owner backend, never a desktop token or a staff realm cookie. Opening
  workspaces, disabling/enabling employees and setting their password act
  through each private realm's supported admin API. Password resets invalidate
  that employee's old sessions according to the backend contract.
* There is no new-user provisioning button. Another employee needs a new UID,
  private volume, systemd policy and scoped model access before being listed.
  Do not enable the old disabled employee accounts in the shared owner server.

Shared browser profiles are still a shared local machine: a user who has local
browser/OS access may inspect previously retained browser data. Use separate
browser profiles on physically shared computers. The front door deliberately
keeps employee app storage on separate origins instead of pooling it on one.

## Verification

`node --test scripts/polza-employee-isolation/team-entry/server.test.mjs` tests
real HTTP connections to isolated fixture backends: credentials, no owner
fallback, CSRF/Host checks, ticket target/replay, secure cookies, staff denial,
owner management and revocation on switching from owner to staff.

Live verification additionally covered the existing owner login, four backend
accounts, host-bound/replayed handoffs, cross-realm cookie denial, real browser
owner admin entry to marker, root redirect and desktop/mobile layouts. No real
employee password was reset and no production employee was disabled just for
testing. Actual staff password values were not read; their existing hashes
and backend login implementation are preserved. Mutating admin controls were
verified against fixture backends, not by disrupting live users.

Rollback: restore `/root/polza-team-20261116/Caddyfile.before`, validate and
restart Caddy; then stop/disable polza-team. Separate realm URLs, files and
backend credentials remain unchanged. Existing OS-isolation and scoped website
Git access are independent of this front door.


All employee services must set `NODE_ENV=production`. Otherwise YA's API may
work while its root/Tasker HTML proxies to a nonexistent Vite port and returns
502. The checked-in employee units and provisioning now set production mode;
verify actual SPA rendering, not just API auth or a URL transition. Final live
verification repeated all 116 OS checks after this fix and rendered marker
Tasker/Cowork under the limited acting principal with accountKey user:marker.

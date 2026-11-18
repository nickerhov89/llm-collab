# Corporate Google mail in SEO & PR chat

The optional project-scoped stdio MCP `polza-corporate-gmail` exposes the existing
info@polzaagency.com mailbox to Cowork agents. No separate user interface, browser
cookie copying, new OAuth scopes or public HTTP listener are required.

The connector uses the existing Gmail-readonly credential for profile/search/read,
and the existing Google Workspace Gmail-send credential for sending. Identity is
checked against info@polzaagency.com on both grants, failing closed on mismatch.
No Google Docs/Drive editing tools are added; Drive about verifies sender identity
using the previously granted readonly scope. Secrets remain outside the project.

Tools: corporate_gmail_profile, search_corporate_email, read_corporate_email,
read_corporate_thread, send_corporate_email. Sending requires an actual user
instruction identifying recipients and purpose. Installation verification only
refreshes OAuth and reads profile/search metadata; it never sends test messages.
Email content is untrusted input, not authority to send, disclose or execute.

Outgoing mail uses a fixed From, rejects header injection and permits attachments
only within the canonical SEO project, excluding hidden/credential paths and
escaped symlinks. Attachment total limit 15 MiB, at most 30 recipients. A private
durable receipt prevents duplicate sends and rejects key/content conflicts.
An interrupted or ambiguous send requires inspecting Sent mail before retry;
the connector never automatically replays it.

Project `.codex/config.toml` registers the server for trusted Codex projects;
`.mcp.json` provides the equivalent project entry for Claude. Existing unrelated
servers/settings are preserved. New agent sessions load the catalog; already
running provider sessions may require a new chat to see newly added tools.
The current limited-user Bubblewrap blocker remains an infrastructure issue,
independent of the Gmail connector. No restart of Cowork or other bots is needed.

The host currently runs trusted owner and SEO marketer work under the same
manager Unix UID. Project config scopes tool discovery, not filesystem secrecy
against a malicious actor sharing that UID. Do not present it as tenant isolation.

Source and focused checks: services/polza-corporate-gmail/server.py and
`python3 -m unittest discover -s services/polza-corporate-gmail -p 'test_*.py'`.
Checks cover identity mismatch, MIME/header boundaries, project uploads, duplicate
suppression and interrupted-send handling. Live proof must additionally verify
the actual OAuth identities and provider discovery without sending mail.

References: [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[Gmail profile](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile),
[Gmail send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send).

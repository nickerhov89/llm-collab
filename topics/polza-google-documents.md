# Corporate Google document reads

The UID integration broker exposes `docs.check` and `docs.read` to currently
granted users. It uses the protected corporate session under the manager
identity; employee processes receive document text, never session cookies.
`docs.check` verifies info@polzaagency.com on the authenticated Docs index.
A successful public-document export alone does not prove an authenticated
corporate session.

The versioned reader in `services/polza-access/google_doc_reader.py` accepts
HTTPS docs.google.com links only. Docs export as UTF-8 text, preserving the
optional tab selector. Sheets export one worksheet as UTF-8 CSV, preserving
numeric `gid` from the query or fragment. Without `gid`, Google selects its
default worksheet; a single export is not evidence that all tabs were read.
HTML sign-in/error pages are rejected as content. Google-only redirects,
private-file ownership checks and the 5 MiB download limit remain in force.

On 18 November 2026, a Sheets link had been rejected by the Docs-only URL
validator and reported with the same generic error used for expired sessions.
The reader now supports that link type. The separate expired server cookie
copy was refreshed from the existing dedicated corporate Chrome profile;
personal-profile cookies and OAuth permissions were not changed. Owner and
marker `docs.check` confirmed the corporate identity, and both UID paths read
the requested worksheet (264 CSV rows). No Cowork chat restart is required:
the broker invokes the installed reader for each request.

Browser sessions can be revoked or expire. This change does not claim permanent
authentication or alter the independent corporate Gmail OAuth connector.

## Native creation and editing

The optional `googleWriteCredentials` runtime entry selects a separate OAuth
grant for info@polzaagency.com with `drive.file`, OpenID and email identity.
No write permission is inferred from browser cookies. Google limits this grant
to app-created or explicitly selected files. Existing cookie-based reading and
Gmail OAuth grants remain independent. Files are created privately on the
corporate Drive; these tools do not change sharing permissions.

Current UID grants on the existing `docs` integration govern every operation:
read-only users cannot write, and disabled/revoked users are refused. Owner and
marker are enabled for creation and editing in the current deployment.
The MCP `polza_integrations` tool `integration_call` and CLI
`polza-integration TOOL JSON` expose:

- `docs.create`: `title`, optional `text`.
- `docs.update`: `document_id`, native Docs `requests`, optional native
  `write_control` (use `requiredRevisionId` after reading existing structure).
- `docs.create_sheet`: `title`, optional scalar `values` matrix. Formulas are
  stored as literal strings on creation.
- `docs.write_sheet`: `document_id`, `data` containing A1 `range`/`values`
  entries; optional `value_input_option` is `RAW` by default or explicitly
  `USER_ENTERED` for formulas and Google value parsing.
- `docs.format_sheet`: `document_id`, native Sheets batchUpdate `requests`.

Every write requires a stable `idempotency_key`. Receipts are actor-scoped and
bounded to 5000 entries; key/content conflicts are refused. The broker serializes
each actor. It records an uncertain outcome before a mutation and, for Docs
creation, the new document ID before inserting text. Failed/uncertain writes
require review and are never replayed automatically. Reusing a completed key
returns the existing URL. Google identity is verified before new writes and
tokens/content are omitted from error logs. No automatic file deletion is used.

Verification on 18 November: actual owner Docs creation and editing, marker
Sheets creation, range updates and formatting, API readback, repeated creation
returning the same ID, and denial of a read-only employee write. Two receipt/
identity tests and five broker boundary tests supplement this live check.

Deployment sets the private runtime `googleWriteCredentials` path to an OAuth
credential for info@polzaagency.com with `drive.file` and verified identity
scopes. Files stay private in that account's Drive. This scope covers files
created or explicitly selected for this application; an arbitrary older file
does not become writable merely because its URL can be read. Enabling writes
does not grant sharing/permission-management or deletion tools. Current owner
and marker write grants were initially enabled. The owner subsequently
requested this capability for every current account: owner, ceo, cfo, cto,
marker and dimak-spec now have docs write grants. Each employee's UID made a
successful range write to the diagnostic spreadsheet after that change;
earlier owner creation/edit checks remain applicable. Future accounts do not
inherit write permission automatically. Other integrations remain unchanged.

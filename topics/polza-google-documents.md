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

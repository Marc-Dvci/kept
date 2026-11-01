# Privacy

Kept's Forge adapter stores customer organisation identifiers and names, optional
renewal dates, source reply snapshots, promise dates, linked Jira keys, account
IDs, delivery evidence and revision history in the installing site's app storage.
It uses those records to assess planning risk and retain reviewed decisions.

Reads require access to the source issue and every linked delivery item. Writes
also require Edit Issues on the source request. Source comments are re-read as
the current user and must be public for capture. A public JSM reply may still
contain personal or commercially sensitive information; use the site's approved
data policy. Confirmation retains the full selected public reply, up to 12,000
characters, plus author/time metadata and the exact promise excerpt. The dialog
exposes that snapshot before confirmation. Use only replies appropriate for the
organisation's retention and access policy.

Background events read current Jira data as the app. They record internal owner
alerts. Viewing alerts requires the same source-and-work permissions. They do not
send email, post support replies or call an external model endpoint.

Graph ingestion is restricted in code to explicitly synthetic demonstration
documents. Those documents are visible to the workspace after an administrator
connects the graph. Real customer promise text, account IDs, renewal dates and
source reply bodies are not eligible for this projection. Disconnecting removes
the connector's graph data; Forge evidence retention is separate.

The standalone replay uses fictional organisations and people. Its records remain
in the visitor's browser. Reset replay removes local edits. No analytics or remote
storage is used. Exported evidence files are under the downloading user's control.
Saved replay data can also be downloaded before a reset. Discovery references in
Forge have a 30-day expiry; confirmed promise evidence has separate retention.

The installing organisation determines lawful retention, access, source correction,
backup, deletion and app removal. Production deployment and retention controls
require organisational review. Contact the repository maintainer through the
project's GitHub issue tracker for support; do not include sensitive records in a
public issue.

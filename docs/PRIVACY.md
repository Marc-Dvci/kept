# Privacy

Kept stores customer organisation identifiers and names, optional renewal dates, source reply snapshots, promise
dates, linked Jira keys, Atlassian account IDs, delivery evidence, owner alerts and revision history in the
installing site's Forge app storage. It uses those records to assess delivery risk and to keep reviewed decisions.

Reads require access to the source request and every linked delivery item. Writes also require Edit Issues on the
source request. Source comments are re-read as the current user and must be public agent replies to be captured. A
public JSM reply may still contain personal or commercially sensitive information; use the site's approved data
policy. Confirmation keeps the full selected public reply, up to 12,000 characters, with its author and time and
the exact promise excerpt. The confirmation dialog shows that snapshot before anything is saved.

Forge triggers read current Jira data as the app and record internal owner alerts. Viewing alerts requires the same
source-and-work permissions as the promise. Kept does not send email, post support replies or call any service
outside the Atlassian platform.

The Teamwork Graph sync writes the demo promises as documents visible to the workspace, after an organisation
administrator connects the connector. Each document carries the customer name, promise title, agreed date, linked
work keys and the source link; it carries no reply body, account ID or renewal date. Promises confirmed from live
customer replies stay in Forge storage.

Reply references found by the comment trigger expire after 30 days; confirmed promise evidence has separate
retention. Exported evidence files are under the downloading user's control. The offline preview (`npm run dev`)
uses fictional organisations and keeps its records in the visitor's browser.

The installing organisation determines lawful retention, access, source correction, backup, deletion and app
removal. For support, open an issue in the project's GitHub issue tracker; do not include sensitive records in a
public issue.

# Setup

## Credential-free replay

Use a supported Node release, such as Node 24.22.1:

```sh
npm ci
npm run dev
# Open http://127.0.0.1:4185
npm run audit
npm run test:browser
```

The replay opens with eight promises, six fictional customer organisations, five
delivery work items and three public-reply proposals. Its fixed clock is 2 November
2026 at 11:00 Paris. Settings can advance or reset it. No external account is needed.
Local browser tests use installed Chrome; CI uses Playwright Chromium.

```sh
docker build -t kept .
docker run --rm -p 4185:80 kept
```

## Forge installation gate

Read [cost controls](COSTS.md) first. Registration and deployment are disabled until
actual provider-backed zero-billing protection is verified. The manifest UUID is
a placeholder, not a registered app. The following are the later release steps,
not evidence that a live install has been performed:

1. Establish an eligible exempt sandbox or enforced hard zero cap with provider
   evidence, scope and expiry. Update the protection record only after verification.
2. Install Forge CLI 15 separately, log in, then use `npm run register:forge`.
3. Build, run `forge lint`, then use `npm run deploy:forge -- development` and install
   to the protected Jira site. Development usage is metered on normal sites too.
4. Open Apps > Kept. An administrator opens Settings and chooses a **dedicated demo
   project**. Load synthetic demo creates five delivery issues, eight source issues,
   three demo versions and source comments. Retry markers preserve completed items.
5. Verify a actual public JSM comment through Capture inbox before claiming the
   support-source integration. Synthetic Jira comments used by the demo are explicitly
   labelled demonstration records; they do not prove actual customer communication.

Creating demo versions requires project administration, and issue/comment creation
requires the current user's corresponding Jira permissions. All demo owners use
the authenticated installing account. No customer replies are posted by Kept's
follow-up workflow.

## Public reply capture

Configure the allowed support project keys in Settings. Jira comment events store
discovery references only. Every inbox view and confirmation re-reads the comment
under the caller's permissions. Alternatively, enter a JSM request key and public
comment ID in Capture inbox. Referenced Jira work is read as the user so known
version names can inform the proposal.

Discovery loads 20 references per page, scoped to the request when opened in an
issue panel. Use **Load more public replies** to continue. References have a 30-day
TTL and an explicit expiry check; an expired reference can be loaded directly
again by request key/comment ID. Confirmed promise snapshots have separate
retention and do not expire with discovery references.

Internal comments, customer account comments and the request reporter's own replies
are rejected. Other source authors still require the confirming operator to check
the outgoing commitment and exact customer. An edited source has a different
fingerprint and must be reloaded before confirmation. Relative dates in edited
replies require explicit date review.
The confirmation dialog exposes the full public reply that will be retained,
including its author/time metadata. Review the complete snapshot under the
organisation's data policy before confirming.

Add or choose a stable customer organisation ID and name. An optional renewal date
can be sourced through a `kept-customer` issue property:

```json
{
  "id": "customer-org-42",
  "name": "Example organisation",
  "renewalOn": "2026-12-01"
}
```

This is operator-attested metadata, not a verified CRM integration. Never use the
same ID for different organisations. Source visibility controls still apply.

Choose the owner from visible accounts or enter another Atlassian account ID; the
server verifies that account and uses its canonical display name. Confirmation
requires Edit Issues on the source and read access to every required work item.

## Delivery observations

Work status, fix versions and update time come from the current Jira issue. Map
Sprint and Flagged custom field IDs in Settings; IDs vary by site. An unmapped or
missing blocked state stays unknown. For integrations that cannot provide a flag,
an explicitly attested `kept-planning` issue property is supported:

```json
{ "blocked": false, "observedAt": "2026-11-01T10:00:00Z" }
```

Its timestamp must be current within 24 hours. Stale/future observations remain
unknown. A property-access outage stops the check rather than inferring unblocked.
Changing a date in a preview does not refresh unchanged evidence.

The adapter requests Jira's versioned sprint representation and accepts modern
structured fields. An unsupported or missing configured sprint field stops the
check. A returned empty/null configured checkbox is unflagged; an absent or
malformed field still needs an explicit observation. Fetch time is kept separate
from the blocked-state attestation's age so a current plan is not discarded when
that attestation is older.

Issue changes, shared-version updates and sprint updates refresh managed promises
and record deduplicated **in-app** owner alerts. This is not email or customer
notification delivery. Current views also re-read Jira. Runtime event delivery,
throttling and concurrency still require a protected live-site test.
Repeated event delivery is deduplicated. A plan returning to a previously seen
risky date is a new occurrence. Access checks for shared issues are deduplicated
within one request and checked again in later requests.

Use **Missed dates** in the register and filter **Activity** by owner/review status.
Edit a prepared customer update before copying it. Internal references are shown
separately. In replay mode, **Download saved replay** retains local data before a
reset, including when validation reports damaged metadata.

## Agents, MCP and graph

The Rovo agent and reusable skill can read evidence, review a customer's promises
and preview release changes. MCP exposes those three read-only actions. An admin
must enable external tool access for the installation; use
`https://mcp.atlassian.com/forge/<registered-app-id>`. Entitlement and actual calls
are release checks. No agent action can confirm, amend, attest delivery or send.

In Atlassian Administration > Connected apps > Kept > Connections, connect the graph
connector. Settings can then sync the **synthetic** promise documents. Item-level
ingestion acceptance is checked; accepted ingestion does not prove search indexing
is complete. Workspace-wide ingestion of real promises is refused. Disconnecting
removes the connector's graph data. Production ACL replication is outside this
demonstration projection.

## Distribution and operational scope

After verified production deployment, enable sharing and test the judge installation
link from a fresh site. Marketplace submission has separate partner verification,
agreement, security/privacy and review requirements. See the [release checklist](RELEASE.md).

The prototype's population guard is 500 managed promises/references per view. It
does not claim institution-wide coverage or production throughput. Every required
work item must be readable for a promise to be returned. Source and linked-work
permission checks also protect Rovo, MCP, alerts and exports.

Jira issue creation and Forge retry markers are not one distributed transaction.
Simultaneous demo creation or a crash after Jira succeeds but before its marker is
saved needs an operational reconciliation check. Promise writes and indexed work
references use conditional storage transactions; work snapshots use version checks.
Obsolete work index entries are revalidated before processing and cannot make a
previously unlinked item affect the current promise.

# Setup

## Install

Kept installs into Jira from the installation link in the [README](../README.md). You need a Jira administrator
account, a Jira software project for releases and delivery work, and a Jira Service Management service project for
customer requests, on the same site.

1. Open the installation link, choose the site and approve the scopes.
2. Open **Apps > Kept**. The settings open from **Workspace settings** in Kept's sidebar, and also from **Jira
   settings > Apps > Kept**. Settings require Jira administrator permission.

## Load the demo

In **Workspace settings**, under **Load the demo**:

1. Choose the software project as **Delivery work project**.
2. Choose the service project as **Support project (Jira Service Management)**.
3. Click **Load synthetic demo**.

Kept creates the releases Atlas 2.7 (released), Atlas 2.8 and Atlas 2.9, five delivery work items, and a JSM
request from each of six fictional customer organisations, each answered by an agent's public reply with a date.
The demo dates are set relative to the day you load it, so Atlas 2.8 always falls four days later. Eight promises
are confirmed and three replies wait in the **Capture inbox**. The loader also finds the site's Sprint and Flagged
fields and adds the service project to the watched support projects.

Forge resolvers stop at 25 seconds, so the loader works in steps: each call records what it created and the page
calls again until the demo is complete. On the production site, loading the full demo took 37.7 to 41.5 s and
**Reset the demo** 13.4 s.

**Reset the demo** removes synthetic promises and unused demo support requests. Promises confirmed through the real capture flow are retained, with their source requests and delivery plans. Unrelated live inbox references are preserved. Jira deletion failures retain retry markers. Atlas work items and releases stay; the next load restores only plans that are not protecting retained promises.

## Capture promises from replies

**Capture projects, separated by commas** in **Workspace settings** lists the support projects Kept watches. When
an agent posts a public reply there, a Forge trigger stores a reference to it, and the reply appears in the
**Capture inbox**. Every view and confirmation re-reads the reply as the signed-in user.

In **Approved support authors by project**, enter one `PROJECT=accountId, accountId` line for each watched service project. Only a Jira administrator can edit this list. Approve the accounts that actually send support commitments; a regular Atlassian account alone does not establish an agent role. The demo loader approves its installing author for the chosen service project.

Kept accepts public replies only from these project-approved authors and rejects portal-only customer accounts. Internal comments and quoted lines are refused. Dates written as "6 November 2026", "November
6", ISO dates, "tomorrow" and weekdays are proposed; a release name or a quarter is flagged for the agent to set the
exact date. An edited reply has a new fingerprint and must be reloaded before confirmation.

**Review promise** opens **Confirm the customer promise**: the exact public reply, **What was promised**,
**Customer organisation**, **Follow-up owner**, **Customer-agreed date**, **Promise timezone** and **Required Jira
work keys**. **Confirm promise** needs Edit Issues on the source request and read access to every linked work item.
The owner is checked against active Atlassian accounts.

A request's customer organisation can be set with a `kept-customer` issue property:

```json
{ "id": "customer-org-42", "name": "Example organisation", "renewalOn": "2026-12-01" }
```

To load an older reply, enter its **JSM request key** and **Public comment ID** under the inbox. The inbox loads 20
replies at a time; **Load more public replies** continues.

## Delivery work and states

For each required work item, Kept reads the status, fix versions and their release dates, the sprint and the
Flagged field. **Sprint custom field ID** and **Flagged custom field ID** in **Workspace settings** hold the site's
field IDs; the demo loader fills them in. Where the Flagged field is not available, a `kept-planning` issue
property can carry the blocked state, with an observation time within the last 24 hours:

```json
{ "blocked": false, "observedAt": "2026-11-02T10:00:00Z" }
```

| State | Meaning |
|---|---|
| On track | Every required item is planned inside the promised date, unblocked, with current evidence |
| At risk | A release or sprint ends after the promised date, or a required item is blocked |
| Needs evidence | A required item has no planned date, or its evidence is missing or stale |
| Broken | The date passed without the customer receiving the outcome |
| Kept | Delivery evidence shows the customer received it in time |
| Withdrawn | The customer agreed to withdraw the promise |

## Change impact and owner alerts

**Change impact** previews a planning decision: choose the **Delivery work**, then **Move its shared release date**
with a **Proposed release date**, or **Mark this work blocked**. The preview lists every promise that shares the
release, its state before and after, the owner and the customers renewing within 60 days. It changes nothing.

When a release, sprint or work item changes in Jira, Kept's triggers find the dependent promises, re-read the work
from Jira and record an owner alert in **Activity** for each promise that falls at risk. Filter Activity by
**Follow-up owner** and **Review status**, and click **Mark reviewed** once handled. **Prepare customer update**
on a promise drafts a factual message from the Jira evidence to review and copy into the team's own channel.

## Delivery, changes and evidence

- **Record customer delivery** records when the customer could use the outcome, an evidence link and what was
  checked. On time, the promise is Kept; late, it stays Broken.
- **Agreed date change** records the new date with the customer's agreement; the original date and its outcome
  stay in the history.
- **Withdraw** needs the customer's agreement and a rationale.
- **Review linked work and owner** corrects the work keys or the owner, with a reason.
- **Export evidence bundle** downloads the full history; see [evidence verification](EVIDENCE.md).

## Teamwork Graph

An organisation admin connects the connector in admin.atlassian.com: **Connected apps > Kept > View app details >
Connections**, then **Connect** under "Teamwork Graph connectors". In **Workspace settings**, **Sync synthetic graph
documents** writes the demo promises to Teamwork Graph as documents with the customer, the promise, the agreed
date, the linked Jira work and the source link, and checks each item's ingestion result. Graph documents are
visible across the workspace, so promises confirmed from live customer replies stay in Forge storage under Jira
permissions.

## Permissions

Every read runs as the signed-in user and returns a promise only when the user can see its source request and every
linked work item. Writes also need Edit Issues on the source request. The actor always comes from the Forge context.
Triggers read Jira as the app; viewing their alerts needs the same permissions as the promise.

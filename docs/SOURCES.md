# Sources and positioning

Reviewed 1 November 2026. The promise-state rules are explicitly documented product
policy, not legal classification or a statistical delivery forecast.

| Source                                                                                                                                                     | Implementation relevance                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Codegeist 2026 rules](https://codegeist2026.devpost.com/rules)                                                                                            | Forge installation, category, equally weighted criteria, public video and judge access |
| [JSM request API](https://developer.atlassian.com/cloud/jira/service-desk/rest/api-group-request/)                                                         | Current public-comment body and visibility; `read:servicedesk-request`                 |
| [Jira platform REST](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)                                                                   | Current-user issue, comment metadata, permissions, versions and profile reads          |
| [Custom Entity transactions](https://developer.atlassian.com/platform/forge/storage-reference/entities-transactions/)                                  | Conditional writes; 20 work links plus the record and population index stay within 25 operations |
| [Jira Software field formats](https://developer.atlassian.com/cloud/jira/software/rest/intro/#jira-software-field-input-formats) | Structured/versioned sprint representations instead of legacy string parsing |
| [Flagged checkbox](https://support.atlassian.com/jira-software-cloud/docs/flag-an-issue/) | Flagged is an optional configured checkbox observation; verify the mapping on the installing site |
| [KVS TTL](https://developer.atlassian.com/platform/forge/storage-reference/kvs-api/) | Relative expiry and asynchronous deletion; discovery also checks its explicit expiry |
| [Jira events](https://developer.atlassian.com/platform/forge/events-reference/jira/)                                                                       | Issue/comment update discovery and canonical re-read                                   |
| [Jira Software events](https://developer.atlassian.com/platform/forge/events-reference/jira-software/)                                                     | Sprint changes affecting required work                                                 |
| [Event equivalence](https://developer.atlassian.com/platform/adopting-forge-from-connect/connect-forge-equivalences/connect-forge-capabilities-available/) | Version-update event mapping                                                           |
| [Graph connector](https://developer.atlassian.com/platform/forge/manifest-reference/modules/teamwork-graph-connector/)                                     | Synthetic-only projection and connector data restrictions                              |
| [Document schema](https://developer.atlassian.com/platform/teamwork-graph/connector-reference/object-types-connectors/document/)                           | SDK-typed promise documents                                                            |
| [Rovo MCP](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/)                                                            | Three read-only tools, installation permissions and external-tool enablement           |
| [Rovo skills](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-skill/)                                                       | Reusable promise-review instructions and action dependencies                           |

## Competitive scope

Customer commitment tracking exists. [Soil](https://meetsoil.com/) advertises a
promise-to-delivery workflow with owner, deadline, linked work and confirmed
customer delivery. [Obo.pm's Marketplace vendor page](https://marketplace.atlassian.com/vendors/1216675/obo-pm)
also describes connecting epics to customer commitments. These are public vendor
claims, not independent product tests. Kept does not claim a market first or claim
that either product lacks a Kept feature.

Kept's demonstrated focus is a Jira/JSM workflow: review the precise public reply,
retain the original agreed date, inspect missing planning evidence, preview a
shared-release change across visible customer promises, and export independently
checkable evidence. The rules and authored case set are public. User time saving,
churn reduction, commercial return and authority acceptance are not measured.

## Interpretation register

- Dates are inclusive local calendar dates, with actual IANA timezone transitions.
- Release/sprint dates are planning bounds. A later bound implies risk; the actual
  deadline must pass without timely customer availability before a promise is broken.
- Stale planning evidence is unknown. A preview changes a plan, not the observation
  time of unchanged facts such as blocked state.
- Multiple required work items and shared versions are evaluated together. All
  relevant items must be visible for the promise itself to be returned.
- Renewal counts use stable customer IDs and an inclusive Paris calendar window.
- English proposals are bounded recognition rules, not arbitrary-language semantic
  understanding. Ambiguity stays visible and requires human confirmation.

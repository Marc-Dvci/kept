# Zero-spend controls

The shipped policy in `config/billing-protection.json` is **unverified**. Both
`npm run register:forge` and `npm run deploy:forge` refuse before invoking the CLI.
The manifest UUID is a placeholder. No Forge app was registered or deployed for
this build.

## Replay and CI

The replay is static HTML, JavaScript and local browser storage. It uses no cloud
function, database service, paid model endpoint, analytics, external font or
scheduled task. It runs without credentials. Public GitHub Pages can serve the
same compiled files. CI is restricted to public repositories on standard Ubuntu
runners with a 15-minute timeout, no cache and no artifact uploads.

## Forge boundary

Atlassian's [Developer Space billing](https://developer.atlassian.com/platform/forge/developer-space/billing-for-developer-spaces/)
and [platform pricing](https://developer.atlassian.com/platform/forge/forge-platform-pricing/)
must be checked before registering or deploying. A free allowance, usage alert or
missing payment method is not a verified hard zero-cost cap. Development usage is
included in metering. A documented eligible billing-exempt sandbox or an actual
provider-enforced cap must be established before changing the policy.

The policy checker validates a protection record and its verification period; it
cannot authenticate a human's billing assertion or control Atlassian's platform.
Running the Forge CLI directly bypasses the local command gate. The effective
protection in this release is leaving the metered app undeployed.

No Forge LLM, container, SQL instance, public web trigger or backend egress is
declared. Rovo and graph APIs are optional platform integrations. Their execution
and underlying Forge invocations still require the same provider protection.
The project policy does not govern other applications or subscriptions.

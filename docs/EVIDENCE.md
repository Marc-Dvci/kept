# Evidence export and verification

Use **Export evidence bundle** in the selected promise. The JSON contains the
original source, confirmed dates, amendments, actual customer availability,
alerts, complete event snapshots and current delivery observations. The UI shows
the bundle's SHA-256 digest after download.

Retain the digest separately in an organisation-controlled record with its own
access and audit policy. Keeping the only digest alongside an editable bundle
does not create an independent anchor.

Verify using Node alone, without installing dependencies:

```sh
node scripts/verify-bundle.mjs kept-kpt-001-evidence.json RETAINED_SHA256
```

Or use `npm run verify:bundle -- FILE RETAINED_SHA256`. Exit zero means the bundle,
event links, allowed state transitions, original commitment metadata, action
attribution and current projection are consistent
with the independently retained digest. Omit the last argument for internal
consistency only. A mismatched retained digest fails.

An acknowledgment can review an alert; it cannot change a date or source. An
amendment appends one agreement and retains the prior dates. A delivery or
withdrawal closes the promise. Both the shared verifier and the independent
Node verifier check these transition boundaries. Rehashing an invalid transition
does not make it valid; an externally retained digest remains necessary to detect
replacement with another internally consistent history.

The verifier uses Node's crypto API and separate canonicalisation code, without
importing the app ledger. It does not prove that a source figure is true, a person
has a particular legal authority, or a URL's content remains available. Forge's
authenticated actor checks and institutional retention controls provide different
parts of the assurance. These are attestations, not qualified electronic signatures.

Closed promises retain their source and events. Withdrawal does not delete the
record. Export alone does not free Forge storage. A conservative size guard stops
further writes before a record becomes too large; an organisation must retain the
bundle and create a linked follow-up under its retention/correction policy.

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
event links, original commitment metadata and current projection are consistent
with the independently retained digest. Omit the last argument for internal
consistency only. A mismatched retained digest fails.

The verifier uses Node's crypto API and separate canonicalisation code, without
importing the app ledger. It does not prove that a source figure is true, a person
has a particular legal authority, or a URL's content remains available. Forge's
authenticated actor checks and institutional retention controls provide different
parts of the assurance. These are attestations, not qualified electronic signatures.

Closed promises retain their source and events. Withdrawal does not delete the
record. Export alone does not free Forge storage. A conservative size guard stops
further writes before a record becomes too large; an organisation must retain the
bundle and create a linked follow-up under its retention/correction policy.

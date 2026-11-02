# Kept: customer promises linked to delivery

Prepared 1 November 2026 for Codegeist 2026, Apps for Business Teams, with the
Teamwork Graph bonus.

A customer success manager has a renewal call tomorrow. A product manager is
moving a release today. Kept shows the customer promises that depend on that work,
their exact source, original date, current plan and accountable owner.

This needs Jira because the same delivery work can support several customers'
promises, and a planning change must be checked against every accessible linked
promise. JSM supplies the public reply; Forge supplies authenticated actions,
storage and issue-change events. No customer message is sent by this app.

## Core workflow

1. Inspect a dated public support reply. Deterministic English date and release
   recognition proposes candidates. Tentative language, ambiguous dates, quoted
   text, internal comments and missing release dates cannot become automatic facts.
2. A person checks the exact excerpt, customer identifier, timezone, date, owner
   and linked work before confirming. Source changes invalidate the proposal.
3. The register shows ON TRACK, AT RISK, BROKEN, KEPT or UNKNOWN. Cancellation is a
   separate explicit terminal state. Reasons and planning sources are visible.
4. Preview a release/blocked-state change. Count affected promises, unique customer
   IDs and renewals in the next 60 days. The preview is read-only; the change is
   made in Jira, and its event creates internal owner alerts.
5. Review the in-app alert, inspect the plan, and prepare a factual customer update
   with the date from observed Jira evidence. Copying a draft is separate from any
   external communication.
6. Record actual customer availability with time and evidence URL. A completed Jira
   task alone does not make a promise KEPT. Delivery after the promised date is
   BROKEN with a delivered-late explanation.
7. An agreed amendment appends the previous/new dates and customer agreement link.
   The original date and original outcome remain visible. Cancellation requires a
   rationale. Export the complete history and independently retain its digest.

## Evaluation contract

- Date-only promises end at the end of that date in the recorded IANA timezone.
- A promise is BROKEN after its deadline without timely customer availability,
  regardless of missing planning facts. A late delivery stays BROKEN.
- Future known release/sprint bounds beyond the promise, blocked/cancelled work,
  elapsed plans or work done without availability proof imply AT RISK.
- Missing work, unspecified required planning dates, unknown blocked state or stale
  observations imply UNKNOWN unless a known risk already establishes AT RISK.
- ON TRACK is conditional on fresh, complete, unblocked planning evidence within
  the promise. It is not a probability or delivery guarantee.
- All linked items are required. Latest relevant release/sprint bound controls.
  Archived versions are ignored. Done work still requires customer availability.
- Human delivery/cancellation evidence is attributed and never inferred from text.
- Customer counts use stable IDs. Renewal windows are inclusive calendar dates;
  missing renewal dates are disclosed rather than treated as safe.
- Events have monotonic recording times and canonical SHA-256 predecessor hashes.
  Replaying the events must reproduce the current state. A digest is consistency evidence, not a
  qualified electronic signature or proof of source truth.
- Reads require access to the source request and every linked work item. Writes
  also require Edit Issues on the source and an authenticated context actor.
- The preview cannot mutate Jira or send communications.

## Demonstration

A fictional product team, six fictional customer organisations, eight promises,
five delivery work items and a support-capture inbox. The principal story moves
the Atlas 2.8 plan from 6 to 13 November, surfaces the affected customers, and
records a reviewed delivery.

## Quality and boundaries

Freeze labelled evaluation cases before the engine. Keep a separate secondary
case set outside the repository until the first implementation is complete.
Report regression and secondary conformance separately.
Run unit, browser, accessibility, mobile, dependency and Forge schema checks.

Confirmed visual identity: shipping manifest and newsroom planning desk. White,
charcoal, cobalt blue, fine rows, date rails and customer-impact preview. No card
grid, cream grounds or stock marketing art. The interface uses system fonts.

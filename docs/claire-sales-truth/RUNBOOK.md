# Claire sales book operations

Original base: `045f96f96db671f2b7dba54440408a688cb50521`.
Reconciled main: `df9b99b97054df97e64f3461a7bb47c403926ff6`.

Private inputs are the supplied CC-Orders-09102024-04102026.csv and
CC-Revenue-09102024-04102026.csv. Keep them outside git. Read DATABASE_URL
through the authorized secret provider without printing it.

Source proof (no database needed):

```sh
npx tsx scripts/claire-sales-truth-certificate.ts "$ORDERS_CSV" "$REVENUE_CSV"
```

Read-only binding preflight, followed by authorized canonical historical import:

```sh
npx tsx scripts/claire-sales-historical-backfill.ts --preflight
npx tsx scripts/claire-sales-historical-backfill.ts --tenant default --orders "$ORDERS_CSV" --revenue "$REVENUE_CSV" --apply
```

The importer verifies source controls before any migration/import, uses the
existing transactional CleanCloud ingestion interface, imports each report twice,
and requires the second import to change nothing. Startup migration also creates
the three idempotent reconciliation/provenance tables. Browser sync retains its
URL and 32-day validation; the long-range exception is internal local import only.
Financial/date revisions retain fingerprints and batch references across updates.
Existing source rows retain their private customer and raw-source provenance.

Candidate-reader acceptance against the configured database:

```sh
npx tsx scripts/claire-sales-reader-proof.ts /tmp/sales-reader-proof.json
```

This proof emits aggregates, hashes and resolution booleans, never customer
profiles. It is explicitly distinguished from deployed HTTP conversation proof.

## Authority and reader inventory

Canonical: businessQuery reconciles the entire loaded economic book before any
scope/customer/service filters. All its metrics, Claire business conversation,
encyclopedia customer/account fallback, active-customer metric, proactive recovery,
proactive sales trends and strategy growth use reconciled events. Source coverage
continues to own freshness; Authority Receipts continue to own consequential acts.

Legacy but safe: P&L gross revenue, processor settlement/payout and territory
visualizations retain their separate meanings. Positive-payment bridge events
exclude refunds by design and are not Claire's sales answer authority.

Source twins prefer Orders net after customer credit. Cross-system same/distinct
sales require durable evidence references; possible customer/day/amount matches
stay withheld. Company, service, source, processor and building are independent.
No building/processor/source classifier promotes CleanCloud to Butler or core.
Classification corrections use sales_service_attribution without rewriting money.

## Production evidence and limits

production-certificate.json proves 533/533 Orders and 492/492 Revenue IDs, 41
Orders-only records, zero missing Revenue IDs, 492 excluded report twins and
2,724,697 cents. It also accounts for the paid -1,000-cent undated adjustment.
The dated combined recorded book is 3,122,059 cents in 577 events, including
397,362 cents of native Butler evidence. No suspected cross-system pairs or
withheld cents were observed in this loaded book; this is the reconciliation
policy's observed result, not a universal assertion that no other copies exist.

The missing refund payment date is not invented. Source accounting is exact;
period-level whole-business answers remain recorded-only until the existing
source coverage/freshness contract licenses exactness. Zero attributed core means
zero positively classified records, not proof that the business has no core sales.
John matches three customer identities, including the requested recurring customer;
identity ambiguity is preserved rather than resolved by name popularity.

Sales artifacts support material completed-month revenue movement and verified
strongest-month ranking. They use the same canonical cents as speech and suppress
partial/stale data and trivial changes. Repeat suppression is process-local.
Other proactive anomaly categories (AOV/concentration/credit/service shifts) are
queryable through the canonical book but do not yet have dedicated proactive
artifact selectors. Production artifacts are suppressed while exactness is not
licensed. Deployed live conversation acceptance must be verified after deployment.

## Verification and baseline failures

Targeted sales/ingestion/customer/Claire/proactive suite: 293 passed, 6 skipped.
TypeScript and production build passed. Migration JavaScript syntax passed.
Database release-exam requires an isolated test database; it mutates fixtures and
was not run against production. Production import/replay is the safe database
integration witness.

Three decisionRecord tests failed identically on a clean origin/main snapshot:
pending concerns expect continues_pending but receive replaces_pending. They are
pre-existing and were not changed or weakened. Earlier full-concurrency runs also
hit repair2SliceB timeouts; focused reruns passed. Broad suite: 2,228 passed, 6 skipped, the same 3 baseline failures. Final post-President and CI results
are recorded in the PR, including any remaining failures.

Automated review corrections: a source-only scope can be exact only when the
canonical reconciliation and existing full coverage contract prove both periods;
other narrower scopes remain conservative. Company processor breakdowns include
Stripe and are withheld when company attribution would make their parts unsafe.

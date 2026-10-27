# CleanCloud late sales: overlap and repeat-import proof

A sale entered after the daily export can be absent from that export. Moving
the run to 11 p.m. reduces that delay, but still leaves transactions entered
after 11 p.m. and missed runs. Overlapping date ranges plus deterministic
reconciliation are required.

## VERIFIED: existing main behavior

Inspected origin/main at `04101bdece37056bcf06aed2143fabdb413ee965`.

- `extensions/gumballpals/core.js:initialRange` chooses today only.
  `sync.js` uses that range for its date fields; `schedule.js` targets
  6 p.m. America/Los_Angeles. A next-day today-only request excludes the
  previous evening's sale.
- `server/integrations/cleancloud/browserSync/cleancloudDirectSync.ts`
  already requests both Orders (Sales) and Orders (Revenue). Its default
  start comes from the latest Orders (Sales) coverage day, or a binding
  timestamp fallback. In normal daily operation that overlaps yesterday.
- Orders (Sales) selects orders by creation date; Orders (Revenue) supplies
  payment-date coverage, including payments on older orders.
- Sales and Revenue commit independently. When Sales advances but Revenue
  fails, a subsequent cold-cache/restarted run on main can advance its start
  to the Sales checkpoint and miss the earlier unimported payment window.
- `cleancloudPaidEvidence.ts:upsertCleanCloudPaidOrderWith` keys source rows
  by tenant, source order ID and report type. An unchanged overlapping row
  is retained; a changed amount updates the economic observation.
- `paidOrderLedger.ts:partitionCleanCloudOrders` reconciles Sales/Revenue
  copies of the same order into one canonical payment. Report row totals and
  import batch totals must not be added together as additional sales.

## Functional in this PR

Only the independently owned server runner changes:

1. When available, use the earlier of the Sales checkpoint and the contiguous
   proven payment checkpoint.
2. For default dates, always include at least yesterday and today in Pacific
   calendar dates, even after today's Sales checkpoint has advanced.
3. Preserve explicit operator-selected dates exactly.
4. Reuse existing ingestion, authority receipts and canonical deduplication.
   No new financial write path, inferred native payment or causal sale claim.

The existing 32-calendar-day request limit remains enforced. A checkpoint older
than that needs explicit recovery in supported chunks; this PR does not silently
skip it. A missing/disjoint payment-coverage span is not repaired or certified
as complete by a two-day overlap. Backdated corrections outside the requested
window still require a wider explicit re-export.

## Disposable verification

`lateSalesRecovery.mysql.integration.test.ts` uses real local MySQL with the
production migration runner. Only CleanCloud's login/export HTTP responses
are synthetic. The source fixture applies the requested date filters, and
source-binding caches are reset between runs to exercise persisted checkpoints.

Six scenarios:

- Empty 6:30 p.m. export, then a sale entered at 7:30 p.m.: the next day's
  default run requests both days and records the payment on its actual date.
- Another default run re-reads the overlapping rows without duplicating money
  or customer order history; both report copies count once.
- A payment for an older order absent from the Sales window arrives through
  Revenue.
- Explicit today-only requests exclude yesterday; an explicit multi-day
  request recovers it.
- An unpaid order becomes paid; a later amount correction replaces the
  canonical amount rather than adding another sale.
- Sales commits and Revenue fails across multiple missed days; a new run
  retains the earlier proven payment checkpoint and recovers the missing pass.
- Identical provider order IDs in two tenants remain independent.

The first two bullets are assertions in one test (six tests total).
On the original runner, the repeat-overlap and partial-failure recovery
assertions failed. With this change, all six pass.

Also run the six existing real-MySQL canonical re-sync tests, 36 direct-sync /
validation / reconciliation unit tests and 12 extension core/schedule tests.
Total: **60 tests passed**, plus `pnpm check`.

Reproduce against an empty local database named
`cleancloud_late_sales_*disposable` (loopback host required):

```sh
DATABASE_URL=mysql://root:root@127.0.0.1:3399/cleancloud_late_sales_disposable node scripts/migrate.mjs
DATABASE_URL=mysql://root:root@127.0.0.1:3399/cleancloud_late_sales_disposable ALLOW_TEST_DB=1 pnpm exec vitest run --config vitest.integration.config.ts server/integrations/cleancloud/browserSync/lateSalesRecovery.mysql.integration.test.ts server/integrations/cleancloud/cleancloudResyncCanonicalRevenue.mysql.integration.test.ts
```

The focused CI workflow provisions its own disposable MySQL service.
No live order, charge, customer message, export schedule or production
database value was changed during implementation.

## Blocked extension integration / owner handoff

All 95 open PRs were refreshed and their complete changed-file lists inspected
before changes. No changed path in this PR overlaps that inventory.

PR [#149](https://github.com/adamwright83-blip/bldg-admin-api/pull/149) owns
`extensions/gumballpals/core.js` and `sync.js`; #316 and #318 also include
`sync.js` and the extension README. Those files are untouched here.

For the extension owner: replace the today-only default with an overlapping
range ending today, including at least yesterday. Preserve the earlier
confirmed Sales/Revenue checkpoint when available, enforce the supported
maximum span, and retain account/store/tenant pairing and interrupted-request
resolution. Reuse the existing unique keys and canonical reconciliation.
A wider rolling lookback can catch recently backdated corrections, but cannot
promise unlimited historical coverage. Verify the installed extension and both
report exports before describing this as live.

The server fix can ship independently; it does not change the extension by
proxy or bypass its owner.

## INFERRED and UNKNOWN

- INFERRED: given a successful next-day direct export, a normally dated late
  sale should reach the canonical book. The disposable proof verifies this
  mechanism, not any particular uninspected live sale.
- UNKNOWN: actual live provider exports after this change, Clearent settlement,
  browser extension installation/reload, and Lantern City's rendering of these
  fixture transactions. No Clearent API was contacted.
- The previously observed missing native Stripe capture metadata and Lantern
  City service-geography configuration are separate issues. This PR does not
  fix either, change shared Claire behavior or certify a combined revenue total.


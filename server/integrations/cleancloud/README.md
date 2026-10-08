# Subsystem Contract: CleanCloud Integration

## PURPOSE
Authoritative integration layer for external CleanCloud laundry POS and operational evidence.

## OWNS
- CleanCloud browser sync polling, session cookies, and live sync scheduler.
- CleanCloud POS customer, order, and ticket data assimilation.
- CleanCloud observation admission (`admitCleanCloudPaidObservationWith`).
- Quarantined legacy CleanCloud imported order models.

## READS
- CleanCloud browser scraping and CSV export payloads.
- External witness JSON signatures.

## WRITES
- `cleancloud_browser_sync_*` tables.
- `cleancloud_paid_orders` table.
- Authority receipt claims (`claimType: "cleancloud_paid_observed"`).

## LEGAL ENTRYPOINTS
- `cleancloudPaidEvidence.ts` (observation admission)
- `cleancloudPaidOrders.ts` (canonical cleancloud paid order upsert)
- `browserSync/cleancloudDirectSync.ts` (sync runner)
- `browserSync/router.ts` (browser sync procedures)

## DOWNSTREAM CONSUMERS
- `server/analytics/paidOrderLedger.ts` (source-aware customer economic analysis)
- `server/geography/customerOrderTruth.ts` (external order correlation)
- `server/money/moneyProjectionService.ts` (external economic baseline)

## MUST NEVER OWN
- Native payment admission (`admitNativeStripePayment`). CleanCloud observations are NEVER native payments.
- Native laundry order lifecycle (`server/domains/orders/`).
- Commercial pipeline conversion (`won` status).

## LEGACY/COMPATIBILITY EXCEPTIONS
- `cleancloud_legacy_orders` table remains an explicit unresolved tenantless data-policy exception.

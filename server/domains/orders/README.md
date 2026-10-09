# Subsystem Contract: Orders

## PURPOSE
Authoritative domain owner for native laundry/dry-cleaning order lifecycle, intake validation, status progression, and order history.

## OWNS
- Native order lifecycle states (`pending_intake`, `scheduled`, `in_service`, `completed`, `cancelled`).
- Order creation, revision, and soft-deletion.
- Driver assignment and lifecycle transition admission.
- Canonical order history read surfaces.

## READS
- Tenant context and actor credentials.
- Admitted payment receipts (to enforce delivery payment fences).

## WRITES
- `orders` table (sole authoritative writer in production).
- Order status transition history and audit timestamps.

## LEGAL ENTRYPOINTS
- `transitionNativeOrderStatus` (`server/domains/orders/orderLifecycleService.ts`)
- `admitOrderProcessingStatusInTransaction` (`server/domains/orders/orderLifecycleService.ts`)
- `createOrReuseResidentOrder` (`server/domains/orders/orderOwnership.ts`)
- `reviseNativeOrder` (`server/domains/orders/orderLifecycleService.ts`)

## BEHAVIORAL CONTRACT: PAYMENT ADMISSION STATUS GUARD
During native payment admission, Orders domain owns status transitions via `admitOrderProcessingStatusInTransaction`:
- **Preserved Statuses:** Orders already in `collected`, `processing`, `ready`, `delivered`, or `cancelled` preserve their existing state. Payment admission never forces them back to `processing`.
- **Cancelled Orders:** Cancelled status is preserved, and the returned status disposition flags `cancelled: true`. Callers (`chargeCard`) report `success: true` and `reconciliationRequired: true` without creating false pickup-completed events.
- **Initial Statuses:** Orders in `new` or `intake-pending` transition to `processing`.

## DOWNSTREAM CONSUMERS
- Driver UI / route execution
- Admin order operations
- Day Line / planning projections
- Lantern City building objective marks

## MUST NEVER OWN
- Native payment admission (owned by Payment).
- Captured dollar truth (owned by Payment).
- Commercial customer conversion (owned by Commercial).
- Game world progression (owned by Experience).

## LEGACY/COMPATIBILITY EXCEPTIONS
- Historical tenantless order workbook imports quarantined in `scripts/`.
- Disposable test fixtures in `server/domains/orders/*.test.ts`.

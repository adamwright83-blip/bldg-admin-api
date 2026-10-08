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
- `transitionNativeOrderStatus` (`server/orders/orderLifecycleService.ts`)
- `createOrReuseResidentOrder` (`server/orders/orderOwnership.ts`)
- `reviseNativeOrder` (`server/orders/orderLifecycleService.ts`)

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
- Disposable test fixtures in `server/orders/*.test.ts`.

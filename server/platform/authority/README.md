# Subsystem Contract: Platform Authority & Execution Gates

## PURPOSE
Platform-level shared infrastructure for durable authority receipts, action execution gates, and cross-domain admission verification.

## OWNS
- Shared platform action execution gates (`actionExecutionGate.ts`).
- Generic durable authority receipt persistence (`authorityReceipt.ts`).
- Neutral action completion admission (`actionCompletionAdmission.ts`).
- Field observation admission (`fieldObservationAdmission.ts`).

## READS
- Tenant context and action inputs across domains.

## WRITES
- `authority_receipts` table (generic execution gate and completion receipts).

## LEGAL ENTRYPOINTS
- `executeWithActionGate` (`server/platform/authority/actionExecutionGate.ts`)
- `recordAuthorityReceipt` (`server/platform/authority/authorityReceipt.ts`)
- `admitActionCompletion` (`server/platform/authority/actionCompletionAdmission.ts`)

## DOWNSTREAM CONSUMERS
- Durable execution workers (`server/durableExecution/`)
- Persistent Operator action runs (`server/persistentOperator/`)

## MUST NEVER OWN
- Domain-specific payment policy or Stripe capture admission (owned by `server/domains/payment/`).
- Order lifecycle transitions (owned by `server/domains/orders/`).
- Commercial conversion (owned by `server/domains/commercial/`).

## LEGACY/COMPATIBILITY EXCEPTIONS
- Generic receipt schemas shared across historical and modern actions.

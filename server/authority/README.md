# Subsystem Contract: Payment Authority & Execution Gates

## PURPOSE
Authoritative domain owner for native payment admission, immutable capture dollar verification, and platform-wide action execution gates.

## OWNS
- Native payment admission (`authority_receipts` ledger).
- Provider capture proof interpretation (Stripe `amount_received` & currency).
- Canonical native payment read models.
- Shared platform action execution gates.

## READS
- Stripe webhook payloads & provider charges.
- Native order identifiers and explicit tenant context.

## WRITES
- `authority_receipts` table.
- Provider claim locks (preventing duplicate capture binding).

## LEGAL ENTRYPOINTS
- `admitNativePayment` (`server/authority/paymentAdmission.ts`)
- `recordAuthorityReceipt` (`server/authority/authorityReceipt.ts`)
- `executeWithActionGate` (`server/authority/actionExecutionGate.ts`)
- `getNativePaymentStatus` / `getNativePaymentOccurrenceHistory` (`server/authority/nativePaymentReadService.ts`)

## DOWNSTREAM CONSUMERS
- Orders delivery gate (requiring payment admission before delivery)
- Canonical revenue analytics (`server/analytics/canonicalRevenue.ts`)
- Tower Wars economic banking (`server/towerWars/towerWarsService.ts`)

## MUST NEVER OWN
- Order status lifecycle transitions (owned by Orders).
- Commercial conversion `won` (owned by Commercial).
- Game narrative/progression (owned by Experience).

## LEGACY/COMPATIBILITY EXCEPTIONS
- Historical payment receipts without provider amount proof remain unknown dollars (occurrence proven, amount unadmitted).
- Seeded NULL-tenant migration witness row remains unresolved.

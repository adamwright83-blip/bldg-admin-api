# Subsystem Contract: Payment Domain

## PURPOSE
Authoritative business domain owner for native payment admission, immutable capture dollar verification, provider claim identity, and canonical revenue reads.

## OWNS
- Native payment admission (`authority_receipts` ledger).
- Provider capture proof interpretation (Stripe `amount_received` & currency).
- Provider claim locks (preventing duplicate capture binding).
- Canonical native payment read models (`nativePaymentReadService.ts`).

## READS
- Stripe webhook payloads & provider charges.
- Native order identifiers and explicit tenant context.

## WRITES
- `authority_receipts` table.
- Orders payment fields upon verified admission.

## LEGAL ENTRYPOINTS
- `admitNativePayment` (`server/domains/payment/paymentAdmission.ts`)
- `getNativePaymentStatus` / `getNativePaymentOccurrenceHistory` (`server/domains/payment/nativePaymentReadService.ts`)

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

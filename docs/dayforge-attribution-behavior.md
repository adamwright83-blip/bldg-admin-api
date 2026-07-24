# DayForge campaign and revenue attribution behavior

## What wins attribution

An active, unexpired, non-revoked opaque DayForge campaign token supplied with an order is the strongest order-specific source. The server hashes the bearer token, looks up the tenant-owned campaign, and records high-confidence explicit-campaign attribution. The public token grants no admin access and contains no sequential account, mission, or pipeline ID.

The customer's original first-touch source is a separate durable record. A later explicit campaign may receive credit for that later order without rewriting the original first touch. If the later campaign contradicts the preserved account/source, the order is held for review and both histories remain visible.

An order without a new campaign can inherit the preserved first touch only when the normalized customer identity and normalized service property/building match exactly. No arbitrary 30-, 90-, or 180-day expiration is imposed. A changed property, unmatched identity, contradictory explicit source, or ambiguous relationship is not silently inherited.

## Which orders qualify as attributed revenue

An acquisition record can be created before a commercial account is won; it remains pending. It reaches the existing commercial revenue ledger only when the campaign's account has a canonical converted commercial customer and the source is not conflicting.

Revenue is realized only from canonical paid truth:

- A paid, non-cancelled order with reliable net payment data contributes that net paid amount.
- When the only reliable facts are `paid=true`, `paidAt`, and order total, that paid total is used and clearly remains the legacy gross-paid basis.
- The first eligible order is labeled `first_order`; later eligible orders are labeled `recurring`.
- `paidAt`, not a generic update timestamp, controls payment timing.

Attribution changes reporting only. It never changes price, payment intent, customer charge, vendor payout, or fulfillment routing.

## Which orders are excluded or held

- A generic homepage/order-form order with no explicit campaign and no matching preserved first touch stays generic.
- An unpaid order has zero paid and realized revenue, even if its acquisition source is known.
- A pending pre-win acquisition is not commercial realized revenue.
- A cancelled, deleted, fully refunded, or reversed order has zero realized revenue and a reversed status.
- A known partial refund without a canonical net amount is put in `financial_review`; DayForge does not invent subtraction math.
- A changed address/property, ambiguous identity, conflicting campaign/account, low-confidence fuzzy guess, expired token, or revoked token is not silently credited.
- Currency and tenant boundaries are preserved. A token from one tenant cannot attach an order in another tenant.

## Recurring orders

Recurring inheritance requires both the same normalized customer identity (email preferred, otherwise phone) and the same normalized property/building key. It also requires a preserved source and no new conflicting explicit campaign. A new explicit campaign can receive order-specific credit for the later order while the acquisition source remains unchanged. There is no invented time cutoff.

## Corrections, refunds, and reversals

The existing manual order-ID attribution path remains available for recovery. Automatic acquisition records have tenant-scoped review state. A reversal writes an immutable correction row containing the previous and corrected states, reviewer, reason, request ID, and timestamp, then zeroes realized revenue in the existing ledger. It does not erase the source history.

Known full refunds and cancellations are reversed. Reliable captured/refunded/net projections use net paid. When only the legacy paid flag and total exist, partial-refund net reporting remains unsupported and is held for financial review rather than reported as a fabricated net amount. Webhook/order retries are protected by tenant/order and request uniqueness, so replay cannot create a second revenue row.

## Before and after examples

- Explicit campaign: A guest scans the Maybourne concierge leave-behind and places a $72 order. Before, an operator manually typed the order ID. After, the valid token creates explicit high-confidence acquisition; once the commercial customer is eligible and the order is paid, $72 enters realized attributed revenue.
- Unpaid order: The same guest schedules but has not paid. The source is preserved as pending/attributed acquisition, but realized revenue is $0.
- Recurring order: The guest orders again next month with the same email and Maybourne address, without rescanning. The original first touch is inherited and the paid order is labeled recurring. No arbitrary attribution-window cutoff applies.
- New campaign: The same customer later uses a distinct reactivation campaign at the same property. That order receives the reactivation campaign's order-specific credit; the original first-touch campaign is not overwritten.
- Changed address: The customer moves to a different property and orders without a new token. The location key no longer matches, so DayForge does not inherit the old building campaign.
- Conflict: An order carries a valid campaign for Account B while its preserved first touch belongs to Account A. The new explicit touch is retained, but the contradiction enters review and no automatic commercial revenue is posted.
- Generic order: A resident comes directly to the homepage with no campaign and no prior source. The order stays generic.
- Full refund/cancellation: A paid attributed order is fully refunded or removed. Its revenue row is reversed to $0 and the correction history remains.
- Partial refund without net truth: The system knows a refund occurred but lacks a trustworthy net amount. It reports financial review, not the original gross total as net revenue.
- Manual correction: An admin verifies that an ambiguous order belongs to the Westview mission. The manual path records the correction and actor/reason without modifying what the customer paid.

## Rollback

Disable or revert the attribution-phase application commit on `codex/dayforge-30-day-v3`. The additive acquisition/correction/payment tables can remain in place. Existing manual attribution continues to work. The clean project rollback SHA is `fc6d70c025086d727e3cb3fd5ecb8a9f0b369187`. Never roll back by deleting attribution history or changing customer charges.

# Program C read-side audit

## C1: Orders customer history

Starting main: 1e93cac20001844105db8e7a4e1ecc57d6ca29d0.
The customer geography/history projection selected Orders fields itself. That narrow
query now belongs to `orders/orderHistoryReadService.ts`; the consumer composes
Orders facts with canonical Payment admission and external CleanCloud observations.
Payment flags returned by Orders are evidence candidates, never paid authority.
The established unscoped admin aggregation is explicitly isolated as
`readLegacyNativeCustomerHistoryAcrossTenants`; it does not assign tenants. Scoped
reads reject blank tenant identity and retain exact persisted-tenant predicates.
No product ranking/personality, reward, external evidence, or write policy changes.

MySQL proves two-tenant isolation, exclusion of tenantless rows from scoped access,
explicit compatibility retaining null tenant, and repeat stability. Existing narrow
column tests, Payment guards, and strategy customer aggregate tests cover composition.

## Unresolved monetary read boundary

A disposable MySQL witness on B4/C1 starting main proved `loadPaidOrderLedger`
changes an admitted native event from 4200 to 9000 cents after `reviseNativeOrder`
edits the order total; the same receipt ID is used both times. `mapNativeOrders`
reads current editable `orders.total`. Payment admission receipt metadata contains
only orderId, no captured amount. Customer assets also fall back from netPaidCents
to this editable total. Consequently receipt-valid payment existence does not
establish the asserted dollar amount. Program B/C certification is withheld.

Payment owns the missing monetary evidence. Historical receipts cannot safely be
backfilled from current price. Repository evidence does not establish whether these
historical amounts should be reconstructed from provider captures, interpreted net
of refunds, or withheld pending reconciliation. That specific historical/data-policy
item remains unresolved; no provider credentials or production data were used.

## C2: Reminder conversion requires Payment admission

The Level 4 gate's existing reminder-conversion consequence previously counted raw
paid flags. The count now composes the owning Payment reader and exact receipt
matcher. Operational collection blockers retain their existing behavior; no unknown
payment is reinterpreted as a new asserted debt. MySQL proves a weak paid flag earns
no conversion, canonical admission enables the existing consequence, and repeated
projection does not multiply it. The test isolates unrelated offensive presentation
loading while exercising real Orders, action logs, Payment receipts and gate logic.

Adam resolved the historical-dollar policy: unknown amounts must be withheld and
reconciled from durable provider captures. Editable order prices must never supply
canonical paid dollars, customer value, or game/business truth. Work on that reader
family continues in a separate slice.

## C3: Native paid dollars require durable provider capture amounts

Policy is now explicit: a receipt proves payment admission, while amount remains
unknown unless durable Payment/provider evidence establishes it. Payment persists
Stripe `amount_received` and currency in matching receipt metadata. Known captures
are immutable; conflicting replay is rejected transactionally. Explicit historical
reconciliation enriches an existing matching receipt without changing order price
or current paid/refund state. The CLI defaults to provider-read preview and requires
explicit tenant/order identity plus `--apply` for reconciliation. No production
reconciliation was run by this architecture campaign.

Canonical revenue withholds admitted native records whose capture amount is unknown.
It uses persisted capture cents after reconciliation; editable Orders prices cannot
alter paid events. Customer history, native lifetime value/profile/averages, admin
aggregates and building attribution preserve unknown amounts. Verified current net
provider projections remain distinct from past gross capture occurrences. Screens
render unknown and exclude unknown values from revenue ranking rather than coercing
null to zero. Existing unverified-price diagnostics remain explicitly excluded from
the paid ledger; they do not contribute paid dollars.

MySQL proves missing capture withholding, provider reconciliation, unchanged $42
revenue/value after an order-price revision to $90, matching attribution/profile
values, replay stability, conflicting-amount rejection, wrong-tenant rejection and
preservation of the current paid flag. All focused proofs pass. Expanded contracts:
1618 pass; four untouched-main failures (three Claire decisionRecord and one Gumball
digest) remain. React review covers the narrow unknown-rendering changes; no hooks,
interactions, art or reward mechanisms were added.

The wider scan also identified remaining independent raw monetary consumers in
Tower Wars, Level 4 referral selection, native freshness, vendor dashboard and
capability/order statistics. They are being classified and migrated in subsequent
coherent slices; B/C are not yet globally certified.

## C4: Resident/referral facts compose owning Orders and Payment readers

Level 4 paid-resident counts and referral lifetime values previously queried raw
paid flags and summed mutable prices. A customer projection now composes the narrow
Orders history reader with matching Payment receipts and provider capture cents.
Admitted payment existence can count a resident even when historical dollars remain
unknown. A referral object requiring a numeric lifetime value is withheld until its
captures are reconciled. Prices do not substitute for amounts; tenant is explicit.

Outreach copy/execution previously trusted browser-supplied customer/count/value
payloads. They now resolve business facts from the durable server projection.
Stale/foreign targets fail closed; caller-selected brand and reviewed copy remain
intent/presentation. Execution dedupe runs before source refresh, preserving replay.
The downstream Ops task uses the admitted source snapshot, not the browser's money.
No outbound messaging is introduced; this remains the existing reviewed-action log.

MySQL proves weak flags are excluded, amountless receipts enable only counts,
reconciliation enables immutable value, price changes/replay preserve value, and
other tenants do not contribute. Source tests prove browser money/count/name values
cannot replace canonical facts and stale/held targets cannot execute.

The pre-existing tenantless `bldg_users` shared registration census remains an
explicit legacy observation (signups, not tenant-owned paying customers). No row
gets assigned a tenant. Tenant-bound paid residents require owned Orders lineage
and Payment admission. The separate `cleancloud_legacy_orders` exception is untouched.


## C5: Staff receipt and operations dashboard use admitted Payment facts

The staff digital receipt previously presented the mutable current order total as
the Payment amount and used `orders.updatedAt` as payment time. Order detail now
includes a Payment-owned read projection based on exact tenant/order/PaymentIntent
receipt matching. The receipt keeps the current order total as order/intake state
and renders payment occurrence/captured dollars separately. An admitted occurrence
with no durable capture amount remains amount-unknown; unavailable or unverified
Payment evidence is not silently converted into Pending/paid dollars.

The operations-events dashboard/CSV previously joined `orders.total`,
`orders.paid`, and `orders.paidAt` directly and labeled them charged amount,
paid, and paid time. Orders now supply only candidate identity/evidence fields;
canonical Payment facts supply admitted occurrence, provider occurrence time, and
immutable captured dollars. If Payment proof cannot be read, the operations event
remains valid operational evidence while its economic fields remain unknown.

The Payment fact projection intentionally preserves historical admitted occurrence
after current paid/refund state changes. Current paid-state authority remains a
separate question from whether the provider-backed payment occurred.


## C6: Unknown Payment evidence remains unknown in operations UI

The operations dashboard now carries an explicit payment evidence status:
`verified`, `unverified`, or `unavailable`. The UI no longer collapses
unverified/unavailable evidence into "Unpaid" and no longer collapses a verified
payment with no immutable captured amount into "No charge". Those states render
as "Payment not verified", "Evidence unavailable", or "Amount unknown".


## C7-C9: Remaining native monetary read convergence

### Native data freshness

Native freshness now consumes the Orders-owned explicit-tenant history reader and
Payment-owned admitted facts. It no longer selects native `orders.paid`,
`orders.paidAt`, mutable `orders.total`, or a missing-tenant-to-default
predicate as sale truth. The latest native sale is ordered by Payment receipt
occurrence. Dollars remain unknown when the occurrence is admitted but immutable
capture evidence is absent. Claire's freshness renderer speaks that amount as
unknown rather than coercing null into a dollar value.

### Vendor dashboard and payout history

Vendor operational counts remain Orders facts. A dedicated vendor payment
projection composes an Orders-owned vendor reader with canonical Payment facts.
Historical gross and payment time come from immutable capture evidence and receipt
occurrence, not current order price, `updatedAt`, or raw paid flags. Vendor
payment history is sorted by admitted payment occurrence. The current paid/refund
projection remains distinct from historical capture occurrence, so a refunded
order is labeled as historical payment rather than currently Paid. Known amounts
retain currency display; unknown amounts remain explicit.

### FIRST_HIRE supporting revenue

FIRST_HIRE readiness still uses Orders operational weight for utilization, with an
exact persisted tenant predicate. Its supporting trailing revenue is now populated
only from canonical revenue when that reader may state the requested 30-day window
exactly. Partial or unavailable revenue remains null. Mutable order quote totals no
longer masquerade as paid revenue, and missing tenant identity is not coerced to
`default`.

These changes close the three remaining raw monetary consumer families named by
the C3 audit. Final Program C certification still requires the post-merge hostile
repository scan and classification of every remaining suspicious read/write seam.


## C10: Strategy snapshot fixtures use canonical Payment admission

The real-MySQL strategy snapshot fixture previously manufactured a paid customer
by inserting `paid = true` and a PaymentIntent directly. After read-side Payment
convergence, that weak fixture correctly stopped qualifying as a dormant paid
customer. The fixture now creates the order unpaid and establishes the historical
payment through `admitNativeStripePayment` with succeeded provider capture
evidence. Runtime payment authority is not weakened merely to satisfy the test.

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

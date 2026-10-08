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

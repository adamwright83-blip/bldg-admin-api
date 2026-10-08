# Program B — downstream business/game integrity

Program A merged through #465 at `096ca68c72e4eb812b8f20d3f441394663ddd0c3`.
Post-merge native Orders inventory/guard passed; Driver is read-only plus canonical
transition admission. Worker/outbox/action-gate checks: 27 unit and 41 MySQL tests
passed. Existing health, execution context, attempt/lease/error witnesses satisfy
the observability objective; no new dashboard is needed.

## Slice B1: recovery intent is not verified recovery

`beginDriverRekindle` writes a compact game node after checking that a real
Commercial follow-up exists. It records the time the visual path starts; it does
not establish that a customer returned, a payment occurred, or a commercial
recovery completed. `loadGoldlineProgressionEvidence` previously converted the
node's `resolvedAt` into `verifiedAt`, enabling `FIRST_VERIFIED_RECOVERY` and
business-action evidence from game state. This reverse authority is removed.

Recovery opportunities/active visuals remain, but their verification is unknown.
Their source identifies the Commercial mission, not a fabricated recovery outcome.
No browser/game timestamp can provide a verified real recovery. A future actual
recovery input must cross its owning domain; this slice does not define a new
Commercial recovery policy or map customer recovery to prospect missions.

Verification: actual loader → shared progression regression tests, replay,
tenant/actor preservation, existing world/progression contracts; 35 focused tests
passed, plus type-check/nomenclature/tenant/vertical gates. No art, Kingdom, Rook,
Tower Wars, rewards, or unlock rule definitions changed.

## Continuing audit

- Orders/Payment: A5 mutation guard applies to game/server operational surfaces.
- World event admission rejects generated fiction as business actions/outcomes;
  `account_won` validates a tenant-bound Commercial authority receipt and entity
  binding. Journal actions remain operator-attested actions, explicitly not outcomes.
- CleanCloud economic outbox feeds downstream, tenant-scoped idempotent snapshots.
- Lantern City composes Geographic Truth and canonical revenue readers; its
  objective-mark router is read-only with canonical operator/tenant admission.
- Fiction-only authored canon, art/rendering and visual game state are out of scope.
- Native customer/payment projection still uses a paid flag + PaymentIntent string
  without validating an admission receipt. Canonical revenue validates receipts.
  This discrepancy needs a separate owning-domain read seam; B is not yet certified.

## Slice B2: Payment admission supplies customer/game paid truth

A PaymentIntent string plus a checkbox was weaker than canonical revenue admission.
`nativePaymentReadService` now composes the existing bounded Payment receipt reader
and its exact tenant/order/source/ref policy matcher. Geography and customer assets
consume that admission. Commercial's diagnostic evidence predicate is explicitly
named candidate evidence and retains its separate receipt check; it is not authority.

Rows without established tenant identity remain unverified. Receipt-provider
unavailability propagates; no fallback grants authority. Unadmitted historical
paid flags do not become an asserted unpaid debt: asset lifetime value/balance are
unknown, and Money/Business World preserve that unknown in aggregate receivables.
Open-order statistics distinguish unverified payment from explicit awaiting payment.
No new truth table, inferred payment, or historical tenant assignment.

Real MySQL proves an unreceipted paid flag + processor reference cannot produce
paying-customer/game truth or a known asset value/balance. Canonical Payment admission
then enables the exact tenant-bound projection. Wrong tenant remains unverified.
Read-only architecture guards pin the owning boundary.

Proven pre-existing focused failures on slice starting main `464a44f5`:
`gumballCustomerTruth` digest expectation and `moneyProjectionService`'s missing-proof
fixture. They are outside the changed business logic and are not repaired here.

## Slice B3: Commercial owns world/progression fact reads

Driver world and progression previously selected mission/pipeline/account/visit/
follow-up facts inside game services. A narrow Commercial-owned SELECT-only reader
now supplies those facts with explicit tenant/actor fences. Saved game nodes are
read separately and cannot enter the Commercial fact query. Game code retains
only visual composition and its own compact state. Armory/scout joins to missions
remain correlation/actor-admission filters for those source records, not independent
Commercial outcome interpretation.

Real MySQL proves actor and tenant isolation, repeated projection stability, and
that a saved `captured` game node cannot override a real Commercial `follow_up`.
No new win/payment/customer/order, no new reward, and no game UX changes.

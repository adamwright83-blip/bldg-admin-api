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

## Slice B4: Payment history uses admitted occurrences

Customer assets previously labeled an `order_payment_projections.paidAt` value
as a VERIFIED historical payment without an admission receipt. The timeline now
uses the matching Payment receipt's occurrence time and source reference. The
Payment reader distinguishes an admitted historical occurrence from the current
paid flag, so a later state change does not erase the admitted history. Historical
amount is unknown: a current net projection or editable order price cannot prove
the amount captured at that earlier occurrence.

Real MySQL proves projection-only history is withheld, admission enables exactly
one event, and replay/current-state changes preserve that event without inventing
an amount. Four receipt unit tests, geography/reader guards, both Payment projection
MySQL tests, typecheck, nomenclature, tenant ratchet, and vertical dependency checks
pass. Starting main: bd124b461a65480995d00b9453b02610a4a5579e.

## B5: Tower Wars consumes admitted economic facts

Tower Wars previously selected native/modern CleanCloud payment rows itself and
marked processor references/raw paid flags as authoritative, using mutable native
prices as dollars. Its Reality Bridge adapter now consumes `loadPaidOrderLedger`:
matching Payment/External observation receipts and durable native capture amounts
are required before an economic candidate exists. Native Payment and external
CleanCloud sources retain distinct provenance. Saved game state does not supply
business facts. Event keys, source lineage and existing compiler/attack rules remain.

MySQL proves a raw paid flag produces no candidate, admission without capture still
produces no dollars, reconciliation enables the $42 candidate, a subsequent $150
order-price edit does not alter it, repeat projection is stable, and another tenant
cannot read it. Existing Tower Wars compiler/day-director/settlement/impact tests are
run. No game art, unlock mechanics, new rewards or currencies are introduced.

B5 validation note: the two `towerWarsDayDirector` actor-identity unit tests also
fail unchanged on exact starting main 7209fc50ab7876e878e58ca9d3300831c978258d
(empty commitment result / commitment not found). These are outside the economic
reader change and are retained as proven baseline failures.
The adapter also composes canonical revenue reconciliation before projecting game
candidates: proven links and unresolved suspected copies retain the owning ledger's
withholding policy, including customer identity keys beyond phone numbers.

## B6: Command Sky first-payment wins require business evidence

Command Sky auto-detection previously read raw paid flags without a tenant fence,
and manual first-order wins required no Orders/Payment evidence. Both now resolve
the first admitted payment per tenant-owned customer phone through owning readers.
Manual first-order claims require an order number; labels and dedupe keys come from
the durable source. Unsupported legacy/manual first-order rows contribute neither
customer campaign counts nor payment-based hope. Verbal commitments remain explicit
operator observations with their existing timing. No new reward/art mechanic.

Real MySQL proves weak-flag exclusion, foreign-tenant isolation, amount-unknown
admission eligibility, canonical labels, shared manual/automatic dedupe and exclusion
of an invented legacy win. Ten authority contracts, TypeScript and four architecture
gates pass. The UI adds only the order evidence field needed for the existing action.

## Final Program B certification checkpoint

Program B is certified by the current-source [Program D report](./PROGRAM_D_CERTIFICATION.md), including B6 Command Sky source admission and the later external-evidence import fences. No reward/art redesign or protected agent product rewrite was performed.

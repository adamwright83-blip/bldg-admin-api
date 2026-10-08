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

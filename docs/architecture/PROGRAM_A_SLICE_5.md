# Program A / Slice 5 — Laundry Order Write-Path Convergence

Starting main: `897e7c03ea36af7bb305d53ab6db099f83b1b5a8`.

## Production write inventory

The inventory includes server code and operational scripts, direct Drizzle writes,
SQL writes, and every caller of native Orders persistence helpers. Reads are legal.

| Path | Classification and resulting boundary |
| --- | --- |
| `server/orders/orderLifecycleService.ts` | Canonical Orders creation, lifecycle, revisions, payment-method references, building/vendor assignment, deletion. Creation cannot establish paid state. |
| `server/db.ts` | Internal Orders persistence: insert, resident duplicate/reuse recovery, collection CAS, lifecycle/event transaction, intake, Stripe references, building/vendor assignment, deletion. Only Orders calls these mutation helpers. Intake cannot write payment state. |
| `server/authority/paymentAdmission.ts` | Canonical Payment admission and established legacy payment tenant preparation. Its existing behavior is preserved. |
| `server/agents/tools/createLaundryOrderTool.ts` | Bypass repaired: resident identity/lineage admission → canonical resident creation. Tenant, resident ID, request key, metadata unchanged. |
| `server/_core/index.ts` | Bypass repaired: validated intake → canonical resident creation. Stripe reference checks and response/reuse behavior preserved. Existing host/tenant resolver unchanged. |
| `server/joystick/driverOrderService.ts` | Bypass repaired: membership/tenant admission → canonical lifecycle. Driver store now has only reads. |
| `server/routers.ts` | Bypasses repaired: raw intake, payment-method references, building attribution, vendor assignment, deletion → named Orders application functions. Existing API admission/ownership policies remain in place. Lifecycle in revisions crosses the canonical transition function. |
| `server/agents/tools/attachReceiptToOrderTool.ts` | Bypass repaired: tenant/service admission → canonical revision. |
| `server/agents/tools/completeDryCleaningIntakeTool.ts` | Bypass repaired: tenant/service/unpaid admission → canonical revision. Removes redundant `paid: false` mutation; intake cannot erase a concurrent payment. |
| `scripts/backfill-order-buildings.ts` | Operational bypass repaired: canonical building attribution. |
| `scripts/repair-stripe-paid-order.ts` | Paid-state bypass repaired: succeeded Stripe evidence → Payment receipt/admission; processing status crosses Orders. Missing tenant stops repair without assigning a tenant. |
| `server/goldline/customerOrderHistoryImport.ts` | Explicit manual history/cadence admission, invoked by workbook CLI; fixed-workbook validation, explicit tenant, source/idempotency metadata, historical timestamps, `cadenceEvidenceOnly`, unpaid zero-valued historical rows. Insertion now crosses Orders. These records are historical evidence, not native payment or a new verified delivery. Read-side interpretation is subject to Programs B/C. |
| `server/goldlineCargo/cargoService.ts`, cancellation/status tools | Already canonical lifecycle consumers. |
| `server/legacyDayforgeDemo/demoTenantSeed.ts`, `demoTenantReset.ts` | Explicit bounded demo fixtures/reset; narrow architecture exemptions. |
| `scripts/goldline-living-world-proof-seed.ts`, `goldline-wave-local.ts` | Explicit local proof fixtures; narrow architecture exemptions. |
| `scripts/migrate.mjs`, numbered SQL migrations | Schema/historical migration boundary, not normal application admission. |
| Integration tests and test fixtures | Disposable proof setup/cleanup, excluded from production guard. |
| External operational orders, CleanCloud paid/legacy orders, Mitch work orders | Different tables, not native `orders`. Historical tenantless CleanCloud importer is untouched. |

## Effects and concurrency

Driver operations events, pickup SMS, and stage consequences retain their existing
implementation and occur only after a fresh canonical transition. The canonical
collection/delivery CAS paths do not separately emit those Driver events; the
ordinary status/event transaction remains Orders persistence. There is no double
invocation of lifecycle effects. This slice does not claim a durable exactly-once
SMS guarantee across a crash after mutation; it proves replay and competing-request
safety. Consequential publication durability remains subject to the final scan.

Delivery excludes rows already delivered from its conditional write, so MySQL
matched-row behavior cannot make competing replays report a new transition.
Collection fences the persisted tenant and rejects cancelled/unresolved outcomes.
Resident insert-race recovery uses the existing cause-aware MySQL error classifier,
including Drizzle-wrapped duplicate-key errors.

## Protected work and non-goals

Inspected President #411/#375/#374/#359, Mitch #361, Daphne #463 and fresh #464.
President #375's router import/registration hunks are independent of Orders hunks;
Adam explicitly authorized normal reconciliation. No protected branch is modified.
No shared workflow edits, domain redesign, tenant resolver redesign, default-tenant
manufacture, art changes, or rewards. Existing documented legacy tenant compatibility
is preserved; it is not authorization to assign missing historical tenants.

## Verification

- Type check, nomenclature, tenant ratchet (+0 new default fallbacks), vertical dependencies passed.
- Focused Orders/ownership/Driver/resident/intake/Payment/MySQL-error suites: 90 tests passed before final commit.
- Real MySQL 8.0: 7 integration tests passed, including 8 simultaneous resident creates and 12 simultaneous pickup/delivery requests.
- Existing fast-contracts targets: 1,295 passed; three `server/claire/turn/decisionRecord.test.ts` failures reproduce identically on untouched starting main (1,295 passed, same three failed). No unrelated repair.
- Clean production migration runner and separate clean numbered release migrations both completed. Router integration uses the release schema; production boot intentionally omits historical release-only tables.

## Final Program A certification checkpoint

Program A is certified by the current-source [Program D report](./PROGRAM_D_CERTIFICATION.md). Later C12/C15/C16/C17 tightened delivery admission, provider capture ownership, prior-payment enrollment and unresolved historical tenant handling. The original A5 note preserving legacy tenant preparation is superseded by C17: historical NULL ownership is held, not defaulted. Current quote fields never establish historical captured dollars.

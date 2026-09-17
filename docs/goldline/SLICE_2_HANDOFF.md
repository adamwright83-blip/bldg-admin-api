**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 2 HANDOFF — StrategyEngine live-derived snapshot

**Status: FOUR FAKE SECTIONS REPLACED IN CODE — WAIT FOR REAL CI BEFORE CALLING COMPLETE.**
**Branch:** `claude/goldline-slice-2-strategy-truth`
**Draft PR:** #155
**Exact latest commit SHA:** see `git log -1` on the branch; this file is updated in the same commit as the code it describes.

Uncommitted Claude-local files from the credit-exhausted session (`snapshotDormantCustomers.ts` etc.) were **not** present on this checkout. They were reconstructed from this handoff + the session notes (deterministic `now`, hashed non-phone ids, `listAdminCustomerAggregates`).

---

## ⚠️ Naming collision — read this first

`docs/goldline/BUILD_BRIEF_SLICES_1_5.md` defines an unrelated **"Slice 2 — Kingdom sequence."** This document is step 2 of `BEHAVIORAL_SCIENCE_FOUNDATION.md` §5: kill fake StrategyEngine state.

---

## What is complete (code, pending CI)

Replaced the four hardcoded snapshot sections in `buildStrategySnapshot` with tenant-scoped derivations from `listAdminCustomerAggregates` (orders table), or with an explicit empty/omitted marker when a truthful mapping does not exist.

| Section | What shipped |
|---|---|
| `dormantEligible` | Paid customers whose last order is ≥ 30 days before snapshot `now` (same inactivity default as `getStrategyGrowthMetrics`). Id is `sha256(tenantId + admin group key)` — raw phone is not copied. `firstName` is the existing admin display merge; `buildingName` from `buildingFromSlug`. `scoreCustomerChurn` is **not** a gate (it throws below two orders and would hide one-order lapses). |
| `repeatPipeline` | Paid customers whose **first** paid order is within the last 30 days. `hasSecondOrder` = `paidOrderCount >= 2`. `fulfillmentStatus` / `feedbackStatus` = `unavailable`. `isDueToReorder` is false without observed cadence. `openFeedbackIssues` is 0 and flagged unobserved in unresolved/provenance. |
| `funnelStages` + `limitingStage` | Only stages we can observe: Resident First Order (`paidOrderCount>=1`) and Resident Repeat Order (`>=2`). Property Discovery / Approval **omitted** — mapping commercial pipeline stages onto those labels would be an invented equivalence. Empty funnel → `limitingStage: "insufficient_data"`. |
| `accounts` | **Empty list.** `accounts[].state` (`Captured` \| `Contested` \| `Closed` \| `Recovery` \| `Wait`) still has **no mapping** anywhere outside `server/strategy/`. Unresolved + provenance record that omission. Do not invent a mapping. |

Token truncation: dormant cap is 12 in derivation, then 5 if over token budget (sorted by `daysSinceLastOrder`). The old “truncate to 1 because fixtures had 2” path is gone. Opportunities also truncate to 1 under budget so the existing tight-budget test still observes a real truncation.

`detectedGaps` first-order-no-second now cites a live pipeline customer id when one exists, not `"Marcus K."`. `growthPlan.nextActions` no longer names Broadway Lofts / Century Plaza.

**Still fabricated (out of Slice 2 four-section scope):** `opportunities`, `activation`, `capacity`, `campaigns`, `commitments`, `recentOutcomes`, `constraints`. Do not “improve” those with plausible fiction.

---

## Architecture (unchanged laws)

- Reuse `listAdminCustomerAggregates` / `buildAdminCustomerAggregatesInMemory`. No new data-access layer.
- Tenant-scoped. Deterministic `options.now`. America/Los_Angeles + `en-CA` YMD still used by growth metrics in the same builder.
- Never replace a fabrication with a more convincing one (`REALITY_BRIDGE.md`, foundation permanent law).
- Slice 1 ledger code was not touched.
- No COM-B/TDF/BCT annotations in this slice.

---

## Files changed

- `server/strategy/snapshotDormantCustomers.ts` + `.test.ts`
- `server/strategy/snapshotRepeatPipeline.ts` + `.test.ts`
- `server/strategy/snapshotFunnel.ts`
- `server/strategy/snapshotBuilder.ts` — wiring, provenance, unresolved, truncation
- `server/strategy/slice2LiveSnapshot.test.ts`
- `server/strategy/slice04StrategySnapshot.test.ts` — provenance keys
- `server/strategy/snapshotLiveDerived.integration.test.ts` — real MySQL tenant isolation
- `.github/workflows/goldline-fast-smoke.yml` — unit + integration steps
- `docs/goldline/SLICE_2_HANDOFF.md` — this file

---

## Open design question (still open)

`accounts[].state` mapping. Product decision required. Until then the list stays empty.

---

## Tests

Unit (no DB): fixture-name regression, hashed ids, injected-`now` dormancy, tenant-distinct hashes, funnel omission, unavailable feedback.

Integration (needs `DATABASE_URL`, glob `server/**/*.integration.test.ts`): two tenants, paid orders 45 days old, dormant lists do not leak across tenants, phones not in snapshot JSON.

Local verification: unit files passed in this environment. **No MySQL here.** Integration + `goldline-fast-smoke` must be read from GitHub Actions on PR #155.

---

## Exact next step if CI is green

Slice 2 of the behavioral-science roadmap is done. Next roadmap step is **Finish assertion-guard production wiring** (foundation §5 item 3). Do not start Slice 3 of BUILD_BRIEF (kingdom sequence) by accident.

If CI is red: read the goldline-fast-smoke job logs; do not “fix” by restoring fixture numbers.

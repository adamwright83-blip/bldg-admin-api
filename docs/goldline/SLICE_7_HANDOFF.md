> **LEGACY DAYFORGE COMPATIBILITY:** Retained historical literals in this file are compatibility/history only; they are not current architecture. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md.

**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 7 HANDOFF — Claire relationship offboarding surface

**Status: MERGED into `main` via PR #160.**
**Branch:** `chatgpt/behavioral-slice-7-claire-offboarding`
**PR:** https://github.com/adamwright83-blip/bldg-admin-api/pull/160
**Base:** `main` @ `fd3fc3913cb4687fcf82f4259f596fa269feb408`
**Final PR head:** `683d33f86af578130119c276711c55708d9f8589`
**Merge commit:** `7285bbf9e7a2b6d39190350a3b3cd56d76876ffb`
**CI on final PR head:** Fast Goldline smoke green; DayForge release gates green; Goldline mobile regression green.

## Why this is Slice 7

Behavioral-science Slices 1–6 were already merged. Slice 6 deliberately left one relationship-layer task: expose the existing `composeClaireRelationshipClosing` server/domain contract through a user-facing surface. Adam explicitly asked to execute “Slice 7” on 2026-09-17, so this narrow leftover became Slice 7. This is not BUILD_BRIEF Slice 7 and does not create a new behavioral-science architecture.

## Objective — complete

Expose the existing safe relationship-closing artifact through an authenticated Claire API/UI surface without deleting or mutating authoritative business records, weakening approval gates, inventing emotional claims, or creating another memory system.

## Infrastructure reused

- `server/claire/character/relationshipOffboarding.ts`
- `server/claire/character/relationshipHistory.ts`
- existing relationship event/state/tier/compiler infrastructure from Slice 6
- existing DayForge field-auth procedure
- shared desktop/driver-accessible Claire surface at `client/src/pages/goldline/ClaireDesk.tsx`

## Implementation

### Self-scoped API

New `server/claire/relationshipOffboardingRouter.ts` exposes:

`system.claireRelationshipOffboarding.preview`

The query:

- uses authenticated `ctx.tenantId`
- uses authenticated `ctx.user.openId`
- loads bounded relationship history through the Slice 6 assembler
- calls `composeClaireRelationshipClosing(...)`
- writes nothing
- deletes nothing
- does not alter relationship state, business state, approval state, or operational truth

The router is registered in `server/_core/systemRouter.ts`.

### User-facing surface

`client/src/pages/goldline/ClaireDesk.tsx` now contains a collapsed **Relationship closing** section. The operator must explicitly request the preview; it is not generated on page load.

The UI states plainly that:

- the artifact is built only from eligible relationship history
- business records are preserved
- generating the preview does not delete stored history
- generating the preview does not disable future relationship context

The resulting message comes from the existing Slice 6 domain contract; this slice does not add a second prose generator.

Because `/claire` is already reachable from the relevant authenticated product hosts, one Claire surface serves the relationship-closing preview instead of creating separate Driver/Admin implementations.

## Truth / safety rules preserved

- Closing copy remains limited by Slice 6 to eligible `verified-shared` and `operator-declared` history.
- Business records remain unchanged.
- No account-deletion implication.
- No Claire consciousness/feelings claim.
- No cross-tenant/operator input surface.
- Existing assertion guard and human-approval boundaries are unchanged.
- No new relationship score.
- No diagnosis.
- No adaptive behavioral optimization.
- No fake `DEFERRED` producer.
- `operator_avoidance` remains off.

## Files changed in PR #160

- `server/claire/relationshipOffboardingRouter.ts`
- `server/_core/systemRouter.ts`
- `client/src/pages/goldline/ClaireDesk.tsx`
- this handoff

## Verification

On final PR head `683d33f86af578130119c276711c55708d9f8589`:

- Fast Goldline smoke: **success**
  - typecheck passed
  - migration proof passed
  - behavioral/campaign truth invariants passed
  - StrategyEngine live-state proof passed
  - Real Workday proof passed
  - deterministic production-browser gate passed
- DayForge release gates: **success**
- Goldline mobile regression: **success** across the full workflow, including production build/schema, business-loop contracts, DayForge, real-touch lanes, Driver shell/pixel, immersion, reality route, inhabited-adventure, and authoritative-business lanes.

No migration was added.

## Known intentional limitation

The existing Slice 6 domain contract produces a relationship-closing artifact but does **not** persist a separate “relationship continuity disabled” flag.

This slice intentionally does not pretend that previewing a closing artifact disables future memory/context. The UI says so explicitly.

If product later needs a durable opt-out that suppresses future relationship-context retrieval, build that as an explicit, self-scoped preference/state contract with clear semantics. Do not infer an opt-out from generating this preview and do not delete authoritative business records as a side effect.

## Roadmap state

Behavioral-science Slices 1–7 are now merged. There is no automatically implied Slice 8 from this handoff. Future behavioral work should be driven by a newly defined product/research objective rather than continuing slice numbers by inertia.

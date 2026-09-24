> **LEGACY DAYFORGE COMPATIBILITY:** Retained historical literals in this file are compatibility/history only; they are not current architecture. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md.

**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 2 HANDOFF — StrategyEngine live-derived snapshot

**Status: CI GREEN — Slice 2 is merge-ready on PR #155.**
**Branch:** `claude/goldline-slice-2-strategy-truth`
**Head:** `f8a70e392b2a77f61204ca55bc4ff5e497288d50`
**PR:** #155

Verified on that commit (`gh pr checks 155`): **fast-goldline-smoke** pass, **release-journey** (DayForge) pass, Goldline mobile regression jobs pass, Vercel pass. Do not treat an older red run on `67bc19a7` as current.

---

## ⚠️ Naming collision

This is behavioral-science roadmap Slice 2 (kill fake StrategyEngine state), not BUILD_BRIEF “Slice 2 — Kingdom sequence.”

---

## What is complete

Four fabricated snapshot sections are gone. Live-derived or explicitly unobserved/omitted:

| Section | Truth |
|---|---|
| `dormantEligible` | Observed paid customers, last order ≥ 30 days before snapshot `now`. Hashed id. `dormantCount` is full eligible count (truncation does not undercount). **`dormantCount` is `null` when the aggregate source is unavailable** — never a fake 0. `aggregateSource: "observed" \| "unavailable"`. |
| `repeatPipeline` | Observed first-paid-order window. `openFeedbackIssues` is **`null`** (unobserved). Summary totals are `null` when source unavailable, `0` when observed empty. |
| `funnelStages` / `limitingStage` | Observed first/repeat only. `insufficient_data` = observed empty. `source_unavailable` = source missing. Property Discovery/Approval omitted (no mapping). |
| `accounts` | Empty + unresolved. Do not invent `Captured\|Contested\|…`. |

Customer aggregates load through `loadStrategyCustomerAggregates`:

- no DB → unavailable
- `ER_NO_SUCH_TABLE` → unavailable (DayForge `dayforge_release` has no `orders`)
- other SQL errors **rethrown**
- available + no rows → observed empty

Claire `previewClairePreDrive` can finish when `orders` is absent because snapshot build no longer throws.

Integration insert uses columns from `scripts/migrate.mjs` `orders`, not the full drizzle schema (`heldRawRequestText` does not exist on `goldline_migrate_check`).

---

## Files

- `server/strategy/snapshotCustomerAggregateLoad.ts` + `.test.ts`
- `server/strategy/snapshotDormantCustomers.ts` + tests
- `server/strategy/snapshotRepeatPipeline.ts` + tests
- `server/strategy/snapshotFunnel.ts`
- `server/strategy/snapshotBuilder.ts`
- `server/strategy/snapshotTypes.ts` (`openFeedbackIssues` / `dormantCount` / `totalRecent` nullable; `aggregateSource`)
- `server/strategy/decisionPolicy.ts` (does not treat null as 0)
- tests + `goldline-fast-smoke.yml`
- this file

---

## Still fabricated (out of slice)

`opportunities`, `activation`, `capacity`, `campaigns`, `commitments`, `recentOutcomes`, `constraints`.

---

## Open product decision

`accounts[].state` mapping. Still empty.

---

## Next after merge

Behavioral-science roadmap item 3: finish assertion-guard production wiring. Not BUILD_BRIEF Slice 3.

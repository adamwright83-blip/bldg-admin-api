**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 2 HANDOFF — StrategyEngine live-derived snapshot

**Status: CODE COMPLETE — WAIT FOR CI (Fast Goldline smoke + DayForge release) BEFORE MERGE.**
**Branch:** `claude/goldline-slice-2-strategy-truth`
**Draft PR:** #155

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

## Next if CI is green

Roadmap item 3: assertion-guard production wiring. Not BUILD_BRIEF Slice 3.

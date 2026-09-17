**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 6 HANDOFF — Claire relationship / safe longitudinal history

**Status: MERGED into `main` via PR #159.**
**Branch:** `cursor/behavioral-slice-6-claire-history-723a`
**PR:** https://github.com/adamwright83-blip/bldg-admin-api/pull/159
**Base:** `main` @ `28a02e00` (Slice 5 merged via PR #158 / `6251551c`, plus post-merge handoff)
**Implementation head:** `835aff1309b06521580728ef1ab431e03dd18d99`
**Final PR head:** `701ef41de8aea54953e09ad5e662da7ebb8b21be`
**Merge commit:** `ba294db78e346649affb471272c559938f2d8a11`
**Merged at:** 2026-09-17T12:11:35Z
**CI on final PR head:** 22/22 green

---

## ⚠️ Naming collision

This is **behavioral-science roadmap Slice 6** (Claire relationship / safe longitudinal history).

It is **not** BUILD_BRIEF Slice 6, not Echo follow-up Slice 6, not StrategyEngine plays Slice 6, not laundry vertical Slice 6.

Binding: `docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md` §9.

---

## Exact objective

Longitudinal history is now assembled as labeled relationship knowledge and compiled into Claire's character-enabled generation paths, without becoming diagnosis, rewritten history, causal learning, or a second memory system.

Claire may remember: "This came up three times and you deferred it twice."
Claire may not transform that into: "You avoid outreach."

---

## Preexisting infrastructure reused (do not rebuild)

- `relationshipEmitters.ts` — G1 warmth allowlist; model cannot self-award
- `relationshipEvents.ts` / `relationshipState.ts` / `tierEngine.ts` / `compiler.ts` / `types.ts`
- Slice 3 assertion-guard / verified fact inventory
- Slice 1 behavioral ledger (optional observed counts, caller-supplied)
- Slice 5 experiment observations (caller-supplied; descriptive only)
- `humanApproval.ts` / `permissions.ts`

No new memory table. No second Claire. No migration.

---

## Files changed

- `shared/claireRelationshipHistory.ts` (+ test)
- `server/claire/character/relationshipHistory.ts`
- `server/claire/character/relationshipOffboarding.ts`
- `server/claire/character/compiler.ts` (`claire-runtime-4`)
- `server/claire/reasoning.ts`
- `server/claire/preDriveConversation.ts`
- `server/claire/slice06RelationshipHistory.test.ts`
- `server/agents/humanApproval.ts` (comment only)
- `.github/workflows/goldline-fast-smoke.yml`
- `docs/GOLDLINE-TASKS.md`
- this file

---

## History sources consumed

| Source | How |
|---|---|
| Claire relationship events | Loaded from existing store, tenant+operator+character scoped, limit 40 |
| Claire relationship state / disclosure tier | Existing fail-closed accessor |
| Operator-declared preferences | Caller-supplied; no new store |
| Observed ledger patterns | Caller-supplied counts; observational language only |
| Slice 5 experiment observations | Caller-supplied; descriptive assignment/follow-on events only |
| Claire inferences | Caller-supplied; dropped if diagnostic or superseded by a newer declared statement |

---

## Epistemic classes

Kept distinct on every retrieved item:

- `operator-declared`
- `behavior-observed`
- `verified-shared`
- `claire-inference`
- `historical-model-inference`
- `experiment-observation`

Never collapsed into generic "memory." Prompt lines are labeled `[class YYYY-MM-DD]`.

---

## Retrieval / ranking / budget

`assembleClaireRelationshipHistory` is a pure, inspectable function.

- Isolate tenant + operator (cross-scope rows dropped)
- Skip `operator_avoidance` events
- Drop diagnostic / consciousness / "works better" statements
- Dedupe by kind + entity + statement
- Newer operator-declared statements drop overlapping inferences
- Rank: topic relevance, then epistemic rank, then recency
- `CLAIRE_HISTORY_ITEM_BUDGET = 8`
- `CLAIRE_HISTORY_PROMPT_BUDGET = 5`
- Unresolved identity → `failClosed: true`, empty items

---

## Relationship-state / emission rules

Existing dimensions unchanged. G1 remains binding. Acceptance / path choice / CTA still cannot emit warmth. `operator_avoidance` is not on the warmth allowlist and has no production emitter.

---

## Production generation paths

Same compiler contract (`compileClaireContextForOperator`) is wired into:

- pre-drive brief (`writeClairePreDriveBrief`)
- pre-drive follow-up (`answerClairePreDriveFollowUp`)
- post-stop opening
- outcome confirmation (`success_review` / `failure_review` / `post_stop`)

`runClaireTurn` reaches this through `answerClairePreDriveFollowUp`.

Not dumped into:

- business interrogation (`answerClaireBusinessTurn`) — numbers-only, assertion-guard sanitization already
- encyclopedia — knowledge-seeking, not relationship memory

---

## Assertion-guard interaction

Current verified business truth outranks relationship memory. If a history item claims `scheduled` / `sent` / `queued` for an entity the inventory does not currently verify, it is reframed as `Previously recorded, not current verified state`.

---

## Slice 5 experiment-history interaction

Neutral descriptive context only (`experiment-observation`). `traitClaimFromExperimentHistory` always returns `null`. Diagnostic/"works better" text is not assemblable.

---

## Module-permission rules

`claireInterpretiveModuleEnabled` requires `explicitOperatorEnabled: true`. Observed behavior counts cannot enable executive-function / CBT / recovery language.

---

## Disclosure behavior

Existing tier/canon system. Fail closed on unresolved identity or relationship-store errors (Tier 0, empty history). History is not a reward for compliance. Personality lock / canon store unchanged.

---

## Offboarding contract

`composeClaireRelationshipClosing` — server/domain contract + tests. Uses only `verified-shared` and `operator-declared` items. `mutatesBusinessRecords: false`. No feelings/consciousness claims. Driver/Admin UI leftover is in `GOLDLINE-TASKS.md` backlog.

---

## Privacy / retention

Reuse existing relationship-event store. No transcript-dump memory table. Optional extras are caller-supplied, not a new persistence surface. No cross-tenant/operator fallback.

---

## Migrations

None.

---

## Tests

Focused proofs in `shared/claireRelationshipHistory.test.ts` and `server/claire/slice06RelationshipHistory.test.ts` cover the 25 required Slice 6 proofs, including existing assertion-guard scheduled/sent behavior.

Local: those files + compiler + relationship E2E + Slice 1/3 + generationPaths + preDrive + emitters + Slice 4/5 behavioral tests **pass**. `pnpm check` clean.

---

## Real DB integration status

No production MySQL in this environment. Relationship-loop proofs use the existing in-memory Claire store. Fast Goldline smoke now also runs the Slice 6 unit files.

---

## CI status

22/22 green on final PR head `701ef41d` (Fast Goldline smoke, DayForge `release-journey`, Goldline mobile regression including `mobile-authoritative-business` in 7m32s after the 12-minute browser timeout, Vercel).

---

## Known limitations

- Operator-declared preferences, ledger observed-counts, and experiment observations are assembled when callers supply them. Production character paths currently load stored relationship events + state automatically; they do not scan the entire behavioral ledger.
- Offboarding is a server contract, not a Driver UI.
- Shipping this slice does not earn a “works better because Claire remembers” claim.

---

## Next roadmap work

Slice 6 is merged. Offboarding UI remains backlog-only. Do not start Slice 7 from this handoff.

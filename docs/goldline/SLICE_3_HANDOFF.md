**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 3 HANDOFF — Assertion-guard production wiring

**Status: in progress on this branch.**
**Branch:** `cursor/assertion-guard-wiring-723a`

---

## ⚠️ Naming collision

This is behavioral-science roadmap Slice 3 (finish assertion-guard production wiring), not BUILD_BRIEF “Slice 3 — companion / Last Valet.”

---

## What this slice does

`server/claire/assertionGuard.ts` already existed (Guardrail G4). Slice 1 tests imported it; production generation did not. Slice 3 **does not rebuild it**. It wires:

1. `buildClaireVerifiedFactInventory` from live `ClaireDriveContext` (scheduled Field Today items verified as scheduled; outreach `sent` stays pending/draft; no invented write receipts).
2. `toPromptSection()` into `writeClairePreDriveBrief` and `answerClairePreDriveFollowUp` (system + compact JSON).
3. `lintPostGenerationStateVerbs` after LLM text in `reasoning.ts` / `preDriveConversation.ts` — violation falls back like G2.
4. Speak sanitization in `answerClaireBusinessTurn` and `runClaireTurn` `finish()`.

Empty inventory is **fail-closed**, used only when the caller has no drive context (or assembling it failed). Callers that already hold or can assemble `ClaireDriveContext` pass it through: Twilio post-stop opening, Twilio outcome confirmation, `runClaireTurn` → business + encyclopedia.

Unverified “I sent / I queued / I scheduled” claims do not reach the operator. Verified scheduled claims from Field Today are allowed to survive.

---

## What this slice does not do

- Does not enable `operator_avoidance` (Adam’s call).
- Does not invent `accounts[].state` mapping (Slice 2 leftover).
- Does not claim remaining StrategyEngine sections are live-derived.

---

## Files

- `server/claire/verifiedFactInventoryFromContext.ts`
- `server/claire/reasoning.ts`
- `server/claire/preDriveConversation.ts`
- `server/claire/businessConversation.ts`
- `server/claire/turn/claireTurn.ts`
- `server/claire/slice03AssertionGuardWiring.test.ts`
- `CLAUDE.md`, `docs/GOLDLINE-TASKS.md`, this file

---

## Next after merge

Behavioral-science roadmap item 4 (whatever the foundation names next), not BUILD_BRIEF Slice 4, unless Adam redirects.

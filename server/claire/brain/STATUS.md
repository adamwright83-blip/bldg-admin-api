# Claire Brain V2

Authority stage: **D — primary for the authorized operator** (2026-10-19).

## Production contract

- `CLAIRE_BRAIN_V2_PRIMARY=1`: Brain V2 answers **every** conversational turn for the
  authorized operator on the phone (Twilio Gather + Conversation Relay) and on the
  Claire Desk (OPEN COMMS `weeklyMission.deskComms`, and `claire.talk`).
  Entry point: `live/primaryTurn.ts` → `runClaireV2PrimaryTurn`.
- Eligibility (`live/operatorAuthority.ts`): an authorized operator **identity**
  (`CLAIRE_BRAIN_V2_OPERATOR_IDS`, default `OWNER_OPEN_ID` + `adam-admin`/`adam`)
  **and** a verified owner/admin/operator membership in the conversation's own tenant.
  No tenant literal: `default` and `laundry_farm` both qualify. Readers always run as
  the conversation's tenant, so tenant data authorization is unchanged.
- Legacy Claire (`runClaireTurn`) does not answer. It observes read-only in the
  background (`live/legacyShadow.ts`): only its Brain V3 interpreter runs, after V2
  has answered, never awaited, on copies of the text. Comparisons are written to
  `claire_generation_logs` (`answerPath = 'legacy_v1_shadow'`) and logged as
  `[ClaireLegacyShadow]`. Kill switch: `CLAIRE_V1_SHADOW=0`.
- **Emergency rollback:** `CLAIRE_BRAIN_V2_PRIMARY=0` returns both surfaces to the
  previous routing (guarded `CLAIRE_BRAIN_V2_LIVE` lanes + legacy). There is no
  silent per-turn fallback to legacy: a V2 failure is answered by V2's own recovery line.

## What V2 owns on a primary turn

1. Voice thought assembly (same hold rules as before).
2. Interpretation: deterministic perception + **semantic perception**
   (`perception/semanticPerception.ts`, Claude Haiku 5.5, closed enums, ~1 s). It may
   reclassify the kind of turn (fact / judgment / briefing / personal / small talk /
   leave-taking); it can never mint work, grants, pending bindings or entities.
3. Every decision: retrieval, business facts, prior-claim rechecks, ordered-query
   follow-ups, strategic frames, Day Line propose/commit/confirm/reject, call control,
   weekly-planning intent, and which organ speaks.
4. Composition: decisive turns (facts, clarifications, refusals, prior-claim verdicts,
   actions, call control) speak V2's own plan. Judgment, strategy, briefing and
   personal turns are phrased by Claire's guarded speaking organ
   (`answerClairePreDriveFollowUp`) from **V2's frame, V2's evidence and V2's
   conversational mode** — the organ no longer re-detects the turn. Composed speech
   may not name a dollar figure or percentage V2's evidence does not license.

## Reused services (executors, not deciders)

Grant-bound Day Line / briefing adapter; weekly planning session service; the
showrunner conductor for scheduled morning-readiness / evening-debrief calls and Desk
planning (V2 routes only agenda turns to it); Daphne V2 ingestion, explicit preference
capture, consent-filtered operator memory (`loadDaphneClaireGuidance` honours
`memory_recall` / `adaptation_enabled`); progression disclosure commit; assertion
guard and claim receipts; xAI / Relay speech.

## Still outside V2 (explicit, not hidden)

- Operator mission commands and "text me that" artifact requests are recognized by
  their deterministic grammars **before** V2 on the phone (unchanged utilities).
- The call's opening line (inbound greeting, outbound brief) is generated before any
  turn exists.
- Weekly-planning callback scheduling from the invite ("call me at 8 tonight") is not
  ported; V2 begins or declines the week.
- Daphne conversation ingestion is tenant-gated (`DAPHNE_V2_CONVERSATION_INGESTION_TENANTS`);
  Claire progression is tenant-gated (`CLAIRE_PROGRESSION`).

## Invariants

```
EVERYTHING MAY INFORM.
ONLY EXECUTIVE FUNCTION MAY DECIDE.
```

No mutation without a branded live ExecutiveActionGrant executed once by an adapter.
Legacy observation is one-way and can never affect a live turn.
Synthetic evidence may not enter authorized operator evidence.
Narrative / personal state may not manufacture business truth.
Do not initiate synthetic calls to the real operator phone.

Acceptance: `tests/primaryTurn.test.ts`, `tests/primaryOrgans.test.ts`,
`tests/claireV2Primary.mysql.integration.test.ts` (real phone + Desk path, disposable MySQL).

# Claire work ledger — handoff (2026-10-16)

PR: https://github.com/adamwright83-blip/bldg-admin-api/pull/604 (draft, branch `claude/claire-work-ledger`, base `main`).
The branch sits on top of `antigravity/claire-daphne-repair-verification` (bdb279a0), which sits on `codex/claire-repair-verification`.
Do not merge. ChatGPT is the merge gate.

## Root cause (verified from production logs and MySQL, conversation 86279c0b, 2026-10-15)

Five Day Line writers each read one utterance in isolation:

1. The Brain V2 live grant (`CLAIRE_BRAIN_V2_LIVE=1` in prod) → `grantBoundLegacyAdapter` → the regex `parseBriefingDeterministically`.
2. The voice commitment loop ("quantity 1. Say yes or no.").
3. The briefing commit, which saved ad copy to tomorrow.
4. `explicitDayLine.refersToPriorWork`, where "everything" swept every prior sentence into 7 fragment tasks.
5. The scheduled-call dispatch.

The dry-cleaning orders were never saved. The existing tests drove `runClaireTurn` directly, so the prod V2 path was never exercised.

## What PR #604 does

- `server/claire/workLedger/`: one planner per operator turn (default `claude-haiku-5-5`, override `ANTHROPIC_MODEL_CLAIRE_WORK_LEDGER`).
  - It sees the whole conversation, the Day Line with ids, and the work it is holding.
  - It returns the full next state: held items with a `save` flag, edits, moves, completes, removes, and confirms.
  - The server validates the plan, writes it through the existing Day Director writers, reads it back, and speaks only what the readback shows.
- Wired into `runAuthoritativeClaireVoiceTurn` (Relay and Gather, inbound and scheduled) and into desk `talk`.
  - Non-work turns go to V1 with `state.workLedgerOwnsDayLine` set, so the legacy writers are off.
  - V2 is bypassed.
  - The showrunner gets the ledger prompt section and makes no replans.
- Kill switch: `CLAIRE_WORK_LEDGER=0`.
- Product decision (Adam, 2026-10-16):
  - Clear commitments auto-save.
  - Ambiguous or hypothetical work is held.
  - Requests for Claire to act externally (text, charge, call) go to the V1 action path, never to the ledger.
  - Corrections edit existing items.
- Also in the PR:
  - Call continuity: Claire knows her own scheduled call just dropped.
  - Daphne relationship observations from operator signals.
  - Natural debrief and morning openings.
  - Silent short calls are not transcribed.
  - `ANTHROPIC_MODEL_CLAIRE_BRAIN_V3` knob, default unchanged. Haiku 5.5 disagreed with Sonnet on 5 of 22 V3 turns.
  - Fixed the antigravity branch's typecheck and several broken tests.

## How to verify

- Unit tests: `pnpm vitest run server/claire server/agents/daphne server/_core`. About 2390 pass.
- Typecheck: `pnpm check`.
- In-memory real-model replays (6 scenarios):
  `railway run -- env DATABASE_URL= CLAIRE_WORK_LEDGER_LIVE=1 pnpm vitest run server/claire/workLedger/workLedger.live.test.ts`
- Production Relay path against disposable MySQL (Oct 15 call, evening debrief, morning call):
  1. `docker run -d --name claire-ledger-mysql -e MYSQL_ROOT_PASSWORD=test-only -e MYSQL_DATABASE=claire_ledger_test -p 3307:3306 mysql:8.0`
  2. `DATABASE_URL=mysql://root:test-only@127.0.0.1:3307/claire_ledger_test node scripts/migrate.mjs`
  3. `railway run -- env DATABASE_URL=<same> ALLOW_TEST_DB=1 CLAIRE_WORK_LEDGER_LIVE=1 pnpm vitest run --config vitest.integration.config.ts server/claire/workLedger/workLedgerCall.live.integration.test.ts`
- Debug a plan: set `CLAIRE_WORK_LEDGER_DEBUG=1` to log the planner input and output.

## CI status at ea5b4049 (before the last commit)

These checks fail. Root cause of each:

- **Claire conversation integrity**
  - My integration test failed because `JWT_SECRET` was missing in CI. Fixed in the workflow in the last commit.
  - `conversationIntegrity.mysql` "content replacement" was broken by antigravity: it used `reviseBriefing(...).items` where the function returns `.parsed`. Fixed in the last commit.
- **Legacy compatibility release gates**
  - `claireReliabilityVerification.test.ts` was broken by antigravity because CI exports a `DATABASE_URL` before migrating. Made hermetic in the last commit.
  - The `claireTwilioAnalytics` honest-failure case. Fixed in the last commit.
- **Claire strategic preparation**
  - `strategicJourney` and `strategicReleaseAcceptance` mysql tests fail identically on `main` (8acc176), on the codex tip and on the antigravity tip.
  - So this is pre-existing and not caused by this PR, and it is still unfixed.

## Unresolved issues / next steps (in priority order)

1. Confirm CI is green on the latest push. Fix the pre-existing strategic-preparation failures, or ask Adam or ChatGPT to accept them as known.
2. No live phone test yet (no Twilio credit). After merge and deploy, watch Railway logs for `[ClaireWorkLedger]` events: handled/latency/refused, plus "empty work plan".
3. Haiku 5.5 can't run at temperature 0 and occasionally returns an empty plan.
   - Mitigated with one retry plus a hand-back.
   - Consider `claude-sonnet-4-6` at temperature 0 if production shows misses. It passed the same scenarios at 3.7–7.4 s.
4. Non-work turns still take about 6 s (Brain V3 on Sonnet, then generation). Candidate fixes: Haiku for V3 after a larger agreement eval, or streaming.
5. The showrunner (scheduled calls) still writes "developments" and proposals.
   - The morning opening showed junk from earlier replays: "Waiting on your approval: Follow up: operator", "Since yesterday: operator: Operator wants to…".
   - Audit `replanFromShowrunnerCall` and the development capture now that the ledger owns work.
6. Timing labels: "at 11" said after 11 AM becomes "11 PM" via `parseTiming`. Consider keeping the operator's words verbatim.
7. Moved items are re-created through `commitBriefing`, so a title over 8 words gets compressed ("…Instagram ad" → "…Instagram").

## Daphne MRT follow-up (separate session `local_2740555f`, task "Wire Daphne's MRT framing into a real decision point")

- **Finding (verified):** `assignDaphneMrtMissionFraming` (`server/agents/daphne/missionFramingExperiment.ts`) has no runtime caller.
  - `loadDaphneClaireGuidance` takes an optional `mrtExperiment` that nobody passes.
  - No assignment or outcome is recorded anywhere.
  - Daphne therefore cannot learn which mission presentation works.
- **What's needed:** call it at the real presentation decision point (Day Director / mission presentation).
  - Persist each assignment with decisionPointId, availability, eligibleOptions (including STANDARD_PRESENTATION), assignedOption, assignmentProbability, the policy and definition versions, and the outcome window.
  - Join started, skipped and completed outcomes back to the assignment.
  - Feed the joined outcomes into the next assignment or presentation.
  - Requires `safe_experimentation` consent.
  - Follow `docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md` §§4–7, and never weaken §2.
- **Done in #604 for Daphne:** ledger operator signals become `daphne_observations` (relationship_event, sourceType `claire_work_ledger`).
  - Verified: they appear in the next call's Daphne guidance (corrections, boundaries, ruptures).

**Update:** the MRT follow-up is now draft PR #605 (https://github.com/adamwright83-blip/bldg-admin-api/pull/605).
- It records decisions, joins ops-task and campaign-chapter outcomes back to them, lets the fatigue gate change the next occasion, and adds a per-arm report.
- Not live yet: there is no consent UI and the MRT flag is off.
- When this note was written, its CI was still running.

# Claire / Daphne / Mitch repair plan — 2026-10-20

**Status:** binding execution plan, written by Claude (Fable 5.1) for execution by cheaper sessions. Every design
decision below is already made. An executing session does not reopen them; it implements, tests, and reports.
Where a decision needs Adam, it is listed in §9 and nothing else blocks on it.

**Read first:** `ARCHITECTURE.md`, `docs/JOYSTICK_SYSTEM_MAP.md`, `docs/claire-daphne-convergence/PRODUCT_CONSTITUTION.md`,
`docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md`, `docs/goldline/EARNED_RAPPORT_DISCLOSURE.md`,
`docs/goldline/CLAIRE_TRUTH_PROVENANCE.md`, `server/claire/brain/README.md`.

---

## 0. The thesis, in one paragraph

JOYSTICK is a playable operating system for a real business. Claire owns WHAT and WHY: she is the talking bible of the
business (every fact with a receipt), the strategist (macro goal → bottleneck → the one Mission or Challenge that moves
it → Day Line), the operator's runner (calls before they wake, holds the line, debriefs), and the game master (knows
every Kingdom, level, companion and chapter and where the operator stands). Daphne owns HOW and WHEN for this human:
she learns what makes this person start, selects timing, channel, framing, task size and, eventually, which approved
experience, at logged decision points, without ever touching business truth or diagnosing. Mitch is the supply side:
he produces genuinely different, reusable experiences through bounded work orders, independent QA and Adam's creative
acceptance, so Daphne has something to personalize. The Reality Bridge keeps all three honest: the game never creates a
business fact. Launch order: Claire first, Daphne second, Mitch's pipeline third, then one shared integration test.

## 1. Evidence base (verified 2026-10-20, read-only prod MySQL + Railway logs + source at main 820f7a72)

Production call audit, every call since 2026-10-13. Defect → turn → cause:

| # | Defect | Where seen | Cause (file) |
|---|---|---|---|
| D1 | "What do you want me to do tomorrow?" answered with a raw Day Line row dump + 5 limitation sentences | 10-20 evening, turn 13 | `broad_briefing` ∉ `FACT_INTENTS` (`brain/live/primaryTurn.ts:193`) → showrunner → `answerClaireBusinessTurn` → `analyzeBusinessData` generic row speaker (`showrunner/showrunnerTurn.ts:311`, `analytics/analysis/analyzeBusinessData.ts:488`) |
| D2 | Dictated example of how Claire should speak recorded as operator's commitment; "which three buildings?" asked 3× | 10-20 evening, turns 16–21 | perception `report_or_narration`/`work_instruction`, no grant; evening_debrief prompt is an interview (`showrunnerTurn.ts` systemPrompt) |
| D3 | "You should already know them… needs to be coded" → "I can't freshly verify that claim" + "That is what you intend to do" | 10-20 evening, turn 23 | semantic perception `challenge_prior_claim` because a receipt existed; `brain/executive/integrate.ts:290`; `response/cognitiveAcknowledgement.ts:21` |
| D4 | No game awareness at all | every call | nothing under `server/claire/brain/**` or `showrunner/showrunnerBriefing.ts` reads `goldline_kingdoms`, Day 1 Ten Doors outcomes, `goldline_domain_progression`, companions, chapters |
| D5 | Goal never stated unless forced; "Do you remember what my goal is?" → "No. What else?" | 10-19 evening turn 13; 10-20 evening | evening opening omits objective (`showrunnerBriefing.ts:324` morning only); V2 goals compartment reads board obligations not `operator_macro_goals` (`brain/goals/adapter.ts`); "remember my goal" perceived as personal lane → authored decline |
| D6 | "I love you, Claire" → "No. What else?"; "I want your encouragement" → "That's not something I get into" | 10-20 morning; 10-19 evening | personal lane → rapport-0 authored declines (`progression/authoredDialogue.ts:64-66`). Design rule: advances MUST be deflected, but smoothly; encouragement is a work request |
| D7 | Same agenda question repeated 3× | 10-20 evening turns 5/7/9 | fragment holder releases each fragment (`turn/claireTurn.ts:540,564`); conductor re-asks unanswered agenda question every turn |
| D8 | Duplicate stops read aloud ("The Louise, Los Feliz Towers, The Louise Los Feliz…"); "Jojo Test" on prod Day Line | 10-19, 10-20 | two living-world follow-ups for Los Feliz Towers; The Louise + The Louise Los Feliz same building; test row in `day_director_commitments` |
| D9 | Junk Day Line titles from chopped fragments ("Figure out how to get out in streets", "Fold service in person to people and try", "Before I leave work, I have to create new page…") | 10-15, 10-19 | fragment committed as title; readback "Done. 2 on today's line." |
| D10 | Four open "Call Dana" commitments (09-21, 09-22, 09-29, 10-13); Louise "N days overdue" opens 4 calls incl. Saturday evening | 10-13 → 10-20 | no open-item lifecycle; no yes/no close question; no weekend rule |
| D11 | Standing instructions lost: "encouragement on every call", "ask me on the Sunday 5–7 call", "that's on me to fix" | 10-13, 10-18, 10-19 | only raw `daphne_observations` rows; no instruction store; `claire_operator_doctrine.rulesJson` is 8 numeric knobs |
| D12 | Promise not kept: "Tomorrow morning I'll have the open property visits ready so you can choose" | 10-19 → 10-20 morning | opening builder has no prepared-item input |
| D13 | Talked to voicemail 9× over 19 turns | 10-19 morning (session 453795a2) | AMD fields ARE passed (`claireTwilio.ts:1669,1872`); interactive path still ran; no in-conversation voicemail recognition |
| D14 | "I didn't have enough to state that as fact" ×2 in reply to "what did you say?" | 10-18 evening_planning | repeat request routed to prior-claim verification (`provenance/claimReceipts.ts:436`) |
| D15 | "I couldn't verify that action completed…" ×3 incl. in reply to "Yes." | 10-13 | `brain/live/grantBoundLegacyAdapter.ts:229` reached on non-action turns |
| D16 | Claire speaks twice in a row ("Go ahead, I'm listening." 3–10 s after her own reply) | 10-15 pre_drive turns 23/24, 28/29 | relay silence prompt `claireTwilio.ts:2208` timed from operator's last utterance, not Claire's delivery |
| D17 | 18 sessions since 10-01 never closed (pre_drive, evening_planning, morning_reconciliation at `in_progress`) | prod | only scheduled calls complete sessions |
| D18 | Week objective flipped "maximize sales in Silver Lake" (10-17/18) → "Get to 50 active customers" (10-19) | morning openings | Daphne `operator_declared_goal` (10-10) fed the weekly proposal objective; macro goal is the real one |
| D19 | Rapport band 0 / rung 0 after a month; 2 progression evidence rows ever; 0 entitlements; last relationship event 10-12 | `claire_progression_grants`, `claire_progression_evidence` | growth-action evidence sources are debrief-confirmed field visits (`recordConfirmedVisitEvidence`, called only at `claireTwilio.ts:2543`) and completed `commercial_follow_ups`; Day 1 Ten Doors pitches (3 of 5 recorded) never reach progression (INFERRED; confirm in W4) |
| D20 | Daphne: 0 interventions, 0 outcomes ever; ingestion = ~7 exact regexes (1 row in 14 days); `response_detail=0.2` since 10-09 | `daphne_*` tables | no runtime decision-point caller; `agents/daphne/conversationIngestion.ts` |
| D21 | Experience selection never runs; no taste model; marquee levels not selectable | `goldline_fiction_assignments`=3, `behavioral_ledger_events`=7 | `behavioralExperiment/presentationRuntime.ts` gated on `safe_experimentation` consent never granted; person model `dimension` is a free string; Silver Lake / Beverly Hills / CHANNEL 382 / Colosseum / CPE hard-bound to work kind |
| D22 | Mitch has never shipped: 3 work orders FAILED 10-07 "Claude Code exited 1: " (empty stderr), 0 builds, 0 QA, 0 deliveries; 1 milestone blocked on Adam | `mitch_*` tables, GitHub runs | `scripts/mitch-github-agent.ts:254` runs `npx @anthropic-ai/claude-code@2.1.114 --model claude-sonnet-4-6` (retired id) through an OIDC proxy; failure JSON goes to stdout, which is not logged |

Prod read procedure (read-only): `railway variables --service MySQL --json` → `MYSQL_PUBLIC_URL`; connect with `mysql2`
from a script that `createRequire`s the repo's `package.json`; `SET SESSION TRANSACTION READ ONLY`. Session timestamps
are PDT-as-UTC (+7h). Tables: `claire_conversation_sessions` → `claire_conversation_turns` (by `sessionId`) →
`claire_generation_logs.answerPathDetailJson` (v2 lanes/intent per turn) → `claire_conversation_states` (id
`claire-call:<conversationId>`, holds the showrunner briefing and claim receipts).

## 2. Workstreams, order, model, session

Max **3 sessions in parallel**. Mechanical workstreams run on `claude-sonnet-5-5`; judgment-heavy on `claude-opus-5-5`.
Existing sessions already hold their briefs; resume them with "resume per docs/goldline/CLAIRE_DAPHNE_MITCH_REPAIR_PLAN.md §W<n>".

| Order | Workstream | Session (existing id) | Model |
|---|---|---|---|
| 1 | W1 Claire leads (D1–D5, D7 partial, D18) | `local_397b871d-5df2-44d1-a78e-02a825acecc3` | opus |
| 1 | W2 Call hygiene (D6, D13–D17) | `local_3cec221e-2831-4441-9d09-bdc66e2ebf2c` | sonnet |
| 1 | W3 Day Line hygiene (D8–D10, credit kind) | `local_bcfed9df-49dd-4aa2-8412-846b0318e7b1` | sonnet |
| 2 | W4 Rapport evidence pipeline (D19) | `local_179ed6e1-9aa3-4dee-8177-a1497d31e809` | opus |
| 2 | W5 Standing instructions + promise ledger (D11, D12) | `local_b5854c5f-8d05-4238-aa43-a3091ae5d8f7` | sonnet |
| 2 | W6 Daphne decides + honours explicit preferences (D20, D21-prefs) | `local_48a0488b-d1fd-4ad6-94db-3421fcd99824` | opus |
| 3 | W7 Mitch bounded executor proof (D22) | new | sonnet |
| 4 | W8 Second experience for property visits (D21-library) | new, after W7 + §9 brief | opus |
| 5 | W9 Shared integration test | new, after W1–W6 | opus |

Each workstream = one PR against `main`, its own worktree, tests that replay the real utterances, `npx tsc --noEmit`
clean, full `npx vitest run` compared to the known baseline (~190 pre-existing failures on main as of 2026-10-17; never
count those, never fix them in these PRs). PR description lists the D-numbers closed and the prod session ids used.

## 3. Shared design decisions (apply everywhere)

- **One decision kernel.** All new behaviour goes through Brain V2 (`server/claire/brain/`) grants and readers, or the
  showrunner conductor. No new router, planner, or "mini brain".
- **Speech never claims a write that did not happen.** Readbacks name the items added this turn (title + date); counts
  are a trailing aside at most. `lintPostGenerationStateVerbs` stays on every path.
- **Authored dialogue is human-only.** Sessions may route to existing registry lines and may add empty slots with ids;
  they never write Claire lines. List needed lines in the PR for Adam.
- **One goal.** The headline objective is the operating mandate's `leadingOutcome` (`shared/operatingMandate.ts:325`),
  which resolves to the confirmed primary or the sole active outcome. The macro goal in `operator_macro_goals` is the
  outcome; a Daphne `operator_declared_goal` is a `focus`, never the headline. Adam records the `primary_outcome`
  mandate decision once (§9); until then `sole_outcome` already yields the macro goal when Daphne's goal is filed as focus.
- **Reported vs verified stays separate** in every new row and every spoken sentence.
- **No new bare DayForge names.** Nomenclature guard untouched.
- **Flags:** anything that changes what the operator hears on the phone ships behind a flag defaulting OFF unless it is
  a pure defect fix (D1, D3, D7, D13–D17 are defect fixes and ship ON).

## 4. W1 — Claire leads (opus)

**Goal:** on any scheduled call, "what should I do / what do you have for me tomorrow / today" produces a plan, not an
interview; Claire names the goal and the game position unprompted.

Decisions:
1. **Game-master reader** `server/claire/brain/businessMemory/gameMasterView.ts`: returns `GameMasterView` =
   `{ kingdoms: [{kingdomId,title,status,sequence}], day1TenDoors: {targets:[{id,name,outcome|null}], remaining:[ids]} | {record:"none"},
   domainProgression: [...] | {record:"none"}, companions: [...] | {record:"none"}, chapters: [...] | {record:"none"},
   hiddenGames: [...] | {record:"none"} }`. Sources: `goldlineKingdoms/kingdomUnlocks.deriveKingdomStatuses`,
   `openChannel/day1TenDoorsService.getDay1TenDoorsMissionReadOnly` + `goldlineProgression/colosseumKingdomBinding`,
   `goldlineProgression/progressionStore`, `companions/companionService`, `goldline_chapter_states`,
   `hidden_game_chapter_unlocks`. Read by the signed-in openId; comment the driver-id split (`1`, `driver-primary`,
   `adam-admin`). Evidence item type `game_state`, `authoritativeFor: ["current_business_truth"]`, `operatorVisible: true`.
   Add `"game_state"` to `BUSINESS_TRUTH_TYPES` in `integrate.ts`. Also attach the same view to `ShowrunnerBriefing.gameState`.
2. **Macro goal evidence**: in `brain/goals/adapter.ts` add a reader for the operating mandate `leadingOutcome`
   (`planning/operatingMandate/loadOperatingMandate.ts`) plus `macro_goal_runs` baseline/current; emit one
   `goal_recommendation` item (the objective) and one `business_query`-typed item carrying the figures so the judgment
   may speak them. "No verified current count" is spoken when the run has none.
3. **Lead composition** in `primaryTurn.ts`: a new branch BEFORE the showrunner branch: if `state.showrunner` and
   (`intent === "broad_briefing"` or `semanticReading.turnKind === "daily_briefing_request"` or
   `business_judgment_or_strategy` with a tomorrow/today reference) → build `LeadBrief` (goal + distance, open Day Line
   deduped, game-master view, candidate buildings from day work) → composed organ with `conversationalModeOverride:
   "operational"` and a `semanticFrame.act = "advice_request"` → speech = goal, one first action, named candidates, the
   game move, then an explicit offer to place it on the Day Line through the existing `propose_day_line` grant path on
   a plain yes. Never call `answerClaireBusinessTurn` for this intent on a scheduled call.
4. **Perception**: in `perception/semanticPerception.ts` add turn kinds `role_feedback_or_example` (operator dictates
   how Claire should speak, addresses Claire as "you" with an imperative, or says "you should be saying…") and
   `repeat_request`; `applySemanticReading` maps `role_feedback_or_example` → no commitment, no action, `dialogueActs:
   ["correction"]`, and `challenge_prior_claim` only when the utterance disputes the receipt's content (the classifier
   returns `disputesContent: boolean`). "remember my goal / what is my goal" → `business_fact_question`.
5. **No re-ask**: `ShowrunnerCallState.askedAgenda: string[]`; the conductor prompt gets the list; deterministic guard
   drops a model reply whose question normalizes to one already asked twice.
6. **Fragment folding**: in `assembleV2Thought`, a release that starts with `And|On|So|Also|Plus` arriving ≤ 6 s after the
   previous released operator turn is appended to it (one extra hold, within `CONTINUATION_MAX_HOLDS`).
7. **Dedupe before speaking**: `driverDayLineCall.ts` and the opening builder collapse stops by normalized title and by
   building address.
8. **Scheduled-call openings** (both morning and evening) say the goal first, then the one move. Evening: goal →
   "tonight I need two things from you" → open items as a single deduped line.

Acceptance (brain-level test, `brain/tests/claireLeads.replay.test.ts`, replays the 2026-10-20 evening call
utterances with stubbed readers): goal named before the operator raises it; the briefing request yields a plan naming
≥1 building and the Kingdom 1 move ("Wilshire Vermont or The Chadwick, two left for the Colosseum"); the dictated
example creates no commitment and no "which three"; the "needs to be coded" turn is not a correctness challenge; no
Claire sentence repeats within the call; a stage with no record is spoken as "no record"; the Day Line offer is a
question and nothing is written without a yes.

## 5. W2 — Call hygiene (sonnet)

1. **Voicemail** (D13): recognise greeting/IVR phrases in the operator slot ("you've reached", "leave a message",
   "press 1/2/3", "maximum time permitted", "message has been sent"); on an outbound scheduled call speak at most one
   bounded line and end with `completionReason: "voicemail_detected"`; log `AnsweredBy` on the AMD webhook.
2. **Advances** (D6): perception act `romantic_or_personal_advance`; executive answers with the current rapport band's
   authored `decline` + an authored `business_pivot` ("That's not something I get into. Now, the work."), records the
   advance in `claire_personal_ledger` (kind `advance_declined`), never a warm acceptance. Add empty registry slots
   `decline_r{0,1,2}_advance_*` for Adam. "I want your encouragement" and "do you remember my goal" never reach the
   decline registry (route: work request → composed organ; W5 defines encouragement).
3. **Repeat request** (D14): `repeat_request` act re-speaks Claire's previous turn verbatim from `state.history`.
4. **Execution-failure line** (D15): `brainV2ExecutionFailureResult` only when a grant executed and threw; the no-grant
   path can never reach it; the line names what was attempted.
5. **Double speak** (D16): silence prompt timer starts at Claire's delivery completion; never within 8 s of a Claire
   turn; never twice consecutively.
6. **Session lifecycle** (D17): inbound/pre_drive/evening_planning/morning_reconciliation sessions get `endedAt` +
   `completionReason` on hangup, relay close, or 30-min idle; document (not migrate) how to close the 18 stale rows.

Acceptance: six unit tests replaying the real utterances; voicemail test asserts ≤1 Claire line after recognition.

## 6. W3 — Day Line hygiene (sonnet)

1. **Title gate** before any commit (`briefing/briefingCommit.ts`, `workLedger/workLedgerApply.ts`, V2 grant adapter):
   reject raw-fragment titles (leading conjunction/pronoun, no verb-object, <3 meaningful words); model rewrite into an
   imperative title with the operator's words kept in `objective`; if not confidently grounded, ask one question.
2. **Credit kind** (10-15: "record this as a marketing challenge so I get credit"): committed items carry the declared
   `executionType` (`mission` | `challenge` | `hybrid`) and the readback names it and the title.
3. **Duplicate writers**: living-world follow-up creation idempotent on (account, kind); briefing collapses by building.
4. **Open-item lifecycle**: one item across dates with its age; agenda question is yes/no ("Did you call Dana?");
   "drop it / never talk about it again / not this week" closes or snoozes through the governed path with readback;
   overdue sales follow-ups are not raised Sat/Sun unless asked (standing rule from W5 when it lands; hard-code the
   weekend default until then).
5. **Test-data guard**: `/\btest\b/i` titles never reach a production briefing.
6. `scripts/dayline/close-duplicates-2026-10.md`: which of the four Call Dana rows to keep, which three junk rows and
   "Jojo Test" to close, with exact ids; not executed by the session.

## 7. W4 — Rapport evidence pipeline (opus)

1. Trace every emitter in `server/claire/progression/evidenceSources.ts`, `service.ts`, and the only
   `recordConfirmedVisitEvidence` call site (`claireTwilio.ts:2543`). Expected finding (INFERRED, must be VERIFIED): the
   Day 1 Ten Doors pitch outcomes and the showrunner debrief's `missionUpdates` never call the progression service, and
   the V2 primary path never reaches the legacy debrief hook that did. Report VERIFIED/INFERRED/UNKNOWN per source.
2. Wire the missing feeds through the governed path: a recorded Day 1 pitch outcome = one `growth_action`
   (`field_visit_outcome`, sourceType `day1_ten_doors`, sourceId target id); a debrief-confirmed `done` mission update on
   a field item = one growth action; keep the existing business-progress sources. No call-volume evidence, ever.
3. Idempotent backfill module with `--dry-run` that re-derives evidence from authoritative sources for one operator.
4. MySQL integration test seeding an October-shaped month asserting band/rung movement per `policy.ts` (band 1 = 3
   actions on 2 days; rung 1 = 5 actions on 3 days + 1 progress event) and one minted entitlement. If thresholds make a
   real October insufficient, report the numbers; do not lower thresholds.
5. Admin-only read procedure showing band, rung, evidence by kind, last 20 rows.

## 8. W5 — Standing instructions + promise ledger (sonnet)

1. Table `claire_operator_instructions` (tenantId, operatorUserId, kind ∈ {standing_rule, scheduling_rule, credit_rule,
   role_feedback, encouragement}, text, sourceConversationKey, sourceTurnId, status, createdAt). Captured when the
   operator states a rule about Claire's behaviour; readback only after the row is read back. Every call's prompt
   (conductor system prompt, composed organ, opening builder) gets `OPERATOR STANDING INSTRUCTIONS`.
2. Promise ledger: `claire_prepared_items` (what Claire said she would have ready, for which business date, payload);
   the opening builder consumes and speaks it; the post-generation lint blocks "I'll have X ready / I'll keep X in
   front of you" unless a prepared item was written. Implement the property-visit case end to end.
3. `role_feedback` rows ("that's on me to fix") surface on Claire Desk and in the next call's prompt as an obligation.
4. Encouragement = one grounded sentence tying the next move to the goal (the 10-19 "Fifty is attainable if you count
   buildings" line is the model), honoured by the composed organ when an `encouragement` instruction is active.

Fixtures: the three real instructions (10-13, 10-18, 10-19). Test: next-call prompt carries them; Sunday rule obeyed.

## 9. W6 — Daphne decides and honours explicit preferences (opus)

1. **Decision points** behind `DAPHNE_V2_DECISION_POINTS=1` (default off): morning "first action" and evening
   "tomorrow's move". Options: `plain_instruction`, `implementation_intention` ("when X, you will Y"), `choice_of_two`.
   Selection by `responseModel` when it has support, else uniform random; row in `daphne_interventions` with
   `decisionPointId`, eligible options, chosen action, probability, policy version, outcome window (declared before
   outcome). Proximal outcome in `daphne_outcomes`: started within window, from Day Line / field evidence only.
2. **Ingestion**: bounded Haiku classifier (pattern: `brain/perception/semanticPerception.ts`), closed enum
   {declared_goal, standing_instruction, scheduling_rule, credit_request, motivational_preference, rupture, repair,
   none}; deterministic rules as fallback; keep the mental-health and quoted/hypothetical exclusions. Replay test on
   the three real utterances.
3. **One goal** (D18): weekly proposal and openings read `loadOperatingMandate().leadingOutcome`; Daphne declared goals
   are filed as `focus` sources. Test: both exist → opening names the macro goal.
4. **Motivational dimension registry**: `DAPHNE_PERSON_DIMENSIONS = ["suspense","comfort","humor","exploration",
   "competition","companionship","creative_production","tactical_problem_solving"]`; `assertDaphnePersonDimension`
   enforces it. At launch dimensions are **explicit only** (operator states them, or picks on Claire Desk); no inference.
   Stored as `direct_fact` claims with source utterance.
5. **Consent separation**: `adaptation_enabled` governs honouring explicit preferences; `safe_experimentation` governs
   randomized assignment. Never require the second for the first.
6. **Continuity rule** at every experience/presentation decision point: an experience with recorded progress (e.g. Day 1
   outcomes 3/5) is never switched; explicit operator choice wins; selection happens only at a new-campaign boundary.
7. **Preference audit**: document what `response_detail=0.2` does (`agents/daphne/claireAdapter.ts`) and expose active
   preferences with source utterance on the card; do not change the value.
8. Admin read procedure: card, goals, preferences with sources, intervention/outcome counts, last 20 observations.

## 10. W7 — Mitch bounded executor proof (sonnet)

1. Diagnose "Claude Code exited 1: " (empty stderr) in `scripts/mitch-github-agent.ts:283`: log the last 1500 chars of
   **stdout** on nonzero exit (the CLI prints JSON errors to stdout). Suspects in order: (a) `MITCH_CLAUDE_MODEL=
   claude-sonnet-4-6` is a retired id → set `claude-sonnet-5-5` in `.github/workflows/mitch-claude-executor.yml:61` and
   the script default; (b) `@anthropic-ai/claude-code@2.1.114` pin too old for the proxy/auth → bump to a current pin;
   (c) OIDC model proxy (`server/mitch/mitchGithubOidc.ts`) token exchange.
2. Register nothing new; use the existing canonical game `kingdom.boreslay` with a **trivial bounded work order**
   ("add one deterministic unit test for Boreslay duel scoring") that cannot touch the blocked real-business-binding
   milestone. Run dispatch → implementation handback → independent review → Adam acceptance in the control plane
   (`https://mitch-producer-production.up.railway.app`, issue #370).
3. Done = one `mitch_builds` row, one `mitch_qa_runs` row, the reviewer handback recorded, and Adam's acceptance pending
   in the UI. Report exact run ids. Do not start W8 until this passes.

## 11. W8 — Second experience for property visits (opus, after W7 and the §12 brief)

Kingdom 1 (Colosseum) is the suspense arm for Greystar visits. Build the cozy/exploration arm for the SAME five targets
and the SAME evidence rules (Day 1 Ten Doors outcomes). Register it as a canonical game in the Kingdom registry, bind it
through `kingdom_binding.*` to the same lead-hunt definition, produce it through Mitch (work orders, QA, acceptance), and
register both arms in the selectable catalog keyed by work kind `property_visit` with `STANDARD_PRESENTATION` as the
baseline arm. The re-skin test from `docs/goldline/FICTION_PACKS.md` is the done condition: change only the binding,
nothing in Mission Director, evidence, or business truth changes.

## 12. W9 — Shared integration test (opus, after W1–W6)

`server/claire/brain/tests/joystickLoop.integration.test.ts` (disposable MySQL): seed macro goal, Day 1 outcomes 3/5,
an explicit `comfort` dimension for operator B and `suspense` for operator A, no research consent for either.
Assert, per operator: Claire's morning opening names the goal and distance, the Kingdom 1 position and the next real
move unprompted; Daphne's decision point selects a presentation consistent with the explicit dimension, records the row
with probability and policy version, and never switches an in-progress experience; a verified Day 1 outcome updates game
state through the Reality Bridge; the outcome row is `reported` until verified; no causal claim anywhere. Until W8 lands,
the two operators receive different *presentations* of Kingdom 1, not different games, and the test says so in its name.

## 13. Decisions for Adam (nothing above blocks on them)

1. Record the macro goal as the confirmed `primary_outcome` mandate decision (or confirm `sole_outcome` is acceptable).
2. Confirm the goal text: the record says "Get to 50 active customers" (baseline 23). If the target is +50, the record
   must change.
3. Author the romance-deflection lines per rapport band (slots created by W2).
4. The creative brief for the cozy property-visit arm (W8): tone, cast, camera, the five-door structure.
5. Boreslay's real-business binding (its milestone stays blocked until then; W7 does not touch it).

## 14. Verification protocol (owner: the orchestrating session)

1. Review each PR's diff against this document; run `npx tsc --noEmit` and the full unit suite; compare failures to
   the baseline; merge.
2. After each deploy, read the next two real production calls with the §1 procedure and list every Claire turn with its
   answer path; the acceptance is behaviour on the phone, not green tests.
3. Record outcomes in memory and in `docs/goldline/CLAIRE_DAPHNE_MITCH_REPAIR_PLAN.md` §15.

## 15. Log

- 2026-10-20: plan written. Six sessions exist with briefs (ids in §2); all idle; models set per §2.

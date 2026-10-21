# Daphne decides and honours explicit preferences (repair plan W6)

Status: shipped behind `DAPHNE_V2_DECISION_POINTS` (default **off**). Binding companions:
`docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md` (§2 claims, §4 event naming, §5 MRT fields, §6 registry)
and `docs/goldline/CLAIRE_DAPHNE_MITCH_REPAIR_PLAN.md` §9.

## 1. Before (production, tenant `default`, operator `adam-admin`, read 2026-10-20)

| Table / signal | Value |
|---|---|
| `daphne_interventions` | 0 rows ever |
| `daphne_outcomes` | 0 rows ever |
| `daphne_goals` | 1 row: "maximize sales in Silver Lake", `operator_declared_goal`, 2026-10-10 |
| `daphne_meta_preferences` | 1 row: `response_detail = 0.2` since 2026-10-09 |
| `daphne_metric_events`, 14 days | `card_compiled` 106, `observation_ingested` 56, `control_changed` 1 |
| `claire_conversation_ingestion` observations, 14 days | 1 (last 2026-10-10) |

The card was compiled on every Claire turn, but Daphne never selected anything and never measured an outcome.

## 2. Decision points

Two occasions per business day, opened by the scheduled-call executor
(`operatorAppointmentExecution.ts` → `daphne/decisionPointSeam.ts` → `daphne/decisionPoints.ts`) after the
briefing is built and the dispatch fence is claimed, before the call is placed:

| Decision point | Target | Window (declared on the row) |
|---|---|---|
| `morning_first_action` | the designated mission if it is an open stop, else the first open executable Day Line stop | 600 min |
| `evening_tomorrow_move` | tomorrow's first open Day Director item (`commitment-<id>` stop) | 1440 min |

Options (registry `DAPHNE_FRAMING_REGISTRY` v1, every annotation `proposed`): `plain_instruction` (the
standard presentation, always eligible), `implementation_intention`, `choice_of_two` (eligible only when a
second real open item exists). The chosen framing becomes one line in the showrunner conductor prompt. It
changes how Claire names the item, never which item, and never adds work.

Selection:

1. An explicit "keep it plain" preference → `plain_instruction`, deterministic, probability 1.
2. No active `safe_experimentation` consent → `plain_instruction`, deterministic, probability 1.
3. Consent, and fewer than 5 verified outcomes for any option in this context → uniform draw, `randomized`.
4. Consent and support for every option → tilt toward the higher observed start rate, every option keeps at
   least 0.2, `propensity`.

Recorded before the call: a `daphne_decision_point` observation (availability, eligible options, target,
consent state) and a `daphne_interventions` row (eligible options, chosen action, probability, full propensity
map, policy version `daphne_framing_policy_v1`, registry version 1, outcome window). Idempotent per operator,
point and business date.

Outcome (`daphne_outcomes`, measure `started`, class `proximal`, `system_record` / `verified`), evaluated at the
next scheduled call: `1` when the target's Day Line stop shows completion evidence inside the window; `0` when
the window closes with a readable Day Line and no such evidence. Nothing is recorded while the Day Line is
unreadable. A stop marked done without evidence is noted on the row and never counted. What the operator says
on a call is never evidence.

Known limit: the Day Line records completion, not the moment work began, so `started = 1` is observed only when
the item is finished inside the window. Starts that do not finish in the window read as 0.

### What this does and does not support

With the production consent state today (`safe_experimentation` never granted), every row is the standard
presentation with probability 1. Those rows describe offer→completion rates only. They cannot compare framings.
Randomized rows begin only after the operator grants `safe_experimentation` on Claire Desk. Even then the claim
is "the architecture is MRT-ready", not that any framing works (foundation §2.3, §2.4).

### Turning it on

```
DAPHNE_V2_DECISION_POINTS=1
# optional: DAPHNE_V2_DECISION_POINTS_TENANTS=default
```

Verify with the admin read procedure `daphne.inspect` (tenant owner/admin): it returns the card, macro goals,
Daphne goals and preferences with their source words, intervention and outcome counts, and the last 20
observations by source.

## 3. Ingestion

`conversationIngestion.ts` runs the deterministic rules first, inside the turn. They now also recognise the
three real standing statements (credit, scheduling window, "on every call"). A bounded Haiku classifier then
runs in the background (never on Claire's answer path) with a closed enum: `declared_goal`,
`standing_instruction`, `scheduling_rule`, `credit_request`, `motivational_preference`, `rupture`, `repair`,
`none`. It only adds items the rules missed, as a second observation keyed `conversation-model:<turn>`.
Statements are always the operator's own words, never model text. Both classifiers sit behind the same hard
exclusions: quoted, reported or hypothetical speech and any health or diagnosis talk.

Instructions are written as `claire_conversation_ingestion` observations with items
`{kind:"instruction", instructionKind: standing_rule | scheduling_rule | credit_rule}`, matching W5's
`claire_operator_instructions.kind` values so W5 can import them. No second instruction store was built.

Motivational dimensions are a closed registry (`DAPHNE_PERSON_DIMENSIONS`, enforced by
`assertDaphnePersonDimension`) and explicit only: an operator statement becomes a `direct_fact` claim
`motivational_dimension:<dim>` with the source utterance. Nothing is inferred.

## 4. One goal

`shared/strategicHeadline.ts`: when the operating mandate has a leading macro goal, it is the week's headline in
the weekly plan and in the call briefing, including proposals stored before this change. A Daphne
`operator_declared_goal` stays an area focus and only qualifies the headline ("Get to 50 active customers,
focused on Silver Lake"). Without a leading macro goal the stored wording stands.

## 5. Consent separation and continuity

- `adaptation_enabled` (absent counts as allowed) governs honouring explicit preferences; `safe_experimentation`
  governs randomized assignment only. Tested in `decisionPoints.test.ts`.
- `experienceContinuity.ts`: explicit choice wins; an experience with recorded progress (Day 1 at 3 of 5) is
  never switched; selection happens only at a new-campaign boundary. No runtime experience selector exists yet
  (D21), so this is a pure rule W8 must call. The per-mission presentation point already replays its assignment.

## 6. Preference audit: `response_detail = 0.2`

Source: `explicitPreferenceCorrection.ts` maps "keep your answers shorter / be concise / less detail" to 0.2.
Consumers today:

| Consumer | Effect |
|---|---|
| `claireAdapter.ts` prompt section (composed organ via `preDriveConversation.ts`, both Brain V2 `primaryTurn.ts` and legacy `claireTurn.ts`) | adds "keep the response concise; give one main point or action unless the operator asks for more" |
| `claireTurn.ts` proactive board | speaks the concise board instead of the full one |
| `primaryTurn.ts` / `claireTurn.ts` acknowledgement | "Got it. I'll keep my answers shorter from now on." |
| Showrunner conductor (scheduled calls) | not read; that prompt has its own "at most three short sentences" rule |

"No. What else?" is **not** produced by this preference. It is the authored rapport-0 decline
`decline_r0_what_else` (`progression/authoredDialogue.ts`), reached when a turn is routed to the personal lane
(D5/D6, fixed in W1/W2). The preference does make generated answers one-point by design. The value was not
changed. The card now lists every active preference with the words that set it (`activePreferences`), so the
reason Claire is terse is visible in `daphne.card` and `daphne.inspect`.

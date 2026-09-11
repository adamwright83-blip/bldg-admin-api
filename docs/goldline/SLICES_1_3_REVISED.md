# Slices 1–3 — revised against the code on `main`

**Status:** specification. Slice 1 not started. Slices 2 and 3 partially satisfied by
existing production code, in ways the original brief did not know about.
**Companion document:** `docs/goldline/SLICE_4_MISSION_DIRECTOR.md`

The original brief for Slices 1–3 was written without reading the repository. Four of
its load-bearing statements are wrong, and two of the wrong ones would cause an agent
to damage working production code. This document corrects them, keeps everything in
the brief that survived contact with the code, and states the decisions that are
Adam's rather than an agent's.

## Summary of what the code actually says

| Brief claimed | Code says |
|---|---|
| Build a campaign-library model from scratch | A validated campaign-contract grammar already exists and is in production: `shared/leadHunt.ts`. It is not persisted or editable. Extend it. |
| Build a growth-campaign vocabulary | A real growth-task taxonomy with a proof layer already exists: `server/opsTasks.ts`. Retention already runs as `server/churnRadar/`. |
| Five real Greystar Koreatown targets owned by `system.day1TenDoors` | `system.day1TenDoors` owns **ten** targets, **seven** Greystar, across three neighborhoods. The five-target boundary is real but lives one layer up, in `COLOSSEUM_LEAD_HUNT`. |
| Assign one of seven existing companions | **No companion exists in code.** Zero references to Mara, Sable, Bront, Ilex, Luma, or Orren in `server`, `shared`, or `client`. |
| Replace The Last Valet's passive paid-order trigger, which blocks play | The binding already cannot block play; its own fiction law forbids it. The real gap is that no controllable campaign exists at all. |

---

# Slice 1 — Growth campaign library

## 1.1 Do not invent a grammar. One exists and is proven.

`shared/leadHunt.ts` defines `LeadHuntDefinition`, `validateLeadHuntDefinition`, and
`projectLeadHuntTargets`. It is exercised in production by `COLOSSEUM_LEAD_HUNT` in
`client/src/pages/goldline/colosseumCampaign.ts`, it has tests, and it already
enforces the rules this project cares about: real target ids only, unique ids, a
completion count that must fit the real target set, and a villain that must be one of
the real targets. `projectLeadHuntTargets` explicitly refuses to fabricate a
placeholder for a missing id.

Slice 1 generalises that grammar. It does not replace it.

**What it cannot currently do, stated precisely:**

1. **It is a constant in a TypeScript file.** Editing a campaign requires a deploy.
   This alone fails Slice 1's success condition.
2. **Its shape is door-knocking only.** `requiredRealWorldAction` accepts one value,
   `"pitch_in_person"`. `villainTargetId` is required. `revealTreatment` and
   `fictionalReward` each accept one value. A review request, a referral ask, or a
   local post cannot be expressed in it at all.
3. **Its targets must be `Day1Target` rows** from a hardcoded array in
   `shared/day1TenDoors.ts`. A campaign whose targets are existing customers, or
   which has no targets at all, has nowhere to put them.

## 1.2 Reconcile with the two real systems that already do this work

**`server/opsTasks.ts`** owns a closed growth/ops task taxonomy — `OPS_TASK_TYPES`
already includes `referral_ask`, `stale_customer`, and `revenue_leak` — with lanes,
levels, statuses, an actor-attributed event log including `outcome_recorded` and
`revenue_recovered`, and a proof layer at `drizzle/0020_ops_task_proof_layer.sql`.

The distinction Slice 1 must hold:

> A **campaign** is an editable template. An **ops task** is an instance of doing it
> on a particular day.

So: map each campaign to an existing `OpsTaskType` where one fits, and extend
`OPS_TASK_TYPES` where none does. Do **not** create a second instance store, a second
outcome vocabulary, or a second proof layer. If a campaign cannot be expressed as an
ops task instance, say why in the campaign row rather than routing around it.

**`server/churnRadar/customerChurnService.ts`** already runs retention. It produces
`customer_recovery_interventions` with real statuses (`draft_pending_review`,
`approved`, `contacted`, `recovered`), a `recommendedAction`, an estimated monthly
impact with confidence, and it is already surfaced in the field timeline. The
retention / win-back campaign in the library **wraps this**. It must not duplicate
it, and its `autoVerifiable` field is exactly the `recovered` status transition.

Likewise, the door-hanger campaign already has real precedent in
`server/goldlineWorld/frontierIntelligenceService.ts`, which composes flyer and
door-hanger territory work from real candidate businesses. Read it before writing
the door-hanger campaign's fields.

## 1.3 The seven seed campaigns

Seed the library with the seven from the brief: door-hanger territory operation,
property-manager or office-account pitch, referral ask, review request,
retention / win-back outreach, local digital-footprint post, and
neighboring-business partnership outreach.

Each must carry every field listed in `SLICE_4_MISSION_DIRECTOR.md` §2. That field
list is the data contract between Slice 1 and Slice 4 and is not negotiable from
either side — Slice 4's planner reads exactly those fields and nothing else.

Two additions to that list, forced by §1.1 and §1.2 above:

```
opsTaskType       existing OpsTaskType, or the new one this campaign adds
legacyContract    "lead_hunt" when the campaign is expressible as a
                  LeadHuntDefinition, else null. COLOSSEUM_LEAD_HUNT must
                  round-trip through the new model without changing behavior.
```

That round-trip is the regression test for this slice: loading Kingdom 1 through the
new campaign library must produce byte-identical Colosseum projection output to
`COLOSSEUM_LEAD_HUNT` today.

## 1.4 Evidence, not proof

Store initial timing guidance as **editable assumption rows**, never constants, and
never labelled proven, scientific, or industry-standard. Each assumption carries its
source and the date it was recorded.

Create the place to record Adam's own results in the same slice. `opsTaskEvents`
already has `outcome_recorded` as an event type — use it rather than inventing a
parallel results table. Slice 4's used-it / ignored-it / wrong-mission record writes
here too.

## 1.5 Editability and deployment

Follow the existing editable-admin pattern: `client/src/pages/CommercialProposalSettings.tsx`
plus the `adminSettings` table convention. Register the router on
`server/_core/systemRouter.ts`.

**Deployment reality, repeated because it has already blocked two migrations:**
`scripts/migrate.mjs` does not execute `drizzle/*.sql`. A new table needs the
migration file, the `drizzle/schema.ts` entry, **and** a hand-written idempotent
block in `migrate.mjs`, or it will not exist in production.

## 1.6 Success condition

Adam can view, edit, enable, and disable every campaign without a deploy; the
Colosseum campaign round-trips through the new model unchanged; and every field
Slice 4 consumes is present and populated for all seven seeds.

---

# Slice 2 — Kingdom sequence and campaign contracts

## 2.1 Correction: five versus ten. Read this before touching anything.

The brief says the authoritative campaign has "five real Greystar Koreatown targets,
owned by `system.day1TenDoors`". That is half true and the false half is dangerous.

What the code actually contains:

- `shared/day1TenDoors.ts` `DAY1_TARGETS` holds **ten** real targets. **Seven** carry
  `isGreystar: true`. They span Koreatown, West Hollywood, and Beverly Hills.
  `server/openChannel/day1TenDoorsService.ts` serves all ten.
- `COLOSSEUM_LEAD_HUNT` in `client/src/pages/goldline/colosseumCampaign.ts` selects
  exactly five ids — Rise Koreatown, Avana on Wilshire, The Pearl on Wilshire,
  Wilshire Vermont, The Chadwick — sets `completionCount: 5`, and
  `projectColosseumMission` filters recorded outcomes down to that set.

Both are real and both are authoritative for different things. Restated correctly:

> `system.day1TenDoors` owns ten real targets and their recorded outcomes.
> `COLOSSEUM_LEAD_HUNT` is the five-target projection over them that defines
> Kingdom 1's completion. Neither number is wrong.

**Two ways an agent could break this, both of which the original wording invites:**

1. Narrowing `DAY1_TARGETS` to five to match the prose. This deletes five real
   sourced businesses from a live mission.
2. Widening `COLOSSEUM_LEAD_HUNT` to include more of the seven Greystar properties.
   This is the real version of "inventing a sixth property" — not conjuring a new
   business, but **promoting an existing real target into the Colosseum campaign to
   move a number**. Forbid this explicitly; it is the plausible failure, not fabrication.

`docs/goldline/campaigns/GREYSTAR_COLOSSEUM_SNAPSHOT.md` should be amended to carry
this precision. It is currently correct in spirit and imprecise in a way that has
already produced a wrong instruction.

## 2.2 The Kingdom/Campaign contract is Slice 1's model, not a third grammar

The brief asks to "create a structured Kingdom/Campaign contract". Three grammars
would then exist: `LeadHuntDefinition`, the Slice 1 campaign library, and this. Build
one. The Kingdom contract is a row that references a Slice 1 campaign and adds:

```
kingdomId · realCampaignId · fictionalFieldMission · lanternCityStatus
driverDayRelevance · companionEarnedId · enablesKingdomId
```

Kingdom 1 is the existing Coliseum / Clockhead campaign and is expressed, not rebuilt.
Its `realCampaignId` resolves to the Colosseum campaign from §1.3, which must
round-trip identically.

## 2.3 Naming collision: "Kingdom" is already taken in this codebase

`client/src/components/admin/CommandLanternKingdom.tsx` is **Spark and the Fifty
Lanterns**, an unrelated shipped feature about a floating kingdom under The
Procrastinator's curse, with its own art under `/assets/kingdom/`.

Goldline's Kingdom abstraction must not reuse that name in code, or the two will
collide in imports, asset paths, and search. Pick a distinct identifier before
writing the first file. Also note that `/assets/kingdom/` is exactly the medieval
direction banned by the visual reference guide in `docs/GOLDLINE-TASKS.md` — do not
reuse those assets for Goldline under any circumstances.

## 2.4 Kingdom 3 review surface

Nothing exists. Build it read-only plus one recorded decision.

It shows, for each candidate campaign drawn from the Slice 1 library: the real
business outcome sought, the concrete actions under Adam's control, what Goldline can
verify versus what Adam must report, why this campaign matters for growth, and which
already-defined companion capability makes it materially easier or viable.

Hard constraints:

- Adam selects. The system records the selection and the capability requirement.
  Nothing auto-selects, and no ranking presents itself as a recommendation here.
- No companion is invented at this stage.
- The verify-versus-report split is not free text. It is the `autoVerifiable` and
  `selfReported` fields from the campaign row, rendered. If they are empty the surface
  says so rather than filling them in.

## 2.5 Success condition

Kingdom 3 has one recorded selected campaign and one recorded capability
requirement; Kingdom 1 is expressed through the same contract with no behavioral
change; and the five/ten boundary is documented precisely and covered by a test that
fails if either number moves.

---

# Slice 3 — Companion assignment and The Last Valet refit

## 3.1 Correction: there are no existing companions in code

The brief instructs: "Read every existing companion contract in
`docs/goldline/REALITY_BRIDGE.md`… The established roster is Mara, Sable, Rook,
Bront, Ilex, Luma, and Orren," then "Do not silently create an eighth companion."

Those seven exist **only in that document**. There are zero references to Mara,
Sable, Bront, Ilex, Luma, or Orren anywhere in `server`, `shared`, or `client`. The
only companion UI is a nav label in
`client/src/components/admin/control-room/LanternCommandDeck.tsx` whose panel lives
in `LanternCityAtlasV5.archived.tsx` — an archived file.

So the real state is:

- There is no companion model, no unlock mechanism, no earned/unearned state, and no
  way to tap one for help.
- "Assign the existing companion" means assigning a **specification**, which is a
  sound instruction, but it does not mean wiring to something that exists.
- Slice 5's "let a companion be tapped for help and proactively surface truthful,
  location-relevant assistance" is building the entire companion system from zero.
  That is a slice of its own, not a bullet.

**Decision required from Adam, blocking:** does Slice 3 build the companion model —
roster rows, protected may/may-not rules as data, earned state, and the unlock
transition — or does Slice 3 only record the assignment and defer the model? Slice 3
cannot honestly claim "completing its defined real requirement earns one companion"
until whichever answer is chosen is built.

## 3.2 Correction: Rook is already a shipped product persona

`server/dayforgeCoaching/dayforgeCoachingRuntime.ts` opens its system prompt with
"You are Rook, a concise field-sales coach." Rook appears on the public Dayforge
landing page as a calling field-sales coach and a "Rook field handoff" feature, and
`client/src/pages/DayforgeLanding.test.ts` asserts the name.

If Slice 3 assigns Rook as the Kingdom 2 companion, the product contains two
different Rooks.

**Decision required from Adam, blocking if Rook is the chosen fit:** unify them, or
rename one. Unifying is the stronger answer and worth saying out loud — the existing
Rook is already a real agentic capability doing real field-sales work, which is
exactly what a companion is defined to be. That would make Rook the first companion
that is genuinely earned-and-real rather than described. But it is Adam's call, not
an agent's, because it changes a customer-facing product surface.

## 3.3 Correction: the paid-order trigger does not block play

The brief says to "replace the passive paid-order trigger with a campaign based on
actions Adam controls," implying the trigger currently gates progress. It does not.

`client/src/game/chapters/firstChapter/model.ts` — the chapter itself — contains no
business references at all. It is rooms, movement, combat, and a save schema.

The binding lives in `server/goldlineWorld/chapterEventBindingService.ts`. It arms
against one building, then consumes one real `TowerWarsBusinessEvent` (a paid order
at that building, from the canonical ledger in `shared/towerWars.ts`) that occurred
after arming, exactly once. Its own header states the fiction law: it never kills the
boss, never completes the chapter, only unlocks an optional advantage, and **the
chapter must remain completable with zero qualifying events.**

So the honest restatement of the task:

> The passive trigger is already correctly non-blocking and already satisfies the
> standing rule that a payment may enrich but never gate. Do not remove it. The
> actual gap is that **no Adam-controlled campaign exists for this chapter at all** —
> there is nothing for the player to advance, only an optional advantage to receive.
> Slice 3 adds the campaign. The binding stays as the validation layer it already is.

This also means `goldlineChapterEventBindings` (migration `0068`) is load-bearing for
Kingdom 2 and is currently in the Blocked section of `docs/GOLDLINE-TASKS.md`. Per
Slice 4 §8 it needs a hand-written block in `scripts/migrate.mjs` as well as the
`.sql` file, or it will not exist in production.

## 3.4 What Slice 3 still does, unchanged from the brief

1. Evaluate which specified companion capability genuinely fits Kingdom 3's recorded
   requirement, and explain why the other candidates fit less well. This survives
   intact and is good work.
2. Assign that companion as the Kingdom 2 unlock, preserving its may / may-not rules
   from `REALITY_BRIDGE.md` exactly.
3. Propose a new companion only if Adam explicitly rejects every existing fit.
4. Refit `the-last-valet` as Kingdom 2, keeping only the gameplay and story that
   serves the real field campaign. It stays a mobile Driver field mission; desktop
   hosts the dossier, campaign status, companion state, and pending real-world
   action, and can never substitute for completing the field campaign.

## 3.5 Success condition

An Adam-controlled campaign advances Kingdom 2; completing its defined real
requirement earns one specified companion; that companion's protected real capability
is necessary for Kingdom 3; the chapter remains completable with zero qualifying
business events; and the Rook naming decision is recorded either way.

---

# Decisions blocking this sequence

Stated plainly, because none of them are an agent's to make.

1. **Slice 1 → 4 ordering.** Slice 4 cannot start until the campaign library exists.
   Already recorded in `docs/GOLDLINE-TASKS.md`.
2. **Companion model scope (§3.1).** Build the companion system in Slice 3, or record
   the assignment and defer? Slice 5's tap-for-help depends on the answer.
3. **Rook (§3.2).** Unify the Goldline companion with the shipped Dayforge coach, or
   rename one of them.
4. **Greystar snapshot amendment (§2.1).** Confirm the five/ten restatement before it
   is written into the protected document.

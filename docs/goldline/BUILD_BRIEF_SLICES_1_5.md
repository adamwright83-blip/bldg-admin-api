# Goldline build brief — Slices 1 through 5

**Replaces the original five-slice prompt in full.** Slice 4's detail lives in
`docs/goldline/SLICE_4_MISSION_DIRECTOR.md`; Slices 1–3 background lives in
`docs/goldline/SLICES_1_3_REVISED.md`. This document is the executable brief.

Work in `adamwright83-blip/bldg-admin-api` on `main`. Build the slices in order.

---

## How to use this brief

Update `docs/GOLDLINE-TASKS.md` when you begin, complete, block, or change the scope
of a task. If that file is missing, **stop and report it** — do not create a
replacement.

Do not mark work complete because a UI exists. Verify the actual user flow.

Do not begin a later slice while its prerequisite decision is unresolved. State the
exact decision needed and leave the app in a working state.

**Verify everything twice, in two different ways.** Tests are the first way and are
not sufficient:

```bash
pnpm check && pnpm test
```

The second way is the browser. Run `pnpm dev`, open the Admin and Driver surfaces the
slice touched, and exercise the flow a person would actually perform. A passing test
suite is not proof that Goldline works.

---

## Required reading before writing any code

These are protected continuity contracts. **Current production behavior on `main`
outranks all prose, including this brief.** Do not rebuild systems that already
satisfy them.

- `docs/goldline/REALITY_BRIDGE.md`
- `docs/goldline/IMPLEMENTATION_CONSTITUTION.md`
- `docs/goldline/RUNTIME_INVENTORY.md` — especially its "Do not duplicate" list
- `docs/goldline/campaigns/GREYSTAR_COLOSSEUM_SNAPSHOT.md`
- `docs/GOLDLINE-TASKS.md` — the Canon section is settled; do not re-litigate it

---

## What Goldline is

Goldline is a mission director for Adam's real laundry business, not a disconnected
mini-game.

Admin and Lantern City are the strategic, birds-eye world. Driver is the street-level
adventure layer. The game gives real business growth work a narrative form.

**It must never make Adam wait for a customer, payment, or inbound event in order to
keep playing.**

---

## Standing rules

1. Real actions Adam controls can advance a field campaign.
2. Truthful outcomes can change story conditions, route options, preparation, and
   advantages.
3. A customer payment, reply, or inbound event may enrich or validate a campaign, but
   can never be required in order to play.
4. **No invented contacts, visits, orders, payments, or results.** This has no
   placeholder exemption. A hardcoded customer name or dollar figure rendering in a
   real Admin surface violates this rule even when a code comment admits it is fake.
   See Slice 5 §5.1 for the one live instance of this.
5. The vehicle/facility drawer is a fourth-wall-breaking real operations tool.
   Trailblazer does not know a car exists.
6. Companions travel with Trailblazer in the fiction. They are earned through real
   field work and represent durable agentic abilities.
7. Fantasy progression may react to truthful campaign state. No Wayward, combat, map,
   relic, or local-fiction persistence may write business outcomes.
8. Never claim timing or conversion guidance is scientifically proven or
   industry-standard. Store it as editable, evidence-informed assumptions.

### Visual rules

Reference feel, and the only reference feel: **Tomb Raider II, Twisted Metal 2, Metal
Gear Solid, Super Mario 3D World.** Modern adventure grit, velocity and spectacle with
personality, stealth-tech military cool, bright dimensional platforming wonder.

Banned, including accidentally: Castlevania, gothic vampire, Transylvania, knight-in-
shining-armor medieval fantasy, crown iconography, and "kingdom" read literally as a
castle or throne aesthetic. Kingdom is a business-strategy abstraction, never a visual
direction.

A mockup that leans medieval is a miss, not a starting point. Regenerate it; do not
patch gold-and-crown chrome onto it. Note that `/assets/kingdom/` already exists in
this repo and belongs to an unrelated feature in exactly the banned style — never
reuse it for Goldline.

### Scope guard

Do not expand combat rooms, art, or desktop mini-games until these slices establish
the real business loop.

---

## Codebase facts — do not re-derive, do not contradict

The original brief was written without reading the repository and got five things
wrong. These are the corrections. Verify them yourself if you like, but do not
proceed on the original assumptions.

| Common assumption | Reality on `main` |
|---|---|
| No campaign contract exists | `shared/leadHunt.ts` is a validated contract grammar in production, proven by `COLOSSEUM_LEAD_HUNT`. Extend it. |
| No growth-task vocabulary exists | `server/opsTasks.ts` has a closed task taxonomy with an event log and a proof layer. `server/churnRadar/` already runs retention. |
| `system.day1TenDoors` owns five targets | It owns **ten**, seven of them Greystar, across three neighborhoods. The five-target boundary is `COLOSSEUM_LEAD_HUNT`, one layer up. |
| Seven companions exist to choose from | **Zero companions exist in code.** The roster is doc-only. The one Companions panel is in an archived file. |
| The Last Valet is gated by a paid order | The binding already cannot gate play; its own fiction law forbids it. No controllable campaign exists at all. |
| There is no day planner | `server/dayDirector/` captures commitments and `server/nightShift/` already authors tomorrow. Slice 4 is a third, distinct thing. |

**Deployment reality that has already blocked two migrations:**
`scripts/migrate.mjs` does not execute `drizzle/*.sql`. Any new table needs three
things — the migration file, the `drizzle/schema.ts` entry, and a hand-written
idempotent block in `migrate.mjs` — or it will not exist in production.

---

# Slice 1 — Growth campaign library

Create a durable, editable campaign-library model and an Admin review surface.

## 1.1 Extend the grammar that exists

`shared/leadHunt.ts` already enforces what matters: real target ids only, unique ids,
a completion count that must fit the real set, a villain drawn from the real targets,
and a projection that refuses to fabricate a placeholder for a missing id. Generalise
it. Do not write a second grammar.

Three specific things it cannot do today, which Slice 1 fixes:

1. It is a constant in a TypeScript file, so editing a campaign needs a deploy.
2. Its shape is door-knocking only. `requiredRealWorldAction` takes one value,
   `villainTargetId` is required, and `revealTreatment` and `fictionalReward` each
   take one value. A review request or a local post cannot be expressed in it.
3. Its targets must be `Day1Target` rows from a hardcoded array. A campaign whose
   targets are existing customers, or which has no targets, has nowhere to put them.

## 1.2 Reconcile with the systems already doing this work

A **campaign** is an editable template. An **ops task** is one instance of doing it on
one day. Hold that line.

- Map each campaign to an existing `OpsTaskType` in `server/opsTasks.ts` where one
  fits — `referral_ask` and `stale_customer` already exist — and extend
  `OPS_TASK_TYPES` where none does. Do not build a second instance store, outcome
  vocabulary, or proof layer.
- The retention / win-back campaign **wraps** `server/churnRadar/customerChurnService.ts`,
  which already produces recovery interventions with real status transitions and a
  recommended action. Its `autoVerifiable` value is the `recovered` transition.
- Read `server/goldlineWorld/frontierIntelligenceService.ts` before writing the
  door-hanger campaign. It already composes flyer and door-hanger territory work from
  real candidate businesses.

## 1.3 Seed campaigns

Door-hanger territory operation · property-manager or office-account pitch · referral
ask · review request · retention and win-back outreach · local digital-footprint post
· neighboring-business partnership outreach.

Every campaign defines its real business objective, a concrete completion condition,
required preparation and how many days ahead it must happen, the type of time pocket
it needs, a low-effort fallback for a disrupted day, what Goldline can truthfully
verify by itself, what Adam must confirm himself, the fictional mission category it
maps to, and any companion ability that helps execute it.

**The exact field list is in `SLICE_4_MISSION_DIRECTOR.md` §2.** It is the data
contract between Slice 1 and Slice 4 and is not negotiable from either side. Add two
fields to it:

```
opsTaskType     existing OpsTaskType, or the new one this campaign adds
legacyContract  "lead_hunt" when expressible as a LeadHuntDefinition, else null
```

## 1.4 Evidence, not proof

Timing guidance is editable assumption rows carrying their source and the date
recorded. Never constants, never labelled proven.

Create the place to record Adam's own results in this slice. `opsTaskEvents` already
has an `outcome_recorded` event type — use it rather than inventing a parallel
results table. Slice 4's used-it / ignored-it / wrong-mission record writes here too.

## 1.5 Surface and persistence

Follow `client/src/pages/CommercialProposalSettings.tsx` and the `adminSettings`
convention. Register on `server/_core/systemRouter.ts`. Obey the three-part migration
rule above.

## Success condition

Adam can view, edit, enable, and disable every campaign without changing code; the
Colosseum campaign round-trips through the new model with byte-identical projection
output; and every field Slice 4 consumes is populated for all seven seeds.

---

# Slice 2 — Kingdom sequence and campaign contracts

## 2.1 The five-versus-ten boundary — read before touching anything

`shared/day1TenDoors.ts` holds **ten** real targets, **seven** with `isGreystar: true`,
spanning Koreatown, West Hollywood, and Beverly Hills.
`server/openChannel/day1TenDoorsService.ts` serves all ten.

`COLOSSEUM_LEAD_HUNT` in `client/src/pages/goldline/colosseumCampaign.ts` selects
exactly five ids, sets `completionCount: 5`, and filters recorded outcomes to that set.

Both are authoritative, for different things:

> `system.day1TenDoors` owns ten real targets and their recorded outcomes.
> `COLOSSEUM_LEAD_HUNT` is the five-target projection that defines Kingdom 1's
> completion. Neither number is wrong.

**Two forbidden moves, because both look like fixing an inconsistency:**

1. Narrowing `DAY1_TARGETS` to five to match the prose. That deletes five real sourced
   businesses from a live mission.
2. Widening `COLOSSEUM_LEAD_HUNT` to cover more of the seven Greystar properties. This
   is the real meaning of "never invent a sixth property" — not conjuring a fake
   building, but **promoting a real target into the campaign to move a number.**

Never use the fictional six-door count as business truth. The Colosseum's six doors
are visual fiction only. Never invent a sixth property, target, visit, pitch,
customer, order, payment, or revenue event.

Amend `GREYSTAR_COLOSSEUM_SNAPSHOT.md` with this precision once Adam confirms it.

## 2.2 One contract, not a third grammar

The Kingdom contract is a row referencing a Slice 1 campaign, adding:

```
kingdomId · realCampaignId · fictionalFieldMission · lanternCityStatus
driverDayRelevance · companionEarnedId · enablesKingdomId
```

Kingdom 1 is the existing Coliseum / Clockhead campaign, expressed through this
contract rather than rebuilt, and must round-trip identically.

## 2.3 Naming collision

`client/src/components/admin/CommandLanternKingdom.tsx` is *Spark and the Fifty
Lanterns*, an unrelated shipped feature with its own art directory. Pick a distinct
identifier for Goldline's Kingdom abstraction before writing the first file.

## 2.4 Kingdom 3 review surface

Build it read-only, plus one recorded decision. For each candidate campaign from the
Slice 1 library it shows the real business outcome sought, the concrete actions under
Adam's control, what Goldline can verify versus what Adam must report, why this
campaign matters for growth, and which already-defined companion capability makes it
materially easier or viable.

- **Adam selects.** The system records the selection and the capability requirement.
  Nothing auto-selects; no ranking presents itself as a recommendation.
- No companion is invented at this stage.
- The verify-versus-report split renders the `autoVerifiable` and `selfReported`
  fields. If they are empty the surface says so rather than filling them in.

## Success condition

Kingdom 3 has one recorded selected campaign and one recorded capability requirement;
Kingdom 1 is expressed through the same contract with no behavioral change; and the
five/ten boundary is covered by a test that fails if either number moves.

---

# Slice 3 — Assign the companion, then refit The Last Valet as Kingdom 2

## 3.1 There are no companions in code

Mara, Sable, Rook, Bront, Ilex, Luma, and Orren exist only in `REALITY_BRIDGE.md`.
Zero references in `server`, `shared`, or `client`. The sole Companions panel lives in
`LanternCityAtlasV5.archived.tsx`.

"Assign the existing companion" therefore means assigning a **specification**. That is
sound work, but it wires to nothing yet, and Slice 5's tap-a-companion-for-help builds
the entire system from zero.

**Blocking decision for Adam:** does Slice 3 build the companion model — roster rows,
protected may / may-not rules as data, earned state, and the unlock transition — or
only record the assignment and defer the model? Slice 3 cannot claim a companion is
earned until this is answered.

## 3.2 Rook already ships

`server/dayforgeCoaching/dayforgeCoachingRuntime.ts` opens with "You are Rook, a
concise field-sales coach." Rook is on the public Dayforge landing page and asserted
in `DayforgeLanding.test.ts`.

**Blocking decision for Adam if Rook is the chosen fit:** unify the two, or rename
one. Unifying is the stronger answer — that Rook is already a real agentic capability
doing real field-sales work, which is what a companion is defined to be — but it
changes a customer-facing surface, so it is Adam's call.

## 3.3 The paid-order trigger does not block play

`client/src/game/chapters/firstChapter/model.ts` contains no business references at
all. The binding lives in `server/goldlineWorld/chapterEventBindingService.ts`, which
arms against one building and consumes one real business event exactly once to unlock
an **optional advantage**. Its own fiction law states it never kills the boss, never
completes the chapter, and the chapter must remain completable with zero qualifying
events.

So: **do not remove the binding.** It already satisfies standing rule 3. The actual
gap is that no Adam-controlled campaign exists for this chapter — there is nothing to
advance, only an advantage to receive. Slice 3 adds the campaign; the binding stays as
the validation layer it already is.

## 3.4 The work

1. Evaluate which specified companion capability genuinely fits Kingdom 3's recorded
   requirement. Explain why the other candidates fit less well.
2. Assign that companion as the Kingdom 2 unlock, preserving its may and may-not rules
   exactly.
3. Propose a new companion only if Adam explicitly rejects every existing fit. Never
   silently create an eighth.
4. Refit `the-last-valet` as Kingdom 2, keeping only the gameplay and story that serves
   the real field campaign. It stays a mobile Driver field mission. Desktop hosts the
   dossier, campaign status, companion state, and pending real-world action, and can
   never substitute for completing the field campaign.

## Success condition

An Adam-controlled campaign advances Kingdom 2; completing its defined real requirement
earns one specified companion; that companion's protected capability is necessary for
Kingdom 3; the chapter remains completable with zero qualifying business events; and
the Rook decision is recorded either way.

---

# Slice 4 — Mission Director v1

**Full specification: `docs/goldline/SLICE_4_MISSION_DIRECTOR.md`.** It covers the
existing systems not to rebuild, the today-only projection bug to fix properly, what a
time pocket can honestly claim without travel data, the enforced intelligence
boundary, the closed failure taxonomy, append-only re-planning, and the proof harness.

**Blocked on Slice 1.** A planner seeded with hardcoded campaign constants is the exact
failure the slice exists to prevent.

## Success condition

Goldline produces, for tomorrow, a primary growth mission and an already-prepared
fallback, both selected deterministically from Adam's enabled campaign library against
his real schedule; explains the choice in plain language; re-plans into a recorded new
revision when the day changes; refuses with a named reason and a concrete remedy when
it cannot plan; and records whether Adam actually used it.

---

# Slice 5 — Lantern City, Driver, entry point, and persistence

Make the active campaign visible in the real product.

## 5.1 Fix the fabricated data already rendering in Admin

`client/src/components/admin/control-room/OpusLaInspection.tsx` renders a hardcoded
array of customer names, lifetime values, order counts, and AI pitch text. Its header
comment admits this. Standing rule 4 has no placeholder exemption, and this surface is
reachable from both Lantern City and Home today.

Wire it to real per-tower customer and revenue data, or render nothing where real data
is absent. Real win-back data already exists in `server/churnRadar/`. The dead
"Approve & Queue Win-Back" button on that card must either perform the real queue
action or be removed.

**Do this first.** It is the only standing-rule violation currently live.

## 5.2 Lantern City / Admin

- Add Coliseum and Valet as **distant threshold signals at the edge of the world**.
  Not literal medieval landmarks. Re-read the visual rules first.
- Show the active campaign, the real territory objective, progress, the companion at
  stake, and the latest truthful consequence.
- **Already shipped, do not rebuild:** clicking Opus LA opens the tower inspection
  screen, which carries an "Initiate Tower War" call to action rather than starting a
  battle immediately. Verify it still works; extend it only per §5.1.

## 5.3 Driver

- Surface today's primary mission and fallback mission from Slice 4.
- Show the current Kingdom objective only when it is relevant to the day.
- Keep the vehicle/facility drawer focused on real order organization. Do not add
  fiction to it.
- Let a companion be tapped for help, and proactively surface truthful,
  location-relevant assistance when its unlocked capability applies. **This depends on
  the §3.1 decision** — there is no companion model to tap yet.

The decision moves to the server and the client stops deciding.
`buildDayPlanProjection` in `client/src/pages/driver/goldlineDayPlanModel.ts`
currently derives `growthCoverage` in the browser from a heuristic over stop kinds.
Replace it with the server's plan. `DayPlanProjection` gains the mission plan alongside
`authoredDay`, which it already carries.

## 5.4 Chapter entry surface

`/goldline-chapter` is a registered route in `client/src/App.tsx` linked from nowhere.
It cannot stay a secret standalone URL.

Choose and implement the real entry surface. It must explain the real-world campaign at
stake without spoiling story content. **Adam decides where it is linked from.**

## 5.5 Persistence

`client/src/game/chapters/firstChapter/FirstChapter.tsx` reads and writes only
`localStorage`. The server path already exists and is unused —
`chapterFromServer` and `chapterToServer` in the same directory's `persistence.ts`,
backed by migrations `0067` and `0068`, which are in the Blocked section because they
have never been applied.

After the Kingdom 2 binding is defined: apply and verify both migrations, add their
hand-written blocks to `scripts/migrate.mjs`, and wire `FirstChapter.tsx` to the
server path so shared state, event state, and Echo persist correctly instead of
silently relying on local storage. Keep local storage as the offline fallback, not as
the source of truth.

## Success condition

Adam can encounter Goldline naturally from Admin and Driver, see the real action
connected to the current campaign, perform the action, and see truthful progress return
to the world. No fabricated customer data renders anywhere.

---

# At the end of each slice

1. Update `docs/GOLDLINE-TASKS.md`.
2. Summarize what changed, what real user behavior it enables, and what remains
   unresolved.
3. Run `pnpm check && pnpm test`.
4. Verify the relevant Admin and Driver flow in the browser, by hand.
5. Do not begin a later slice if its prerequisite decision is unresolved. State the
   exact decision needed and leave the app in a working state.

---

# Decisions blocking this sequence

None of these are an agent's to make.

1. **Slice 1 before Slice 4.** Already recorded.
2. **Companion model scope** (§3.1). Build it in Slice 3, or record the assignment and
   defer? Slice 5's tap-for-help depends on the answer.
3. **Rook** (§3.2). Unify the Goldline companion with the shipped Dayforge coach, or
   rename one.
4. **Greystar snapshot amendment** (§2.1). Confirm the five/ten restatement before it
   is written into the protected document.
5. **Chapter entry placement** (§5.4). Where `/goldline-chapter` is linked from, and
   what it says.

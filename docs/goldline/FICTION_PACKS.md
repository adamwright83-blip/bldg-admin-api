**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# DOCUMENT 3 — GOLDLINE FICTION PACKS v1.0

**Audience:** product owner + implementation agent.
**Purpose:** let one real campaign wear any genre, without letting the genre touch the truth.

Read first, in this order:

- `docs/goldline/REALITY_BRIDGE.md` — especially §2 (what the game may know), §11 (unknown remains useful), §12 (Echoes), §13 (the Colosseum precedent).
- `docs/goldline/IMPLEMENTATION_CONSTITUTION.md`
- `docs/goldline/SLICE_4_MISSION_DIRECTOR.md`
- `docs/goldline/RUNTIME_INVENTORY.md` — the "Do not duplicate" list.

---

## Permanent law

> **Campaigns own truth. Fiction Packs own interpretation.**
> A pack may change genre, language, pacing, presentation and payoff.
> A pack may never change the objective, the completion condition, the evidence
> rules, or any business record.

Corollary, and the sharper form of the Reality Bridge's permanent law:

> **Fiction may dramatize an accepted real-world state. It may not increase the
> certainty of that state.**

`operator_reported` stays `operator_reported` underneath the costume.

---

## 1. Why this document exists

A previous design round tried to answer "how do we make every business activity
make sense inside one fantasy world?" That question is dead and should not be
revived. Different real behaviors want different fantasies. Hanging door hangers
in a wealthy residential district wants a field operation, not an ancient city.

The insight that killed it: the fiction may lie about what an action *means*. It
may never lie about whether the action *happened*. `REALITY_BRIDGE.md` §13 already
shipped this — six fictional Colosseum doors over five real Greystar targets, the
fictional count never used as business truth, the reveal withheld until the real
trace completes. Fiction Packs generalize that precedent. They do not replace it.

---

## 2. The two primitives

Everything in this document attaches to exactly two new things. Resist attaching
anything else to them until both are proven.

### 2.1 Campaign Run — the substantive one

A `GrowthCampaign` is reusable truth. An `ops_tasks` row is a single unit of
work, one status, one `completedAt`. Neither can represent *this particular
40-address operation, in progress, across days*.

Real usage is "ten on Wednesday, thirty on Thursday, whenever the willpower
shows up." Wednesday's `10/40` and Thursday's `22/40` are the same run.

```
CampaignRun = {
  campaignRunId
  tenantId
  campaignId + campaignVersion        frozen at start
  fictionPackId + fictionPackVersion  frozen at start (§5)
  targetSetId                         frozen at start
  startedAt
  status         "active" | "complete" | "abandoned"
  completedAt    null until the completion calculation says otherwise
}
```

Mission Director may *start* or *select* a run. **Continuation belongs to the
run, not to the planner.** Without this, "multi-pocket mission" stays undefined
and the planner grows a second timeline it was explicitly forbidden to grow
(`SLICE_4` §3: one timeline source, parameterised).

### 2.2 Target set and target evidence

Pull Lead Hunt's *invariants* downward. Do not contort door hanging into
`LeadHuntDefinition` — that type hardcodes `requiredRealWorldAction:
"pitch_in_person"` and a villain target, and its own header says it was
deliberately not built as a generalized mission platform.

The reusable invariants are: targets are real and sourced, IDs are stable slugs,
IDs are unique, completion is N-of-M over real targets, and nothing may
fabricate a target.

```
CampaignTarget = {
  targetId        stable slug, never regenerated
  targetSetId
  address, lat, lng
  placementPoint  "front_door_knob" | "gate" | "call_box" | ...
  sourceNote      how this address was established
  provenance      official_property_source | operator_observed
}
```

**Do not mutate a `10/40` integer.** Follow the `opsTaskEvents` philosophy that
already exists in this repo (`drizzle/schema.ts:1184`): preserve facts, derive
state.

```
CampaignTargetEvent = {
  campaignRunId, targetId
  kind            "territory_presence" | "placement_reported" | "supporting_photo" | "target_replaced"
  occurredAt, operatorUserId
  provenance      GoldlineProvenanceClass   (shared/goldlineWorld.ts)
  epistemicState  EpistemicState            (shared/goldlineWorld.ts)
  payload
}
```

`17/40` is **derived** from seventeen target states that satisfy the campaign's
completion contract. It is never an integer somebody increments. This matters
immediately and badly once a second tenant exists.

---

## 3. Evidence contract — what actually establishes a placement

GPS cannot establish per-target identity in a residential block. Forty houses sit
inside each other's arrival radius (`day1TenDoors.ts` uses ~125m, widened by
reported accuracy — built for apartment buildings scattered across neighborhoods,
not adjacent lots). Anything that increments a counter on block proximity is a
lie with good intentions.

So the three legs are separated:

| Leg | Established by | Provenance class |
|---|---|---|
| **Uniqueness** | the pre-sourced, frozen target list | `official_property_source` / `operator_observed` |
| **Presence** | device location, territory-level | `device_location` |
| **Placement** | operator attestation, per target | `operator_reported` |
| **Photo** | optional supporting evidence; depicts what it depicts | `operator_reported` |

A target qualifies when territory presence was recorded during the window **and**
placement was reported for that target.

`17/40` therefore means: *seventeen of forty real, named addresses reported
placed, by an operator whose device confirmed presence in that territory.* That
sentence is true, and it is enough to justify `DETECTOR 17 ONLINE` on screen.

**Presence is never placement.** Standing in the neighborhood completes nothing.

---

## 4. The pack

```
FictionPack = {
  id, version
  role                  what the player is cast as
  premise, briefing
  objectiveLabels       slot-bound (§4.1)
  progressBeats         fractional thresholds only (§4.2)
  proofFraming          how the pack asks for evidence
  completionSequences   keyed by tempo tier (§6)
  echoPresentation      the default incomplete state (§7)
  failureSequence       legal ONLY against a real failureCondition (§7)
  visualTheme, audioTheme
}
```

### 4.1 Slot binding — no pack may contain a business noun

Goldline is intended to serve other solopreneurs — electricians, plumbers — over
the same packs. `GrowthCampaign` already carries `tenantId`; the discipline has
to be in the pack schema from the first pack or the first pack hardcodes laundry
and the second tenant needs a rewrite.

The campaign declares `unit`, `actionVerb`, `placementPoint`, `territory`,
`count`. The pack declares what it *calls* them (hanger → "detector"). The trap
is not nouns — it is units and verbs. "Hang a hanger on a door knob," "leave a
card at a job site" and "plant a yard sign" have different placement points,
different countability and different proof.

**Reuse `shared/goldlineVoice.ts`.** `VoiceLine` already has template slots and a
`requires: SlotName[]` array that refuses to render a line whose slots are
missing. That is the mechanism, with the safety property we want. Extend the bank
system; do not build a parallel one.

### 4.2 Beats are fractions, and may not introduce state

Beats fire at fractions of a campaign-owned total — 25% / 50% / 75% — **never at
hardcoded counts.** A pack that fires at 10/20/30/40 breaks the moment an
electrician runs a twelve-target grid. The pack never knows the number.

> **A beat may transform existing state into fiction. It may not introduce new
> state.**

Legal: `25 NODES ACTIVE — COVERAGE INSUFFICIENT`. The only thing that changed
underneath is 24 → 25 qualifying targets.

Illegal: `PARTIAL TRIANGULATION — we're seeing a pattern now`, or anything
northeast of you. That asserts an analysis no system performed.

`goldlineVoice.ts` already encodes this discipline in its `outreach_sent` bank:
*"Every line has to carry the send AND the fact that nothing was won by it.
Anything triumphant here would be the same untruth as a window lighting on
outreach alone."*

---

## 5. Versioning and freezing

Store `fictionPackId + fictionPackVersion` and snapshot the binding onto the
Campaign Run at start. Otherwise copy or thresholds change three weeks later and
a run sitting at `22/40` silently becomes a different story.

The target set is frozen at run start for the same reason. A target may only
change through an explicit, truthful `target_replaced` event recording why —
never by silent edit of the list.

**Sourcing and freezing are separate steps, and only freezing is permanently
manual.** Goldline may eventually help assemble candidate addresses — that is
Mara's authorized role, and her limits are already binding: she may suggest a
real place and present public information, and may never invent an address, a
person, a role or a business status (`REALITY_BRIDGE.md` §4). What must stay
human is the confirmation: an operator approves that these targets are
legitimate and accessible before the run freezes them.

So manual target research is a property of *this experiment*, not a permanent
product requirement. A future solopreneur must not have to hand-research two
dozen addresses before Goldline can create a territory mission. That discovery
system is simply not needed to prove the core loop, and building it first would
delay the only thing worth learning right now.

---

## 6. Tempo grading — ceiling only

Cadence is real state: first touch, session count, gaps between sessions. Grading
a payoff on it dramatizes accepted state and introduces nothing. It is legal.

It is also the single most dangerous thing in this document, because the operator
this is built for carries an "I am not enough until I achieve" distortion, and a
mechanic that punishes slow completion is that distortion rendered as game
design. The hangers are on the doors either way.

Binding rules:

1. **Completion is binary and always honored.** 40/40 wins at any speed.
2. Tempo grades the **aftermath** — the antagonist's condition — never the
   player's grade.
3. **You can earn an S. You can never earn an F.** This is the Metal Gear Solid
   model, which is on the approved reference list in `docs/GOLDLINE-TASKS.md`:
   you can earn Big Boss rank, and you always beat the game.
4. Grade on **cadence, not calendar.** Elapsed weeks punish a sick kid or a bad
   stretch. Session gaps and placements-per-session are closer to controllable.
5. **The tier being tracked is never displayed mid-mission.** No ceiling visibly
   sliding away.
6. **The Colosseum campaign is exempt.** It is weeks in at time of writing;
   retroactive grading would punish the exact instance that most needs a clean
   payoff. Tempo grading starts forward-looking, on new runs.

Tiers name what happened to the antagonist: **Clean Break** / **Wounded** /
**Gone to Ground**. The victory beat is byte-identical across all three. The
divergence happens strictly after the win lands.

**This is designed behavior, not v0.1 scope.** See §11.

---

## 7. Echo by default; failure only against a real failure condition

Incomplete work resolves to an **Echo** (`REALITY_BRIDGE.md` §12), framed as held
ground, never as debt:

> Ten nodes holding. Thirty dark.
> The grid keeps what you give it.

**Nothing decays. Ever.** No expiry, no grid degradation, no streak reset. A
decay mechanic is a debt system, and a debt system gets the app muted and then
deleted. Ten placed is ten placed permanently.

`failureSequence` is legal **only** when the campaign declares a real
`failureCondition` — a 10am appointment not attended, an event that ended Sunday.
Reality genuinely closed that door, and pretending otherwise would be the system
lying in the other direction. `ops_tasks` already distinguishes `expired` from
`dismissed`. Even there: the world closed; the operator did not blow it.

---

## 8. Clockhead — the framing discipline

**The name is Clockhead** (`shared/clockheadReadability.ts`,
`shared/goldlineVoice.ts`). Not Clockface.

Canon, recovered rather than invented: *his obsession is that nothing may happen
before the correct time, and the correct time never arrives. His clocks read
SOON, PENDING, AFTER REVIEW, NEXT WEEK, WHEN CONDITIONS IMPROVE, NOT YET.*

Shipped lines include "Not yet. Not yet. Not yet.", "Soon is a complete answer.",
"Next week. I have written it down.", "Provisionally, you are winning."

**Clockhead is personified deferral.** This is why no shame mechanic is needed
anywhere in Goldline: he never mocks slowness, he *endorses* it. He is not a
judge, he is a seducer, and what he sells is "there's no rush." Every placement
actually made is a direct refutation of him.

Binding copy rules for any pack featuring him:

1. Every outcome sentence describes what **Clockhead** did. Never what the player
   failed to do.
2. **No second person in outcome copy.** No "you were slow," "you let him,"
   "because of you."
3. **No counterfactuals.** The game never shows the ending that was not earned.
4. **Ranks are earned, never lost.** There is no Rank D.
5. **Urgency is present tense only.** Claire pushing mid-mission — "we're losing
   the window, keep moving" — is the whole engine and is encouraged.
   Retrospective verdict is banned.
6. His escape is **his opportunism**, converted into intel: "he moves in the
   gaps" is a forward-looking advantage for the next run, not a backward-looking
   grade.
7. Return after any gap is **neutral and warm**: *"Grid's as you left it. Ten
   holding. Ready when you are."*

### 8.1 Scope of his death

Until world-level antagonist state exists, killing Clockhead means defeating
**this operation's manifestation** — this run's encounter. A cross-campaign
persistent villain who can also be permanently killed is a continuity bug on
the first feature the persistent world ever ships. Either scope the kill to the
run, or the completion sequence must carry a canonical reason he returns. Do not
leave it implicit.

---

## 9. The Deferral Encounter

An optional isolated screen where Clockhead taunts and **dodges everything**. He
is slowed only by real proximity to the territory, and killed only by real
completion.

This is the anti-fake-completion rule made playable: the UI cannot defeat the
problem; reality can. Reuse seam: `planClockheadAttack(pressure)` already maps
real pressure to attack behavior — grid pressure enters the same seam rather
than a new one.

Truth mapping, exactly:

| Real state | Encounter behavior |
|---|---|
| Away from territory, run open | fully evasive |
| `device_location` evidence near the territory | visibly changes — no damage, no completion |
| Qualifying placements recorded | real, proportional progress |
| Run complete | winnable |

Four constraints:

- **Opt-in only.** Never auto-opened.
- **No rewards of any kind from this screen.** No XP, no progression, no
  unlocks. `docs/GOLDLINE-TASKS.md` canon already states desktop play is never a
  way to skip the real action. It is a door, not a room.
- **Never mock the attempt.** A miss produces his patient endorsement — *"You may
  fire as often as you like. It changes nothing. That is the arrangement."* —
  never ridicule.
- **Always show the lever.** A visible reason he is untouchable ("thirty nodes
  dark"), so the felt state is *locked*, never *powerless*.

---

## 10. Notifications — two channels, not one

Geofencing cannot be the primary trigger. The stated problem is getting out the
door at all; a Clockhead who only appears once the operator is already near the
neighborhood cannot solve it.

**Recall** — capped and **decreasing**, never escalating, while an open run sits
unresolved. Fires anywhere. May open the Deferral Encounter. An escalating nag is
a debt system.

**Opportunity** — location-aware, via Field Moves, when near the territory with
an open run.

**His silence is the scariest state**, and it is fiction-native permission to
reduce frequency over time rather than farm engagement: *"He stopped writing. He
considers the matter settled."*

Field Moves integration is not free. `FieldTodayItemKind` currently covers job,
pickup, delivery, follow_up, commercial_visit, commercial_call, mission_dispatch,
customer_recovery, field_commitment, reported_opportunity, payment_blocker,
route_exception, contextual_move. **A standing residential grid needs a
deliberate new kind and its own ranking path** in `rankFieldMoves`.

---

## 11. Build order

Approved sequence. Items 1–5 are the experiment; everything after attaches to the
two primitives rather than blocking them.

**The first run is 24 targets.** Forty was fiction, not a finding. Twenty-four
reads as a real field operation, is large enough to expose whether persistence,
progress and proof actually work, and is finishable across one or two outings.
It also gives clean fractional beats: 6 / 12 / 18 / 24. Nothing in a pack may
care whether a later electrician campaign has 8 targets, a plumber campaign 15,
or a mature campaign 60 (§4.2).

Two tracks run in parallel. The physical track does not wait for the fiction UI.

| | Build track (Claude) | Physical track (operator) |
|---|---|---|
| 1 | Campaign Run + target/evidence persistence | Identify 24 usable doors — one compact affluent area, front doors reasonably accessible. Do not optimize the perfect route. |
| 2 | Generic mission shell + `fictionPackId`/`Version` | Get the hangers printed. This does not wait on anything above. |
| 3 | First pack: `bio_containment` | — |

Then, in order:

4. **Freeze** those 24 into the first Campaign Run (§5).
5. **Run it for real.** Twenty-four placements, in the field.
Only after the real run do we decide whether any of the following deserve further
investment. That decision is made on evidence from step 5, not in advance:

6. Deferral Encounter + recall notifications (§9, §10).
7. QR outcome attribution (§12).
8. Automated Luma → approval → printer-pickup prep chain (§13).
9. Tempo aftermath + world-level antagonist state (§6, §8.1).
10. Richer visual presentation for the field-operation genre.

### The falsifiable question

> Goldline gives the operator 24 actual doors. Clockhead exists. Claire briefs
> him. The grid starts at 0/24. Does he go out and make it 24/24?

A yes makes the product thesis substantially more credible. A no is worth more
than another pass of design canon. Stop designing the wrapper until one of those
two things has happened.

### The done condition — the re-skin test

> Same Campaign Run. Same targets. Same evidence. Same completion calculation.
> Change only the fiction-pack binding, and the mundane door-hanger operation
> becomes the counter-terror operation.

If switching to `bio_containment` requires changing Mission Director, evidence
rules, target completion, or business truth, **the abstraction failed** and the
slice is not done.

---

## 12. QR attribution — after the experiment, not before

A campaign-coded QR is the strongest evidence available anywhere in this model:
machine-verifiable, stronger than GPS or photos. It is also the only path to
settling the campaign's own `timingAssumptions` — currently sourced to "Adam's
own field notes, informal" — with evidence.

It does **not** prove hanger #17 was placed, and it is not needed to test the
actual hypothesis. It is the outcome-measurement layer, built immediately after
the behavioral experiment, not before it.

No QR, promo-code or campaign-code infrastructure exists in the repo today.

Geographic order-matching is **not** available: laundry order addresses carry no
verified coordinates, `googleGeocoder.ts` exists but orders are not reliably
geocoded, and `distanceMiles` in `territoryDiscovery.ts` is straight-line only
(`SLICE_4` §4). Radius correlation is therefore `inferred`, later, and labeled as
interpretation — never stated as fact (`REALITY_BRIDGE.md` §2).

---

## 13. Preparation as a mission — documented, not v0.1

The prep chain is good Goldline and should exist: Luma generates door-hanger
creative (`REALITY_BRIDGE.md` §9 authorizes exactly this, and it is her first
real job — she is currently the thinnest-fit companion), the operator tweaks and
approves it, the spend clears the approval ladder
(`shared/goldlineActionContract.ts` — `APPROVAL_REQUIRED`;
`server/agents/humanApproval.ts`), and the pickup run travels to coordinates that
turn out to be the printer. Withholding the destination's identity is legal;
inventing a destination is not.

This also makes `prepLeadDays: 3` honest — a real chain ending in
`PREP_NOT_READY` naming the date prep needed to happen.

It is a second mission chain, not part of proving `fictionPack`. **For the first
field test, having the hangers printed by hand is enough.**

---

## 14. Out of scope for v0.1

No photo-verification infrastructure. No three genre families — one pack proves
the abstraction, families emerge after. No new art pipeline. No world-level
antagonist state. No writes to business truth from any fictional surface: the
pack reads state and dramatizes it, and never records an outcome the operator did
not take.

---

## 15. Deployment reality

`scripts/migrate.mjs` is a hand-written idempotent script run by `npm start`. **It
does not execute `drizzle/*.sql`.** Any new table therefore needs all three: the
`drizzle/NNNN_*.sql` migration, the `drizzle/schema.ts` definition, and a matching
idempotent block in `scripts/migrate.mjs`. Every service must survive `getDb()`
returning null, as every neighbouring service already does.

There is no database in the local build environment and the admin app is behind a
password gate. DB-backed UI changes generally cannot be exercised locally. Say so
plainly rather than claiming verification.

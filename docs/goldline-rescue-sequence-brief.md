# Goldline rescue sequence — master brief (PR #78 → #83)

Written 2026-08-17 against `main` = `370a62d` (PR #77 merged). Author: Fable 5
(creative director session). Execution: Sonnet 5 sessions, one surgical prompt
per PR. This document is the shared truth for the whole sequence — any session,
on any model, must be able to pick up the next PR cold from this file plus its
surgical prompt.

## The product sentence

Goldline is an action-adventure game whose save file is the real business.

> Your business generates the missions. Your skill determines what you win.
> Your wins unlock agents. Those agents generate the next level.

The loop this sequence builds toward:

REAL WIN → WORLD CHANGES → AGENT UNLOCKS → AGENT ACTS → NEW REAL OPPORTUNITY
→ NEW ADVENTURE → YOU EXECUTE THE HUMAN PART → BIGGER REAL WIN

Read `docs/DESIGN-LAWS.md` before any PR. The two laws that override
everything: the game may dramatize truth but never fabricate business truth,
and no shame mechanics — the game pulls forward, it never punishes.

## Context: the 10-Day Rescue Run

Adam is mid-campaign (roughly 2026-08-17 → 2026-08-27) to materially grow the
business AND prove Goldline creates commercial results. Field-intel capture
(#75), entity linkage (#76), and action grammar / LOCAL_TARGET_RUN / Places
sourcing (#77) are merged and live. What is missing is the payoff layer: the
player does real work and the world does not yet visibly respond. This
sequence closes that gap in small, individually playable increments.

The sequence is allowed to end mid-list. Each PR leaves the game strictly
better. Stopping after #80 is success, not failure. Nobody rushes #81–#83.

**Numbering note:** "#78–#83" are SEQUENCE LABELS, not GitHub PR numbers —
GitHub numbering drifts (this brief's own docs PR took github#78). The
status tracker at the bottom records actual GitHub PR numbers as they land.

## Release protocol (non-negotiable)

1. Fable releases exactly ONE surgical execution prompt (the next PR only).
2. A Sonnet 5 session executes it. Opus 5 for #78.5 (movement resolver).
3. All existing gates pass + the PR's own executable proof runs locally.
4. Fable reviews the diff (short pass) before merge.
5. Adam merges, then plays the PR's 60-second fun gate on his real phone.
6. Only after Adam reports the fun-gate result does Fable release the next
   prompt. Reality gets inspected between every merge. PR #77 began as a
   one-line CI change and became a 4,800-line PR; scope explosion is the
   failure mode this protocol exists to prevent.

### The three gates every PR must pass

- Functional truth gate — existing vitest/tsc/build/bundle gates plus the
  PR's own executable proof. Never fake business truth to make a test pass.
- Real-device play gate — the PR's fun-gate script, run by Adam at 393×852
  on his actual phone, in the car if that is where he plays.
- Feel gate — each surgical prompt carries a written checklist ("does the
  kill SOUND like a kill?", "is the cue readable at arm's length?"). Feel is
  an acceptance criterion of every PR, not a post-run sprint.

## Universal engineering rails (every PR)

- Start from fresh `origin/main`. Verify a clean tree; if the tree is dirty
  with work you did not author, STOP and report.
- Read `docs/goldline-pickup-expedition-handoff.md` first. It records the
  local docker + release-migration recipe, the CDP true-touch verification
  pattern (`scripts/verifyGoldlineTrueTouch.mjs`, `verifyGoldlineHeartbeat.mjs`),
  and hard-won lessons: the Pixi canvas swallows synthetic clicks (use CDP
  `Input.dispatchTouchEvent`); `Graphics.children.length` never proves a draw
  landed (screenshot instead); a comment containing the word DEPLOY trips a
  substring guard; pale/low-alpha art vanishes on this plate — new world
  objects need a dark body, limestone rim light, brass fittings, judged in
  zoomed crops, never full-plate screenshots.
- CI caveat: the real-CDP-touch gate scripts race on GitHub Actions runners
  (see commits `ab4df01`, `d94d50c`). Heavy touch proofs run LOCALLY and
  their output is pasted into the PR; CI carries only the timing-safe gates.
- Never `pnpm db:push`. Migrations only via the guarded dayforge release
  workflow. Zero new migrations expected in #78–#79 and #81–#83; #80 is the
  one PR where a small migration is plausibly justified (supply order state)
  — stop and justify before writing it.
- Entity joins use authoritative ids (`impact_signals.entityId`, landed in
  #76), never fuzzy `entityLabel` matching.
- Goldline JS bundle gate: 150KB gzip. Art is served static from
  `client/public/assets/goldline/...`, never bundled.
- One PR = its scope block below. If a fix wants to grow, stop and report.

## Truth and provenance rails (every PR)

- Impact-class ladder (observation → field_activity → response → opportunity
  → customer_outcome → economic_outcome) is never upgraded. Effort never
  becomes outcome. 47 door hangers is real work, not a lead.
- Provenance (`system_verified` / `operator_confirmed` / `external_record`)
  is never invented upward. A typed or spoken sentence is operator truth.
- Game performance and business outcomes are separate clocks. Winning or
  losing fictional combat can never create or erase business facts.
- World state derives as PURE PROJECTION from confirmed truth (the Stronghold
  restoration pattern: reload rebuilds everything from evidence). No world
  mutation is stored that cannot be rebuilt from authoritative records.

## Asset pack

`goldline_final_asset_pack_v1` (approved art) installs to
`client/public/assets/goldline/field_world/` preserving subfolders
`loot_walk_field_intel/`, `world_transformation/`, `answering/`. First needed
in #79. Ask Adam for the extracted pack's disk path at #79 kickoff. Keep
originals; create optimized derivatives; check `client/public/goldline-sw.js`
caching behavior before shipping new art. #78 needs no new assets.

## Fun-gate template

Each surgical prompt instantiates this as ~5 concrete questions:

1. 60 seconds, Adam's phone, one thumb, fresh app open.
2. Every question is binary pass/fail, about what he SEES/HEARS/FEELS —
   never about what the code does.
3. A failed question is a blocker for the NEXT prompt release, not
   necessarily a revert — Fable triages.

---

# The sequence

## PR #78 — Playtest closure (route legibility + climax honesty + combat audio)

Adam's first real playtest (2026-08-17) found: he cannot find or perceive
section transitions; the built world ends with a silent invisible wall; the
"NO RESOLVED TERRITORY YET" ribbon reads as a territory gate; a desk task
("design door hangers") gets a combat expedition whose cargo box does
nothing he can perceive; combat impact audio is thin.

**Scope IN**
- Forward route cue whenever the route genuinely continues (reuse the
  `objective-direction-cue` chevron pattern in `GoldlineGameHome.tsx`).
- Visible exit landmark near the corridor end; crossing into the next
  section becomes an EVENT (section title chip + existing
  `corridor_transition` audio cue). Exit arming today: `progress >= 0.77`,
  ordinary ceiling 0.82 (`GoldlineGame.ts` `forwardCeiling()`); chip renders
  only when `nextPlayableCorridorId` exists (`corridorRegistry.ts` — only
  corridor_01/_02 are playable).
- Honest end-of-built-world marker in the last playable corridor — sparse
  authored copy, no invisible wall pretending to be a bug.
- Reword the world-history ribbon empty state (`GoldlineGameHome.tsx` ~2912)
  so it cannot be read as a movement gate.
- Climax honesty: plain `open_channel` desk tasks no longer stage a cargo-box
  expedition; they complete in the base (existing task surface / SEAL flow
  outside combat). The expedition shell is reserved for objectives with real
  physical arrival: `native_pickup`, `external_order`, `local_target_run`
  (see `expeditionObjective.ts` kinds and `completeExpeditionObjective`
  adapters in `GoldlineGameHome.tsx` ~1814–1859).
- Barrier release legibility: when the Shieldbearer dies, the opening must be
  seen and heard (minimal visual pulse + `gate_unlock`-class cue) — a known
  gap (release currently drops in one frame).
- Combat audio differentiation: `AudioManager` is wired but borrows a tiny
  palette (`vault` covers four distinct events, `weak_point_hit` covers
  hits — see `GoldlineGameHome.tsx` ~1878–1968). Add distinct synthesized
  cues (strike hit, hostile down, player hurt, barrier release, cargo/work
  secured) and assign them semantically. Respect the existing
  `isCallActive` rule at call sites.

**Scope OUT:** movement resolver / body collision (#78.5), world
transformation (#79), any new dependency, any migration, any refactor.

**Proof:** local CDP script (new, modeled on `verifyGoldlineTrueTouch.mjs`):
forward cue visible mid-corridor when route continues; transition event
fires crossing into corridor_02; end-of-world marker present in corridor_02;
desk task shows no ENTER THE LINE staging; audio cue counters (harness-gated)
fire for hit/kill/hurt/release. Plus full existing gates.

**Fun gate:** Can you find the way forward without hunting? Does crossing
sections feel like an event? Does the world SAY where it ends? Does the desk
task skip combat entirely? Do hits/kills/hurt each sound distinct?

## PR #78.5 — Solid bodies (Opus 5 session)

You cannot phase through Ruinbound. Contact blocks and shoves (~20px
knockback via the existing recoil/impulse rails) with a short hit-stop.
Implemented in the ONE movement resolver shared by every input path — the
`forwardCeiling()` / `movementLimit.ts` discipline. Audit every progress
writer (joystick, dodge, Linehook impulse, `performAction`, checkpoint
restore, expedition entry, corridor reveal, `start()`); this file class has
a three-round history of "helper correct, sibling path bypasses it."
**Proof:** CDP script drives real touch into a hostile from multiple paths
and asserts position never crosses the body radius; kills still work; 60fps
held. **Fun gate:** enemies feel SOLID; walking into one feels like hitting
a thing, not a ghost.

## PR #79 — The consequence loop (Immediate World Transformation + The Answering)

The payoff spine. After this PR, real confirmed work visibly changes the
world the same day, and later real responses land as dramatic events.

- Truth sources (all merged, all id-linked): confirmed impact signals
  (`impact_signals`, entityId from #76), authoritative visit outcomes,
  collected-order evidence (the four `listByStatus` queries), external-order
  completion/reconciliation.
- World transformation intensity maps to impact CLASS, never model-extracted
  magnitude alone: field_activity → supplies/worked-state; response → signal
  fire; opportunity → gate/bridge state; customer/economic → handled in #82
  Census / Stronghold prosperity. Activity must never look like customers
  or revenue.
- Pure projection, idempotent, reload-rebuildable. No new tables.
- The Answering: a later-confirmed response-class (or stronger) signal, or a
  real inbound business event, materializes as a world event with one sparse
  authored line ("Someone answered the Line."). Authored line bank written
  once, ~12 lines. Never fabricated, never randomized for engagement.
- Earned Mission Interrupt staging rule: reality interrupts the fiction at
  beat boundaries (expedition end, corridor entry, base return) — never
  mid-combat, never as a productivity popup. The real response elevates the
  matching real follow-up objective where mission systems permit.
- ONE unseen-world-delta queue, player-scoped client checkpoint (the
  positional `checkpointStorage` pattern). Dawn (#83) will consume the SAME
  queue. Never build a second "what changed" system.
- Uses `world_transformation/` + `answering/` assets. Art legibility law
  applies (dark body, limestone rim, brass; zoomed-crop review).

**Fun gate:** confirm one real signal → something you can SEE changes within
one second. Reload → it is still there. A response confirmed later →
tomorrow's open shows the world answering, and you can name what happened
without reading a number.

## PR #80 — THE QUARTERMASTER (Campaign Supply v1)

Player-facing name: the Quartermaster. Never "Campaign Supply Agent" in UI.
The first agent whose AGENCY the player unmistakably experiences: it takes
an approved design, causes a real print order to exist across town, then
pins real coordinates on the map.

- Flow: choose campaign target → Quartermaster prepares creative (image-gen
  draft of the door hanger / collateral) → Adam approves creative AND spend
  (explicit cap) → 60-second manual-assist checkout (v1: the app preps
  everything, Adam completes the vendor payment himself — no autonomous
  purchasing) → truthful order states → shop notifies Adam it is ready →
  real-coordinate supply-recovery expedition → physical retrieval.
- Truth ladder, ALL operator-confirmed provenance in v1:
  `PREPARED → AWAITING APPROVAL → CHECKOUT REQUIRED → ORDER CONFIRMED →
  AT PRESS → READY FOR PICKUP → RECOVER SUPPLIES → FIELD KIT STOCKED`.
  ORDER CONFIRMED means Adam completed checkout; READY FOR PICKUP means the
  shop told Adam and he tapped it. The app never claims vendor truth it
  cannot see.
- FIELD KIT STOCKED fills the deliberately-empty socket:
  `strongholdProjection` has a TEST asserting no `fieldKit` property exists
  (the no-fake-inventory rule). That test is replaced by real state modeling
  the day physical supplies exist. Stock appears ONLY after RECOVER SUPPLIES.
- The pickup is a real place with real coordinates and SECURE-CARGO-grade
  staging and verification.
- The one PR where a small migration (supply order state) is plausibly
  justified — stop and justify first.

**Fun gate:** does it feel like a character DID something real for you? Is
the moment the coordinates appear a mission, not a notification? Is the
Field Kit visibly real only after your hands touched the box?

## PR #81 — THE REPLICATOR (swappable with #82 — decide from live run state)

Verified closed account → `expansionScoutService` archetype lookalikes
(`CATEGORY_BY_ARCHETYPE`, "Sourced lookalike opportunity" — already coded) →
operator approves the hunt → ONE `LOCAL_TARGET_RUN` via
`localTargetRunSourcing` (Places, honest `SIMULATED · PLACES UNAVAILABLE`
fallback) → progress only via confirmed Field Intel
(`markLocalTargetRunTargetVisited`). Ships dark if the run has produced no
real closed account — it must never fabricate a win. If no close has landed
by #80's merge, ship #82 first.

**Fun gate:** after a real win, does the world OFFER the next hunt in game
language ("Scout has found 7 related strongholds") rather than CRM language?

## PR #82 — World memory (Unwritten Map + Census)

- Unwritten Map: worked-location node states (unknown/dormant →
  revealed/worked) from confirmed activity with entity ids and visit
  outcomes. Driving past reveals nothing. No GIS platform — corridor node
  presentation over existing truth.
- Census: real recurring customers (`customerAssets` residential
  `service.recurring` — the `capabilityEvaluationService` predicate) become
  persistent inhabitants / lit windows via the PopulationSystem binding.
  Genuinely inactive relationships dim gracefully. No shame states. Nothing
  short of real recurring truth creates an inhabitant.

**Fun gate:** can you point at the world and say "I worked THAT building,
and THAT person lives here because they're really my customer"?

## PR #83 — DAWN

First-meaningful-open staging of the SAME unseen-delta queue #79 built:
short, cinematic, understandable in seconds, ends on ONE next objective.
Orchestration only — Dawn owns no data. If #79's queue is empty, Dawn shows
nothing: a quiet morning is a true morning.

**Fun gate:** does opening the app feel like the world kept living while
you slept — in under ten seconds, ending with exactly one obvious thing
to do?

---

## Explicitly deferred (do not build in this sequence)

- SECOND SEAT / FIRST_HIRE_READY campaign: the capability exists but three
  of its six inputs (declined profitable demand, reserve months, schedule
  saturation) are deliberately null in the schema so it cannot falsely
  unlock. Requires a metrics-capture workstream first. Do not corrupt the
  lock to make the campaign visible.
- Agents-as-characters presentation for SCOUT / FOLLOW_UP / RELATIONSHIP /
  INTEL beyond what #80/#81 naturally deliver.
- Autonomous vendor purchasing. The Overland driving layer. Any GPS/geofence
  arrival detection. Broad audio architecture. New enemy/traversal systems.

---

# SEQUENCE CORRECTION v2 — 2026-08-18, after the GL-78 fun gate FAILED

GL-78 (merged as github#79, `853ae26`) shipped correctly and its own items
work on device — forward cue, section transitions, end-of-world monument,
audio palette. Adam's live playtest then failed the gate ONE LAYER UP: the
product model, not the PR. Recorded verbatim findings:

1. **"SEAL THE WORK" renders for PHYSICAL work.** "Pick up an order for
   Mona at Opus LA in one hour" and "drop off John's order" were typed into
   Open Channel, landed as plain `open_channel` tasks, and GL-78's climax-
   honesty rule (written by Fable — this fence was drawn in the wrong place)
   gave them desk semantics: a completion button tappable from bed. The
   type system had no physical/base distinction, so "remove fake combat
   from desk work" silently became "all typed work is desk work."
2. **Goldline waits to be told the day instead of assembling it.** Native
   orders auto-populate (controller queries), CleanCloud screenshot import
   EXISTS (`AddExternalWorkSheet`, chooser at `GoldlineGameHome.tsx` ~3386)
   — but it is buried in the field console. Adam re-typed reality that the
   product could have ingested with one giant button.
3. **No campaign awareness.** The business has ~9 days to live; the brief
   knows it; the game he holds does not. No main quest, no gap, no
   "N days remain," no required-visits math.
4. **The world is inert between expeditions**, and mobile legibility fails:
   chips too small, joystick too small, dev vocabulary leaking to the
   player ("STATIONARY PLAY · TEMP • INSIDE GAME LOOP",
   `GoldlineGameHome.tsx:2951`), empty-state cards (COLD CALL BURST) parked
   center-screen.

Diagnosis receipts from `main` (`853ae26`):
- `OpenChannelTask` already carries `navigationQuery: string | null` — the
  model already signals place-bound work; nothing downstream honors it.
  `category` is topical (food/sales/…), not an execution type.
- CleanCloud import + manual job entry: fully built, wrong hierarchy.
- No goal/campaign-gap model exists anywhere in server/shared (grep clean).
- Foreground one-shot geolocation EXISTS (`requestGoldlineLocation`) for
  move sourcing; no destination proximity, no arrival context.

**The operating principle this correction enforces: Goldline begins with
reality and generates the adventure — it never begins with an empty
adventure and waits for the operator to type reality into it.**

## Corrected sequence (supersedes the order above; scope blocks above stay valid where referenced)

| Order | Label | Scope |
|-------|-------|-------|
| 1 | **R1 — Day assembly + physical-stop honesty + mobile legibility** | Execution typing (`base` vs `physical_stop`) on Open Channel tasks, proposed by the model (navigationQuery is the signal), CONFIRMED by the operator at approval; `physical_stop` objectives stage the expedition/Threshold flow with the same canonical completion write; SEAL THE WORK only ever for base work. Front door: on an empty day the base leads with giant thumb-first actions — IMPORT TODAY FROM CLEANCLOUD (promote existing chooser), ADD OTHER STOPS (existing sheets), OPEN CHANNEL for the rest. Legibility: chip fonts ≥11px, joystick +~18%, dev-vocab chips removed, empty-content cards never center-screen. Surgical prompt: `docs/goldline-r1-execution-prompt.md`. |
| 2 | **R2 — Rescue Campaign Director** | The main quest. Operator-declared campaign: deadline, recurring-revenue gap, average-account value (verified where evidence exists, else explicitly operator-assumed), conversion scenario (operator-approved). HUD embodies it: days remaining, verified gap closed vs remaining, today's required qualified visits. Progress ONLY from verified evidence (impact ledger `rescue-10day`, won accounts). Numbers are never fabricated — every derived figure is labeled verified or assumption. The one justified migration (campaign store). |
| 3 | **C1 — Consequence loop** (was step 2 above) | Immediate World Transformation + The Answering, unchanged scope from the original GL-79 block, now also reflecting campaign progress. |
| 4 | **R3 — Protected route + growth windows** | Assembled day → real gaps between protected obligations → generated qualified-visit missions sized by R2's math, using existing fieldOpportunity moves + `localTargetRunSourcing`. "THE ROAD OPENS FOR N MINUTES." Never invents urgency; never makes him late. |
| 5 | **R4 — Location context** | Destination geocoding for physical stops; on app-foreground, one-shot location (existing plumbing) → near destination ⇒ offer Threshold/arrival; far from an unresolved stop ⇒ truthful reconciliation question ("Mona's Opus LA pickup is still unresolved — did you complete it earlier?"). Location is CONTEXT evidence, never completion evidence. Fully graceful without permission. |
| 6+ | Solid bodies (GL-78.5, Opus session, parallel-safe any time after R1) → Quartermaster → Replicator → world memory (Unwritten Map + Census) → Dawn (its morning role is partially absorbed by R1's front door and R2's chapter card; what remains is the cinematic staging). |

## Status tracker (executor updates this table in its PR)

| Seq | Label | Branch | Status | Merged | Adam played |
|-----|-------|--------|--------|--------|-------------|
| GL-78 | playtest closure | `agent/goldline-pr78-playtest-closure` | merged as github#79 | `853ae26` | 2026-08-18 — **FUN GATE FAILED at product-model level** (see correction) |
| R1 | day assembly + physical stops + legibility | — | PROMPT RELEASED | — | — |
| R2 | rescue campaign director | — | held | — | — |
| C1 | consequence loop | — | held | — | — |
| R3 | growth windows | — | held | — | — |
| R4 | location context | — | held | — | — |
| GL-78.5 | solid bodies | — | held (parallel-safe after R1) | — | — |
| — | Quartermaster / Replicator / world memory / Dawn | — | held | — | — |

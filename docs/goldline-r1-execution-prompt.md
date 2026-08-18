# R1 execution prompt — day assembly, physical-stop honesty, mobile legibility

You are implementing R1 of the corrected Goldline rescue sequence. Read
`docs/goldline-rescue-sequence-brief.md` — especially the
"SEQUENCE CORRECTION v2" section — and
`docs/goldline-pickup-expedition-handoff.md` (tooling + landmines) BEFORE
touching code. This prompt is your scope fence.

## Why this PR exists (one paragraph)

The operator typed "pick up an order for Mona at Opus LA in one hour" into
Open Channel and Goldline gave it a desk-work completion button he could
tap from bed. Physical work and desk work currently share one execution
semantics because the task model has no execution type — even though every
task already carries `navigationQuery: string | null`, the model's own
signal that work is place-bound. Separately, the operator had to TYPE his
day at all: CleanCloud screenshot import and manual job entry are fully
built (`AddExternalWorkSheet`, chooser near `GoldlineGameHome.tsx:3386`)
but buried. And the screen fails basic mobile legibility. R1 fixes all
three. Operating principle: **Goldline begins with reality and generates
the adventure — it never waits for the operator to type reality into an
empty adventure.**

## Baseline

- Start from fresh `origin/main` (must contain `853ae26`). Branch:
  `agent/goldline-r1-day-assembly`.
- Dirty tree you didn't author → STOP and report.
- Never `pnpm db:push`. **Zero migrations expected**: Open Channel tasks
  are stored as a JSON shape owned by `server/openChannel/` — verify this
  before starting; if tasks turn out to be relational columns and an
  execution field genuinely requires a migration, STOP and justify first.
- tsc baseline (27 pre-existing errors): add none. Bundle gate 150KB gzip.

## Workstream 1 — execution typing: `base` vs `physical_stop`

1. Add `execution: "base" | "physical_stop"` to `OpenChannelTask` and
   `OpenChannelEditableTask` (`server/openChannel/openChannelTypes.ts`).
   This is EXECUTION semantics — do not touch or overload the topical
   `category` enum.
2. Generation (`openChannelService.ts` structured-output schema, ~76/~113):
   the model PROPOSES `execution` per task. A non-null `navigationQuery`
   is the natural signal for `physical_stop`, but the model decides;
   the schema requires the field.
3. **The operator is the authority.** The approval UI
   (`client/src/pages/goldline/OpenChannel.tsx`) must show each task's
   execution type as a large, thumb-sized toggle — BASE WORK vs PHYSICAL
   STOP — with the destination text (from `navigationQuery`) visible and
   editable for physical stops. A `physical_stop` task must not be
   approvable with an empty destination. Model classification is a
   proposal; what the operator approves is what persists. No keyword
   heuristics anywhere downstream of approval.
4. Legacy default for already-approved tasks with no `execution` field:
   non-null `navigationQuery` → treat as `physical_stop`; null → `base`.
   This makes the operator's live Mona/John tasks physical without
   re-typing. Add a small reclassify mutation + affordance on the task
   surface for the cases the default gets wrong (operator-triggered,
   updates `execution` and `navigationQuery` together).
5. `prepareExpeditionObjective` (`expeditionObjective.ts`): an
   `open_channel` task resolving to `physical_stop` returns a NEW objective
   kind `physical_stop` — label from the task, detail = destination, a
   Google Maps navigation URL derived from `navigationQuery` (the pattern
   the HUD's `objectiveNavigationUrl` already renders). It stages the
   expedition/Threshold flow exactly the way plain `open_channel`
   objectives did BEFORE GL-78 removed them (that machinery still exists:
   the `activeExpedition?.kind === "open_channel"` HUD branches and the
   `completeExpeditionObjective` open-channel adapter are currently dead
   code — revive them under the new kind rather than rebuilding). The
   completion CTA at the destination reads as physical (e.g.
   "RESOLVE THE STOP"), and calls the SAME canonical
   `completeOpenChannelTask` write. LOCAL_TARGET_RUN payload tasks are
   untouched (they already return their own kind before this branch).
6. SEAL THE WORK (the base-completion button GL-78 added) renders ONLY for
   `execution: "base"` tasks. Its write is unchanged.

## Workstream 2 — the day assembles itself (front door)

1. When the base/explore view is showing and the day has NO assembled work
   (no native orders, no external orders, no active Open Channel mission),
   the primary surface leads with three giant, thumb-first actions
   (minimum 56px tap targets, full-width or two-up on 393px):
   - **IMPORT TODAY FROM CLEANCLOUD** → the existing
     `onOpenAddExternalWork` chooser (IMPORT CLEAN CLOUD DAY /
     ADD CLEAN CLOUD JOB). Promote — do not rebuild.
   - **ADD OTHER STOPS** → the existing manual-entry paths
     (`QuickNewOrderSheet` via `onOpenNewOrder`, and manual external job).
   - **OPEN CHANNEL** → the existing voice/text flow, for everything else.
2. Once the day has ≥1 work item, this block collapses to a compact row —
   it must never bury the live objective surface.
3. Native Laundry Butler orders already auto-populate (the controller's
   date queries). Never ask the operator to retype anything the database
   already knows.

## Workstream 3 — mobile legibility

1. Joystick: increase the movement zone ~18% (`goldline-game.css`
   `.game-joystick` ~996 and its 393px media query ~2069).
2. Type floor: no player-facing text below 11px computed at 393px. Audit
   the status chips (`goldline-game.css`, `goldline-legibility.css`) and
   raise offenders.
3. Remove dev vocabulary from player-facing chrome:
   `GoldlineGameHome.tsx:2951` ("STATIONARY PLAY · TEMP • INSIDE GAME
   LOOP") — replace with player language or remove entirely.
4. Empty-content cards never sit center-screen: the COLD CALL BURST card
   renders only when it has actionable content; the INTEL LINE / encounter
   prep panel must not dominate the primary view when there is nothing to
   prep. Demote, don't delete.

## Truth rails

- Model output is proposal; operator approval is authority; provenance
  stays `operator_confirmed`.
- No GPS, no proximity, no location gating in R1 (that is R4).
- Completion writes unchanged everywhere; a `physical_stop` resolves
  through the same canonical Open Channel write, just staged at the
  destination instead of from bed.
- Never fabricate: no invented destinations, no auto-created stops.

## Verification

1. Full existing gates (game vitest, tsc baseline, build, bundle).
2. New local proof `scripts/verifyGoldlineR1.mjs` (CDP real touch at
   393×852, harness flag, modeled on `verifyGoldlinePr78.mjs`):
   - fixture mission: "design door hangers" (base) + "pick up Mona's order
     at Opus LA" (physical, navigationQuery set);
   - physical task: NAVIGATE affordance + expedition staging reachable, NO
     base SEAL button anywhere for it;
   - base task: SEAL THE WORK present, no expedition staging;
   - legacy-default rule: a fixture task with navigationQuery and no
     execution field behaves as physical;
   - empty-day fixture: the three front-door actions render with measured
     tap targets ≥56px;
   - legibility spot-checks via computed styles on named chips.
3. CI carries timing-safe gates only; paste the local touch-proof output
   into the PR (the CDP-race caveat in the brief).

## Fun gate (verbatim in the PR description; Adam runs it on his phone)

1. Fresh open on an empty day: are IMPORT TODAY FROM CLEANCLOUD and ADD
   OTHER STOPS unmissable, thumb-sized, and working in one tap?
2. Say "pick up Mona's order at Opus LA at 3pm" into Open Channel: does it
   arrive at approval as a PHYSICAL STOP with a destination — and does
   approving it produce a stop you must GO to (NAVIGATE + arrival), with
   no way to complete it from the couch?
3. Does "design the door hangers" still complete in the base, one tap?
4. Can you read every on-screen label at arm's length, and does the
   joystick feel like it was made for a thumb?
5. Is the middle of the screen finally showing the WORLD instead of empty
   system cards?

## Report format

What shipped per workstream with file references; proof outputs pasted;
what you deliberately did not build; update the R1 row in the brief's
status tracker; anything discovered that should reshape R2 (campaign
director) before its prompt is written.

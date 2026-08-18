# PR #78 execution prompt — playtest closure

You are implementing PR #78 of the Goldline rescue sequence. Read
`docs/goldline-rescue-sequence-brief.md` (the master brief) and
`docs/goldline-pickup-expedition-handoff.md` (tooling + landmines) BEFORE
touching code. This prompt is your scope fence: implement exactly this PR,
at production quality, and nothing beyond it.

## Context in two sentences

Goldline is an action-adventure game whose save file is the real laundry
business; it may dramatize truth but never fabricate it. The game's only
player just play-tested it and could not find section transitions, hit a
silent invisible wall at the end of the built world, misread a history
ribbon as a movement gate, and fought a combat expedition for a DESK task
whose climax did nothing — this PR closes those findings.

## Baseline

- Start from fresh `origin/main` (must contain `370a62d`, PR #77). Create
  branch `agent/goldline-pr78-playtest-closure`.
- If the working tree is dirty with work you did not author: STOP, report.
- Local verification environment: the docker + release-migration + harness
  recipe in the handoff doc. Never `pnpm db:push`. No migrations in this PR.
- The 28-ish pre-existing tsc errors are baseline; add none.
- Goldline bundle gate: 150KB gzip. This PR adds no dependencies and no
  bundled assets.

## Workstream A — route legibility

1. **Forward route cue.** When the route genuinely continues ahead and no
   objective cue is already showing, render a persistent directional cue
   (reuse the `objective-direction-cue` chevron pattern in
   `client/src/game/GoldlineGameHome.tsx`, ~2838). "Genuinely continues" =
   current corridor has a playable next corridor
   (`nextPlayableCorridorId`, `client/src/game/world/corridorRegistry.ts`)
   OR the player is below the current corridor's exit band. No cue on the
   last playable corridor once nothing lies ahead — never point at nothing.
2. **Exit landmark + transition as an event.** Exit arming today:
   `progress >= 0.77` with ordinary ceiling 0.82
   (`GoldlineGame.ts` `forwardCeiling()`, ~1272; `exitNear` at ~1873; the
   "ROUTE CONTINUES · DESTINATION READY" chip in `GoldlineGameHome.tsx`
   ~2833). Add: a visible landmark object or treatment at the exit zone
   (respect the art law: dark body, limestone rim light, brass — verify in
   a ZOOMED crop), and on reveal of the next corridor a brief section title
   moment (existing chip style; corridor labels are internal, so author two
   short player-facing section names in one place) plus the existing
   `corridor_transition` audio cue if it does not already fire on reveal.
3. **Honest end of the built world.** In the last playable corridor, at the
   ceiling band, a sparse authored marker in-world (one line of copy, e.g.
   "THE LINE ENDS HERE — BEYOND IS UNWRITTEN"). No invisible wall with no
   explanation. Keep copy sentence-length and rare — this is a monument,
   not a tooltip.
4. **Ribbon copy fix.** `GoldlineGameHome.tsx` ~2912: change
   "NO RESOLVED TERRITORY YET" to copy that cannot be read as a movement
   gate (e.g. "NO MISSIONS RESOLVED YET"). Check the string is not asserted
   in tests/scripts before renaming (`git grep "RESOLVED TERRITORY"`).

## Workstream B — climax honesty

1. Plain `open_channel` desk tasks (kind `open_channel` in
   `client/src/game/expedition/expeditionObjective.ts`) no longer stage a
   cargo-box expedition. They complete in the base via the existing task
   surface (`completeOpenChannelTask` flow). The expedition shell is
   reserved for objectives with real physical arrival: `native_pickup`,
   `external_order`, `local_target_run`. Trace every consumer of
   `preparedObjective` / ENTER THE LINE staging so no path still offers
   combat for a desk task (the adapters live in `GoldlineGameHome.tsx`
   `completeExpeditionObjective`, ~1814–1859; HUD labels ~2751–2807).
   LOCAL_TARGET_RUN behavior is untouched.
2. **Barrier release legibility.** When the Shieldbearer dies and the
   forward ceiling opens, the player must SEE and HEAR it: a brief visual
   release on the seal plus a distinct audio cue. Minimal is fine (a
   ~250–400ms fracture/pulse, not a cinematic). The single
   `activeClimaxBarrier()` predicate stays the one source of truth — you
   are adding presentation to an existing edge-detected state change, not
   new state.

## Workstream C — combat audio differentiation

`client/src/game/audio/AudioManager.ts` is a synthesized cue system already
wired into expedition callbacks in `GoldlineGameHome.tsx` (~1878–1968) — but
the palette is borrowed: `vault` currently covers four distinct events and
`weak_point_hit` covers hits. Add distinct synthesized cues and assign them
semantically:

- `strike_hit` (player's strike lands), `hostile_down` (kill — must feel
  terminal), `player_hurt` (distinct, softer than kill), `barrier_release`
  (Workstream B), and a securing cue for CARGO SECURED / WORK SEALED if the
  existing `captured_truth` cue is not already used there.
- Tune envelopes so hit < hurt < kill in weight. Two-tone or three-tone
  oscillator envelopes in the existing `CUE_DEFINITIONS` style; no assets.
- Respect existing audio settings and the documented `isCallActive` rule at
  call sites (AudioManager deliberately has no call-aware branching).

## Scope OUT (hard fence)

No movement-resolver or collision changes (that is PR #78.5). No world
transformation, no Answering, no Quartermaster. No new dependencies, no
migrations, no Pixi upgrades, no refactors beyond what the items above
require, no changes to business mutations or truth semantics. If a fix
wants to grow beyond this file's scope: stop and report instead.

## Verification (all required before the PR is opened)

1. Full existing gates: focused `client/src/game` vitest, repo tsc baseline
   unchanged, production build, bundle gate.
2. New local proof script `scripts/verifyGoldlinePr78.mjs`, modeled on the
   existing verify scripts (CDP real touch at 393×852, harness flag,
   fixture route): asserts (a) forward cue visible mid-corridor-01 with no
   objective ahead; (b) crossing the exit band into corridor_02 fires the
   transition moment (DOM chip + corridor id attribute flip — the host div
   exposes `data-corridor-id` / `data-next-corridor-id` / `data-player-progress`);
   (c) end-of-world marker present in corridor_02's ceiling band;
   (d) a desk `open_channel` task never renders ENTER THE LINE staging;
   (e) harness-gated cue counters fire for strike/kill/hurt/release.
3. CI caveat (recorded in the brief): real-CDP-touch gates race on GitHub
   Actions (`ab4df01`, `d94d50c`). Run the touch proof LOCALLY and paste
   its output into the PR description; add to CI only timing-safe checks.
4. Do not rely on screenshots alone; exercise the interactions. Verify any
   new in-world art object in a zoomed crop.

## Fun gate (Adam runs this on his phone after merge — include it verbatim in the PR description)

1. Fresh open: within five seconds, is there ONE readable pull toward
   where you should go?
2. Walk forward past the exit: does crossing into the next section feel
   like an event you could name?
3. Keep walking in the last section: does the game TELL you the world ends,
   in-world, without you wondering if it's a bug?
4. Open the door-hanger (desk) task: does it complete in the base with no
   combat staging anywhere?
5. Enter a real expedition (fixture or live): do a landed strike, a kill,
   and taking a hit each SOUND distinct — and does the Shieldbearer's
   barrier audibly/visibly break?

## Report format (end of your run)

1. What shipped, per workstream, with file references.
2. Proof outputs: script results pasted, gate results, zoomed art crops.
3. What you deliberately did NOT build (anything outside the fence you
   noticed and left).
4. Update the status tracker row for #78 in
   `docs/goldline-rescue-sequence-brief.md` (branch, status, SHA).
5. Anything discovered that should change #78.5 or #79's surgical prompts.

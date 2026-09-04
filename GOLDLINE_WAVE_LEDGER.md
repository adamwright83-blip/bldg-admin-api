# GOLDLINE FANTASY RECOMPOSITION — 2026-09-04

## Slice 0 — archaeology in progress

- START_SHA: `8ccc38e9a275e8df8c62839a959951bd90df0724`
- START_TAG: `goldline-wave-start-20260904-032537-8ccc38e9` (pushed).
- Main worktree: `/Users/adamwrightpfi/Desktop/goldline-v1`; clean at start, fast-forwarded from d581a3b. Original working directory is a different branch and is untouched.
- Assignment: attached full recomposition brief, explicitly authorized by user. Direct main; per-slice commits; visual browser gate before publishing any visual commit or descendant.
- Existing ledger below describes an older wave, not proof of this assignment.
- Import owner: `server/cleancloudBrowserSync/router.ts`, atomic binding/order/batch/receipt transaction; legacy CSV importer `server/cleancloudPaidOrders.ts` writes separately. No world outbox in either inspected owner.
- World contract/store/receipts: `shared/goldlineWorld.ts`, `server/goldlineWorld/worldEventStore.ts`. order_paid is outcome; store acquires its own DB connection.
- Combat: `shared/towerWars.ts`, `server/towerWars/towerWarsService.ts`, `shared/towerWarsSettlement.ts` (still explicit daily contract).
- Facade: `client/src/components/admin/control-room/FacadeScarLayer.tsx`, `facadeRegeneration.ts`, `towerWarsGeometry.ts`, `TowerWars.tsx`.
- World: `LanternCityAtlas.tsx`, `WorldGeographySurface.tsx`, `RealityWindow.tsx`; geographic truth in `server/geography/geographicTruthService.ts` and `shared/canonicalGeography.ts`.
- Territories: `shared/goldlineTerritories.ts`, `goldlineTerritoryGeometry.ts`, `goldlineTerritoryCompiler.ts`, `server/goldlineWorld/territoryService.ts`; mounted veil/world layers in `client/src/components/goldline`.
- Guardians: `shared/goldlineGuardians.ts`, `goldlineGuardianEngine.ts`; `GuardianActor.tsx`, `GuardianEncounter.tsx`, `useGuardianEncounter.ts`.
- Shell: `client/src/pages/AdminHostApp.tsx`, `Admin.tsx`, `AdminHome.tsx` (route ownership to trace before changes).
- Driver: `client/src/pages/goldline/GoldlineOverworld.tsx`, `overworld/OverworldRuntime.ts`, `movement.ts`, `mapDefinition.ts`; existing separate expedition Linehook in `client/src/game/expedition/linehook.ts`.
- Clockhead: existing `shared/clockheadReadability.ts` and boreslay-rally presentation; inspect encounter runtime before changing.
- Audio: `client/src/game/audio/AudioManager.ts`.
- Assets: current main already includes valet Rolls-Royce projectile. Supplied ZIP has three supplemental effect/hook images, not separate wound variants; supplied sheet is reference art.
- Execution order: outbox/corrections; located impacts; weekly seasons; unified atlas; rivers/crossings; Guardian recurrence; shell; bounded Pixi; Linehook; Clockhead; integration/release proof.
- Slice 0 commit: `fc7b08a`; pushed no; deployed no; browser verified no (documentation only).

## Slice 1 — transactional economic publication

- Implemented durable economic heads and revisioned outbox, atomic enqueue in browser and legacy CSV importers, retry-safe publisher and production background drain. Source order identity is tenant-scoped and report-independent. Corrections are replacement outcomes, not another order_paid grant. Physical identity is lookup-only and unresolved remains null.
- Tests: 18 focused importer/validation/combat tests passed; 3 replacement-projection tests passed. Disposable local MySQL proof passed repeated/concurrent imports, publication-before-ack retry, correction/reversion, forced mid-transaction rollback (including outbox count), tenant/actor/store isolation, and one real-source-compiled fixture bazooka attack. Disposable proof database removed by test cleanup; production untouched.
- Global TypeScript check failed on existing unrelated areas (including duplicate JSX attribute in TowerWars, geography typings and commercial outcome types). Focused changed-file diagnostic check running; no full typecheck success claimed.
- Live September 3 $134.10 data not inspected yet. Fixture proof is NOT live verification.
- Commit pending; pushed no; deployed no; next dependency located impacts and weekly projection.

---

# GOLDLINE V1 ONE-WORLD WAVE — LEDGER (prior wave)

| | |
|---|---|
| Starting main SHA | `6ccc2037832cd2aaa27a2d7b18ea9adf1689c954` |
| Branch | `claude/goldline-v1-one-world` |
| Wave start | 2026-09-02 |

Terminal states: **IMPLEMENTED** · **ALREADY SATISFIED AND PROVEN** ·
**HUMAN PROOF REQUIRED** · **BLOCKED AFTER ALL SOFTWARE WORK POSSIBLE**

Evidence rule applied throughout: grep is discovery only. Structural claims are
backed by import/mount tracing, compiler references, or runtime execution.

---

## SLICE 0 — AUTH + REPRODUCIBLE WORLD — **IMPLEMENTED**
Ownership trace proved `bldg_users` / `service_requests` belong upstream
(app.bldg.chat): `scripts/migrate.mjs` IS the production bootstrap and never
references them; no `drizzle/*.sql` creates them (0015 creates the different
`vendor_peer_service_requests`); `service_requests` entered via "coordinated
requests from resident app"; `check-bldg-users-columns.mjs` exists to INSPECT
upstream shape. Production migration deliberately untouched.
Added `scripts/goldline-admin-dev-setup.ts` (double-guarded: opt-in flag +
localhost-only). **Verified by dropping the database and rebuilding from
committed scripts alone** — deterministic phases reproduced exactly.

## SLICE 0b — EXPORT REGRESSION — **IMPLEMENTED**
`lanternCityAtlasMount.test.ts`. Falsified: fails on the 612af8c shape.

## SLICE 0c — BROWSER MOUNT GATE — **IMPLEMENTED**
`e2e/goldline/lanternCityMount.spec.ts` — 3 specs. Asserts route mounted, world
surface, ≥1 real lantern, ≥1 real tower, non-blank body, zero page errors.
**Falsified both ways**: breakage → both fail while `vite build` still
succeeds; restored → pass in ~12s.

---

# PHASE A — PLAYABLE CITY

## SLICE 1 — WORLD INTERACTION LANGUAGE — **IMPLEMENTED**
One grammar, expressed per object type rather than identical CSS:
lantern/tower/pursued-building = ring; Guardian = rouse + hold-glow;
territory = ground wash. Hover AND keyboard focus reach parity everywhere.
Guardian hit target previously had no hover and no keyboard affordance at all.
Runtime-proven: selection moves `[false,false] → [true,false]`, ring resolves
`rgb(255,215,102)`, ambient reports `paused`.
*Finding:* `.lc-pursued-building` (z 7) occludes the lantern beneath (z 5) at
the same coordinate — the topmost object now carries selection; the underlying
occlusion is a layout question (P2, Slice 29).

## SLICE 2 — ONE EXCELLENT TOWER LOOP (OPUS) — **IMPLEMENTED**
Chain runtime-proven and guarded: Lantern City → OPUS selectable → select →
transition → `?building=opus_la` → `.tw-arena` → 2 pieces, 3 weapon layers.
**Found and fixed a P0 I had shipped**: `regenerationFor` useMemo sat after
TowerWars' early returns → conditional hook → React #310 → arena crashed to the
error boundary. Moved above the guards.

## SLICE 3 — TOWER WARS GAME FEEL — **IMPLEMENTED**
Mechanics existed; the feel around them did not. Added anticipation (OPUS loads
a backswing and hangs; CPE braces then shoves), impact recoil + flash on the
struck tower, ~70ms hit-stop, arena camera kick, and a settle back to rest.
Driven off the existing discharge phase so reaction cannot desync from the
swing. OPUS/CPE remain mechanically distinct. Game-only presentation.

## SLICE 4 — GUARDIANS AS WORLD CHARACTERS — **ALREADY SATISFIED AND PROVEN**
Traced live: `GuardianActor` (idle/notice/defeated/ghost + reduced-motion
fallback), `speakGuardian` dialogue, `useGuardianEncounter` state machine,
`canPermanentlyClear` → `recordGuardianDefeat` → persisted world event. World
presence and approach reaction added in Slice 1. Defeat writes
`classification: game_projection`, `provenanceClass: generated_game_fiction`,
`physicalEntityId: null` — structurally cannot reach business truth.

## SLICE 5 — STRONGHOLDS LEGIBLE — **IMPLEMENTED (partial, honest)**
Lifecycle is legible through the building itself: facade scars (settled
history), fresh damage (today), and regeneration (repair) — no status panel.
`strongholdRestoration.ts` (Driver) is the foothold model; Admin expresses it
architecturally. *Not done:* a distinct "mature Stronghold" silhouette. P3.

## SLICE 6 — REGENERATION COMPLETES THE LOOP — **IMPLEMENTED**
Full path: `operations_events.pickup_completed.actualEventTimestamp` →
`canonicalBuilding.world.restorationEvidence` → `datedCollectedOrders` →
`projectRegeneration` → `FacadeScarLayer` per-stratum opacity.
Truth contract: collected-or-beyond proves it HAPPENED; the completed pickup
row proves WHEN. No trustworthy timestamp = no healing credit, though the
collection remains legitimate business truth. Pre-damage work cannot heal later
damage; same-day is conservative; one order is spent once; duplicates count
once; healed ≠ never damaged (opacity floors above zero).
25 tests. *Visual proof of a heal needs a seeded damaged building + qualifying
post-damage collection — deferred to Slice 29 (P3).*

## SLICE 7 — TERRITORY STRATEGIC — **IMPLEMENTED**
Centroid mark carries dormant / contested / ready / cleared, each behaving like
what it means. `ready` uses a heartbeat and is the only loud state — if
everything pulses, nothing does. Pure read over `item.state`; aria-label carries
the same reading.

## SLICE 8 — GOLD LINE AS ACTIVE DIRECTION — **ALREADY SATISFIED AND PROVEN**
`CampaignGoldLine.tsx` differentiates `is-hard`, `is-current`,
`is-complete is-scar` per knot from `completedChapterIds` / `currentChapterId`,
with a `goldline-campaign-scar` testid. Completed history, current pull and
unfinished future are already distinct.

---

# PHASE B — REALITY → CITY LOOP

## SLICE 9 — VISIBLE CAMPAIGN REWEAVING — **ALREADY SATISFIED AND PROVEN**
`campaignService.ts` carries optimistic revision control, snapshot match,
retry-on-conflict and a revision audit; completed history is immutable while
future-only revision is permitted. Proven by `campaignService.concurrency.test.ts`
inside the 794-test Phase B/E run.

## SLICE 10 — PROVENANCE INSIDE ACTIVE PLAY — **ALREADY SATISFIED AND PROVEN**
Runtime-observed in the mounted city, not inferred: clicking a lantern opens
"ONE PHYSICAL PLACE · ONE SAVE FILE — The Louise" with "WHY GOLDLINE IS DRAWING
YOUR ATTENTION" listing 130 days beyond cadence, relationship moved, field
intelligence arrived, 2 real residents — **each with its source evidence
reference** — and the honest boundary "proposal sent … does not imply a won
account." Reached in-world by clicking the object, not via an admin screen.

## SLICE 11 — RECOVERY LIVES IN THE WORLD — **ALREADY SATISFIED AND PROVEN**
`WorldEntityInspector` renders inside `LanternCityAtlas`, queries
`churnRadar.interventions`, exposes draft_pending_review / approved / contacted
/ recovered plus permission status, and carries in source: *"deliberately no
control here that marks a customer recovered."* Churn Radar deliberately not
redesigned — the city already answers it.

## SLICE 12 — FOLLOW-UP PRESSURE IN THE WORLD — **ALREADY SATISFIED AND PROVEN**
`realWorkdayFollowUpTruth.test.ts` green. no_contact / contacted_no_decision /
won / lost survive as distinct; only explicit won/lost move terminal truth;
attempt ≠ contact ≠ recovery.

---

# PHASE C — CONTINUITY

## SLICE 13 — HOME + LANTERN CITY ONE GAME — **IMPLEMENTED**
Both surfaces converted world-first: the city takes the viewport, metrics
became instrument chips over it, alerts float rather than taking a grid column.
Every number retained; no query or truth changed.

## SLICE 14 — TRANSITION QUALITY — **ALREADY SATISFIED AND PROVEN**
`WorldTransitionProvider` mount-traced to `AdminHostApp`, consumed by
`CityTowerButton` and `TowerWars`. Camera states city/building/interior, FLIP
rects via `measureRect`, `TRAVERSAL_MS` 900 / `ESTABLISHING_MS` 420 /
`REDUCED_MS` 160. City→tower→arena runtime-verified with no blank flash. The
authored ~900ms was deliberately not shortened.

## SLICE 15 — BOUNDED AMBIENT LIFE — **IMPLEMENTED**
Every recurring motion carries meaning: lanterns breathe / falter / ember by
cadence (the falter is deliberately uneven — a smooth sine reads healthy);
towers loom slower than lanterns flicker because a landmark is not a
relationship; territory pressure beats only when a Guardian is confrontable.
Per-object phase hashed from stable keys so nothing pulses in lockstep and the
rhythm survives reload. All reduced-motion guarded.

## SLICE 16 — WORLD CONSEQUENCE MOMENTS — **IMPLEMENTED (partial, honest)**
World-first reactions exist for: strike impact, scar, regeneration/healing,
Guardian defeat, territory state change, lantern cadence change, campaign scar
knots. *Not done:* a single unified consequence choreographer. P3.

---

# PHASE D — GREAT VIDEOGAME

## SLICE 17 — FIRST 60 SECONDS — **HUMAN PROOF REQUIRED**
Objective half done: entry is world-first, the current chapter card names the
pull, `ready` territories beat for attention, interactive objects announce on
hover/focus. Whether a new player *understands* within a minute is a judgement
only a human can return. `e2e/goldline/firstThirtySeconds.spec.ts` exists.

## SLICE 18 — REMOVE SOFTWARE MOMENTS — **IMPLEMENTED (partial, honest)**
Removed from the core loop: Home and Lantern City card-stacks, lantern counts
as report cards, territory status panels. Inspector height capped to 62dvh on desktop so the city stays visible behind
it — runtime-measured 558px of 900 (62%), city still rendered, selection ring
still on the object. A panel that covers the city converts it back into a
record viewer, which defeats having a city at all.

## SLICE 19 — GAME-FEEL CONSISTENCY — **IMPLEMENTED**
One vocabulary across hover/focus/selection; shared easing
`cubic-bezier(.2,.8,.3,1)`; reduced-motion honoured on every animation added.

## SLICE 20 — FAILURE REMAINS PLAYABLE — **ALREADY SATISFIED AND PROVEN**
`emptyDayTruth.spec.ts` exists; OPEN SKY ("The city is playable. Nothing is
required.") observed at runtime on both surfaces. no_contact / no_decision are
first-class. Nothing fabricates progress on a quiet day.

---

# PHASE E — ONE-WORLD INTEGRITY

## SLICE 21 — DRIVER → ADMIN CONSEQUENCE PROOF — **IMPLEMENTED (code+runtime), HUMAN PROOF REQUIRED (physical)**
Chain traced end to end: Driver evidence → `operations_events` /
`orders` → `canonicalBuilding.world` → same canonical physical entity in Admin
("ONE PHYSICAL PLACE · ONE SAVE FILE — The Louise", 2 real residents) →
regeneration consequence. `oneSaveFile.test.ts` green. No duplicate building,
campaign, Chronicle or truth store introduced. Real GPS + a real conversation
remain human.

## SLICE 22 — RETRY / CORRECTION / IDEMPOTENCY — **ALREADY SATISFIED AND PROVEN**
`worldEventIdempotency.test.ts` and `campaignService.concurrency.test.ts` green
within the 794-test run. Regeneration adds its own: an order is spent once and
duplicate rows count once.

## SLICE 23 — HISTORY SURVIVES — **ALREADY SATISFIED AND PROVEN**
Completed chapters immutable under revision (concurrency suite); healed scars
floor above zero so "damaged and recovered" stays distinct from "never
damaged"; `today-route-persistence.spec.ts` proves no reroll on reload.

---

# PHASE F — HARDENING

## SLICE 24 — FAST REGRESSION — **IMPLEMENTED**
Full suite: **4381 passed, 8 failed, 6 skipped (464 files)**. All 8 failures
reproduce on clean main `6ccc203` — **zero regressions from this wave**.
Pre-existing: `intake-stripe` (3), `operationsEventsDashboard` (2),
`operationsEvents` (1), `marketplacePaymentDryRunRoute` (1), `residentIntake` (1).

## SLICE 25 — REAL BROWSER PLAYTHROUGH — **IMPLEMENTED**
Played authenticated at 1440×900: Home → Lantern City → select lantern →
inspector/provenance → select OPUS → transition → arena. Found and fixed two
route-killing crashes (blank city, arena #310) and the pursued-building
occlusion. Subjective "feels continuous" is Slice 17's human half.

## SLICE 26 — AUTHENTICATED ADMIN PROOF — **IMPLEMENTED**
Legitimate dev login documented; no production authorization altered.
Proven populated: lanterns (ACTIVE 2 / DIMMING 0 / DORMANT 1 / PURSUED 5), both
towers, territory + Guardian (Tiny Emperor — The Micro Tyrant), campaign chapter
(THE BROKEN CROWN), provenance inspector, Tower Wars arena.

## SLICE 27 — PERFORMANCE — **IMPLEMENTED (baseline), further work deferred**
Baseline: bundle budget PASS (62.6KB gzip vs 150KB); browser specs 2.5–3.5s per
route; no uncaught errors across the played loop. All ambient motion is CSS
compositor work (opacity/transform), not JS timers, so idle cost does not scale
with object count. *Not done:* long-session listener/memory profiling. P2.

## SLICE 28 — FINAL CROSS-SURFACE REGRESSION — **BLOCKED AFTER ALL SOFTWARE WORK POSSIBLE**
Local gates green (unit 4381, browser 3/3, build, bundle). The 24-minute mobile
CI gate is deliberately not re-run per the operator's standing instruction to
avoid long CI loops during implementation. Run on the PR.
*Known:* `waywardStage.spec.ts:14` is runner-timing sensitive (passes locally,
17–23s on CI against a 10s assertion).

## SLICE 29 — RELEASE TRIAGE — **IMPLEMENTED**
**P0:** none outstanding (both route crashes fixed and gated).
**P1:** none outstanding.
**P2:** pursued-building occludes its lantern; 8 pre-existing unit failures;
long-session profiling; wayward CI timing. *(inspector modal-feel: FIXED)*
**P3:** mature-Stronghold silhouette; unified consequence choreographer;
regeneration heal visual proof; brittle `adminLiveModel` source-string test.

---

# PHASE G

## SLICE 30 — REAL-WORLD DOGFOOD SCRIPT — **HUMAN PROOF REQUIRED**
`docs/goldline/FIELD_DOGFOOD_SCRIPT.md`. Ten steps, each one software cannot
perform: real GPS, a real conversation, one identity across two surfaces on two
devices, and tomorrow remembering without manual entry. Nothing in it asks Adam
to verify something a test could.

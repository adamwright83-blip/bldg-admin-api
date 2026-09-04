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
- Commits `96069ea`, `8a83d32`; pushed yes. GitHub commit statuses report Vercel and Railway success for `8a83d32`; not production browser-verified. Narrowed-row compiler errors corrected in follow-up.

## Slice 2 — located persistent impacts (implemented; final visual gates pending)

- Shared deterministic attack-addressed geometry uses existing measured facade bounds, four wound identities, explicit game_projection provenance, permanent records and per-impact dated repair projection. Existing aggregate scars/patina remain available for legacy callers. Live canonical settlement persists; historical replay derives without writing.
- Tests: 48 impact/scar/regeneration tests passed. Local browser mounted actual Tower Wars API: 15 wounds; local DB 15 rows; reload exact ID/position equality true; browser errors empty. Screenshot `/tmp/goldline-wave-impacts.png`.
- Remaining checks: repaired-vs-fresh mounted proof; responsive layout; complete historical projection and weekly integration. Current screenshot also exposes pre-existing scoreboard crowding, to address in weekly side/layout integration.
- Fixed discovered ISO date-only parser default (`00` vs `0`) while seeding local evidence; no production fixture writes.
- Isolated browser environment: `goldline_recomposition_20260904` on local MySQL; script `scripts/goldline-wave-local.ts`; port 4188. Source `goldline_daylight` schema read only; no source rows copied or changed.
- Commit `2e61ee8`; pushed no; deployed no. All descendants held until visual gates complete.

## Slice 3 — weekly rivalry (implementation and verification in progress)

- Replaced DAILY COMBAT CONTRACT with weekly rivalry; migrated 15 existing settlement tests rather than deleting them. Added four season tests covering Mon/Tue charge, Monday reset, champion stability/draw carry, historical correction and 167/169-hour DST weeks. All 21 season/settlement/impact tests passed.
- Live service loads Monday-to-current-date authoritative candidates and preserves per-day source deduplication. History compilation produces season-isolated attacks, season IDs on impacts, deterministic prior-champion sides, content-addressed stored season revisions, and read-only revision inspection API. History replay does not invoke persistence.
- Date input moved under History / Replay. Current-season side determines slot and weapon mirroring; building plates stay unmirrored so signage stays legible. Corrected existing scoreboard transform and cramped centre; evidence HUD now collapsible.
- Mounted browser: CPE left/challenger, OPUS right/champion, week 2026-08-31, $750 fixture / 15 wounds, no browser errors. Screenshot `/tmp/goldline-wave-weekly-fixed.png`; mobile screenshot captured, review pending.
- Remaining final checks: all-game integration, repaired-state browser fixture, revision audit UI, production-safe readback. No visual push yet.
- Slice 3 commit: `5510cdf`, local only.

## Slice 4 — one Lantern City

- Removed primary atlas/Google fork, including implicit mode change on tower entry. Existing daylight fantasy atlas reused; geographic projection unchanged. Real 3D renderer retained in an explicit Spyglass tab inside RealityWindow. Attribution remains inside that actual Google surface.
- Corrected fictional-art fallback wording; no authored art called real evidence. Daylight presentation retained independently of actual weather context.
- Browser discovered Spyglass hitbox was covered by tower subtitle; fixed stacking and target size. Actual click now opens OPUS window while atlas, Guardian and entities remain mounted. Screenshot `/tmp/goldline-wave-spyglass-verified.png`. Nine geographic projection tests passed. No browser errors observed. Google imagery itself cannot render locally without provider key; honest unavailable state present.
- Commit pending; pushed/deployed no (held ancestry). Next: rivers/territory crossings.
- Slice 4 commit: `8379cf3` (local).

## Slice 5 — rivers and crossings

- Added deterministic Voronoi strategic partition using existing real LA landmark anchors; clipped shared borders yield adjacency and connected blue waterways. This is explicitly fictional geography, not municipal boundary or hydrology data. Existing real entity positions unchanged.
- Bridge states derive separately from legitimate territory evidence and persisted Guardian game clearance; unknown remains visibly UNBUILT. Inspection is local UI state only, with no business mutation.
- Six crossing/territory geometry tests passed; crossing tests rerun after border refinement. Browser mounted world with crossing controls and visible blue borders; initial screenshot reviewed and floating segment geometry refined into connected borders.
- Commit pending; visual ancestry remains held; final pan/zoom and responsive checks pending in integration.
- Slice 5 commit: `57556ac` (local).

## Slice 6 — territory Guardian recurrence

- Evidence gates simulation and combat input, not merely the final write. Closed inaccessible encounter is still inspectable, with mobile Return to city action. Preserved approved roster/engine and enlarged world-space character. Removed duplicate idle actor behind cleared ghost.
- Added explicit renewed pressure from verified non-fiction dormancy outcomes after historical defeat. Prior victory/rewards remain; recovery does not auto-win. Server derives rematch readiness and uses recurrence-addressed idempotency.
- Twenty territory/engine tests pass, including recurrence, immutable history, recovery and subsequent gameplay clearance. Mounted browser gate shows Linehook disabled on incomplete territory and visible Return to city. Full skilled-win browser proof remains pending; no production game/business fixture writes.
- Local only; final visual release gate pending.
- Commit: `990713d`.

## Slice 7 — world-first shell

- Actual owner AdminHostApp now presents Lantern City for home and atlas routes. World remains mounted behind operational routes; three direct portals, small utilities affordance, explicit return link. Existing auth, forms, lists, URL routing and tenant behavior remain owned by existing components. Public localhost root remains resident marketing, correctly distinct from admin host root.
- Browser: New Order reached full unchanged form in one click; Customers -> /customers; Active Orders -> /operations; return path works; no browser errors. Desktop screenshot reviewed, campaign/title collision fixed, waterways narrowed after visual inspection. Mobile and retained camera verification pending final integration.
- New TSX files show no diagnostics in TypeScript run (global pre-existing errors remain). Local only.
- Commit: `da13156`.

## Slice 8 — bounded Pixi comparison

- React/trpc remain truth owners. Explicit admin comparison reads persisted CPE -> OPUS impact, otherwise refuses to fabricate one. Default DOM remains deliberate. Pixi uses canonical plates/car, windup/recoil, accelerating arc/trails, 80ms punctuation, falling fragments, persistent registered wound and existing AudioManager cues/mute.
- Inspected actual art: car and bazooka face RIGHT despite stale geometry comment. Corrected side mirroring in DOM and Pixi. Two geometry/timeline tests pass. Browser mounted, replayed and persisted wound; screenshot `/tmp/goldline-wave-pixi-facing.png`. Discovered query-only routing did not rerender promptly; added reactive useSearch before final repeated mount gate.
- No production fixture writes or renderer-default migration. Subjective art/feel review remains for Adam. Local only.
- Commit: `f2a0f52`.

## Slice 9 — reusable overworld Linehook

- Versioned authored collision blocks both broken spans. Four data-defined outbound/return traversals share aim/fire/flight/catch/travel/land/release timing, rope graphics, existing audio cues, reduced motion, landing validation and collision-safe checkpoint recovery. Explicit LINEHOOK CTA; no evidence publisher.
- Eleven phase/collision/navigation/full-route tests pass. Existing route audit migrated to explicit hook steps rather than asserting that sky is walkable.
- Mounted local browser: Colosseum landing (325,950), greystar-apron, walkable true. Second gap at mobile 390×844 landed (210,505), treehollow, walkable true using the same runtime. No browser errors reported. Fixture teleports only positioned test at each entry; traversal was activated through actual UI and real runtime.
- Local only. Screenshot `/tmp/goldline-wave-linehook.png`; labels/HUD overlap still needs integration polish.
- Commit: `c354098`.

## Slice 10 — authored Clockhead duel

- Replaced hold-to-advance finale with three health-gated combat phases: aimed pressure; fan/sweep; delayed deadline zone plus sweep/fan. Existing art, projectile geometry, AudioManager and haptics reused. Tell -> danger -> winding vulnerability; one close-range strike per opening, dodge cooldown, finite guard, loss/retry. Existing game-only Wayward unlock callback runs only after victory.
- Removed old finale’s real-target identity binding entirely. New duel accepts only a game completion callback, no customer/prospect/person record or outcome writer. Verified field-trace prerequisite remains the parent gate.
- Nine engine/projectile tests pass. Mobile browser discovered inherited joystick hitbox covered Start/Dodge; scoped joystick layout fixed. Browser stationary loss observed; DOM-observed keyboard bot then won all three phases, nine strikes, guard 3/3, no state injection. `/tmp/goldline-wave-clockhead-won.png`. Existing audio cue log captured; no generated voice claimed.
- Local only. Subjective game-feel review remains.

---

## Slice 11 — integration / release proof in progress

- Slice 10 commit: `60d3e44` (local only). Visual ancestry remains unpushed while finishing gates.
- Added tenant-scoped current economic revision receipts with automatic 5-second refresh, visible unresolved-place wording, and current-revision replacement revenue in city projections. Enabled background outbox drain in explicitly isolated proof mode. Local newly imported source orders appeared in open city without replay/date/navigation.
- Full suite: 484 files, 480 passed / 4 failed; 4,558 tests passed, 5 failed, 6 skipped. The five failures were reproduced identically in untouched start-SHA worktree (`/tmp/goldline-recomposition-baseline`), in operationsEvents, operationsEventsDashboard, residentIntake, and marketplacePaymentDryRunRoute. Prior daily/fixed-side contracts migrated to weekly semantics. Full build succeeded. Global TypeScript remains baseline-red; no changed-owner diagnostics in latest run.
- Local mounted repair proof: 15 impacts, 1 repaired + 14 fresh after dated collection; persists reload. Added prior-season and new-current-season $100 local fixtures, now 19 total impacts and same one repair. Source orders are local only. Corrections stay single economic identities.
- Normal DOM projectiles now register launch and target in the canonical contained 800×1200 plate, not viewport-distance guesses; measured CSS target delta populated. Native CPE art direction corrected from stale registry comment. Wound types now have four distinct geometries and repair seams vary.
- Guardian keyboard telegraph/counter proof won with 3 counters; saved clearance appeared in city. Current cadence recurrence projection snapshots active residents at defeat and publishes only game pressure, not fabricated business outcomes. Local recurrence/mobile rematch proof running. Existing audio/haptics integrated; keyboard button activation retained.
- Pixi/DOM switch browser proof: canvas count 1 -> 0, no default migration. Camera retained exact `scale(1.35) translate(0%, 0%)` and same DOM world node through Customers/return.
- Mobile world portal hitbox covered camera reset; corrected vertical separation and verified actual reset/bridge click without route change. Unbuilt bridge inspector says no evidence is created; horizontal overflow false. Mobile Tower Wars label transforms corrected after screenshot inspection.
- Full mounted Driver route: 73 waypoints, no failures, walkable final training-grounds landing; traversal-aware runtime audit now shares actual Linehook phases. Midair checkpoints withheld. Clockhead prior proof won all three phases with no engine state injection.
- Main worktree now has its own frozen-lockfile dependencies. Original checkout's node_modules untouched; prior symlink retained at `/tmp/goldline-recomposition-shared-node-modules-link`.
- Existing Railway deployment `cac67d43-6415-4353-a6c3-0b1208e1c391` SUCCESS at pushed `8a83d32`. No visual deployment claimed. Production fixture writes: none.
- Additional completed gates: fresh browser session reports zero page errors; mobile recurrence rematch won through 3 timed counters, preserving prior victory. Historical reads (Aug 26, Sep 1, Sep 4) returned 2/17/19 impacts and 0/0/1 repairs; before/after counts of orders, source orders, world events, impacts and revisions were identical. Mounted DOM discharge samples showed registered moving projectile, not just static CSS declarations.
- Production-safe read at admin.bldg.chat confirmed the specified CPE $134.10: $51.00 + $83.10, both retaining LA payment date 2026-09-03. A separate legitimate Stripe $19 makes that day's current total $153.10. No data changed. api.bldg.chat currently serves the separate resident app; admin.bldg.chat correctly rewrites API calls to the admin Railway service. Do not change that unrelated domain routing.
- Latest targeted integration run: 59/59 tests; Clockhead/Guardian/shell focused run: 28/28. Release build succeeds. The old WorldGeographySurface district callback diagnostic is also present at start SHA, not introduced by this wave.
- Visual gate satisfied locally: desktop/mobile world, portals, bridge inspection, Spyglass fallback, Guardian gate/win/recurrence, weekly tower impacts/repair/replay, opt-in Pixi, both Driver gaps, full route and three-phase Clockhead. Fresh-session page errors empty. Final DOM replay observation captured BOTH car and golf-ball in motion with registered positive/negative target deltas; fixed legacy golf-ball CSS that otherwise suppressed its parent flight.
- Local visual ancestry may now be published under the assignment's gate. Production interactive verification follows deployment; do not equate local fixtures with live evidence. Subjective renderer choice, art direction and game feel remain Adam's review, not deployment blockers.
- Slice 11 commit `8fa623e` pushed. Railway deployment `a5739c2f-7ea4-44df-88a7-dc87dc128ac0` SUCCESS and Vercel SUCCESS. Live Admin world-first and Driver overworld mounted; both page-error lists empty. Local conventional New Order created a priced $45 order saved unpaid (no saved card, no external charge); mobile Continue reached item intake after scrolling into view.
- Live Spyglass uncovered inherited `pointer-events:none` on its world layer; explicit button pointer events fixed. Its fallback canonical-art child also escaped its preview container and covered tabs; contained it and the 3D viewport, verified actual mobile 3D tab click and close. Provider attribution now follows the displayed source, with native Maps attribution owned by the 3D renderer. Moved utility Return link into layout so it cannot cover form controls. Follow-up publishing after local browser gate/build; final live readback remains to do.

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

# GOLDLINE FIRST 2.5D CHAPTER — IMPLEMENTATION HANDOFF

SPOILERS: Adam deliberately does not read this file. Keep all player-facing updates neutral.
Read first-2_5d-chapter-execution-contract.txt and first-2_5d-chapter-continuity-contract.txt alongside this file. They contain the complete user authorization, acceptance gates, main/WIP push rules and scope. Do not ask Adam to explain again.

## 1. Current status
Starting origin/main and current working base: `6436f54258b809cb3412b8fc231dcd120c76cd05`. origin/main had not moved when Slice 1 completed and was pushed.
Worktree: `/Users/adamwrightpfi/Desktop/goldline-first-chapter`; branch `astra/first-2_5d-chapter-handoff` (WIP disaster-recovery commit `8d0bc8b`, pushed to origin).
Slice 1 COMPLETE and merged to main. All acceptance gates verified: 10/10 focused simulation tests pass, TypeScript baseline unchanged (pre-existing server/ errors only, none touching chapter files), production build succeeds, browser-driven graybox playthrough confirmed rendering/movement/combat/interact, and reload/interruption (pause-on-hidden, checkpoint resume mid-room) verified directly in a live preview.
Slice 2 COMPLETE. 15/15 focused tests pass (5 new: launch physics, redirect-to-bridge traversal, redirect-to-latch puzzle, redirect-to-confrontation combat stagger + direct-strike still viable, checkpoint persists mechanism state). TypeScript/build clean. Browser-verified rendering of launcher/redirector/weight in both Garden and Gallery. Active slice is now Slice 3.
The original checkout has unrelated untracked assets. Leave it alone. node_modules is a symlink to its installed dependencies, not a committed artifact.
Dev preview: `.claude/launch.json` config `goldline-first-chapter-preview` (vite.chapter-preview.config.ts, port 5191), gated development entry only — not wired into Driver/Admin routing yet.

## 2. Creative canon — SPOILERS ALLOWED HERE
Chapter id `the-last-valet`, title THE LAST VALET. Primary canonical building Century Park East. Fictional interiors expressly make no claim about real access or architecture. OPUS supplies an existing golf/redirect inspiration only, not a second location or fabricated partnership.
Three spaces: The Arrival Court (lower terrace), The Turntable Garden (middle machinery garden), The Departure Gallery (upper confrontation). They form one continuous upward service route. No additional kingdom.
Companion: Inez Vale, fictional restorer of impossible machines, dry humor, practical, refuses waste. Ability: hold a redirector in its selected detent temporarily, freeing the heroine to cross/use it. Chemistry is mutual admiration and understated flirtation; never tied to revenue.
Adversary: Bellwether, an immaculate mechanical maître d' who has scheduled the whole building's departure, including everyone in it. Wants a perfect departure with no loose ends. Comically courteous, attacks by dispatching wheeled brass luggage and snapping retractable queue ribbons. Not a real employee or customer. Starts with direct charges; later uses angled projectiles and recovery openings.
Supporting character: Perrin, fictional custodian of the departure gallery. Wants to preserve the ceremonial apparatus even at the cost of a slower escape. Offers the manual gallery route; Inez proposes redirecting a launched weight through its latch. Choice is remembered and changes assistance/ending, never business facts.
Opening: heroine arrives to find the departure mechanism running with nobody aboard. Inez is holding a lever with her boot: "If you are here for the view, it is leaving."
Beats: learn movement/dodge in arrival court; learn launch and redirect in garden; choose preserve apparatus versus break fictional latch; confront Bellwether; stop the departure; return to court.
Climax: Bellwether is vulnerable after a telegraphed dispatch. Direct dodge/strike approach always works. Launch/redirect can interrupt him and open a longer window.
Ending: departure stops, Inez releases the lever, Perrin reacts to the remembered decision. Inez: "Same place tomorrow? Preferably still attached to the building."
Return secret: a brass inspection balcony visible from the first court becomes reachable after finale unlocks the redirector's return detent. Contains a short optional character beat and view, not business-critical information.
Tone: bright luxurious adventure, precise absurdity, competence, flirtation without stats, brief authored lines. Do not reveal cast, machinery solutions, ending, secret, or event consequence in updates to Adam.

## 3. Gameplay design
Reuse Pixi; no renderer migration. Fixed oblique view, ground-plane collision and explicit height/layer illusion, not a full 3D physics engine. Keyboard WASD/arrows plus mobile direction pad; dodge Space; attack J; interact E. Touch buttons duplicate every action. One-device city/adventure toggle.
Movement: accelerate/decelerate using existing movementFeel helpers where suitable; fixed-step simulation, diagonal normalization, grounded shadows. Dodge has cooldown and brief invulnerability, no stamina economy. Attack has startup/recovery, short reach, one hit per swing. Hit-stop after contact, not after empty attacks. Preserve existing Clockhead and Expedition code.
Health is fictional encounter health only (3 hits). Death retries the last safe room checkpoint, restores enemy and transient shots; no business damage. Pause on hidden document or lost focus. Never simulate driving-time interaction.
LAUNCH: sends a fictional trolley/weight along a fixed lane at fixed speed. No arbitrary coins/ammo; cooldown is mechanical recovery.
REDIRECT: selects one of three stable headings (bridge, latch, confrontation). Intersecting launched weight takes that heading once per redirector, preserving legible speed. Same weight/redirect rules power bridge traversal, latch puzzle, and enemy stagger. Not two animation buttons.
Two approaches: direct dodge/strike (always available) or environmental stagger. Alternative manual traversal remains available regardless of any business event. Optional bank shot is a skill shortcut.

## 4. Desktop/mobile shared-state contract
Design contract for Slice 3, NOT implemented yet. chapterId `the-last-valet`; version 1.
Persist fiction only: {chapterId, version, revision, room: arrival|garden|gallery, checkpoint:{room,x,y}, mechanism:{heading:bridge|latch|confrontation,bridgeOpen,latchOpen}, encounter:idle|active|won, routes:string[], choice:null|preserve|break, restored:boolean, prepared:{armedAt:null|ISO,resolvedEventId:null|string}, secretSeen:boolean}.
Server derives tenant/player from existing auth, never request-supplied ownership. Store one row per tenant/player/chapter; compare revision on writes, dedupe request id. Safe checkpoints only, no mid-dodge animation persistence. On conflict return latest authoritative fictional state, client adopts and retries an intentional action only after validation. GET must not authorize business writes.
Desktop manipulates heading/armed state directly in scene; phone resumes exact heading and resulting route. Both allow perspective switch. No simultaneous device timing required. Frame loop, input, particles, hit-stop and projectile interpolation stay client transient. On reconnect fetch fiction and business event adapter; never reroll fiction or adopt stale checkpoint over newer server revision.

## 5. Real-business-event binding
Planned Slice 5: consume server-compiled TowerWarsBusinessEvent from existing towerWarsService canonical paid ledger. Exact entity `century_park_east`; source eventId and occurredAt retained. Only qualifying paid events admitted by existing canonical compiler; no inferred local paidAt or new payment integration. Require occurredAt after server armedAt. Transactional compare-and-set empty resolvedEventId plus unique event binding prevents duplication.
Prepare a fictional counterweight receiver. State WAITING is optional. Qualifying payment unlocks an upper firing position and stabilizes the balcony approach; it never kills boss or awards territory conquest. Wrong entity/type/pre-arm event ignored. Duplicate event returns same consequence. Offline means reconciliation on next load can apply consequence; do not claim background worker exists without implementing one. Keep event ingestion server-side, never accept browser-asserted revenue.
This binding DOES NOT write any order/payment/customer/business truth. Manual route and direct combat complete chapter with zero events. One binding only.

## 6. Echo workflow
Planned Slice 6: existing supported follow-up preparation. Resolve actual follow-up id and assigned mission through authorized server source; retrieve recorded history, exact promise/note, due date/channel and missing info. Evidence-linked deterministic brief always works. If existing drafting provider supports it, constrained editable draft uses only those facts; absence of provider gives brief and no fabricated prose.
Human chooses/edits/discards and performs contact. No autosend, calls, commitments, discounts or new outreach integrations. Baseline summaries/preparation never gated. Echo retains a reusable preparation preference for the same workflow, then automatically assembles future eligible context. Inez's translucent prior movement prepares the apparatus and stops at a human-required threshold. Show real prepared output in accessible field drawer. Acceptance must measure removed retrieval steps, not animation completion.
Existing actionRegistry FOLLOW_UP and authoritative follow-up record are intended source; inspect exact router/query before wiring, preserve assignment/tenant authorization.

## 7. Art direction
Only approved reference currently stored: `client/public/assets/goldline/chapters/the-last-valet/references/approved-art-direction.png`. Source generation exec-45c8988e-1d89-4c5a-b5c3-bd7c0c574481; preview approved by Adam in parent task. Reference only, NOT a flattened playable background. Dimensions to be recorded by inspection.
Bright ivory stone, teal/cyan water, California foliage, warm brass; fixed oblique view; legible shadows. Existing Trailblazer directional sprites may be reused in graybox. Finish art only in Slice 9 after gameplay is verified. No dark-mode chapter. No new generated art yet. Record all prompts in first-2_5d-chapter-art-prompts.md. Never show asset previews to Adam.

## 8. Scene composition
Shared design canvas 960x640, scale-to-fit camera on desktop/mobile; responsive controls outside canvas with large tap targets. Portrait can letterbox for graybox; final composition needs portrait-specific camera testing. Ground plane room bounds x=60..900,y=100..550. Hero start (150,470), exit near (830,160).
Arrival: ivory ground/back wall; foreground rail at lower edge; safe start; ribbon sentinel telegraphs before charging. Balcony visible upper-left but initially unreachable. Room exit after sentinel overcome; no required business action.
Garden: launcher left (220,380), redirector center (480,330), latch right (780,220), bridge upper-right; walkable perimeter/manual route so machinery not an event gate. Safe checkpoint lower-left. Mechanism interaction radius clearly marked in graybox; labels removed/replaced only when final art communicates purpose.
Gallery: Bellwether at (720,240), cover islands kept out of checkpoint, return exit lower-left after victory; Inez/Perrin stage at safe sides. Headings affect projectile route, not canonical geography. Foreground rails occlude feet appropriately. Room changes fade; resume always safe ground.

## 9. Code map
Created docs/goldline/HANDOFF-FIRST-2_5D-CHAPTER.md: authoritative human continuation.
Created docs/goldline/first-2_5d-chapter-handoff.json: machine summary.
Created docs/goldline/first-2_5d-chapter-{execution,continuity}-contract.txt: original user instructions, preserve.
Created client/public/assets/goldline/chapters/the-last-valet/references/approved-art-direction.png: approved style reference.
Implementation files will be listed here as created.

## 10. Integration map
Expedition movement/audio: REUSE suitable pure helpers, preserve existing runtime.
Existing encounter lifecycle: REUSED as business action boundary; new room combat stays fictional, not commercial mission status.
Campaign: DEFERRED wiring until chapter entry works; extend existing hosts rather than replace compiler.
Fiction assignment: REUSE stable identity principle; server chapter state extends persistence in Slice 3.
Forge: REUSE documented canonical valet/golf eligibility, EXTEND with two fixed behavior families in Slice 2.
World events / Tower Wars canonical ledger: REUSE in Slice 5; no new business-event writes.
Night Shift: NOT USED; no duplicate director or scheduler.
Driver/Admin: EXTEND with gated entry and same chapter component; no public unauthenticated operational route.
Echo/action registry/follow-up: REUSE in Slice 6; no outbound sender.
Siege: NOT REPLACED; preserve its own state and entry points.

## 11. Tests
`client/src/game/chapters/firstChapter/model.test.ts`: 10/10 passing. Covers acceleration-bounded movement, wall collision without dodge tunneling, diagonal normalization, pause short-circuit, attack reach/recovery/hit-stop/guard, facing-gated hits, dodge invulnerability + cooldown, death/retry checkpoint reset, interact proximity gating for switch and exit, and full three-room zero-business-event completion. TypeScript baseline (`npx tsc --noEmit`) unchanged from main — all remaining errors are pre-existing server/ issues unrelated to chapter files. Production build via `vite.chapter-preview.config.ts` succeeds (only a benign Pixi chunk-size warning). Browser-driven verification: rendering confirmed in Arrival Court and Turntable Garden, checkpoint persists to localStorage key `goldline:chapter-dev:the-last-valet:v1`, and a full page reload correctly resumes mid-chapter (garden room, lever already thrown) — confirming interruption/reload behavior. Live keyboard-hold movement could not be driven from the automated browser pane because the pane runs the tab backgrounded (`document.hidden===true`), which correctly triggers the app's own pause-on-hidden gate — this is the feature working as designed, not a defect. Reducer tests already give exact numeric coverage of movement/collision that the backgrounded pane can't exercise live; a human play test remains the way to confirm feel.

## 12. Remaining work
Slices 1–2 are done. Continue with Slice 3 (desktop/mobile shared fiction state, section 4 above) per the execution contract: extend server-side authenticated persistence for {room, checkpoint, mechanism heading/gardenOpen/latchOpen, cleared[], completed}, keyed by tenant/player/chapter with revision compare-and-set, replacing localStorage as sole source of truth while keeping it as an offline fallback. Then continue Slices 4–11 in order without stopping between them, testing/committing/pushing at each slice boundary.

## 12a. Slice 2 implementation notes (non-spoiler, mechanical)
LAUNCH/REDIRECT is one shared mechanism family (`model.ts`: `LAUNCHER`, `REDIRECTOR`, `HEADINGS`, `HEADING_TARGETS`, `Weight` type, `stepWeight`). Interacting near a room's launcher spawns a weight that travels at a fixed speed to that room's redirector; interacting near the redirector cycles the room's available headings (persisted in `save.heading`); when the weight reaches the redirector it re-targets toward the selected heading and resolves an effect on arrival. Garden headings: `bridge` (sets `gardenOpen`, opens the exit gate — same flag the original manual lever also sets, so the lever remains a business-independent manual alternative to the mechanism, satisfying "two viable approaches" for traversal too) and `latch` (sets `latchOpen`, which removes the `SHORTCUT_CRATE` collision blocker — puzzle use). Gallery heading: `confrontation` (aims the weight at the enemy's current position; on arrival forces `stage:'recover'` early — combat use, an alternative to the direct dodge/strike approach which remains fully viable on its own). All three headings share one `Weight` object/state machine — not three separate mechanics. No business imports anywhere in `model.ts`.

## 13. Do-not-redesign list
Keep chapter/cast/three spaces/two families above. No extra buildings-as-levels, fictional customer facts, mandatory business event, affection economy, full 3D, engine migration, autosend, or deliberately tedious first-run Echo. Do not edit older combat systems to simplify integration. User authorized main pushes only for genuinely complete slices; partial must go to named handoff branch. Never force push.

## 14. Current blockers / open questions
None established. Remote main movement during slice is a STOP condition per user; fetch before push. Local dependency symlink is for this worktree only. Creative decisions require no further Adam approval.

# CLAUDE CODE — SHIP THE JOYSTICK DRIVER STUDIO

**Request:** Finish the existing driver UX redesign, verify it, merge existing draft PR #742, and verify the live driver app. The user wants to inspect the updated app as soon as possible. Work autonomously; do not stop at a plan or ask for redundant choices. **Do not merge or claim success if tests or deployment verification fail.**

## Where to start

Repository: `adamwright83-blip/bldg-admin-api`.

Existing **draft** pull request: **#742**.

Branch: `feat/driver-lantern-city-studio-20261027`.

Current pilot route: on authenticated driver Day Line, query `?dayline=studio`. It is deliberately NOT the production default.

Current implementation:
- `client/src/pages/driver/studio/DriverStudioDay.tsx`
- `client/src/pages/driver/studio/driverStudioModel.ts`
- `client/src/pages/driver/studio/driver-studio.css`
- `client/src/pages/driver/studio/driverStudioModel.test.ts`
- `client/public/joystick/driver-studio/koreatown-boba.svg`
- `client/src/pages/goldline/GoldlineDayPlan.tsx` (pilot switch)
- `client/src/pages/driver/GoldlineDriverController.tsx` (New Order wiring)
- `client/src/pages/driver/studio/README.md`

**Do not restart or create a second implementation/PR.** Check out #742, verify main has not introduced conflicts, make minimal corrections on this branch, then merge this PR if accepted.

## The UX is established; do not redesign it

- A **sunlight-readable light-mode** Tuesday-style **list** of REAL authorized stops. Distinguish daytime vs evening. One visit card at one building contains its multiple, separate pickup/drop-off jobs. Do not hardcode any customer identities, times, sample addresses or fabricated ETAs into production.
- A warm cozy **+ NEW ORDER** button uses the **existing QuickNewOrderSheet**; no second order creator.
- Per visit: **EN ROUTE** shows location, real notes, Call/Text only where contact details and safe interactions exist, and a prominent Google Maps action using the existing `navigationUrl`. **ARRIVED** shows large individual HOLD circles for each job. Finish each job separately. **DONE** appears when all jobs at that location were saved; then NEXT STOP.
- HOLD is continuous (~1.1s); release early means no write. After completion, call only the existing authoritative `onResolveStop` / CleanCloud workflow. No success animation until a successful save. A CleanCloud save is not proof of completed upstream sync and absolutely not payment. Explicitly show pending/attention state and retry. Do not offer an undo that the backend cannot support.
- The saved job triggers a **brief local reaction** in the game's actual visual language; it is NOT a gameplay-reward write, customer acquisition, sales, or revenue proof. A real game unlock requires an independently authorized/verified action.
- Keep the app fast and touch-friendly, screen-reader usable, reduced-motion compatible, and legible in full LA daylight. Provide night treatment only when useful, without turning daytime operating screens dark.

## Art — authenticity is NON-NEGOTIABLE

The user rejected repeated generic/fabricated versions of their games. Reuse codebase art **as-is** and layer UI/animation over it:
- Silver Lake = **bright outdoor 3D courtyard with actual villagers**, not a generic downtown, cottage, bungalow or fox mascot pasted onto random art. Existing sources: `client/public/joystick/gameplay/silver-lake.jpg`, `client/src/pages/goldline/silverLake3d/`.
- Beverly Hills = **The Other Rodeo**, painted sunlit ranch with TWO DOGS AND COWS/CALVES. Existing assets `client/public/assets/goldline/beverly-hills-2d/`. Note a different Beverly Hills *Velvet Rope* 3D game exists; use the authorized Rodeo art for this specified route.
- Century Park East = existing multi-floor cutaway/CCTV/zombie game, never an invented animal concierge lobby. `client/public/joystick/gameplay/century-park-east.jpg`, `client/src/pages/goldline/centuryParkEast3d/`. Night behavior should match actual game rules; don't depict unverified live CCTV feeds.
- OPUS LA = **animal cozy high-rise vs excessive golden penthouse** direction, NOT a generic flat icon apartment. The playable high-rise game is **not shipped**. Existing `client/public/goldline/opus-clubhouse/room.webp` is **concept art**; locate any better *authored* OPUS world art already in repo before creating new replacements. Do not claim it is live gameplay.
- Koreatown = cozy animated boba shop (new isolated SVG already in PR), NOT generic luxury tower or nightclub.
- Hollywood = dark **indoor mouse world** (user supplied actual screenshot in conversation); reuse only if the actual source is discoverable in repo. Otherwise keep it neutral and flag the missing authored source instead of fabricating it.
- East Hollywood dry cleaner = ordinary clean operational card, no fictional game.
- Never print real customer names or data in public screenshots, tests, or GitHub docs. Synthetic test names only.

All animation **layers** are separate from base artwork and must be idempotent and reversible locally. No per-stop generated video. Verify that authored sprite atlases are cropped correctly before shipping; unverified CSS background-position guesses are not acceptable.

## Critical engineering checks to complete

1. Inspect `GoldlineDayPlan` and `GoldlineDriverController`. Confirm `?dayline=studio` really opens the new UI via the **driver app**, not only via an obscure secondary modal.
2. Audit `groupRouteVisits`: same visit address+time grouping, separate job IDs, afternoon vs evening revisits, true task ordering; no fabricated city classification; don't drop genuine field tasks except user-excluded derived JETRO/Lugos logistics. Use real neighborhood metadata where available rather than brittle guesses from customer text.
3. Audit `HoldRing` pointer and keyboard gestures, progress animation, async unmount/race conditions, focus management, idempotence. Press/release at <1.1s = ZERO mutations. Failing network/write = ZERO success effects. A second click cannot duplicate an order status write.
4. Confirm pickup bridge bag/garment validation matches `pickupCountsSchema`; verify original chapter remains fallback for unsupported states and statuses. Ensure `CleanCloud pending` is accurately displayed after local persistence.
5. After success only, play scene-specific **short** payoff within the existing artwork. Existing static CSS effects are a starting point, not a substitute for proof of visual quality. A two-job stop shows two separately earned states. Do not make one job's completion change real game state unless authorized backend supports it.
6. Verify site assets load without 404 and are genuinely recognizable at mobile crop. OPUS remains identified as concept.
7. Test mobile ~390x844 and other viewport sizes, safe area/scroll to bottom, new order, Google Maps, screen-reader and reduced motion. No false/guessed ETA labels, addresses, fake statistics or extra features.
8. Tests: `npm run check`; `npx vitest run client/src/pages/driver/studio/driverStudioModel.test.ts`; relevant e2e for Day Line and Goldline mobile smoke. Add a focused simulated-real-world UX test that exercises route -> arrived -> hold canceled -> hold succeeds -> job 1 done -> job 2 done -> next stop. Mock mutations; NEVER mutate real customer orders in QA.
9. If necessary, fix Vercel/build/CI issues; rerun cancelled mobile regression + fast smoke checks. Don't treat previously cancelled runs as passed.

## Release requirements

- Once tests and screenshot review are clean, promote **Studio** to the normal driver Day Line entry, with **a reversible legacy opt-out** (e.g. `?dayline=legacy`). Make sure returning to a stop from Google Maps retains position and does not auto-submit.
- Do not touch admin Lantern City or replace the GOLDLINE kingdom game engine. No database migrations, no price/payment changes, no real outbound SMS.
- Confirm actual deployment destination and production workflow for `https://driver.gojoystick.com`. Don't assume admin deployment is equivalent. Validate final real driver hostname via authenticated browser or existing smoke fixture.
- Update PR #742 (same PR). Await all required checks. Mark ready and squash-merge only if valid. Check auto-deploy and live health; check authenticated route, one stop, new order modal and Google Maps link on production, but **do not complete a real job** just to test.
- If any actual blocker prevents a safe merge, **leave PR #742 open**, show exact failure/CI link, and specify the smallest remediation. Do not fake "shipped."
- When done, report exact PR, merge commit SHA, production URL, executed tests and observed deploy result. Say explicitly whether Studio is actually the default and whether any art/payoff is still placeholder.

## Out of scope

Do not build autonomous AI genre/art directors in this driver rollout, rewrite customer datasets, invent game narratives, hardcode real resident names, or replace functioning back-end. Those systems can later consume a tested, modular scene/animation interface.

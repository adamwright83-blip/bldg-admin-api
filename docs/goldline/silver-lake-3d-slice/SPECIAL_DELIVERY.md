# Silver Lake · Special Delivery (Rook's airmail)

A slapstick paper-glider game inside the walkable Silver Lake courtyard, and the correspondence desk beside it.
Rook launches gliders from his stall by the teal cottage; the goal is the wicker basket on Bella's balcony across
the east lawn. The courtyard's fan, washing line, cups, sheet, Cleo and Bella are all in the flight's way, and all
of them are physics, not animation.

The game is fiction. The desk is the real business: one actual customer, what is on record about them, and a draft,
handed to the existing Letter Desk for anything that leaves the building.

## Turning it on

| What | Where |
|---|---|
| Server flag | `JOYSTICK_SPECIAL_DELIVERY_TENANTS`: comma-separated tenant ids. No wildcard. Unset means off for everyone. |
| Flag code | `server/experience/lanternCity/specialDeliveryFlag.ts` |
| Migration | `drizzle/0151_courtyard_discoveries.sql`, applied by `scripts/migrate.mjs` (adds one nullable JSON column to `lantern_neighborhood_memories`; idempotent) |
| Routes | `system.goldlineWorld.specialDelivery` (query), `recordSpecialDelivery` (mutation), `sableRecall` (query) in `server/composition/goldlineWorldRouter.ts` |

With the flag off the query answers `{ enabled: false }`, the mutation is refused (`FORBIDDEN`), the recall answers
nothing, and the client renders nothing: no station, no pill, no change to the reunion quests.

Nothing here touches the resident app's tools, the s2s or intake contracts, Stripe, or any send path.

## How it plays

- **Aim and launch:** press anywhere and drag back (the elastic pulls the other way), release to launch. A pull
  shorter than `MIN_PULL` is a change of mind, never a launch.
- **Wings:** hold to open, release to fold (or switch the HUD to "Wings: tap" for a toggle). Open wings climb and
  float; folded, the glider is a dart.
- **Keyboard:** Space/Enter launches and works the wings, arrows aim, F turns the fan, Esc goes back to the courtyard,
  E/Enter opens the station when you are near it.
- **The fan** blows straight up. After the first delivery a tap on it turns it to lean forward or back.

Three kinds of route across, none scripted: an aimed lob into the basket; the high road (wings open over the fan,
through the cups, a bounce off the line); and the low road (laundry, Cleo, luck). Cleo's tail can fling a glider
into the basket, but only after it has physically landed on her tail at a low speed, and it is rare (about 3.5% of
flights that touch her, measured over a grid of 4,320 inputs). Ringing all three cups in order in one flight is the
secret: Rook conducts the "courtyard orchestra", Cleo meows at exactly the wrong moment, "That was the finale."

The first delivery: a silence while Bella takes the bell out of the glider and holds it up, then the DIIING, and the
courtyard reacts: shutters thrown open on both cottages, a newspaper dropped, the sparrows off the washing line, Cleo
bolt upright, Rook with his wings over his ears: "Well. She won't lose that." Then a second ring, and "Next delivery?"

## What is real and what is fiction

- **Physics** (`specialDelivery/deliveryPhysics.ts`): a fixed 240 Hz step, toy aerodynamics (lift across the relative
  wind, drag along it), a deterministic gusting updraft, a sagging washing line, swinging cups, Cleo with a live tail,
  Bella as a soft body. The same input always flies the same flight from the same state.
- **The environment carries over between throws** (cups still swinging, Cleo awake and grumpy), as a player would
  expect. So a live throw can differ from the same input flown from a settled courtyard.
- **Discoveries** (`shared/courtyardDiscoveries.ts`) are only what a flight's observed contacts show: a delivery, a
  cat assist, three cups in order, a fan-and-line delivery, a Rook save, a rim shot, a laundry rescue. They are
  remembered per business and neighbourhood on the server (`courtyardDiscoveriesService.ts`), in one transaction with
  a row lock, idempotent per flight id (a retried request counts once). A remembered thing shows on the next visit,
  never mid-visit: the orchestra sign ("ROOK'S COURTYARD ORCHESTRA / ONE PERFORMANCE ONLY"), "I made improvements." with
  a second elastic band, "I haven't tested them."
- **Nothing in the game ever changes business state.** It records fiction progress only.

## The correspondence desk

After the first delivery an envelope marked YOUR BUSINESS appears on Rook's stall, and Rook mentions it once. Opening
it is optional ("Take a look" or "Keep playing").

- **Which customer** (`specialDelivery/deskTarget.ts`): one at a time, and the same one until it is settled. Only
  customers the operator may contact (`hasConsent`), who have not accepted, been observed receiving a message, or been
  consent-blocked. The draft saved at the desk comes first, then one already under way, then the mission's next.
  Customers the operator passed on stay passed.
- **Sable's recall** (`server/experience/lanternCity/sableRecall.ts`, `shared/correspondenceDesk.ts`) reads the
  existing records: `scheduled_outreach_messages`, their revisions, `sms_compose_handoff_audits` and
  `personal_outreach_replies`. Every entry keeps no more authority than its row has: `record`, `operator_reported`, or
  `observed`, and only a provider receipt or an observed outbound row counts as observed. Sable quotes the operator's
  own promise when there is one, with its date and source, and says what is not known ("No reply recorded since.",
  "The send was reported by you; no provider or device observed it.").
- **Rook's draft** honours the promise and invents nothing: "Hi Tessa, following up as promised about your next
  laundry pickup. Would you like me to help arrange one this week?" with "Kept it short. Sable found the promise."
- **Actions:** edit the draft; "Continue to send from your phone" hands the customer and the draft to the existing
  Letter Desk (consent, the phone hand-off, the reported send all stay there); "Save for later" saves the
  neighbourhood's one unfinished draft; "Not now" hides the envelope on this device until midnight; "Pass on … for a
  week" records the existing reunion pass; "Back to the courtyard".
- **State lines never conflate evidence:** "Draft prepared. Nothing has been sent." / opened in the messaging app is
  not sent / a reported send is not independently observed / an order after a message is not credited to the message.
- **The synthetic preview** shows the labelled fixture "Synthetic example (fixture): not a real customer" (Tessa Park,
  four paid wash-and-fold orders, the October 21 promise, no reply). It writes nothing anywhere.

## Product decisions to confirm (Adam)

1. While the flag is on, Bella and Cleo are on the airmail course, so the reunion quests do not give them errands
   (`useReunionQuests` `excludeGivers`). The quests wait for the flag's answer before assigning.
2. The envelope appears only after the first delivery, and Rook mentions it once a visit.
3. "Not now" is per device until midnight; "Pass for a week" uses the existing reunion pass record.

## Developer tools

- `window.__specialDelivery` (the same inputs a player gives; the simulation decides): `state()`, `enter()`, `exit()`,
  `lastFlight()`, `fly(input, { fromRest })`, `predict(input)`, `skip()`, `setFan(f)`, `dragFor(pull)` (the screen
  points of a drag that makes a pull, for driving real pointer input). `fly` with `fromRest` settles the courtyard first,
  so the live flight is exactly what `predict` says. Inputs are `{ pull: { x, y }, wings: [{ at: step, open }] }`, `at`
  in 1/240 s steps after launch.
- **Preview:** `npx vite --config vite.special-delivery-preview.config.ts` (port 5199) mounts the real Silver Lake
  component with its synthetic neighbours and an in-memory tRPC stub. `?fresh=1` forgets this device's preview memory.
- **Artifact build:** `npx vite build --config vite.special-delivery-preview.config.ts && node
  preview/special-delivery/package-artifact.mjs`. The build-only GLTFLoader (`preview/special-delivery/artifactGltfLoader.ts`)
  loads textures through `<img>` (the artifact CSP blocks `blob:` fetches) and reassembles the models, which the
  packager ships as base64 JSON parts (an artifact serves no `.glb` and caps each file at 15 MB). The packager keeps
  only the files in `artifact-files.json`.

## Verification

**VERIFIED**
- Unit tests: `deliveryPhysics.test.ts` (determinism; launch, wings and fan change flights; a recorded direct lob,
  fan-and-line delivery where the line decides it, three cups in order, a tail rescue that only follows a tail landing;
  the cat is not a win; no flight hangs), `deskTarget.test.ts`, `shared/courtyardDiscoveries.test.ts`,
  `shared/correspondenceDesk.test.ts` (the exact Tessa draft), `sableRecall.test.ts` (authority labels),
  `courtyardDiscoveriesService.test.ts` (scope and idempotency, flag allowlist). `pnpm check`, `check:nomenclature`,
  `check:tenant-ratchet`, `check:vertical-dependencies`, `check:domain-boundaries` pass.
- Real input in the browser (headless Chromium on the Metal GPU, real pointer drags and a held mouse button for the
  wings, timed off the flight clock): the intro, a first delivery and its payoff, a cat bonk, three cups rung on the
  first attempt (the chosen input survives frame-timing jitter about 44% of the time), the desk, and a return visit
  after a reload, at 1280×720, at 390×844, and with reduced motion. No console errors.
- The artifact build loads under an artifact-like CSP at a sub-path, textures intact.

**INFERRED**
- The server memory write and Sable's queries against real rows: there is no database in the local environment, so
  the services ran on their test fallback and the row mapping was unit-tested; the SQL itself was not run.
- The flag-off path in production behaves as in the unit tests and the preview.

**UNKNOWN**
- Audio: the episode is procedural WebAudio and honours the global mute; no one has listened to it.
- Real phones (the 390×844 check is a desktop browser), and whether a stranger finds the cups or Cleo's tail.
- Feel: most flights last 1.5–3 s, shorter than the 3–6 s the brief imagined.
- The published artifact on claude.ai itself (the local CSP serve stands in for it).

## Known gaps

- A phone held upright sees the whole course small; the HUD offers a one-time "turn sideways" tip, and the plaza's
  fountain and bench fade out of the way of the far camera.
- No telemetry beyond the courtyard's own counts.
- Rook's art is the canonical overworld atlas plus nine new poses rendered from the same rig
  (`scripts/assets/blender/rook_rig.py`: fold, hide, toss, catch, lunge, flick, conduct, ears, bow). He always faces
  his painted side; no mirrored copies.

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
nothing, and the client renders nothing: no station, no pill. The reunion quests are the same with the flag on or off
(see "Bella and Cleo").

Nothing here touches the resident app's tools, the s2s or intake contracts, Stripe, or any send path.

## How it plays

- **Aim and launch:** press anywhere and drag back (the elastic pulls the other way), release to launch. The pull is
  measured on the screen: a full pull is 30% of the screen's short side (between 110 and 240 px), so the same thumb
  movement works on a phone and a monitor. A pull shorter than `MIN_PULL` is a change of mind, never a launch.
- **Wings:** hold to open, release to fold (or switch the HUD to "Wings: tap" for a toggle). Open wings climb and
  float; folded, the glider is a dart. The first flights of a visit say how, for the input you are using ("Hold your
  finger down to open the wings"), until the wings have been used.
- **Keyboard:** Space/Enter launches and works the wings, arrows aim, F turns the fan, Esc goes back to the courtyard,
  E/Enter opens the station when you are near it.
- **The fan** blows straight up. After the first delivery it can lean forward or back: tap the fan, the "Fan ↑"
  button in the HUD (which shows its setting), or F.

Three kinds of route across, none scripted: an aimed lob into the basket; the high road (wings open over the fan,
through the cups, a bounce off the line); and the low road (laundry, Cleo, luck). Cleo's tail can fling a glider
into the basket, but only after it has physically landed on her tail at a low speed, and it is rare (about 3.5% of
flights that touch her, measured over a grid of 4,320 inputs). Ringing all three cups in order in one flight is the
secret: the camera pulls back to take in the whole stage, each cup puts up a note in its own colour as it rings, Rook
conducts the "courtyard orchestra", Cleo meows at exactly the wrong moment, "That was the finale."

The first delivery: a real silence (the fan's hum ducks out) while Bella takes the bell out of the glider and holds it
up, then the DIIING, and the courtyard reacts: shutters thrown open on both cottages, a newspaper dropped, the
sparrows off the washing line, Cleo bolt upright, Rook with his wings over his ears: "Well. She won't lose that."
Then a second ring, and "Next delivery?"

## On a phone

- Held upright, the camera frames each moment for the tall screen instead of shrinking the landscape view: Rook, his
  station and the fan while you wait; the whole course while you aim; the glider while it flies; the bell and the
  orchestra in their own shots.
- When the course is small on screen, the aim dots, the guide line and the glider draw larger, so the aim stays
  readable.
- On a touch screen the station's pill sits beside the Hop button instead of under it, and keyboard hints are hidden.
- There is no "turn sideways" prompt: upright is a first-class way to play.

## Bella and Cleo

They keep their reunion quests whether the flag is on or off (`useReunionQuests` is unchanged from main). While the
airmail is open, the courtyard's own Bella and Cleo, with their name labels, step out of the scene
(`setVillagersHiddenWhere`), and the airmail's Bella on her balcony and Cleo on the lawn play the episode. When you
leave the station they are back at their doors with whatever errand they had. Anyone else standing in the flight plane
steps out of the shot the same way.

## The correspondence desk

After the first delivery an envelope marked YOUR BUSINESS appears on Rook's stall, and Rook mentions it once. Opening
it is optional ("Take a look" or "Keep playing").

- **Which customer** (`specialDelivery/deskTarget.ts`): one at a time, and the same one until it is settled. Only
  customers the operator may contact (`hasConsent`), who have not accepted, been observed receiving a message, or been
  consent-blocked (a recorded opt-out makes the projection consent-blocked, `shared/cozyVillagerEvidence.ts:690-767`).
  The draft saved at the desk comes first, then one already under way, then the mission's next. Customers the
  operator passed on stay passed.
- **Sable's recall** (`server/experience/lanternCity/sableRecall.ts`, `shared/correspondenceDesk.ts`) reads the
  existing records: `scheduled_outreach_messages`, their revisions, `sms_compose_handoff_audits` and
  `personal_outreach_replies` (with the reply service's stored classification, opt-out effect and prepared
  follow-up). Every entry keeps no more authority than its row has: `record`, `operator_reported`, or `observed`, and
  only a provider receipt or an observed outbound row counts as observed.
- **"You said" is only for words the customer could have received.** Sable quotes a promise as "You said" only from a
  send you reported or one a provider or device observed, and says which. A promise that exists only in a saved draft,
  or in a message opened in the messaging app but never recorded as sent, is shown as exactly that ("In a draft you
  saved but never sent: …", "In a message you opened but never recorded as sent: …"), never as something the
  customer heard, and Rook treats it as a first note, not a follow-up.
- **Replies are read by the reply service, not by the desk.** What a reply asks for is `classifyPersonalOutreachReply`'s
  reading, stored with the reply when it was recorded. The desk never re-guesses it and never infers feelings. A
  reply with no stored reading counts as a question, as the reply service would file it.

What Rook does with it (`composeRookDraft`):

| What the record shows | What Rook does |
|---|---|
| They opted out, at any point (the classification or the reply service's opt-out effect) | No message, and none can be written here: no send, no save, no snooze, only "Back to the courtyard" |
| They said not now | No message: "Rook won't push." |
| They raised a problem | The careful reply the reply service prepared, if it prepared one, for you to read first; otherwise yours to write. Never a sales note |
| They asked a question | Over to you: a greeting only, "They asked something only you can answer. Rook won't guess." |
| They said yes to a pickup, with no question and no time named | "happy to set that up. What day and time work best for you?" Rook never offers a day or a time |
| They said yes with a question, or named a time | Over to you |
| A reply recorded without its words | Over to you |
| Sable can't read the record | Over to you; Rook doesn't guess from nothing |
| A promise you sent, no reply since | "following up as promised about your next laundry pickup…" |
| A message you sent, no promise, no reply | A short check-in |
| Nothing sent (drafts only, or nothing at all) | A plain first note |

- **Actions:** edit the draft; "Continue to send from your phone" hands the customer and your words to the existing
  Letter Desk (consent, the phone hand-off, the reported send all stay there); "Save for later" saves the
  neighbourhood's one unfinished draft; "Not now" hides the envelope on this device until midnight; "Pass on … for a
  week" records the existing reunion pass; "Back to the courtyard". When it's over to you, Continue and Save stay off
  until you've written more than the greeting. For someone who opted out, only "Back to the courtyard".
- **State lines never conflate evidence:** "Draft prepared. Nothing has been sent." only when there is a draft
  (otherwise "Nothing has been sent.") / opened in the messaging app is not sent / a reported send is not
  independently observed.
- **Rook on your way back** acknowledges what you chose and nothing more: "It'll be there." (back), "It's on the desk
  when you want it." (saved), "It'll keep." (not now), "Understood. I'll leave them be for a while." (passed),
  "Leaving them be." (opted out).
- **The synthetic preview** shows the labelled fixture "Synthetic example (fixture): not a real customer" (Tessa Park,
  four paid wash-and-fold orders, the October 21 promise, no reply), and the same fixture in six other situations
  (see Developer tools). It writes nothing anywhere.

## What reaches the desk, and what doesn't

| Outcome | Reaches the desk | Authority |
|---|---|---|
| Saved drafts and their revisions | Yes, shown as never sent | record |
| A message opened in the messaging app (`sms_compose_handoff_audits`) | Yes, shown as not recorded as sent | record |
| A send you reported | Yes, "You reported sending it" | operator_reported |
| A send a provider or device observed | Yes, "Sent (observed)" | observed |
| A reply, with the reply service's classification and opt-out effect | Yes | as recorded: operator_reported or observed |
| Consent, accepted, send observed, consent blocked | Yes, through which customer is picked | the recovery projection |
| The lapse: paid order count and last order date | Yes, from the mission's target | record |
| **A paid order placed after a message** | **No** | |

The last row is the return experience (a customer comes back and the courtyard notices), and it is **not
implemented**. `loadCozyRecoverySurfaces` (`server/experience/lanternCity/cozyRecoverySurfaces.ts:102-115`) builds the
projection without `paidOrderEvidence`, so `projectCozyRecoverySurfaces` (`shared/cozyVillagerEvidence.ts:875`) sees
none, and every target's paid order is unavailable. The desk says so ("This desk can't see orders yet, so it can't
tell you whether they've ordered since."), never shows an order as caused by a message, and has no "they came back"
state. Connecting it needs an admitted paid-order reader that meets the projection's own contract (an authority
receipt and a positive amount, `shared/cozyVillagerEvidence.ts:44`). That is separate work, not part of this PR.

## Product decisions to confirm (Adam)

1. The envelope appears only after the first delivery, and Rook mentions it once a visit.
2. "Not now" is per device until midnight; "Pass for a week" uses the existing reunion pass record. Neither is offered
   for someone who opted out.
3. For a complaint, Rook starts from the follow-up the reply service prepared, for you to read first. The alternative
   is to always leave a complaint blank.
4. Whether to build the paid-order return experience next.

## Developer tools

- `window.__specialDelivery` (the same inputs a player gives; the simulation decides): `state()`, `enter()`, `exit()`,
  `lastFlight()`, `fly(input, { fromRest })`, `predict(input)`, `skip()`, `setFan(f)`, `turnFan()`, `say(key)`,
  `dragFor(pull)` (the screen points of a drag that makes a pull, for driving real pointer input). `fly` with
  `fromRest` settles the courtyard first, so the live flight is exactly what `predict` says. Inputs are
  `{ pull: { x, y }, wings: [{ at: step, open }] }`, `at` in 1/240 s steps after launch.
- **Preview:** `npx vite --config vite.special-delivery-preview.config.ts` (port 5199) mounts the real Silver Lake
  component with its synthetic neighbours and an in-memory tRPC stub. `?fresh=1` or `#fresh` forgets this browser's
  courtyard memory (an artifact link passes only the `#anchor`). `#desk-<case>` shows the desk's fixture in another
  situation: `draft-only`, `question`, `yes`, `not-now`, `complaint`, `opt-out`.
- **Artifact build:** `npx vite build --config vite.special-delivery-preview.config.ts && node
  preview/special-delivery/package-artifact.mjs`. The build-only GLTFLoader (`preview/special-delivery/artifactGltfLoader.ts`)
  loads textures through `<img>` (the artifact CSP blocks `blob:` fetches) and reassembles the models, which the
  packager ships as base64 JSON parts (an artifact serves no `.glb` and caps each file at 15 MB). The packager keeps
  only the files in `artifact-files.json`.

## Verification

**VERIFIED**
- Unit tests:
  - `deliveryPhysics.test.ts`: determinism; launch, wings and fan change flights; a recorded direct lob; a
    fan-and-line delivery where the line decides it; three cups in order; a tail rescue that only follows a tail
    landing; the cat is not a win; no flight hangs.
  - `shared/correspondenceDesk.test.ts`: unsent drafts are never "You said"; each reply class gets its Rook mode;
    an opt-out at any point stops Rook; no day or time is promised; the state lines.
  - `CorrespondenceDesk.test.ts`, the rendered desk:
    - "You said" appears only for a reported send.
    - A question opens in review, with Continue disabled.
    - An opt-out gets no send, save or snooze.
    - When the recall fails, the desk is in review.
  - `sableRecall.test.ts`: authority labels, stored reply classes, opt-out flags.
  - `deskTarget.test.ts`, `shared/courtyardDiscoveries.test.ts` and `courtyardDiscoveriesService.test.ts`: scope,
    idempotency and the flag allowlist.
- `pnpm check`, `check:nomenclature`, and the Goldline bundle budget and three.js isolation check
  (`scripts/checkGoldlineBundleBudget.mjs`, unchanged) pass.
- Real input in a desktop browser (headless Chromium on the Metal GPU, real pointer drags and a held mouse button for
  the wings, timed off the flight clock): the intro, a first delivery and its payoff, a cat bonk, three cups rung,
  the orchestra's concert shot, the desk, and a return visit after a reload, at 1280×720, at 390×844, and with reduced
  motion. No console errors.
- An Android phone emulator (Medium Phone, API 36, Chrome 133, software GPU at about 6 fps), held upright, driven by
  real touch events through Chrome's DevTools protocol: the walk to the station, the intro, an aimed delivery and the
  payoff, and each camera framing reviewed in screenshots.
- Sound, measured: each WebAudio context's output was recorded in the page and analysed.
  - The cups and the bell sound at their intended pitches, and nothing clips.
  - The fan's flutter stops once the glider leaves the updraft. Before the fix it kept hissing after the first pass.
  - The silence before the bell measures −73 dBFS, down from −29 dBFS when the fan's hum ran under it.
- The desk in each of the six preview situations, and Rook's line on the way back from it.
- With the flag on, Bella and Cleo are at their own doors with their errands in the courtyard, and on the course
  while the airmail is open.
- The artifact build loads under an artifact-like CSP at a sub-path, textures intact.

**INFERRED**
- The server memory write and Sable's queries against real rows: there is no database in the local environment, so
  the services ran on their test fallback and the row mapping was unit-tested; the SQL itself was not run.
- The flag-off path in production behaves as in the unit tests and the preview.

**UNKNOWN**
- A real phone: its frame rate (the emulator draws in software, so its 6 fps says nothing either way), touch feel,
  and the notch and home-indicator margins on real hardware.
- Whether the sound is pleasant: it was measured, not listened to.
- Whether a stranger finds the cups or Cleo's tail.
- Feel: most flights last 1.5–3 s, shorter than the 3–6 s the brief imagined.
- The published artifact on claude.ai itself (the local CSP serve stands in for it).

## Known gaps

- The paid-order return experience is not implemented (see "What reaches the desk, and what doesn't").
- No telemetry beyond the courtyard's own counts.
- Rook's art is the canonical overworld atlas plus nine new poses rendered from the same rig
  (`scripts/assets/blender/rook_rig.py`: fold, hide, toss, catch, lunge, flick, conduct, ears, bow). He always faces
  his painted side; no mirrored copies.

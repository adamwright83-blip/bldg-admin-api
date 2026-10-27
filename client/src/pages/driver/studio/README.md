# JOYSTICK Driver Studio

**Driver Studio is the default driver Day Line.** The previous GOLDLINE world Day Line stays one switch away:

| URL | Result |
|---|---|
| `/driver` | Studio, unless this device opted out |
| `?dayline=legacy` | previous Day Line, remembered on this device (`localStorage["joystick:dayline"]`) |
| `?dayline=studio` | Studio, and forget the opt-out |
| `?dayline=classic` | older classic layout, QA only, not remembered |

The route list also has a **Use the previous Day Line** link. Logic: `daylineSurface.ts`. No schema changes, no data migration.

## What is implemented
- Sunlight-first route list projected from **real** `buildDayPlanProjection()` stops. Never ships with synthetic customer fixtures.
- Jobs at the same address scheduled within 30 minutes share a visit card; each is a **separate** authority-preserving completion. Times come from the projection's normalized 24h `sortKey` (CleanCloud `07:00`, operations `1:30–2:30`), so grouping and the DAYTIME / EVENING split work on real data. Grouping does not depend on adjacency: the projection moves completed work to the end, and the card must not split while the driver saves jobs.
- Scenes come from place evidence only: linked building, the canonical tower registry (`shared/propertyTowers.ts`), then the address locality. Customer names never choose a world.
- Google Maps uses the stop's own `navigationUrl` (directions when any job has them). **New Order** opens the **existing** `QuickNewOrderSheet` supplied by the driver controller.
- **HOLD** needs a 1.1s continuous press (pointer or Space/Enter), then calls the existing `onResolveStop`. Releasing early writes nothing; a second press cannot start a second write. A refused or failed write shows RETRY and the reason, **no celebratory animation**.
- CleanCloud bridge pickups need at least one bag or garment (same rule as `pickupCountsSchema`). After saving, the card says **SYNC PENDING**, **SYNC NEEDS ATTENTION** (with **RETRY CLEANCLOUD SYNC**, the existing retry mutation) or **CLEANCLOUD SYNCED**. A save is never shown as an upstream sync or a payment. Jobs Studio cannot complete fall back to the original `DriverStopChapter`.
- Position survives leaving for Google Maps: the open visit and ARRIVED state are kept in `sessionStorage` per business date. Nothing is resubmitted.
- Light by default; dark after 7pm (or by the driver's toggle, remembered). Reduced motion swaps every reaction for a fade.

## Claire
Claire's approved head (the same pixels as the Day Line header badge) sits in Studio's top-right corner. The gesture is the resident app's pen-pull mechanic (`bldg-resident` `usePenPhysics.ts`) without the pen:
- **pull down** past the dashed line and release → Claire's existing text composer (`ClaireComposerSheet`)
- **pull down, then slide right** and release → Claire calls the driver (`claire.callBeforeDrive`, the same call the header portrait places)
- release above the line → nothing; tap or Enter → a menu with the same two choices.

Model and thresholds: `claireTetherModel.ts`. The floating "Message Claire" launcher steps aside while Studio is mounted.

## Art pack registry
Only committed project art is used, and every reaction is a separate layer over it, placed in the art's own coordinates (`.lc-scene__stage` reproduces `object-fit: cover`), and only after a successful save:
- **Silver Lake**: `/joystick/gameplay/silver-lake.jpg`. Reaction: villagers Fennel (`fox-wave.png`) and Bella (`bunny-wave.png`), the same card art `SilverLake3D` uses.
- **Beverly Hills · The Other Rodeo**: `/assets/goldline/beverly-hills-2d/01-look.png`. Reaction: a calf trots across the ranch meadow using the authored walk cycle, plus the terrier's "delighted" reaction portrait. Frames are cut by `scripts/build-driver-studio-rodeo-sprites.py` from the cells in `beverlyHills2d/cells.ts`, clipped the way `paint.ts` clips them.
- **Century Park East**: `/joystick/gameplay/century-park-east.jpg`. Reaction: the cutaway's floors light up, ground floor first. No CCTV feed is depicted.
- **OPUS LA**: `/goldline/opus-clubhouse/room.webp`. **Concept art, labelled on screen as not live gameplay.** Reaction: the clubhouse's two tower models fill with light.
- **Koreatown**: standalone illustrated boba plate `/joystick/driver-studio/koreatown-boba.svg` (new in this PR, not a previously shipped game). Reaction: the pendant bulbs warm up and pearls rise from the mascot's straw.
- **Hollywood**: neutral card. The indoor mouse-world art is not in this repository; no replacement was made.
- **Ordinary businesses** (e.g. a dry cleaner): neutral operational card.

Reactions are temporary feedback, not game state. Permanent progression must use the authoritative game action contracts.

## Tests
- `npx vitest run client/src/pages/driver/studio/`: grouping, scene choice, completion truth, surface resolution, Claire gesture.
- `e2e/goldline/driverStudio.spec.ts` (in `playwright.dayline-art.config.ts`, harness fixture `?goldlineDayPlanFixture=studio-route`, synthetic data, mocked writes): default surface, route → arrived → 600ms release (no write) → job 1 → job 2 → DONE → next stop, keyboard HOLD, failed write, counts guard, Maps, New Order, reload persistence, Claire gestures, reversible opt-out, no asset 404s, no horizontal overflow.
- `playwright.goldline.config.ts` and `playwright.goldline-smoke.config.ts` pin `joystick:dayline=legacy` because those suites regress the previous Day Line.

## Future game director contract
A new genre must supply a scene identity, optional authored backdrop, a short reversible local reaction, a success-only trigger, and a canonical backend completion action. AI is allowed to choose/assemble the first three, never invent the last.

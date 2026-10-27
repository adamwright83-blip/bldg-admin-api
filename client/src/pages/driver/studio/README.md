# JOYSTICK Driver Studio — October 2026 pilot

**Preview:** open the authenticated driver Day Line with `?dayline=studio`. The production Day Line remains the default. No schema changes or data migration.

## What is implemented
- Sunlight-first route list projected from **real** `buildDayPlanProjection()` stops. Never ships with synthetic customer fixtures.
- Multiple pickup/drop-off jobs at the same location and within 30 minutes share a visit; they are **separate** authority-preserving completion actions.
- Google Maps uses `stop.navigationUrl`; "New Order" opens the **existing** `QuickNewOrderSheet` supplied by driver controller.
- "HOLD" requires 1.1s continuous press, then calls the existing `onResolveStop` handler. Releasing early does nothing; server failure shows retry, **no celebratory animation**. A successfully saved job has a brief scene-specific reaction.
- CleanCloud bridge pickups require bag/garment counts and report saved vs. synced honestly. Unsupported/blocked jobs fall back to original `DriverStopChapter`.
- Daylight-friendly surface. Individual scene art retains real game's palette. Reduced-motion preference is respected.

## Art pack registry
Only these already committed project assets are used as finished-game visual sources:
- Silver Lake: `/joystick/gameplay/silver-lake.jpg`, plus existing fox wave `/assets/lantern-villager-outreach/villagers/animations/fox-wave.png`.
- Beverly Hills: existing **The Other Rodeo** approved `/assets/goldline/beverly-hills-2d/01-look.png`.
- Century Park East: existing playable cutaway screen `/joystick/gameplay/century-park-east.jpg`.
- OPUS: existing clubhouse concept art `/goldline/opus-clubhouse/room.webp`. **This is not shipped gameplay**.
- Koreatown: new standalone illustrated boba plate `/joystick/driver-studio/koreatown-boba.svg`. Not represented as a previously shipped game.
- Hollywood: neutral presentation, because the mouse-game source art is not in this path. Do not fabricate a replacement for it.
- General dry cleaner: neutral operational screen.

The CPE/OPUS overlays are *temporary feedback*, not mutation of the games' permanent state. Permanent game progression must use the authoritative game action contracts.

## QA before default rollout
1. `npm run check` and `npx vitest run client/src/pages/driver/studio/driverStudioModel.test.ts`.
2. Open driver on real mobile 390×844, tablet, and direct sun. Use synthetic test tenant (no real customer screenshots in public PR).
3. Ensure two jobs at same tower: HOLD first → only first saved; HOLD second → both saved; NEXT STOP.
4. CleanCloud pickup with bags+garments; test transient network failure and pending/retry sync.
5. Verify Google Maps opens the selected real stop address and New Order uses existing form.
6. Verify zero-click accidental completion; release HOLD at 600ms; no write.
7. Verify prefers-reduced-motion, keyboard HOLD, and next-stop navigation.
8. Check the actual `onResolveStop` post-commit data refresh and the pilot presentation of sync states.
9. Do NOT merge before CI and on-device acceptance. Switch default routing only after approval.

## Future game director contract
A new genre must supply a scene identity, optional authored backdrop, a short reversible local reaction, a success-only trigger, and a canonical backend completion action. AI is allowed to choose/assemble the first three, never invent the last.

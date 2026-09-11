**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# Greystar / Colosseum production snapshot

## Fantasy contract

The Colosseum presents six fictional architectural doors and Clockhead as an arena threat. Six is visual fiction only. Clockhead resolution may fracture or awaken the fantasy world, but cannot manufacture a business event.

## Reality contract

`system.day1TenDoors` owns TEN real targets (`shared/day1TenDoors.ts` `DAY1_TARGETS`), SEVEN of them Greystar, across Koreatown, West Hollywood, and Beverly Hills — all sourced, none invented. The Colosseum campaign's completion condition is a five-target projection over that list, `COLOSSEUM_LEAD_HUNT` (`shared/leadHunt.ts` via `client/src/pages/goldline/colosseumCampaign.ts`), naming five specific Koreatown properties and their recorded outcomes. Neither number is wrong — they answer different questions. Completion comes only from `COLOSSEUM_LEAD_HUNT`'s five recorded outcomes. Do not derive completion from fictional door count, combat, Wayward exploration, Relics or local fantasy persistence.

Two moves are forbidden, because both look like "fixing" the five/ten difference and both are not:

1. Narrowing `DAY1_TARGETS` to five to match the Colosseum campaign. This deletes five real sourced businesses from a live mission (day1TenDoors serves all ten independent of Kingdom 1).
2. Widening `COLOSSEUM_LEAD_HUNT` to include more of the seven Greystar properties. This is the real meaning of "never invent a sixth property" below — not conjuring a fake business, but promoting an existing real target into the Colosseum campaign to move a completion number.

Guarded by `shared/greystarColosseumBoundary.test.ts`.

## Current implementation seams

- `colosseumCampaign.ts` projects the existing real mission without altering its truth.
- `Day1TenDoors.tsx` owns the existing Colosseum presentation.
- `ColosseumBossGate.tsx` calls `onBossDefeated` only after its authored finale resolution.
- `GoldlineDriverController.tsx` owns the scene transition. It may persist a fantasy Wayward unlock after the already-authoritative campaign is complete and the finale resolves.

## Protected regression laws

- Five real targets remain authoritative.
- Six fictional doors remain fictional.
- Wayward never writes targets, visits, pitches, customers, orders, revenue or campaign outcomes.
- The Wayward fixture bypasses eligibility only behind `VITE_GOLDLINE_TEST_HARNESS=1`.
- Normal Wayward entry requires the persisted fantasy consequence created at the real campaign's Colosseum-resolution boundary.

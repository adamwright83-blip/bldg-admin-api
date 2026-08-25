**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# Greystar / Colosseum production snapshot

## Fantasy contract

The Colosseum presents six fictional architectural doors and Clockhead as an arena threat. Six is visual fiction only. Clockhead resolution may fracture or awaken the fantasy world, but cannot manufacture a business event.

## Reality contract

The authoritative campaign contains five real Greystar Koreatown targets. Completion comes only from the existing `system.day1TenDoors` campaign and its recorded target outcomes. Do not derive completion from fictional door count, combat, Wayward exploration, Relics or local fantasy persistence.

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

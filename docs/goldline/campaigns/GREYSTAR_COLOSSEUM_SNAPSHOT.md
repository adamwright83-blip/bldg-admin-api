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
- `GoldlineDriverController.tsx` owns the scene transition. It may persist fantasy consequences — the Wayward unlock, and Rook joining the party (`client/src/pages/goldline/stages/goldlineParty.ts`) — after the already-authoritative campaign is complete and the finale resolves. Nothing else writes the party; later kingdoms and the Road read it from there.
- `colosseumStage.ts` `projectColosseumArena` is the only path from the real campaign into the arena's scenery. It reads `visitedCount`, `totalCount` and `isComplete` from the campaign projection and returns Clockhead's seals, signal, mood and taunt — read-only, one seal per real target, one broken per recorded outcome. `located` follows `isComplete` and nothing else. Nothing in the arena, the doors or the finale can break a seal.
- The approved facade paints five doors; the sixth fictional door is Door VI, the one the Brass Republic has debated for generations (WORLD_BIBLE §13). Walking into any door is lore — it opens onto nothing — never progress and never a death.
- `ClockheadDuel.tsx` receives only `onDefeated` and calls it once, from the party card that ends the aftermath: LEVEL COMPLETE, then the arena goes quiet and one of Clockhead's handless dials — a speaker all along — carries Rook's voice (WORLD_BIBLE §12: rumoured captured, actually running an illegal communications network through the Republic's clocks; never a prison door), then ROOK JOINED THE PARTY with his mechanic, CONTACT (the in-world name for `rook.outreach_drafting`). The fiction modules (`clockheadDuelEngine`, `colosseumSearchEngine`, `colosseumAvatar`, `colosseumCombat`, `colosseumStage`, `colosseumFx`, `clockheadHitReaction`, `colosseumPrologue`, `ColosseumAftermath`, `aftermathScript`, `stages/goldlineParty`, `CompanionUnlockReveal`, the construct, controls, sprites and stage view) import nothing that can read or write the campaign; the aftermath cannot persist anything itself; and no Colosseum surface uses `businessVictoryFeedback` or a `victory`-category cue. Guarded by `client/src/pages/goldline/colosseumTruthBoundary.test.ts`.
- First entry plays `ClockheadPrologue` (same file): a taste of the fight that can be neither won nor lost. Its engine mode stops at the end of his first hour (`escaped`, never `won`), guard never drops below one pip, and it ends with all five seals intact — so it plays only while the campaign has no recorded outcome, once per device per mission (a local presentation flag, `colosseumPrologue.ts`). It receives only `onSealed`, cannot reach `onDefeated`, and the gate mounts it after the finale and field-mission branches. A seal reveal in the search arena holds the fight still (`holdSearchArena`) — a real outcome being shown never costs the player a hit.

## Protected regression laws

- Five real targets remain authoritative.
- Six fictional doors remain fictional.
- Wayward never writes targets, visits, pitches, customers, orders, revenue or campaign outcomes.
- The Wayward fixture bypasses eligibility only behind `VITE_GOLDLINE_TEST_HARNESS=1`.
- Normal Wayward entry requires the persisted fantasy consequence created at the real campaign's Colosseum-resolution boundary.

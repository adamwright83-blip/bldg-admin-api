**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# Greystar / Colosseum production snapshot

## Fantasy contract

The Colosseum presents five painted hunt doors plus lore-only Door VI and Clockhead as an arena threat. The five painted doors are now the fantasy counterparts of the five authored Greystar campaign targets, in authored target order. A painted door may open only after its corresponding real-world outcome has been recorded. Door VI has no real-world counterpart and remains sealed. Clockhead resolution may fracture or awaken the fantasy world, but cannot manufacture a business event.

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
- `GoldlineDriverController.tsx` owns the scene transition. After the already-authoritative campaign is complete and the finale resolves, it may record fantasy consequences as same-device local continuity (`localStorage`, keyed by player): the Wayward unlock, and Rook joining the party (`client/src/pages/goldline/stages/goldlineParty.ts`). Neither is durable or server state — another device or a cleared browser will not have them. Nothing else writes the party; later kingdoms and the Road read it from there.
- `colosseumStage.ts` `projectColosseumArena` reads `visitedCount`, `totalCount` and `isComplete` from the campaign projection and returns Clockhead's seals, signal, mood and taunt — read-only, one seal per real target, one broken per recorded outcome. `located` follows `isComplete` and nothing else. Nothing in the arena can break a seal or manufacture a visit.
- `ColosseumBossGate.tsx` is the reality bridge for the doors. It maps the five projected campaign targets to painted Doors I–V in authored order and passes the pure fiction engine only an abstract set of door ids that are currently openable. A door id enters that set only when the corresponding target already has a recorded real outcome. The search engine does not know targets, visits, businesses or outcomes.
- The approved facade paints five hunt doors. Door VI remains the Brass Republic's debated lore door (WORLD_BIBLE §13), has no real-world counterpart, and never becomes openable. Before a visit, approaching a painted door leaves it sealed. After that target's real outcome exists, the corresponding door may open.
- `COLOSSEUM_LEAD_HUNT.villainTargetId` determines which of the five painted doors hides Clockhead. The current authored villain target is the fifth campaign target. Even after all five outcomes exist, the duel does not auto-start: the player must return to the Colosseum and open that now-earned villain door. The gate starts the duel only when both the authoritative campaign says `isComplete` and the opened door maps to `villainTargetId`.
- `ClockheadDuel.tsx` receives only `onDefeated` and calls it once, from the party card that ends the aftermath: LEVEL COMPLETE, then the arena goes quiet and one of Clockhead's handless dials — a speaker all along — carries Rook's voice (WORLD_BIBLE §12: rumoured captured, actually running an illegal communications network through the Republic's clocks; never a prison door), then ROOK JOINED THE PARTY with his mechanic, CONTACT (the in-world name for `rook.outreach_drafting`). The fiction modules (`clockheadDuelEngine`, `colosseumSearchEngine`, `colosseumAvatar`, `colosseumCombat`, `colosseumStage`, `colosseumFx`, `clockheadHitReaction`, `colosseumPrologue`, `ColosseumAftermath`, `aftermathScript`, `stages/goldlineParty`, `CompanionUnlockReveal`, the construct, controls, sprites and stage view) import nothing that can read or write the campaign; the aftermath cannot persist anything itself; and no Colosseum surface uses `businessVictoryFeedback` or a `victory`-category cue. Guarded by `client/src/pages/goldline/colosseumTruthBoundary.test.ts`.
- First entry plays `ClockheadPrologue` (same file): a taste of the fight that can be neither won nor lost. Its engine mode stops at the end of his first hour (`escaped`, never `won`), guard never drops below one pip, and it ends with all five seals intact — so it plays only while the campaign has no recorded outcome, once per device per mission (a local presentation flag, `colosseumPrologue.ts`). It receives only `onSealed`, cannot reach `onDefeated`, and the gate mounts it after the finale and field-mission branches. A seal reveal in the search arena holds the fight still (`holdSearchArena`) — a real outcome being shown never costs the player a hit.

## Protected regression laws

- Five real targets remain authoritative.
- Doors I–V are presentation counterparts to those five targets and unlock only from already-recorded outcomes.
- Door VI remains lore-only and has no real-world target.
- Clockhead's duel requires both complete real-world campaign truth and opening the earned villain door.
- Wayward never writes targets, visits, pitches, customers, orders, revenue or campaign outcomes.
- The Wayward fixture bypasses eligibility only behind `VITE_GOLDLINE_TEST_HARNESS=1`.
- Normal Wayward entry requires the persisted fantasy consequence created at the real campaign's Colosseum-resolution boundary.

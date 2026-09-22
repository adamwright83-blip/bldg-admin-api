# Mission art wiring audit

Read-only inventory. No assets were moved. Roles are the contract in `shared/missionVisualPackage.ts`. A filename is not a business key.

## Fiction pack resolver

| Current file | Owner | Use | Later role |
|---|---|---|---|
| `shared/fictionPackVisuals.ts` | Fiction pack presentation | `FICTION_PACK_VISUALS.bio_containment` maps pack id `bio_containment` to hero, field background, icon, antagonist comms, completion scene, and detector states under `/assets/goldline/missions/bio-containment/` | `missionBriefHero`, `playableBackdrop`, `dayLineMark`, `consequenceArt` |
| `client/src/game/fiction/CampaignRunMissionHost.tsx` | Campaign Run host | Calls `presentCampaignRunArt` / `resolveFictionPackVisuals("bio_containment")` | same roles; pack id stays the art key, not the experience id |
| `client/src/pages/driver/GoldlineDriverController.tsx` | Day Line card | `resolveFictionPackVisuals(fictionPackId).missionIcon` for the BIO CONTAINMENT card | `dayLineMark` |
| `client/src/game/GoldlineGameHome.tsx` | Game home | Second `resolveFictionPackVisuals("bio_containment")` icon binding | `dayLineMark` duplicate |

The pack id is coupled to the asset folder. The experience runtime must not use that id as mission identity.

## Week

| Current file | Owner | Use | Later role |
|---|---|---|---|
| `client/src/pages/goldline/week/weekArt.ts` | Week brochure plates | Imports six plates. `weekArtSrc` selects by variant name, not by mission id. Unknown variant falls back to default | `weekKeyArt` |
| `client/src/pages/goldline/week/WeekBrochure.tsx` | Week brochure | Claire hologram mark | not a mission role |
| `client/src/pages/goldline/week/LockedWeekBrochure.tsx` | Locked week | Same Claire mark plus `weekArtSrc(skin.artVariant)` | `weekKeyArt` |

## Day Line

| Current file | Owner | Use | Later role |
|---|---|---|---|
| `client/src/pages/goldline/GoldlineDayPlan.tsx` | Day Line | `goldline-world-empty.png` as the shell background; `trailblazer-operator.png` as the now-marker | `playableBackdrop`, operator mark is not a mission role |
| `client/src/components/goldline/DriverVehicleDrawer.tsx` | Day Line drawer | Claire hologram, today manifest, overland portal, first spark | `dayLineMark` only if a later package assigns one; today these are chrome |

## Overworld and hosts

| Current file | Owner | Use | Later role |
|---|---|---|---|
| `client/src/pages/goldline/GoldlineOverworld.tsx` | Overworld | `goldline-overworld-clean.png` | `playableBackdrop` for the world, not a per-mission landmark |
| `client/src/pages/goldline/stages/futureStages.ts` | Wayward map | Hardcoded `/assets/goldline/wayward/*.webp` for deck, foreground, guardian, linehook | `playableBackdrop`, `playableForeground`, `missionObject` |
| `client/src/pages/goldline/stages/WaywardTetheredDeck.tsx` | Wayward host | `pickup_cache_objective.png` | `missionObject` |
| `client/src/game/expedition/ExpeditionLayer.ts` | Expedition | Same pickup cache, plus hunter, slinger, shieldbearer, grapple ring, cargo hazard | `missionObject` / `playableForeground` |
| `client/src/pages/goldline/ClockheadDuel.tsx` | Clockhead | Boss `/assets/boreslay-hero/procrastinator-reference.png`; player `/assets/goldline/characters/trailblazer/directional/idle-back.webp` | `missionObject`, operator sprite is not a mission role |
| `client/src/pages/goldline/ColosseumBossGate.tsx` | Colosseum | Arena background, six-door facade, villain reveal, trailblazer directional base | `playableBackdrop`, `playableForeground`, `missionObject` |
| `client/src/components/goldline/CampaignChapterHost.tsx` | Chapter host | No image of its own. It dispatches into an existing host | none until that host is bound |

## Duplicated generated imports

`@/assets/goldline/generated/goldline-world-empty.png` is imported by `GoldlineDayPlan.tsx`, `GoldlineHome.tsx`, `GoldlineGameHome.tsx`, and `TowerForgeAdmin.tsx`.

`@/assets/goldline/generated/trailblazer-operator.png` is imported by `GoldlineDayPlan.tsx`, `GoldlineHome.tsx`, `GoldlineGameHome.tsx`, and `LanternRun.tsx`.

`claire-hologram.webp` is imported by both week brochures and `DriverVehicleDrawer.tsx`.

`pickup_cache_objective.png` is imported by Wayward and the expedition layer.

## Not mission identity

Landing and flagship pages (`LandingFinal.tsx`, `DayforgeLanding.tsx`, `DayforgeFlagship.tsx`, `CodexLFinal.tsx`) import victory, interrupt, and field-visit stills. Those are marketing surfaces. They should not become `visualPackageId` values.

No current binding writes a filename into a Daily Command item id, a WeeklyIntent primary, or a Mission Director plan id.

# Mission Experience Runtime — code audit

Read-only findings from `origin/main` `742a05675619f743c719f0baf8e1c2d3d8d12057`.
This runtime wraps existing authority. It does not plan the week, rank campaigns, or mint a second Mission Director.

## 1. Does Mission Director already expose a stable identity for the selected playable work?

No. A persisted plan is not one playable instance.

- `mission_director_plans.id` is a revision row (`drizzle/schema.ts` `missionDirectorPlans`). Revisions are append-only (`server/missionDirector/missionDirectorService.ts` `getLatestPlan`).
- `stableKeyFor` is one key per tenant, operator, and business date: `mission-director:${tenantId}:${operatorId}:${businessDate}`. That is the day's plan, not one piece of selected work.
- `MissionSelection` (`shared/missionDirector.ts`) carries `campaignId`, title, objective, pocket, and `isFallbackVariant`. It has no instance id.
- `selectMissionPlan` (`server/missionDirector/planSelection.ts`) can put a primary and a fallback in the same outcome. The same `campaignId` can be both, distinguished only by `isFallbackVariant`.

`campaignId` is a library id. It is not an identity for Tuesday's playable work.

## 2. Does selected work retain a Daily Command item id?

The Mission Director selection does not. Daily Command items do.

- `DailyCommandItem.id` is required (`shared/claireWorkdayCommand.ts`).
- `MissionSelection` does not store that id. `computeMissionPlan` reads the command for pocket protection and does not write the item id onto the selection (`server/missionDirector/missionDirectorService.ts`).
- Locked weekly primary work is projected to a command item by `intentPrimaryItem` in `server/claire/weeklyMission/dailyCommandIntent.ts`: `day-director:${commitmentId}` when a commitment id exists, otherwise `weekly-intent:${businessDate}`.
- A Daily Command override keeps the other primary and records `weeklyIntentOverride.commandPrimaryId`. That id is a different item. It is not written back onto the locked week.

When a wrapper needs a key and a command item exists, uniqueness is tenant + operator + business date + that item id.

## 3. Are Campaign Run rows already 1:1 with a playable mission?

No. `shared/campaignRun.ts` defines a run as one standing multi-day operation with a frozen slot list. `goldline_campaign_runs` (`drizzle/schema.ts`) is keyed by campaign and operator, not by business date or a Daily Command item. Progress is derived from `goldline_campaign_target_events`. One run is not Tuesday's selected mission, and one day can be played without a run.

A `campaignRunId` may be referenced. It is not the experience identity.

## 4. Which gameplay hosts persist their own progress?

| Host | Owner | What it stores |
|---|---|---|
| Wayward | `client/src/pages/goldline/stages/waywardProgress.ts` | `localStorage` key `goldline:fantasy:wayward:v1:` |
| Overworld | `client/src/pages/goldline/overworld/checkpoint.ts` | `localStorage` key `goldline:overworld-checkpoint:v1` |
| Campaign Run truth | `server/campaignRuns/campaignRunService.ts` | run row + target events; progress is derived |
| Campaign Run presentation | `client/src/game/fiction/campaignRunPresentationStorage.ts` | field-entered and acknowledged beat; not run truth |
| Clockhead | `client/src/pages/goldline/clockheadDuelEngine.ts` | in-memory `phase` 1–3 and `stage`; no durable save |
| Real Action Bridge | `client/src/game/encounters/RealActionBridge.tsx` | persists only through the caller's `onPersist` |
| Day 1 / Colosseum | server `day1TenDoors` plus a dismissal flag in `waywardProgress.ts` | mission outcome on the server |

The experience wrapper references these. It does not become their writer and it does not clear them.

## 5. Which Day Line and Overworld taps already enter a host?

Day Line (`client/src/pages/goldline/GoldlineDayPlan.tsx`, wired in `GoldlineDriverController.tsx`):

- Stop chapter Enter calls `onEnterWorld(stopId)`. Commercial ids navigate to `/driver/sales-mission/:id`. Other stops set the game or overworld scene.
- OPEN CHAPTER opens that stop chapter. It does not start a second mission.
- Kingdom chapter button sets `window.location` to `/goldline-chapter`.
- Campaign-run card opens `CampaignRunMission` on the game scene.
- Colosseum button sets the colosseum scene.

Overworld (`client/src/pages/goldline/GoldlineOverworld.tsx`):

- `CampaignChapterHost` calls `onEnterCampaignHost` → `enterCampaignHost` in the controller, which dispatches onto the existing surface (`surfaceForCampaignHost`).
- Proximity enter on destination `greystar-6` opens the colosseum. `wayward-approach` opens Wayward.
- Neither destination id is a selected-work identity. No destination id is stable for an arbitrary Daily Command item.

## 6. Minimum seam

Wrap the calls. Do not replace the hosts.

- Day Line: one call beside the existing `onEnterWorld` path in `GoldlineDriverController.tsx`.
- Overworld: one call beside the existing `enterCampaignHost` path. There is no selected-work landmark, so the overworld entrance is a stub that resolves the same instance id and does not add a destination.

`resolveMissionExperience({ tenantId, operatorId, businessDate, selectedWorkRef })` is the only resolver. `openMissionExperience({ instanceId, entrance })` is the only client seam. Entrance is `DAY_LINE` or `OVERWORLD`.

## Persistence decision

Campaign Run rows and Mission Director plan rows are not 1:1 with one playable selected-work instance, so they cannot be the experience row.

One new table, `mission_experience_instances`, stores the wrapper. Typed JSON holds the authority ref, gate, checkpoint reference, consequence, and replacement. Host save files stay the owners of host progress.

## Fallback authority already present

Do not invent a planner. These already exist and are only read:

- Daily Command override on `DailyCommandWithIntent.weeklyIntentOverride` (`dailyCommandIntent.ts`). When the override is absent, the locked week remains the command primary.
- Mission Director `fallback_only` outcomes and `fallbackVariant` selections (`planSelection.ts`, `eligibleCampaigns`, `computePrepReadiness`). A `planned` outcome's standby fallback is not today's selected work.
- `no_plan` and a missing override mean there is no replacement. `replacement = null` is legal.

## Unreadiness

Open weekly readiness on the locked day (`WeeklyIntentDay.readinessRequirements`) means the original instance is `NOT_READY_TODAY`. The locked `WeeklyIntentRecord` is not rewritten. The original title, objective, source, and identity stay. A legitimate existing replacement is a second instance with `replacementReason: ORIGINAL_MISSION_NOT_READY`.

# DayForge production rollout

This document tracks the additive migration and configuration order for the stacked DayForge production extraction. The locked landing-page implementation is outside this stack.

## Stack and migration order

1. **PR A — canonical mission:** apply `drizzle/0035_commercial_mission_spine.sql` before deploying code that reads commercial accounts, opportunities, missions, steps, events, or visit outcomes.
2. **PR B — territory intelligence:** after 0035, apply `drizzle/0036_territory_intelligence.sql` before enabling authenticated territory scans. Configure one server-only Google key through `GOOGLE_MAPS_API_KEY` or `GOOGLE_PLACES_API_KEY`; keep the provider disabled when neither is present.
3. **PR C — BORESLAY mission integration:** after 0035, apply `drizzle/0037_commercial_mission_game_results.sql` before exposing mission-bearing Rally links. PR C adds no environment variable.

These migrations are additive and are not assumed to run automatically in Railway. Application rollout must be gated until the required tables exist.

## PR C invariants

- `commercial_mission_game_attempts` keeps every active, abandoned, failed, or qualifying attempt. A UUID is a `gameAttemptId`; it is never accepted as a `missionId` or `taskId`.
- `commercial_mission_game_results` permits one authoritative qualifying result per tenant and mission, and one result per attempt.
- `commercial_mission_game_rewards` permits one XP/streak award per tenant and mission, and one award per qualifying result.
- The existing tenant-scoped mission-event idempotency constraint permits one `phone-unlock:<missionId>` event.
- Completion writes the attempt outcome, immutable replay, qualifying result, reward, `game_completed` transition, and `phone_ready` transition in one database transaction.
- The Rally simulation and replay inputs remain local and deterministic. Network state wraps match start/end; it never enters the physics loop or replay adapter.

## Safe deployment checks

Before application deployment, verify the PR C tables:

```sql
SHOW TABLES LIKE 'commercial_mission_game_attempts';
SHOW TABLES LIKE 'commercial_mission_game_results';
SHOW TABLES LIKE 'commercial_mission_game_rewards';
SHOW INDEX FROM commercial_mission_game_results;
SHOW INDEX FROM commercial_mission_game_rewards;
```

After deployment, verify that a controlled mission produces multiple attempt rows when retried, exactly one result, exactly one reward, and exactly one `phone_unlocked` event. Never run `drizzle-kit push` against production without reviewing the exact generated diff.

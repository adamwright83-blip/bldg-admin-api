# DayForge production rollout

This document tracks the additive migration and configuration order for the stacked DayForge production extraction. The locked landing-page implementation is outside this stack.

## Stack and migration order

1. **PR A — canonical mission:** apply `drizzle/0035_commercial_mission_spine.sql` before deploying code that reads commercial accounts, opportunities, missions, steps, events, or visit outcomes.
2. **PR B — territory intelligence:** after 0035, apply `drizzle/0036_territory_intelligence.sql` before enabling authenticated territory scans. Configure one server-only Google key through `GOOGLE_MAPS_API_KEY` or `GOOGLE_PLACES_API_KEY`; keep the provider disabled when neither is present.
3. **PR C — BORESLAY mission integration:** after 0035, apply `drizzle/0037_commercial_mission_game_results.sql` before exposing mission-bearing Rally links. PR C adds no environment variable.
4. **PR D — field mission:** after 0035 and 0037, apply `drizzle/0038_commercial_mission_field.sql` before creating driver sessions or exposing phone handoffs. Configure `DRIVER_PASSWORD`, `DRIVER_OPEN_ID`, `DRIVER_APP_ORIGIN`, and `JWT_SECRET` before enabling the route. `DRIVER_OPEN_ID` must match the mission assignee; `JWT_SECRET` signs one-time handoff tokens and must not be exposed to the client.
5. **PR E — proposals and collateral:** after 0035 and 0038, apply `drizzle/0039_commercial_proposals.sql` before operators configure proposal profiles or generate collateral. PR E adds no environment variable. Configure each tenant's proposal profile in DayForge before allowing that tenant to generate a proposal.

These migrations are additive and are not assumed to run automatically in Railway. Application rollout must be gated until the required tables exist.

## PR C invariants

- `commercial_mission_game_attempts` keeps every active, abandoned, failed, or qualifying attempt. A UUID is a `gameAttemptId`; it is never accepted as a `missionId` or `taskId`.
- `commercial_mission_game_results` permits one authoritative qualifying result per tenant and mission, and one result per attempt.
- `commercial_mission_game_rewards` permits one XP/streak award per tenant and mission, and one award per qualifying result.
- The existing tenant-scoped mission-event idempotency constraint permits one `phone-unlock:<missionId>` event.
- Completion writes the attempt outcome, immutable replay, qualifying result, reward, `game_completed` transition, and `phone_ready` transition in one database transaction.
- The Rally simulation and replay inputs remain local and deterministic. Network state wraps match start/end; it never enters the physics loop or replay adapter.

## PR D invariants

- Driver login creates a signed `driver` session. The 0038 role-enum migration must land before the first driver user is persisted.
- Every field read and mutation derives the tenant and actor from the signed session. A driver can only read or mutate a mission assigned to that driver's `openId`; administrators retain an explicit tenant-scoped override.
- Phone handoff links expire after 24 hours, are bound to one tenant, mission, and assignee, store only a SHA-256 token hash, and can be consumed once. Repeating the same handoff request UUID returns the same signed URL until it expires.
- Preparation snapshots the tenant's active checklist into the mission. Later template changes never rewrite an in-progress visit.
- Checklist, notes, departure, arrival, and outcome writes use optimistic versions and immutable mission-event idempotency keys. Required preparation items must be complete or explicitly skipped before departure.
- `won` records a field outcome and estimated contract value, not realized revenue. Realized revenue remains zero until a paid order is attributed in a later revenue-ledger slice.

## PR E invariants

- Every proposal is an immutable, versioned snapshot of one tenant-scoped persisted mission plus one persisted tenant proposal profile. Profile edits affect only newly generated versions.
- Generation and approval are administrator-only. Drivers can read only the current approved, unexpired proposal for a mission assigned to their signed identity.
- Only the latest draft can be approved. Approval supersedes any older approved version in the same transaction, and all proposal actions use tenant-scoped idempotency keys.
- Drafts are visibly watermarked, cannot invoke the browser print workflow, and disappear entirely under print media. The Field collateral checklist cannot be completed without an approved, unexpired proposal.
- `browser_print_opened` means DayForge successfully opened the browser print workflow; it does not claim that a printer completed the job or that collateral was delivered.
- Annual opportunity value remains labeled as a confidence-scored planning estimate. The generated leave-behind explicitly states that it is not a guarantee or binding service agreement.

## Safe deployment checks

Before application deployment, verify the PR C, PR D, and PR E tables and the expanded user role:

```sql
SHOW TABLES LIKE 'commercial_mission_game_attempts';
SHOW TABLES LIKE 'commercial_mission_game_results';
SHOW TABLES LIKE 'commercial_mission_game_rewards';
SHOW INDEX FROM commercial_mission_game_results;
SHOW INDEX FROM commercial_mission_game_rewards;
SHOW COLUMNS FROM users LIKE 'role';
SHOW TABLES LIKE 'tenant_field_checklist_templates';
SHOW TABLES LIKE 'commercial_mission_field_states';
SHOW TABLES LIKE 'commercial_mission_field_checklist_items';
SHOW TABLES LIKE 'commercial_mission_phone_handoffs';
SHOW INDEX FROM commercial_visit_outcomes;
SHOW TABLES LIKE 'tenant_commercial_proposal_profiles';
SHOW TABLES LIKE 'commercial_proposals';
SHOW TABLES LIKE 'commercial_proposal_events';
SHOW INDEX FROM commercial_proposals;
SHOW INDEX FROM commercial_proposal_events;
```

After deployment, verify that a controlled mission produces multiple attempt rows when retried, exactly one result, exactly one reward, and exactly one `phone_unlocked` event. Then issue a driver handoff, consume it as the assigned driver, refresh on a second device, and confirm that the same persisted checklist, notes, arrival, and terminal outcome resume without duplicate events. Finally, generate two proposal versions, approve only the latest, confirm the driver sees that exact version, and confirm an unapproved or expired proposal cannot satisfy the collateral checklist. Never run `drizzle-kit push` against production without reviewing the exact generated diff.

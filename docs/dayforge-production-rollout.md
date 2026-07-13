# DayForge production rollout

This document tracks the additive migration and configuration order for the stacked DayForge production extraction. The locked landing-page implementation is outside this stack.

## Stack and migration order

1. **PR A — canonical mission:** apply `drizzle/0035_commercial_mission_spine.sql` before deploying code that reads commercial accounts, opportunities, missions, steps, events, or visit outcomes.
2. **PR B — territory intelligence:** after 0035, apply `drizzle/0036_territory_intelligence.sql` before enabling authenticated territory scans. Configure one server-only Google key through `GOOGLE_MAPS_API_KEY` or `GOOGLE_PLACES_API_KEY`; keep the provider disabled when neither is present.
3. **PR C — BORESLAY mission integration:** after 0035, apply `drizzle/0037_commercial_mission_game_results.sql` before exposing mission-bearing Rally links. PR C adds no environment variable.
4. **PR D — field mission:** after 0035 and 0037, apply `drizzle/0038_commercial_mission_field.sql` before creating driver sessions or exposing phone handoffs. Configure `DRIVER_PASSWORD`, `DRIVER_OPEN_ID`, `DRIVER_APP_ORIGIN`, and `JWT_SECRET` before enabling the route. `DRIVER_OPEN_ID` must match the mission assignee; `JWT_SECRET` signs one-time handoff tokens and must not be exposed to the client.
5. **PR E — proposals and collateral:** after 0035 and 0038, apply `drizzle/0039_commercial_proposals.sql` before operators configure proposal profiles or generate collateral. PR E adds no environment variable. Configure each tenant's proposal profile in DayForge before allowing that tenant to generate a proposal.
6. **PR F — Churn Radar:** after the existing tenant order tables and ops-task migrations, apply `drizzle/0040_customer_churn_recovery.sql` before running a tenant scan or creating a recovery mission. PR F adds no environment variable and does not enable automated outbound messaging.
7. **PR G — revenue pipeline and account conversion:** after 0035-0040, apply `drizzle/0041_commercial_pipeline_conversion.sql` before creating another commercial mission. PR G adds no environment variable. It backfills stable account identity on future mission writes, projects every mission transition into one pipeline, and creates the commercial customer graph only when the canonical mission is won.

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

## PR F invariants

- A scan reads real tenant-scoped `orders` and considers only customers with at least two completed or paid orders. A current active order suppresses win-back action rather than competing with an existing service.
- Every risk result is an immutable snapshot with source order IDs, source timestamps, confidence, calculations, estimates, and explicit unavailable evidence. The current schema has no reliable structured unresolved-issue source, so the interface states that gap instead of inventing a signal.
- A recovery action is an existing `stale_customer` ops task plus a linked recovery intervention. It is not a disconnected alert or message record. A nullable active-customer key and tenant-scoped unique index prevent concurrent requests from creating two active recovery missions for one customer.
- Win-back copy is deterministic and fact-grounded. Editing creates a new immutable version; approval is valid only for the exact latest message and content hash. Because no promotion source is configured, edited copy cannot promise discounts, coupons, free service, or other incentives.
- Human approval and current recorded SMS marketing consent are separate gates. Contact preparation locks the intervention, latest draft, and permission in one transaction; an opt-out, expired permission, revised draft, or changed mission state blocks contact.
- DayForge never auto-sends the recovery SMS. It can open the native SMS composer only for a validated 10-digit US phone after both gates pass. “Contacted” is an explicit operator report and remains labeled provider-delivery-unverified.
- A later paid order for the same tenant-scoped customer identity can attribute recovered revenue exactly once. Attribution completes the linked ops task and records realized revenue separately from estimated monthly impact.

## PR G invariants

- `commercial_pipeline_records` is a controlled projection of the canonical persisted mission, not a second mission state machine. Mission creation and lifecycle transitions update the pipeline in the same database transaction; relationship-only stages have explicit, audited transitions.
- Provider identity, or normalized account name plus location when provider identity is unavailable, produces a tenant-scoped account key. Location and decision-maker keys prevent repeated mission creation from duplicating the account graph.
- A won mission creates or links one commercial customer, all known locations and contacts, a proposed service expectation, planned route capacity, a verbal agreement record, and one final mission reward. Retrying or reopening cannot issue the reward twice.
- A verbal yes is not an approved agreement. Approved annual value requires an operator confirmation plus an evidence reference; the original opportunity estimate remains separately labeled.
- An attributed order requires an explicit human confirmation and an existing order in the signed tenant. The current order source does not establish invoice truth, so invoiced revenue stays zero.
- Paid and realized revenue include only attributed orders whose persisted order record is paid. A won mission or approved agreement never creates realized revenue by itself.

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
SHOW TABLES LIKE 'tenant_customer_recovery_profiles';
SHOW TABLES LIKE 'customer_churn_scans';
SHOW TABLES LIKE 'customer_churn_snapshots';
SHOW TABLES LIKE 'customer_contact_permissions';
SHOW TABLES LIKE 'customer_recovery_interventions';
SHOW TABLES LIKE 'customer_recovery_drafts';
SHOW TABLES LIKE 'customer_recovery_events';
SHOW INDEX FROM customer_recovery_interventions;
SHOW INDEX FROM customer_recovery_drafts;
SHOW INDEX FROM customer_recovery_events;
SHOW COLUMNS FROM commercial_accounts LIKE 'identityKey';
SHOW COLUMNS FROM commercial_account_locations LIKE 'locationKey';
SHOW COLUMNS FROM commercial_account_contacts LIKE 'contactKey';
SHOW TABLES LIKE 'commercial_pipeline_records';
SHOW TABLES LIKE 'commercial_pipeline_events';
SHOW TABLES LIKE 'commercial_customers';
SHOW TABLES LIKE 'commercial_customer_locations';
SHOW TABLES LIKE 'commercial_customer_contacts';
SHOW TABLES LIKE 'commercial_service_expectations';
SHOW TABLES LIKE 'commercial_agreements';
SHOW TABLES LIKE 'commercial_route_assignments';
SHOW TABLES LIKE 'commercial_follow_ups';
SHOW TABLES LIKE 'commercial_order_attributions';
SHOW TABLES LIKE 'commercial_mission_final_rewards';
SHOW INDEX FROM commercial_pipeline_records;
SHOW INDEX FROM commercial_order_attributions;
SHOW INDEX FROM commercial_mission_final_rewards;
```

After deployment, verify that a controlled mission produces multiple attempt rows when retried, exactly one result, exactly one reward, and exactly one `phone_unlocked` event. Then issue a driver handoff, consume it as the assigned driver, refresh on a second device, and confirm that the same persisted checklist, notes, arrival, and terminal outcome resume without duplicate events. Generate two proposal versions, approve only the latest, confirm the driver sees that exact version, and confirm an unapproved or expired proposal cannot satisfy the collateral checklist. Run a Churn Radar scan against a controlled tenant, confirm active orders are suppressed, revise and approve a recovery draft, verify missing or expired consent blocks the SMS composer, and attribute exactly one later paid order to the intervention. Finally, take one controlled commercial mission through follow-up, verbal yes, won, agreement approval, and first-order attribution. Confirm the account, locations, contacts, customer, route, history, and reward remain singular when requests are retried; confirm realized revenue remains zero until the attributed order is paid. Never run `drizzle-kit push` against production without reviewing the exact generated diff.

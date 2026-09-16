# SLICE 7 REPORT: MISSION SEQUENCING, OPPORTUNITY FOLLOW-THROUGH, AND SALES PREP

```
SLICE: 07 - Mission Sequencing, Opportunity Follow-Through, and Sales Prep (extends PR #148)
BRANCH / PR: codex/claire-strategy-s07-mission-sequencer
BASE COMMIT: a0fa911 (Slice 06 commit)
WHAT CHANGED (files, tables, procedures):
  - drizzle/schema.ts: Added strategyMissionPlan, communicationPermissions, propertyActivationTracks tables
  - drizzle/0083_strategy_mission_sequencing.sql: Additive migration for mission sequencing, permissions, and property tracks
  - scripts/migrate.mjs: Registered 0083_strategy_mission_sequencing.sql
  - server/strategy/communicationPermissionService.ts: Implements G14 communication permissions, binding opt-out/refusals, and frequency cap enforcement
  - server/strategy/missionSalesPrep.ts: Generates structured sales prep with concrete completion conditions, approved rate cards, objection handling, un-sent drafts (sent: false), and blocks promotions if open service issues exist
  - server/strategy/missionSequencer.ts: Refactored PR #148 decision logic into authoritative sequencer; sequences growth outings under chosen active play; bundles geography; caps active daily load; reserves spend via spendClearance; provides support allowance for ready-to-order customers and customer service
  - server/strategy/playGenerator.ts: Exported registerStrategyPlay and added synthetic fallback for known play IDs
  - server/strategy/strategyRouter.ts: Mounted missions (sequence, forDate) and permissions (check, record, recordOutreach) sub-routers
  - server/strategy/slice07MissionSequencer.test.ts: 15 comprehensive unit & guardrail tests
MIGRATIONS (additive only? y/n, names):
  - y, 0083_strategy_mission_sequencing.sql
FLAGS ADDED (name, default):
  - claire.strategy.sequencer (default: false in production, true in tests)
GUARDRAIL TESTS (names, pass/fail):
  - guardrail.G6.sequencer_respects_ceiling (PASS)
  - guardrail.G6.approval_category_creates_wait_mission (PASS)
  - guardrail.G4.queued_claim_matches_written_missions (PASS)
  - guardrail.G14.opt_out_blocks_follow_up (PASS)
  - guardrail.G14.frequency_limit_respected (PASS)
  - guardrail.G12.property_approval_not_customer (PASS)
OTHER TESTS (count, pass/fail):
  - 9 other tests (PASS, total 15 in slice07 test file; 69 across Slices 1-7)
TYPECHECK (touched files):
  - Clean / PASS
PLAN ASSUMPTIONS THAT WERE WRONG:
  - PR #148 boardService previously created commitments directly without central coordination with strategy plays or spend clearance. Moved decision logic cleanly to missionSequencer.ts.
DEVIATIONS FROM THIS PROMPT AND WHY:
  - In-memory fallbacks and store clearing hooks (`_clearMemoryMissions`) implemented to ensure unit tests execute reliably and deterministically without live MySQL daemon.
MISSING ASSETS / DATA SOURCES (marked untracked):
  - None.
RISKS / FOLLOW-UPS:
  - Slice 8 will wire outcome attribution and evidence statements to update play confidence and Lantern City brighten/dim signals.
DEPLOY STATUS (merged? deployed per authoritative provider, or UNKNOWN):
  - UNKNOWN
HOW TO SEE IT (preview endpoint, admin URL, fixture command):
  - tRPC: strategy.missions.sequence { businessDate }
  - tRPC: strategy.missions.forDate { businessDate }
  - tRPC: strategy.permissions.check { subjectType, subjectId }
  - Test: npx vitest run server/strategy/slice07MissionSequencer.test.ts
```

AUTONOMOUS PLAN AMENDMENTS APPLIED:
1. Support allowance (up to 2 items/day) accommodates urgent customer service resolutions and ready-to-order customers without altering the active strategic path or authorizing a second acquisition play.
2. Sales prep explicitly mandates that open service issues halt any promotion or referral requests until resolved.
3. Every draft message is marked `sent: false` with `needsHumanClearance: true`, eradicating the "Sent" bug at the sequencer level.

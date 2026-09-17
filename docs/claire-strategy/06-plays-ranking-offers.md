# SLICE 6 REPORT: PLAYS, RANKING, PATH OFFERS, AND PATH CHOICE

```
SLICE: 06 - Plays, Deterministic Ranking, Path Offers, and Path Choice
BRANCH / PR: codex/claire-strategy-s06-plays-ranking-offers
BASE COMMIT: 3dbfc64 (Slice 05 commit)
WHAT CHANGED (files, tables, procedures):
  - drizzle/schema.ts: Added strategyPlays, strategyPathOffers, strategyPathChoices tables
  - drizzle/0082_strategy_plays_and_paths.sql: Additive migration for strategy plays, offers, and choices
  - scripts/migrate.mjs: Registered 0082_strategy_plays_and_paths.sql
  - server/strategy/verticalTemplates/types.ts: Core vertical template interfaces isolating trade specifics (G13)
  - server/strategy/verticalTemplates/laundryFluffFold.ts: Laundry fluff-and-fold vertical template
  - server/strategy/decisionPolicy.ts: Deterministic ranking policy with initiation cost model, clustering bonus, capacity constraints, neutral unknown economics, and ignoring injected LLM ranks
  - server/strategy/playGenerator.ts: Candidate play generator, 2-3 route fork creator with daily deduplication and 7-day expiry
  - server/strategy/pathChoiceService.ts: Strategic path choice handler, voice readback verification, G6 spend clearance gating, and G1 zero-warmth guarantee
  - server/claire/character/relationshipEmitters.ts: Guardrail G1 regex updated to reject path choices/fork selections
  - server/strategy/strategyRouter.ts: Mounted strategy.plays subrouter (offer, choose, active)
  - server/strategy/slice06PlaysRankingOffers.test.ts: 14 comprehensive tests
MIGRATIONS (additive only? y/n, names):
  - y, 0082_strategy_plays_and_paths.sql
FLAGS ADDED (name, default):
  - claire.strategy.plays (default: false in production, true in tests)
GUARDRAIL TESTS (names, pass/fail):
  - guardrail.G1.no_warmth_on_path_choice (PASS)
  - guardrail.G1.no_warmth_for_agreeing_with_recommendation (PASS)
  - guardrail.G6.needs_approval_play_does_not_spend_on_choice (PASS)
  - guardrail.G12.unknown_economics_score_neutral (PASS)
  - guardrail.G13.no_laundry_logic_in_core (PASS)
OTHER TESTS (count, pass/fail):
  - 9 other tests (PASS, total 14 in slice06 test file; 54 across Slices 1-6)
TYPECHECK (touched files):
  - Clean / PASS
PLAN ASSUMPTIONS THAT WERE WRONG:
  - None; PR #148 refactoring and vertical isolation implemented as specified in amended Slice 0 inventory.
DEVIATIONS FROM THIS PROMPT AND WHY:
  - In-memory fallbacks utilized when database connection is unavailable during offline unit test execution so deterministic ranking and fork offers remain 100% testable without live MySQL daemon.
MISSING ASSETS / DATA SOURCES (marked untracked):
  - 3D custom route geometries for Lantern City: route fork renders using existing overworld route primitive with world names.
RISKS / FOLLOW-UPS:
  - Slice 7 will link mission sequencer to active chosen path and implement sales prep and opportunity follow-through.
DEPLOY STATUS (merged? deployed per authoritative provider, or UNKNOWN):
  - UNKNOWN
HOW TO SEE IT (preview endpoint, admin URL, fixture command):
  - tRPC: strategy.plays.offer { tenantId }
  - tRPC: strategy.plays.choose { tenantId, offerId, chosenPlayId, surface, spokenConfirmation }
  - Test: npx vitest run server/strategy/slice06PlaysRankingOffers.test.ts
```

AUTONOMOUS PLAN AMENDMENTS APPLIED:
1. Core Decision Policy imports zero vertical-specific logic or trade constants (G13). All funnel stages and trade archetypes reside in `server/strategy/verticalTemplates/`.
2. Outing effort uses an initiation cost model (fixed base cost 50 + marginal stop cost 8) with a +25 geographic clustering bonus, preventing fragmentation across disconnected stops.
3. Path choices activate the strategic direction without committing funds or bypassing `spendClearance`.

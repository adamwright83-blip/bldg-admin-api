# Program E0 — Physical tree classification and move protocol

Verified against `7ba7310df76a142c053c9c2c857b750e207cb221` (October 8, 2026). Program D is [certified](PROGRAM_D_CERTIFICATION.md). This classification captures **86 existing server subdirectories**, but it does not assert that every folder is semantically pure. The classification labels are working navigation categories. No runtime file was moved in E0/E1.

## Current tree inventory

| Working classification | Directories | Current paths |
| --- | ---: | --- |
| `business-authority` | 10 | `server/orders/`, `server/authority/`, `server/money/`, `server/commercialPipeline/`, `server/commercialMissions/`, `server/commercialProposals/`, `server/commercialCampaigns/`, `server/geography/`, `server/canonicalBuilding/`, `server/territory/` |
| `business-read-and-operations` | 12 | `server/analytics/`, `server/churnRadar/`, `server/customerAssets/`, `server/field/`, `server/strategy/`, `server/salesIntel/`, `server/campaignRuns/`, `server/missionSalesBrief/`, `server/nightShift/`, `server/goldlineOnboarding/`, `server/franchise/`, `server/marketplacePayments/` |
| `agents-and-planning` | 17 | `server/agents/`, `server/claire/`, `server/daphne/`, `server/operatorRepresentative/`, `server/persistentOperator/`, `server/missionDirector/`, `server/dayDirector/`, `server/planning/`, `server/weeklyGrowthCandidates/`, `server/president/`, `server/mitch/`, `server/learning/`, `server/behavioralExperiment/`, `server/behavioralLedger/`, `server/behavioralSelection/`, `server/executionIntelligence/`, `server/operatorArtifact/` |
| `experience-and-game` | 21 | `server/armory/`, `server/businessWorld/`, `server/campaignLibrary/`, `server/companions/`, `server/driverGameWorld/`, `server/fictionPacks/`, `server/goldlineCargo/`, `server/goldlineKingdoms/`, `server/goldlineProgression/`, `server/goldlineVerification/`, `server/goldlineWorld/`, `server/grow/`, `server/impactSignals/`, `server/lanternCity/`, `server/narratorOs/`, `server/openChannel/`, `server/rookContact/`, `server/spiritHumanRescue/`, `server/towerWars/`, `server/unload/`, `server/worldForge/` |
| `integrations-and-external-evidence` | 6 | `server/cleancloudBrowserSync/`, `server/externalOrders/`, `server/externalSystems/`, `server/google/`, `server/googleCalendar/`, `server/twilioPlatform/` |
| `platform-and-saas` | 9 | `server/_core/`, `server/businessEvents/`, `server/capabilities/`, `server/clientFatal/`, `server/durableExecution/`, `server/identity/`, `server/saas/`, `server/schema/`, `server/team/` |
| `historical-legacy` | 8 | `server/legacyDayforgeCoaching/`, `server/legacyDayforgeDemo/`, `server/legacyDayforgeEvents/`, `server/legacyDayforgeProof/`, `server/legacyDayforgeRelease/`, `server/legacyDayforgeRetention/`, `server/legacyDayforgeSecurity/`, `server/legacyDayforgeToday/` |
| `mixed-verify-before-moving` | 3 | `server/goldline/`, `server/joystick/`, `server/procurement/` |

## Invariants and protected work

- **Frozen until Daphne PR #495 merges:** `server/claire/proactive/boardService.test.ts`, `server/claire/proactive/boardService.ts`, `server/claire/turn/claireTurn.ts`, `server/claire/turn/daphneV2RuntimeCorrection.mysql.integration.test.ts`, `server/claire/turn/daphneV2RuntimeCorrection.test.ts`, `server/daphne/claireAdapter.ts`, `server/daphne/explicitPreferenceCorrection.test.ts`, `server/daphne/explicitPreferenceCorrection.ts`. Daphne owns that PR's conflict resolution and merge. When it merges, fetch current main and separately integrate its changes into later Program E physical moves.
- Preserve PR #476; do not silently absorb its Claire tests.
- President and Mitch are separate managed workstreams. Do not edit/rebase their open PR heads as part of a filesystem cleanup.
- Orders, Payment, Commercial, CleanCloud/external evidence and Driver boundaries are governed by the certified A–D rules, regardless of target folder name.
- The externally used resident agent tool contract, legacy production endpoints, SQL migrations, feature flags and active workflows must survive any later physical move.

## Permitted sequence: no cosmetic shell games

1. **CLASSIFY** every code unit and its entrypoints, tests, exports, migrations, scripts and consumers.
2. **SPLIT MIXED RESPONSIBILITIES**; if ownership remains ambiguous, record UNKNOWN and stop that move.
3. **MOVE WRITES/AUTHORITY** only to the domain that already legally owns them; preserve admissions and actor/tenant checks.
4. **MOVE READ/PROJECTION/EXPERIENCE** code to its actual consumer; do not create parallel read truth.
5. **RENAME** only after semantic ownership is proven.
6. **REMOVE OBSOLETE WRAPPERS/NAMES** only when no live consumers remain and backward compatibility is proved.
7. **COLD-MODEL EXAM:** independent model, no chat context, file-cited answers and explicit unknowns.

For each future slice require an OLD PATH → NEW PATH map, import/callsite impact assessment, one coherent PR, compile and domain tests, and a post-merge check. Avoid multi-domain tree churn in one PR. Begin physical moves with independently bounded non-overlapping modules; do not relocate any protected #495 path before merge.

## Reconciliation with Codex E0 PR #501

Codex's merged [Program E audit](PROGRAM_E_AUDIT.md) is the controlling E0 classification and target physical taxonomy. This file and the JSON map are supplemental current-path lookup aids, not authorization to move a directory or to replace E0's OLD → NEW migration plan. Where the proposed target tree and this provisional grouping differ, use the E0 audit plus actual ownership callsite evidence before moving anything.

## E slices and current checkpoint

- **E0** classification and physical-migration plan: merged in PR #501; this extra full-tree inventory supports E1 navigation.
- **E1** canonical repository entrypoint and navigational contract: this checkpoint.
- **E2** Orders/Payment/Commercial and other core business modules: pending small verified slices.
- **E3** platform, worker and integration boundaries: pending.
- **E4** Claire/Daphne/Operator/President/Mitch/planning: pending; Daphne paths frozen.
- **E5** world/game/experience versus business-authority split: pending.
- **E6** genuine legacy quarantine and composition cleanup: pending.
- **E7** repository-wide import, old path, guard and documentation audit: pending.
- **E8** independent cold-model comprehension certification: pending; use [the exam](PROGRAM_E_COLD_READ_EXAM.md).

## Explicit unknowns to settle before moves

- The mixed `server/goldline/`, `server/joystick/`, and `server/procurement/` require per-file responsibility classification before physical moves.
- A historically named `legacyDayforge*` module may be required by live routes, migrations or compatibility APIs. Never equate legacy-named with removable.
- The current-folder classification is not a legal-write-API proof: inspect owning functions, callers and historical admission evidence.
- No independent cold-model exam has been run or passed yet.

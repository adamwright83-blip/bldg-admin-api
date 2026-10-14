# Claire analytical intelligence — acceptance evidence

Implementation extends the recovered PR #581 baseline (`11b10416`) in PR #582. Recovery, module boundaries, sandbox controls and authority separation are documented in [approved-view-analysis.md](approved-view-analysis.md).

## Actual configured model

The real provider served `claude-sonnet-4-6`, resolved through Claire's existing model authority. This was not a mock, a second reporting model, or a model migration.

The final synthetic run passed five conversational turns and an independently selected proactive investigation in twelve provider calls, using real SQLite workers. The cohort oracle checks weekly intervals, outstanding-order exclusion, geographic refinement, ordered spending candidates and first-customer continuity. Its full trace contains fictional records only: [synthetic real-model report](../../artifacts/claire-analysis/real-model-synthetic.json).

A separate real-provider run used actual Laundry Farm records from authenticated tenant-scoped canonical readers. Seven independent checks passed in thirteen provider calls:

| Check | Result |
| --- | --- |
| Novel ordering consistency: variance of actual consecutive gaps divided by squared mean gap, compared with a separate JavaScript oracle | Passed |
| Exclude native outstanding orders without broadening the selected population | Passed |
| Apply Silver Lake scope using the customer's latest recorded ZIP geography | Passed |
| Preserve filters and order the remaining historical spending candidates | Passed |
| Resolve the first selected customer and compare returned latest-order date and contents with canonical records | Passed |
| Sum materialized recorded sales and reconcile with the canonical reconciler's included amount | Passed |
| Disclose missing costs and unsynchronized CleanCloud outstanding orders | Passed |

The real-data test transferred the approved dataset through RAM/IPC into a provider process with no database configuration. No raw production records, model outputs, customer names, monetary amounts or SQL text were saved in reports. Only booleans, execution metadata and query hashes were retained. No production business writes occurred. [Redacted real-data report](../../artifacts/claire-analysis/real-model-production-redacted.json).

The actual-record test caught two integration defects that synthetic data had not established: imperative analytical requests could miss the old question-prefix gate, and follow-up context could cause earlier cohort criteria to be recomputed. Both were fixed with regression coverage. The last-order oracle checks actual canonical date/content rather than requiring a projected customer-ID column; a separate worker test proves that ordinal retrieval is restricted to the stored first identity while preserving the full selected list for subsequent work requests.

## Deterministic validation

The final local regression suite covers analytics, Claire, strategy and the shared model adapter. The focused analysis suite uses real workers for SQL execution and mocked providers only where stated. It proves canonical overlap deduplication, tenant rejection, restricted-field/schema rejection, hostile statements, recursive/Cartesian restrictions, hard timeout termination, result limits, cancellation, fabricated model-reference rejection, private identity-metadata redaction and scoped follow-ups.

Continuity tests also prove that analytical turns cannot record developments, replan, approve or execute. An explicit operator request creates an exact pending revision through the existing proposal port; the existing approval callback is required to commit it. Desktop/telephone routing, Showrunner, claim provenance and existing strategy regressions remain covered.

TypeScript checking, production packaging and the copied trusted worker syntax are checked locally and by the new `Claire approved-view analysis / bounded-evidence` workflow. Check the PR for the final remote CI state; local passes are not a claim that all remote checks have completed.

## Remaining release considerations

The governed Silver Lake dormant-customer calculation reproduces the previously reported fourteen-customer count on current records at the fixed acceptance clock. The prior exact raw snapshot and historical reporting window were not retained, so identical historical-dataset reproducibility remains unproven. This is explicitly false in the redacted report and is not counted as a passed historical-snapshot certification.

The five-customer spending selection is analytical evidence for existing strategic preparation, not a new mission-ranking engine. Exact-revision proposal authorization is covered separately with isolated test ports; certification does not create real customer tasks or contact customers.

CleanCloud outstanding orders and complete costs remain unavailable. Geography is ZIP-approximate. Inactivity is not proven churn; recorded sales are not profit; partial coverage is not zero. Large datasets and exhausted budgets fail explicitly. Physical microphone certification is outside this text acceptance.

No merge or deployment has occurred. Review the historical reproducibility gap and remote CI before authorizing release.

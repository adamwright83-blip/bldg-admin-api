# Anthropic cost control (2026-10-16)

## What spent the money

| Source | What happened | Status |
|---|---|---|
| Claude's local real-model replays | About 15 full replay runs today, run with `railway run`, which uses the **production** key. Each run was roughly 50–70 Sonnet calls. This was most of the ~$10. | Stopped. Paid replays now need `CLAIRE_PAID_REPLAY_AUTHORIZED=1` (`server/claire/workLedger/paidReplayGate.ts`). |
| GitHub Actions `claire-conversation-integrity.yml` | Ran three real-model suites on every push to the Claire branches. | Fixed. Pushes run only the deterministic job. The paid job runs only on manual dispatch with `run_paid_model_replays=true`. |
| Production Mission Director (`explainPlan.ts`) | The goal-cycle worker's 5-minute bootstrap re-planned each operator. Every pass paid for a Haiku "explain the plan" call **before** the code checked whether the plan had changed. Bursts of 4 calls every ~3–5 minutes, all day. When the plan was `no_plan`, the explanation was paid for and then thrown away. | Fixed. The input fingerprint is checked first, so an unchanged plan returns the stored revision with no model call. `no_plan` outcomes never call the model. |
| Production tracked usage, October to date | `tenant_ai_usage`: 2,862 requests, about $35 estimated (the estimate priced every model as Sonnet). | Haiku is now priced as Haiku in estimates. |

## Other holders of the same key (verified by hash; the values were never printed)

The same Anthropic key is used by:

- `bldg-admin-api`
- `president-worker`
- `claire-real-exam-temp`
- `claire-temporal-exam-temp`

Notes:

- The two `*-exam-temp` services ran real-model exams and redeployed at 19:17 today, together with the API.
- `president-worker` is currently crash-looping on a MySQL sort-memory error rather than calling the model.
- `mitch-producer` and `bldg-resident` use different keys.

**Recommended (your decision; nothing was deleted):**

- Remove or pause `claire-real-exam-temp` and `claire-temporal-exam-temp`.
- Check whether `president-worker` should run at all.

## Keys and limits (Anthropic Console, your action)

1. Create two workspaces with separate keys:
   - **production**: only `bldg-admin-api` and `bldg-resident`.
   - **testing**: the GitHub `CLAIRE_TEST_ANTHROPIC_API_KEY` secret and any local replay.
2. Set a monthly spend limit on each workspace. For example, testing at $5, so a runaway test stops on its own.
3. Store the testing key as the GitHub secret `CLAIRE_TEST_ANTHROPIC_API_KEY`. The paid CI job reads only that secret.
4. Locally, never use `railway run` for a paid replay; the gate refuses to run when Railway variables are present. Use the testing key explicitly:
   `ANTHROPIC_API_KEY=<testing key> CLAIRE_REPLAY_KEY_IS_TESTING=1 CLAIRE_PAID_REPLAY_AUTHORIZED=1 CLAIRE_WORK_LEDGER_LIVE=1 pnpm vitest run …`

## Per-feature attribution (new)

- Every model call now records its cost in `tenant_provider_usage` under the category `llm:<feature>`. Examples: `llm:claire_work_ledger`, `llm:claire_brain_v3_turn`, `llm:mission_director_explanation`, `llm:claire_follow_up`.
- Structured calls use their schema name as the feature. Plain-text calls pass `feature`, defaulting to `text_generation`.
- To see where money goes this month:
  `SELECT category, requestCount, estimatedCostCents FROM tenant_provider_usage WHERE month = '2026-10' ORDER BY estimatedCostCents DESC;`
- Rows written before this change stay under the old `llm` category.

## Before the next paid replay

Use the testing key and keep its spend limit. Run one suite at a time; the approximate costs are listed in `paidReplayGate.ts`.

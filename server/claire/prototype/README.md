# Claire native-tool prototype (non-production experiment)

Built 2026-10-29 after the Oct 27 and Oct 28 production calls. **Not wired into
production Claire, the phone transport, or `invokeLLM`.** It exists to test one
hypothesis with evidence: Claire does her job better as one Claude model with a
few complete-workflow tools than as a perception → executive → composer pipeline
where the speaking model is told it may not write.

Anthropic guidance followed: [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents),
[Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents),
[Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents),
[Demystifying evals for AI agents](https://anthropic.com/engineering/demystifying-evals-for-ai-agents),
[Tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview).

## Pieces

| file | what |
|---|---|
| `spokenDate.ts` | Server-side "tomorrow / Friday / next Thursday / the 3rd" → business date; vague days refused. One weekday rule shared with the evals. |
| `tools.ts` | Five tools: `read_day_line`, `apply_day_line_changes` (batch, per-item receipts, dedupe, read-back), `read_business_numbers`, `save_standing_instruction`, `end_call`. Writes go through `acceptProposalWithReceipt` with operator-instruction admission, `moveDayDirectorCommitment`, `completeDayDirectorCommitment`, `cancelDayLineItem`. |
| `claireToolLoop.ts` | The Messages API tool loop. Tool results stay in the thread for the whole call. |
| `evals/scenario.ts` | Locked scenario format and grading semantics. |
| `evals/grade.ts` | Code-based grader: final DB state, forbidden writes, seeded rows intact, false save claims, denials of confirmed saves, repeated authorization asks. |
| `evals/userSimulator.ts` | A second model plays the operator for goal-driven scenarios. |
| `evals/runEvals.ts` | Seeds a disposable MySQL per trial, runs `prototype`, `v2` (production Brain V2 via the real inbound-call path) or `noop`, grades, writes traces and `REPORT.md`. |
| `evals/scenarios/dev/` | Development set: the two production calls as business situations plus authored guards. |
| `evals/scenarios/sealed/` | Held-out set written by a separate agent; the prototype's author did not read it. |

## Run

```
docker run -d --name claire-eval-mysql -e MYSQL_ROOT_PASSWORD=test-only -e MYSQL_DATABASE=claire_eval -p 127.0.0.1:3306:3306 mysql:8.0
export DATABASE_URL=mysql://root:test-only@127.0.0.1:3306/claire_eval
node scripts/migrate.mjs
# harness self-check, no model:
pnpm tsx server/claire/prototype/evals/runEvals.ts --systems noop --sets dev --trials 1 --out /tmp/eval-noop
# real models (capped testing key only):
ANTHROPIC_API_KEY=… pnpm tsx server/claire/prototype/evals/runEvals.ts --systems prototype,v2 --sets dev,sealed --trials 3 --out eval-output
```

CI: `.github/workflows/claire-prototype-eval.yml` (manual, `CLAIRE_TEST_ANTHROPIC_API_KEY`).

## What passing means

A scenario passes when all trials pass (pass^k). Passing the dev and sealed sets
justifies a larger evaluation and a design review, not a production swap.

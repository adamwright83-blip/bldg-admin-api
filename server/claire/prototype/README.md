# Claire native-tool prototype (on the phone for allowlisted operators since 2026-10-29)

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
| `tools.ts` | Seven tools: `read_day_line`, `find_day_line_item`, `apply_day_line_changes` (batch, per-item receipts, dedupe, read-back), `read_business_numbers`, `read_goal_progress`, `save_standing_instruction`, `end_call`. Writes go through `acceptProposalWithReceipt` with operator-instruction admission, `moveDayDirectorCommitment`, `completeDayDirectorCommitment`, `cancelDayLineItem`. |
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

## On the phone (production seam)

`voiceEngine.ts` is the seam between the Twilio call (`server/claire/claireTwilio.ts`:
identity, token, transcription, speech, call ledger) and this tool loop. Nothing else about
the call changed: same number, same greeting, same Conversation Relay socket, same
transcript ledger.

- **Who.** `CLAIRE_NATIVE_TOOL_OPERATOR_IDS` (comma list). `owner` = `OWNER_OPEN_ID`;
  `tenant:operator` scopes to one tenant; a bare id matches that operator anywhere.
  Unset: nobody, everyone stays on Brain V2. The same switch covers inbound calls and the
  scheduled morning and evening calls (`executeDailyClaireCall`). Weekly planning calls stay on V2.
- **Scheduled calls.** Read before dialing. The model writes the opening from live reads
  (`read_goal_progress`, then the Day Line only if it needs it) after a call-start notice that is
  never recorded as operator words, so nothing can be authorized by it. No showrunner briefing,
  scripted opening or Daphne tone decision is prepared. The voicemail check runs before the model
  on every outbound turn. Scenarios with `callKind` exercise this in the evals (prototype only).
- **Rollback.** `CLAIRE_NATIVE_TOOL_KILL_SWITCH=1` (or emptying the list) puts the NEXT
  call back on V2. Railway restarts the service on a variable change (same build, no code
  deploy). A call already in progress never changes engine: the engine is chosen at pickup
  and persisted in the call state (`PreDriveConversation.nativeTool`).
- **No silent fallback.** A model failure mid-turn is spoken as a failure
  (`NATIVE_TOOL_FAILURE_LINE`), the model thread is restored to before the turn, and the
  call stays on this engine.
- **Logs.** `[ClaireNativeTool]` carries `engine_selected`, `turn` (latency, model calls,
  tokens, tool names, receipt statuses and row ids) and `turn_failed`. Transcript text goes
  through the existing scoped `[ClaireTranscript]` mirror only. Each Claire ledger turn
  carries `providerMetadata.engine = "native_tool"` and the tool summary.
- **Tests.** `voiceEngine.test.ts` (switch), `voiceEngine.mysql.integration.test.ts` (the
  production open and relay-turn functions against a disposable MySQL with a scripted
  model: write, singular-vs-plural completion, forged quote refused, failure spoken, end
  of call, ledger rows). `evals/liveSmoke.ts` runs the same path with a real model
  (workflow dispatch, `mode: smoke`).

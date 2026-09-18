# Claire Intelligence PR1 exam artifacts — what these actually are

Per corrective note B and the coordinator's follow-up instructions, this
directory is honest about scope:

- **`before-metrics.json`** — a config/prompt baseline pulled directly from
  `git show main:...` (i.e. the actual pre-PR1 source), not a live
  production log query and not a live conversational run. Production
  `claire_generation_logs` were not queried: no existing read-only
  production-query tooling was found in this repo/environment. No
  fallback-rate or log-derived number is fabricated anywhere in this
  directory.
- **`run-exam.ts`** — a deterministic harness that calls the real, modified
  `answerClairePreDriveFollowUp` / `writeClairePreDriveBrief` functions
  against fixture context, with a scripted ("mocked") model response
  injected per turn. It proves real prompt composition, real generation
  parameters actually requested, and real guardrail behavior (the
  assertion guard / G2 / CEO lints actually run against the scripted text
  and can actually reject it) — it does **not** prove that a live Anthropic
  model, given these prompts, produces subjectively better conversation.
  Run it with `npx tsx docs/goldline/claire-intelligence/run-exam.ts` from
  the repo root (needs `ANTHROPIC_API_KEY` set to any non-empty string in
  the environment; it never calls the network).
- **`after-pr1-transcript.md`** / **`after-pr1-metrics.json`** — the output
  of that harness, generated against the PR1 code. Re-running the script
  regenerates them deterministically (same fixtures, same scripted
  outputs).
- There is no live-app, live-Twilio, live-Anthropic "before" run and no
  live "after" run in this repo's history for this PR. A true live exam
  (real phone call or real HTTP conversation loop against a running
  deployment with real Anthropic responses) was out of reach in this
  environment — no running app instance, no Twilio call path available
  locally, and per corrective note B, no invented latency or log numbers.
  This is stated plainly rather than skipped silently, per the coordinator's
  instruction.

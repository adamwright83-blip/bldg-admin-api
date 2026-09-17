# Claire Intelligence Repair — PR1 Handoff (living doc, final for this pass)

Branch: `codex/claire-intelligence-pr1-conversation`.
PR: [#161](https://github.com/adamwright83-blip/bldg-admin-api/pull/161) (draft, targeting `main`).
Head SHA as of this update: see `git rev-parse HEAD` at time of push (recorded in the PR/commit history — this doc is not re-stamped per micro-commit to avoid drift; trust the PR's actual HEAD over any SHA copied here).

Verified ancestor: PR #151 (`8e6c7003dfd19c6cda5585120c1fee5bfcd54ce7`) is confirmed via
`git merge-base --is-ancestor` to be in `main`'s history; this branch was cut from latest `main`.

**Subjective Claire intelligence acceptance requires Adam's review.** Nothing in this
document or in the automated test suite certifies that Claire "sounds smarter" —
only that a bounded, tested slice of the spec is implemented, guardrails are intact,
and the full existing suite plus new tests pass. See "Known limitations" at the end.

---

## Files changed

- `server/_core/env.ts` — added `ENV.anthropicModelClaire` (`ANTHROPIC_MODEL_CLAIRE`).
- `server/_core/llm.ts` — `invokeTextLLM` now accepts and correctly orders `assistant`-role messages.
- `server/_core/llm.test.ts` — updated one test (assistant is no longer an invalid role; switched to `"tool"` for the invalid-role case), added 2 new tests for assistant-role ordering/non-collapse.
- `server/claire/preDriveConversation.ts` — un-nerfed `answerClairePreDriveFollowUp`; real message history; new fallback line; telemetry now carries `modelRequested`/`surface`.
- `server/claire/reasoning.ts` — un-nerfed `writeClairePreDriveBrief`; sentence-boundary trim instead of a hard char cut; telemetry now carries `modelRequested`/`surface`.
- `server/claire/generationTelemetry.ts` — added optional `modelRequested` / `surface` fields to `ClaireGenerationDiagnostic` and the emitted `claire_generation` event (additive, non-breaking).
- `server/claire/generationPaths.test.ts` — updated prompt-content and telemetry-shape assertions to match the new copy/fields.
- `server/claire/slice03AssertionGuardWiring.test.ts` — updated the follow-up fallback-text assertion to match new copy; behavioral assertion-guard check unchanged and still passing.
- `server/claire/pr1TestMatrix.test.ts` — **new**, 13 tests directly covering spec section 16 items 5–11 and 15–21 (see below).
- `docs/goldline/CLAIRE_INTELLIGENCE_PR1_HANDOFF.md` — this doc.
- `docs/goldline/claire-intelligence/README.md`, `run-exam.ts`, `before-metrics.json`, `after-pr1-transcript.md`, `after-pr1-metrics.json` — deterministic exam harness and its outputs (see "BEFORE vs AFTER" below).

No other files are touched. Confirmed via `git diff --stat main`.

---

## What this PR actually changes (behavior)

1. **`ENV.anthropicModelClaire`** (`ANTHROPIC_MODEL_CLAIRE`) — follows the exact existing
   per-feature pattern (`anthropicModelVendorOnboarding`, `anthropicModelMissionPlanner`).
   Wired at both edited call sites as `ENV.anthropicModelClaire || ENV.anthropicModel`,
   matching the repo's existing convention (`vendorOnboardingAgent.ts:617`,
   `vendorCandidateServiceAreaStructuredInterpreter.ts:161`). **No new model string invented.**

2. **`invokeTextLLM`** now accepts `role: "assistant"` and relays `system`/`user`/`assistant`
   turns to Anthropic in the given order — real alternating history, not one serialized JSON blob.

3. **`preDriveConversation.ts` (`answerClairePreDriveFollowUp`)** and **`reasoning.ts`
   (`writeClairePreDriveBrief`)**: removed the "only clarify/restate" framing, the blanket
   "no outside knowledge"/"no sales doctrine" prohibition, the 55-word and 70-word/3-sentence
   caps, the 180/320-token ceilings, the 0.1/0.15 temperatures, the hard 520/900-char cuts, and
   the canned "I can only clarify today's field brief..." always-fallback line. Replaced with
   a business-fact-vs-general-knowledge distinction, 600/500 maxTokens, 0.6 temperature, a
   generous sentence-boundary trim, and a varied, honest fallback line. Prompt composition
   reordered to: identity → eligible canon → verified context/fact inventory → task →
   truth/action boundaries → conversation history → latest turn.

4. **Telemetry**: `ClaireGenerationDiagnostic` gained optional `modelRequested` and `surface`
   fields, populated at both edited call sites, additive and non-breaking to existing callers.

---

## Test matrix (spec section 16) — item-by-item

| # | Item | Where proven |
|---|---|---|
| 1–4 | assistant messages accepted; ordering reaches Anthropic; untrusted third-party text; operator utterance as normal input | `server/_core/llm.test.ts` (new tests), prior report |
| 5 | general knowledge allowed as advice, not asserted as business fact | `pr1TestMatrix.test.ts` #5 |
| 6 | business-specific facts still require verification or "unknown" | `pr1TestMatrix.test.ts` #6 |
| 7 | assistant-history hallucination can't become verified truth next turn | `pr1TestMatrix.test.ts` #7 (history is relayed as real assistant turns, not folded into "verified" content; end-to-end rejection proven in item 19) |
| 8 | opening brief no longer has the old suppressing cap | `pr1TestMatrix.test.ts` #8 |
| 9 | follow-up no longer has the 55-word/520-char gag | `pr1TestMatrix.test.ts` #9 |
| 10 | a complex question can get a multi-sentence answer, no hard truncation | `pr1TestMatrix.test.ts` #10 |
| 11 | a simple question can still get a short answer, no forced padding | `pr1TestMatrix.test.ts` #11 |
| 12–14 | model env override/fallback; extraction paths stay low-temp; existing suite green | prior report; `businessConversation.ts::extractClaireDebrief` (temp 0) and query-plan parser (temp 0) untouched, confirmed by grep |
| 15 | G2 disappointment/guilt/shame lint remains active | `pr1TestMatrix.test.ts` #15 (unit + wired end-to-end: a disappointment-framed model string is rejected and falls back) |
| 16 | CEO-language lint remains active | `pr1TestMatrix.test.ts` #16 (same pattern) |
| 17 | recovery/clinical framing does not auto-enable | `pr1TestMatrix.test.ts` #17 (the shared `CLAIRE_V1_REASONING_POLICY` recovery-language prohibition is confirmed still present in the composed prompt) |
| 18 | `operator_avoidance` remains disabled | `pr1TestMatrix.test.ts` #18 (absent from both `WARMTH_EMISSION_ALLOWLIST` and `CLAIRE_ATTESTABLE_EVENT_TYPES`, unchanged by this PR) |
| 19 | verified-state guard still blocks unsupported sent/completed/scheduled claims | `slice03AssertionGuardWiring.test.ts` (existing, updated only for new fallback copy, behavior unchanged) + `pr1TestMatrix.test.ts` #19 (confirms the guard function is still imported/called in both edited functions) + the exam harness (`after-pr1-metrics.json`, turn "unverified sent/completed/scheduled claim should be rejected by the guard" → `source: "fallback"`) |
| 20 | fallback telemetry records reason/source | `pr1TestMatrix.test.ts` #20/21, `generationPaths.test.ts` (updated) |
| 21 | provider/model name is logged | same — `modelRequested` field added to `ClaireGenerationDiagnostic` and the `claire_generation` telemetry event |
| 22–23 | shared `ClaireConversationCore`, usable by voice and surface-neutral for a future desktop surface | **Not applicable — deferred.** This refactor was not built in PR1 (see "What is NOT done"). No test exists for it because the module does not exist; faking one would misrepresent the state of the code. This is the correct call per the coordinator's own instruction, not an oversight. |
| 24 | existing Claire turn tests remain green | `npx vitest run server/claire` — all pass |
| 25 | StrategyEngine/business-truth regression tests remain green | `npx vitest run` (full repo) — all pass, see CI section |

Full new/updated test count: 2 new in `llm.test.ts`, 13 new in `pr1TestMatrix.test.ts`, 6 assertions updated in `generationPaths.test.ts` and `slice03AssertionGuardWiring.test.ts` to match new copy without weakening behavior.

---

## Slice 3 fact-verification wiring — confirmed intact (unchanged from prior report)

`buildClaireVerifiedFactInventory` → `inventory.toPromptSection()` injected into the system
prompt, and `assertPostGenerationStateVerbs(text/trimmed, inventory)` still runs on model
output before acceptance, in both edited functions, in the same try/catch → fallback
structure as before. `businessConversation.ts` and `turn/claireTurn.ts` were **not modified**
and their existing wiring is untouched (`slice03AssertionGuardWiring.test.ts`,
`slice01SafetyBaseline.test.ts` unchanged, still passing).

## Resident-app integration surface — confirmed untouched (re-verified this pass)

```
git diff --stat main -- server/agents/permissions.ts server/agents/s2sEndpoint.ts server/agents/tools/
git diff main | grep -n "ADMIN_AGENT_SHARED_SECRET\|APP_SHARED_API_SECRET"
```

Both empty. Zero diff to the 8 resident-facing tools, their allowlists, or either shared secret.

---

## CI / self-correction (spec section 17)

Ran against the final branch HEAD:

- `npx vitest run server/claire server/_core` → **43 files, 369 passed, 0 failed.**
- `npx vitest run` (full repo, unit config) → **635 files, 5910 passed, 7 skipped, 0 failed.** This includes all Claire turn tests, conversation ledger/state tests, character/relationship tests, assertion-guard tests, and every StrategyEngine/business-truth-affected test in the repo — nothing in this PR's diff regressed any of them.
- `npm run check` (`tsc --noEmit`) → 47 pre-existing errors, all in `server/sheets.ts`,
  `server/cleancloudCsvSheetSync.ts`, `server/truePnlCockpit.ts`, and a few procurement/payment
  store files — all `googleapis`/`google-auth-library` peer-version type conflicts, **zero of
  them in any file touched by this PR**. Confirmed pre-existing by running the identical
  `npm run check` against the branch's own committed HEAD before these working-tree changes
  (`git stash` / `git stash pop`): same 47 errors, same files, before any of this pass's edits.
  Not introduced by, not fixed by, and unrelated to this PR.
- Repo CI workflows actually present (`.github/workflows/`): `dayforge-release.yml`,
  `goldline-fast-smoke.yml`, `goldline-mobile-regression.yml`,
  `lantern-city-territory-mosaic.yml`, `sales-intel-teaching-review.yml`. All of them require
  either a live MySQL instance (`pnpm db:dayforge:release`), Playwright/Chromium + Python image
  rendering, or an integration-test DB config — none are runnable in this sandboxed
  environment (per this repo's own documented "no database in local build environment"
  constraint). `goldline-fast-smoke.yml`'s non-DB step is `pnpm check`, run above. I did not
  guess at these gates' pass/fail status — they simply could not be executed here, and none of
  their listed test files (`driverSalesJournalResilience.test.ts`, `armoryEvolution.integration.test.ts`,
  `dayforgeReleaseJourney.integration.test.ts`, `localTargetRun.test.ts`, `impactSignal.test.ts`,
  `goldlineProgression.test.ts`, `salesIntelTeachingReExtraction.integration.test.ts`) are
  touched by this PR's diff.
- No test was disabled, weakened, or had its assertion removed to make it pass. Every test
  edit either matches new (intentional) prompt copy/telemetry shape, or is a net-new test.

---

## Railway / production model (corrective note B, part a)

Railway MCP tools were reachable this pass. Project `supportive-creation`, service
`bldg-admin-api`, production environment. `list-variables` (name-only; values are redacted
for this account/token) confirms:

- `ANTHROPIC_MODEL` is **not set** as an explicit variable on the production service.
- `ANTHROPIC_MODEL_MISSION_PLANNER` and `ANTHROPIC_MODEL_SERVICE_AREA_VERIFIER` **are** set
  (values redacted — name-only visibility).
- `ANTHROPIC_API_KEY` and `ANTHROPIC_API_KEY_GoldlineAdminProduction` are both set.
- `ANTHROPIC_MODEL_CLAIRE` (this PR's new var) is, correctly, **not yet set** — it will fall
  back to `ENV.anthropicModel` at runtime, which resolves to `server/_core/env.ts`'s
  `DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6"` since `ANTHROPIC_MODEL` itself is unset in
  production.

**This resolves the open question from the prior report as far as it can be resolved without
reading a redacted secret value**: production Claire generation currently runs on the code
default `claude-sonnet-4-6`, not a Railway-configured override. If Adam wants Claire on a
different model, the correct action is either setting `ANTHROPIC_MODEL` (repo-wide) or the new
`ANTHROPIC_MODEL_CLAIRE` (Claire-only) in Railway — this PR does not set either, since doing so
is a production configuration change outside a code PR's scope and wasn't asked for.

---

## BEFORE vs AFTER — what could and could not be measured

**Production `claire_generation_logs` baseline**: still not queried. No existing read-only
production-query tooling was found in this repo/environment. No fallback-rate, latency, or
volume number from production is reported anywhere in this PR — this is a real, standing gap
that needs someone with direct production DB access.

**Live conversational exam (real app + real Twilio call + real Anthropic responses)**: not
attempted. No running app instance or live Twilio call path is available in this sandboxed
environment. Stated plainly rather than skipped silently.

**What *was* built this pass**: `docs/goldline/claire-intelligence/run-exam.ts`, a
deterministic harness that calls the actual modified `answerClairePreDriveFollowUp` /
`writeClairePreDriveBrief` functions against fixture context, with a scripted ("mocked")
model response injected per turn covering categories A (continuity), B (business memory),
C (strategic reasoning), D (general knowledge), E (truth boundary, including one turn
designed to trip the assertion guard), F (relationship continuity), G (style/length), plus
one opening-brief turn. This proves real prompt composition, real generation parameters
actually requested (maxTokens/temperature/model), and real guardrail behavior — **it does
not** prove live-model output quality. Full caveats in
`docs/goldline/claire-intelligence/README.md`.

Result of that harness (`after-pr1-metrics.json`): 12 turns, 11 passed through the widened
model path (600/500 maxTokens, 0.6 temperature, business-fact/general-knowledge distinction
present in the composed prompt), 1 correctly fell back — the turn where the scripted "model"
text claimed an unverified "already sent" action, which `assertPostGenerationStateVerbs`
correctly rejected. That single fallback is the *expected, correct* behavior, not a bug.

**BEFORE config baseline** (`before-metrics.json`): sourced directly from `git show main:...`
of the two edited files — real numbers from the actual pre-PR1 source (180/320 maxTokens,
0.1/0.15 temperature, 520/900-char hard caps, 55/70-word prompt caps, the canned always-fallback
line, JSON-blob-only conversation history) — not fabricated, not a live run.

**Twilio voice latency path** — documented from reading the code (`server/claire/claireTwilio.ts`):

1. Twilio POSTs the speech result to a webhook (`PRE_DRIVE_PATH` / `CONTINUE_PATH`), validated
   via `validTwilioRequest`.
2. The webhook starts an async "voice turn" job (`startVoiceTurn`) which internally calls
   `answerClairePreDriveFollowUp` (routing/context assembly → the Anthropic `invokeTextLLM`
   call → guardrail checks → telemetry).
3. The webhook handler waits up to `TURN_BUDGET_MS = 11_000` (11 seconds) for that job
   (`withinBudget(job, TURN_BUDGET_MS)`). If the job finishes in time, the handler returns a
   `<Gather><Say>...</Say></Gather>` TwiML response immediately.
4. If the job has not finished within the budget, the handler instead returns a short "still
   working" TwiML (`stillWorkingTwiML`) that says a brief holding phrase and re-polls via
   `CONTINUE_PATH` (up to a few attempts, each also budgeted at `TURN_BUDGET_MS`), until the
   job completes or a max-attempts message is spoken.
5. **Text-to-speech uses Twilio's own `<Say>` verb** (Twilio's built-in TTS, voice constant
   `CLAIRE_VOICE`, with `prosody` rate/volume tags) on the **complete, already-generated**
   response text. Twilio synthesizes and starts speaking only after `<Say>` receives the full
   text in the TwiML response.

**True token-to-TTS streaming does not exist today.** There is no `<Stream>`/WebSocket path
piping incremental LLM tokens into a live TTS stream — the architecture is: full LLM
generation completes (or the 11-second budget expires and a holding message plays) → full
text is returned as one TwiML `<Say>` → Twilio's TTS engine speaks it. This is stated from
reading the code, not assumed.

**Measured live time-to-first-spoken-word**: **not measured.** There is no running Twilio
call in this environment to measure against, and no historical latency metric surfaced by
existing telemetry (the `latencyMs` recorded by `recordClaireGeneration` measures the
generation function's own wall-clock time, not "time from operator's last word to Claire's
first spoken word," which would additionally include Twilio's webhook round-trip and its
`<Say>` TTS synthesis start time — neither instrumented today). No number is fabricated here.

---

## What is NOT done in this PR (explicitly open, unchanged categories from prior report + this pass)

- Production `claire_generation_logs` baseline — not queried (no safe tooling found).
- Live-app/live-Twilio/live-Anthropic conversational exam — not attempted (no running
  instance available); the deterministic mocked-harness exam above is the closest tractable
  substitute and is explicitly labeled as such.
- Shared `ClaireConversationCore` refactor (spec items 22/23) — not attempted; deferred to a
  future "one brain, multiple surfaces" pass, not started.
- Telemetry beyond `modelRequested`/`surface` — no conversation/session id or
  route/responder field was added; the existing `recordClaireGeneration` shape and its DB/log
  persistence (`appendClaireGenerationLog`, `logAgentEvent`) are otherwise unchanged.
- Fallback-line variation beyond `preDriveConversation.ts`'s one call site.
- Measured live Twilio latency — architecturally documented (above), not measured.
- `ANTHROPIC_MODEL_CLAIRE` is not set in Railway production by this PR — that is a
  configuration action for Adam, not a code change.

## Truth statement (spec step 8, restated)

Automated tests confirm: transport-layer assistant-role correctness, presence/absence of
specific prompt strings (old suppression language removed, new business-fact-vs-general-
knowledge distinction present), that the assertion-guard/G2/CEO-language fallback paths still
fire correctly, that `operator_avoidance` remains disabled, that telemetry now carries
model/surface fields, and that the full existing 5910-test suite plus 15 new tests all pass.

**They do not, and cannot, confirm that Claire "sounds intelligent."** No live conversational
exam was run. **Subjective Claire intelligence acceptance requires Adam's review.**

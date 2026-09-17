# Claire Intelligence Repair — PR1 Handoff (living doc, final for this pass)

Branch: `codex/claire-intelligence-pr1-conversation`.
PR: [#161](https://github.com/adamwright83-blip/bldg-admin-api/pull/161) (draft, targeting `main`).
Head SHA as of this update: see `git rev-parse HEAD` at time of push (recorded in the PR/commit history — this doc is not re-stamped per micro-commit to avoid drift; trust the PR's actual HEAD over any SHA copied here).

---

## SECOND CORRECTIVE PASS (real-exam findings) — read this section first

The first real (non-mocked) Anthropic exam through this branch's actual code path
(`after-pr1-REAL-transcript.md`, run by someone with real Anthropic credentials — not this
agent) surfaced three real bugs the 5,917-test mocked suite had not caught. Adam independently
verified two of the three before this pass began. All three are fixed here, plus one durable
telemetry addition Adam asked for regardless of this specific exam.

### 1. Hard mid-sentence truncation — FIXED

`answerClairePreDriveFollowUp` (`preDriveConversation.ts`) had a 600-token generation ceiling
*and* a hard `.slice(0, 1200)` character cut applied to the model's output. The real exam hit
that exact 1200-char cap on 2 of 12 answers (`strategic_reasoning`, `complex`), both cut off
mid-sentence. Fixed: raised `maxTokens` to 1400, and replaced the hard slice with the same
`trimToSentenceBoundary` helper `reasoning.ts` already used, now shared via
`server/claire/textTrim.ts`, with a generous 6000-char safety net that should almost never
actually trim anything. No new behavioral length rule was added — she stays concise because the
character/mode instructions already say so, not because generation gets chopped.

**Durable stop-reason telemetry** (requested regardless of this specific bug): `invokeTextLLM`
(`server/_core/llm.ts`) now exposes an optional `onStopReason` callback that captures
Anthropic's real `stop_reason` ("end_turn", "max_tokens", ...). Both edited generation paths
wire it into `ClaireGenerationDiagnostic.stopReason` (`generationTelemetry.ts`), so any future
exam or production monitoring can positively detect "the model hit its token ceiling" instead
of inferring it from trailing punctuation.

### 2. Personal-canon hallucination ("London, originally.") — FIXED, generally

Verified: `characterDefinition.ts`'s canon for Claire's origin is exactly `"Claire is British."`
(core, Tier 0) and `"Claire had an internationally mobile childhood."` (tier-gated, Tier 1) —
no city anywhere. "Where are you from, Claire?" got the model an invented specific fact.

Fix is structural and general, per Adam's explicit instruction not to build a denylist for one
word: `server/claire/character/personalSpecificityGuard.ts`'s
`assertNoUngroundedPersonalSpecificity(text, eligibleCanonFacts)` extracts any proper-noun-shaped
specific (a place, a person's name, an organization — not just "London") from a personal-mode
answer and throws if it doesn't appear in the exact canon facts supplied for that turn. Wired
into `answerClairePreDriveFollowUp` immediately after a successful personal-mode generation,
routing a violation into the existing deterministic fallback path — exactly like the assertion
guard and G2/CEO lints already do. The prompt instruction was also strengthened: "go NO more
specific than what canon actually states... do not invent the more specific detail to sound
complete." Regression tests prove this rejects an invented *city* and, separately, an invented
*name* (proving it generalizes, not "blocks the word London"), while still allowing an answer
that stays at canon's real specificity and allowing ordinary business answers that legitimately
reference account/property proper nouns (the guard is scoped to personal mode only).

### 3. Timezone / business-time truth ("scheduled just before midnight") — ROOT CAUSE: THE EXAM FIXTURE, NOT PRODUCTION

Investigated before writing any fix, per Adam's explicit instruction:

- **Production's real context-builder** (`assembleClaireDriveContext` in `contextAssembler.ts`)
  always calls `buildClaireClock(now, timeZone)` and attaches the result as `context.clock`
  *unconditionally*, before Field Today is even queried and regardless of whether that query
  succeeds — this is proven by an existing test,
  `contextAssembler.test.ts`'s "assembles tomorrow from tomorrow's explicit business date",
  which already asserts `context.clock?.fieldSalesDayState` on a real assembled context. So a
  real call always carries a resolved business timezone (`America/Los_Angeles`) and a resolved
  "now" (`clock.localTime`).
- **`docs/goldline/claire-intelligence/run-real-exam.ts`'s fixture**, by contrast, built
  `scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString()` and set **no `clock` field at
  all**. The model had nothing but a bare, timezone-less UTC instant to reason from — that is
  the actual, sufficient explanation for "just before midnight."

**Conclusion: production was not broken in the way the symptom suggested — the exam fixture
was.** Per Adam's instruction for this case ("fix ONLY the fixture, add a test that mirrors
production's actual real serialization format"), the fixture now calls the exact same
`buildClaireClock(now, CLAIRE_BUSINESS_TIME_ZONE)` production uses (imported, not
reimplemented) and derives `scheduledAt` from a concrete 5pm-business-timezone instant via a
small, tested UTC↔zoned conversion helper — so it cannot silently drift from production's real
shape again.

That said, one real, if smaller, latent gap **was** found and fixed in production itself:
production resolves "now" to a business-local time, but never pre-rendered a *specific
commitment's* `scheduledAt` into local time the same way — it still relied on the model to
mentally convert a raw ISO timestamp, which is exactly the class of task a model can get wrong,
even with a timezone anchor available. Added `formatClaireLocalTime(iso, timeZone)` to
`contextAssembler.ts` (deterministic, tested, returns `null` for missing/invalid input) and
wired a new `nextFixedCommitmentLocalWhen` field into both generation paths' compact context
payloads, with an explicit instruction not to convert the raw timestamp directly. This is a
genuine, if narrower, production hardening — not a claim that production's timezone handling
was as broken as the fixture's.

### 4. Repetitive blocker nagging (8 of 12 turns re-mentioned the gate code) — addressed with prompt-level salience guidance

Added `BLOCKER_REPETITION_DISCIPLINE` (`server/claire/conversationVoiceGuidance.ts`), wired into
both generation paths: don't mechanically re-mention an already-surfaced blocker on an unrelated
answer unless the question is specifically about it, its status changed, or it's materially
relevant right now. This reads from the actual recent-turn history already passed as real
message-history turns (not a keyword/one-off suppression hack) — the model can see what was
already said and is instructed to reason about salience from that, the same way a human
colleague would.

### 5. Consultant-formatted, written-style answers ("Good question...", markdown headings) — scoped to voice surface

Verified `answerClairePreDriveFollowUp` is genuinely shared between the Twilio voice call and a
desktop/text surface (`server/claire/turn/claireTurn.ts`'s `surface: "voice" | "text"`, though
that caller does not yet pass `surface` through to this function). Added an optional `surface`
param (`ClaireGenerationSurface`, defaulting to `"voice"` to preserve exact existing behavior for
today's only real caller) and `VOICE_NATIVE_ANSWER_GUIDANCE` — no markdown/headings/bullet lists,
no "Good question" openers, natural spoken transitions instead of formatted structure — applied
only when `surface !== "desktop"`. `writeClairePreDriveBrief` (`reasoning.ts`) is voice-only in
production today, so the same guidance was added there unconditionally, no `surface` param
needed.

### 6. Rerunning the real exam — BLOCKED AGAIN, same root cause as before, not by choice

Per Adam's instruction, the identical 12-turn real exam should be rerun against this fixed code
on the same model for an apples-to-apples comparison. **This agent still has no working
`ANTHROPIC_API_KEY` in its sandboxed environment** — re-confirmed: `env | grep -i anthropic`
shows only `ANTHROPIC_BASE_URL` (the Claude Code harness's own, not a usable direct key). The
first real transcript (`after-pr1-REAL-transcript.md`) was produced by someone else (Adam or
another session) with real credentials, not by this agent — and that has not changed. No
fabricated "rerun" transcript is provided.

**Exact command to rerun, on this branch's new head, from a machine/environment with a real
key** (identical procedure as documented for the first run, in
`docs/goldline/claire-intelligence/after-pr1-REAL-transcript.md`):

```
git fetch origin
git checkout codex/claire-intelligence-pr1-conversation
npm install --legacy-peer-deps   # or pnpm install, matching this repo's lockfile
ANTHROPIC_API_KEY=<real key> npx tsx docs/goldline/claire-intelligence/run-real-exam.ts
```

This will overwrite `after-pr1-REAL-transcript.md` / `after-pr1-REAL-metrics.json` in place with
the new run's raw output (same filenames as the first run, since the harness always writes
those two files) — **save a copy of the current `after-pr1-REAL-transcript.md` /
`after-pr1-REAL-metrics.json` before rerunning if a true side-by-side diff against the first run
is wanted**, since the harness does not itself version its output. (This agent could not do that
copy-then-rerun itself, since it cannot run the harness with a real key at all.)

### Everything preserved (re-verified this pass)

`operator_avoidance` still absent from both event allowlists (untouched). G2 disappointment
lint and CEO-language lint still wired into `writeClairePreDriveBrief`, unchanged. Assertion
guard (`assertPostGenerationStateVerbs`) still called in both edited functions, now on the
sentence-trimmed text as before. Tier/disclosure eligibility gating in `canonStore.ts`/
`compiler.ts` untouched — only the personal-specificity *answer* is now checked post-generation,
the *retrieval* gating logic is unchanged. Resident-app tool surface and both shared secrets:
zero diff (reverified via `git diff --stat main`). Full suite: `npx vitest run server/claire
server/_core` → 46 files, 407 passed; `npx vitest run` (full repo) → 637 files, 5935 passed, 7
skipped, 0 failed.

**No merge was performed. PR2 was not started.**

---

---

## CORRECTIVE PASS (character voice fix) — read this section first

Adam had ChatGPT independently review PR1. It found real gaps in
`server/claire/character/` that the original PR1 pass did not touch (that
pass only edited `preDriveConversation.ts` and `reasoning.ts` — the
per-turn generation call sites — not the shared character-compiler
substrate both of them pull from). All three of ChatGPT's specific claims
were verified directly against the code before any fix was made:

| Claim | Verified? | Where |
|---|---|---|
| (a) `pre_drive` mode had a hidden `maxWords: 70` compiled into the prompt as "Keep it under 70 spoken words," separate from the word cap already removed from `reasoning.ts` | **Confirmed** | `characterDefinition.ts:118` (`MODE_POLICY.pre_drive.maxWords: 70`), compiled at `compiler.ts:79` (old: `` `Mode objective: ${modePolicy.objective} Keep it under ${modePolicy.maxWords} spoken words.` ``) |
| (b) A field-mode override told the model not to use "personal storytelling, emotional processing, teasing, or expressive flourishes," and eligible canon is only inserted on an explicit ask | **Confirmed** | `personalityLock.ts` `CLAIRE_FIELD_MODE_OVERRIDE` (old text matched exactly); canon-insertion gate at `compiler.ts:86` (`if (eligibleCanonFacts.length && (!modePolicy.fieldOverride \|\| input.explicitlyRequestedTopic))`) |
| (c) `compiler.ts` computes a `fewShotBlock` (Claire's example lines) as a field separate from `promptSection`, and neither `preDriveConversation.ts` nor `reasoning.ts` included it in what's sent to the model | **Confirmed** | `compiler.ts:113-116` computes `fewShotBlock`; grep of both files before this fix showed only `compiled.promptSection` referenced, never `compiled.fewShotBlock` |

### Fixes made (per the "know who she is vs. what she may volunteer" principle)

1. **Removed the hidden numeric cap.** `ClaireModePolicy.maxWords: number` → `lengthGuidance: string`
   (`types.ts`). Every mode in `MODE_POLICY` (`characterDefinition.ts`) now carries
   `CONCISE_BUT_FULL`: *"Default to concise, but let a genuinely strategic question run as long
   as it actually needs — do not truncate a real answer to hit a word count, and do not pad a
   short answer either."* `compiler.ts` now composes `` `Mode objective: ${objective} ${lengthGuidance}` ``
   instead of a numeric word count. No hard ceiling was reintroduced anywhere in the compiled
   prompt — confirmed by `pr1CharacterVoiceFix.test.ts` #1 (regex-asserts no `"keep it under N
   spoken words"` or bare `"N words"` pattern survives, and every mode's policy object lacks a
   `maxWords` property entirely).

2. **Rewrote `CLAIRE_FIELD_MODE_OVERRIDE`.** Kept the operational-focus limit ("don't start a
   personal story or dwell on feelings mid-task, don't let eligible canon derail the work") and
   removed the blanket ban on teasing/expressive flourishes. New text explicitly separates the
   two concerns: *"That is a limit on WHAT to volunteer, not on HOW you sound: stay exactly
   yourself — direct, dry, occasionally teasing, observant. Personality is not the same as
   personal disclosure."* The actual eligibility gating in `canonStore.ts`/`compiler.ts` (which
   facts are even retrievable/insertable by tier and topic) was **not touched** — confirmed by
   `pr1CharacterVoiceFix.test.ts` #4, which re-proves Tier 0/Tier 3-no-ask/Tier-1-with-ask/
   permanently-private behavior is bit-for-bit the same as before this change.

3. **Audited every few-shot in `fewShots.ts` before wiring `fewShotBlock` into any live
   prompt** (done in this order per the coordinator's explicit instruction — audit first,
   wire second). Rule applied: a few-shot may teach Claire's *voice*, never an unsupported
   claim about memory, learning, or operator-trait diagnosis.
   - `ordinary_pre_drive` — **kept as-is.** No memory/learning/diagnosis claim.
   - `avoidance` — **kept as-is.** "Were you avoiding walking through the door?" is a direct
     question about *today's specific observed fact* (drove to four buildings, entered zero) —
     it doesn't assert a stored avoidance trait, doesn't log or imply a relationship event, and
     doesn't touch the `operator_avoidance`-stays-off rule (no event type is emitted by this
     line; it's just a question).
   - `rationalization` — **kept as-is.** No memory/learning/diagnosis claim.
   - `claire_was_wrong` — **rewritten.** Before: `"...We keep the miss. Next time an account has
     already seen multiple approaches, I weight pitch fatigue much higher. You shouldn't have to
     remind me. I'll remember."` That's a durable-learning/memory claim with no real backing
     mechanism — the architecture doesn't persist a per-account weighting adjustment across
     calls anywhere. After: `"...We keep the miss, plainly, and move on — no excuses, no
     dressing it up."` Same dry, self-critical, no-excuses voice; the unsupported future-memory
     claim is gone. Confirmed by `pr1CharacterVoiceFix.test.ts` #5 (new copy present, old
     "I weight pitch fatigue"/"I'll remember" phrasing absent from the actual composed prompt)
     and #6 (structural regex sweep of all four few-shots for memory/learning/trait-diagnosis
     phrasing).

   `fewShotBlock` is now spliced into the system prompt in `preDriveConversation.ts` and all
   three `reasoning.ts` generation calls, immediately after `compiled.promptSection`, clearly
   labeled `"Voice reference only, not facts to repeat verbatim — illustrative examples of how
   Claire actually talks: ..."`, and only when the compiler actually produces one (i.e. never in
   non-field modes, unchanged from before).

### New regression tests: `server/claire/character/pr1CharacterVoiceFix.test.ts` (7 tests)

1. No hidden numeric word/char cap remains reachable in the `pre_drive` compiled prompt (regex + structural).
2. `CLAIRE_FIELD_MODE_OVERRIDE` no longer bans teasing/flourishes; still keeps the operational-focus limit.
3. Safe character grounding (`promptSection` containing the personality lock) is present in every one of the 11 modes.
4. Tier/disclosure gating is unchanged: Tier 0 and Tier 3 both get nothing inserted into the prompt without an explicit ask; Tier 1 + explicit ask surfaces the tier-1 fact; permanently-private never surfaces at any tier.
5. Both `answerClairePreDriveFollowUp` and `writeClairePreDriveBrief`'s actual model requests now contain the audited few-shot content, and no longer contain the old unsupported-memory line.
6. Structural sweep: none of the four routine few-shots contain memory/learning ("I'll remember", "next time I weight/adjust") or operator-trait-diagnosis ("you are avoiding", "your pattern is") phrasing.
7. **Identity test** (structural, not a quality score): a plain generic prompt built from the same business-fact context is compared against Claire's actual production prompt — Claire's version contains the personality lock and voice-example markers the generic version categorically cannot, since it was never built with a character system.

Full suite re-run after this pass: `npx vitest run server/claire` → 41 files, 374 passed.
`npx vitest run` (full repo) → **636 files, 5917 passed, 7 skipped, 0 failed.**

### Live (non-mocked) Anthropic exam — attempted, blocked

Per the coordinator's instruction, a real (non-mocked) Anthropic call was attempted using the
actual `@anthropic-ai/sdk` client against `claude-sonnet-4-6` with whatever credentials this
sandboxed environment exposes. Result: **HTTP 401 `authentication_error`, "API key is invalid."**
`ANTHROPIC_API_KEY` is not set in this environment's shell (confirmed via `env | grep -i
anthropic`, which shows only an `ANTHROPIC_BASE_URL` used internally by the Claude Code
harness itself, not a usable direct-API key for arbitrary SDK calls). No live model output was
produced, and none is fabricated. **This remains an open item: a live Anthropic exam still
needs to run in an environment with a real, working `ANTHROPIC_API_KEY` (or
`ANTHROPIC_MODEL_CLAIRE`-scoped key) before Adam's review** — e.g. Adam's own machine, a CI
runner with the real secret, or a deployed Railway instance.

### Second, deeper investigation (live-acceptance-only pass) — still blocked, no code touched

A follow-up pass, explicitly scoped to "live acceptance only, do not improvise, do not fabricate"
(no changes to `server/claire/character/*` or `server/claire/{preDriveConversation,reasoning}.ts`
in this pass), investigated two further paths before concluding the same:

1. **A PR-preview/branch-deploy pattern for this Railway project.** None exists: no
   `railway.json`/`railway.toml`, no workflow or script that deploys a non-`main` branch, and
   Railway `describe-service` confirms `bldg-admin-api`'s production service source is
   hardcoded to `branch: "main"`. `list-services` (from the earlier pass) already established
   this project has exactly one environment, `production`.
2. **Pulling a real `ANTHROPIC_API_KEY` value via Railway MCP tools to run the actual
   generation functions in-process (no deployment, no Twilio), a path the coordinator
   explicitly offered.** `list-variables`' own tool description states *"Connected OAuth apps
   receive variable names only"* — this session's Railway MCP connection is exactly that, and
   every call returns `valuesRedacted: true`. **There is no way for this session to read an
   actual secret value from Railway**, structurally, regardless of retries or parameters.

Both paths are genuinely blocked, not skipped. A ready-to-run harness,
`docs/goldline/claire-intelligence/run-real-exam.ts`, was built and committed so that anyone
with a real key (Adam's own machine, or Railway CLI access via `railway run`) can execute a
single command against this exact branch/SHA and get the first genuine non-mocked exam — see
`docs/goldline/claire-intelligence/after-pr1-REAL-transcript.md` for the full writeup and exact
commands. **No exam has been run and no output exists yet in `after-pr1-REAL-transcript.md` or
`after-pr1-REAL-metrics.json` beyond this blocked-status writeup — nothing in either file is
fabricated model output.**

### The phone call is the real acceptance test, not the text exam — explicitly flagged

Even once a live Anthropic text exam exists, **that only proves the PROMPT carries Claire's
voice — it does not prove the PHONE CALL feels like Claire.** A real call additionally depends
on conversational history/turn-taking, Twilio's `<Gather>`/`<Say>` pacing and the ~11-second
turn budget documented earlier in this doc, and the actual TTS voice (`CLAIRE_VOICE`)
rendering the text out loud. These two facts are kept explicitly separate and neither
substitutes for the other:

- **Text exam (live or mocked)**: proves prompt composition and guardrail behavior. Necessary,
  not sufficient.
- **Real end-to-end phone call**: the actual human quality gate for a voice product. Not yet
  done, and not something this pass could do safely or accurately from this environment —
  reasons below.

**Why it wasn't done here**: `mcp__Railway__list-services` (used earlier this pass to confirm
the production model) shows this project has exactly **one** Railway environment, `production`
— there is no staging/preview environment to deploy this branch to in isolation. Twilio
credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `CLAIRE_TWILIO_FROM_NUMBER`) and the
only configured destination (`CLAIRE_OPERATOR_PHONE`, a specific real phone number — almost
certainly Adam's or a field operator's) live only in that production service's redacted
variables. Placing a real outbound call to that number from this session would mean (a) using
credentials that are Adam's, for the first time, from an automated context, to (b) ring an
actual person's phone, based on an instruction that didn't explicitly authorize that specific
action. That combination was judged unsafe to do unprompted, so no call was placed.

**Exact steps for Adam (or someone with Railway/Twilio access) to trigger a real test call
against this branch**:

1. Deploy `codex/claire-intelligence-pr1-conversation` (or merge it to a short-lived test
   branch/environment) to the `bldg-admin-api` Railway service — either by pointing a new
   Railway environment at this branch, or temporarily deploying it to `production` if a
   maintenance window is acceptable.
2. Ensure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `CLAIRE_TWILIO_FROM_NUMBER`, and
   `CLAIRE_OPERATOR_PHONE` (or `CLAIRE_OPERATOR_PHONES`) are set for that deployment (they
   already are in `production`).
3. Trigger a pre-drive Claire call the same way it's triggered today in the app (the existing
   "start pre-drive call" action that calls into `server/claire/claireTwilio.ts`'s call-creation
   path — this PR does not add or change how a call is initiated).
4. Answer the call and have a real conversation, including at least one question from each of
   exam categories A–G (see `docs/goldline/claire-intelligence/run-exam.ts` for the exact
   wording used in the mocked harness, as a starting script) to hear how the repaired prompt +
   real Twilio pacing + real TTS actually sound together.
5. That listen — not this PR's text artifacts — is the actual acceptance gate. **This step has
   not been performed by anyone as of this handoff.**

---


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

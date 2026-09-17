# Claire Intelligence Repair — PR1 Handoff (living doc)

Branch: `codex/claire-intelligence-pr1-conversation`, off `main` at a commit
descending from PR #151 (`8e6c7003dfd19c6cda5585120c1fee5bfcd54ce7`, verified
via `git merge-base --is-ancestor`).

Status as of this writing: **implementation-complete for a bounded subset of
the PR1 spec** (see "What is NOT done" below — this is explicitly partial,
not a full completion of the program). Subjective "does Claire sound
smarter" quality is **not** verified here and is Adam's call — see the last
section.

## What this PR actually changes

1. **`server/_core/env.ts`** — added `ENV.anthropicModelClaire`
   (`ANTHROPIC_MODEL_CLAIRE` env var), following the exact existing pattern
   of `anthropicModelVendorOnboarding` / `anthropicModelMissionPlanner`
   (`anthropicModelEnv(name)`, empty-string default). It is **not** wired
   with a hardcoded fallback inside `env.ts` — like every other per-feature
   model var in this file, the fallback-to-general-model happens at each
   call site via `ENV.anthropicModelClaire || ENV.anthropicModel`, matching
   `vendorOnboardingAgent.ts:617` and
   `vendorCandidateServiceAreaStructuredInterpreter.ts:161`. Wired into both
   conversation call sites touched in this PR
   (`reasoning.ts::writeClairePreDriveBrief`,
   `preDriveConversation.ts::answerClairePreDriveFollowUp`).

   **Open question for Adam (corrective note B):** the current production
   default is `DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6"` in
   `server/_core/env.ts`, read via `ENV.anthropicModel` (`ANTHROPIC_MODEL`
   env var). I did not have Railway MCP tool access in this environment to
   independently confirm the Railway production env var value, so this is
   sourced from the repo's own `env.ts` default/normalization table, not
   from a live Railway read. If the actual Railway `ANTHROPIC_MODEL` value
   differs from this default, `ANTHROPIC_MODEL_CLAIRE` will still correctly
   fall back to whatever `ANTHROPIC_MODEL` actually resolves to at runtime
   (it reads `process.env.ANTHROPIC_MODEL`, not the hardcoded default) — so
   this is a documentation/confirmation gap, not a functional risk. **No
   new model string was invented anywhere in this PR.**

2. **`server/_core/llm.ts`** — `invokeTextLLM` now accepts `role: "assistant"`
   messages and relays them to the Anthropic Messages API in the given
   order, alongside `system`/`user`. Previously only `system`/`user` were
   accepted and everything was serialized into one JSON blob in a single
   user turn. Order and role are now preserved verbatim to the Anthropic
   adapter. Covered by new tests in `server/_core/llm.test.ts`.

3. **`server/claire/preDriveConversation.ts`** (`answerClairePreDriveFollowUp`):
   - Removed: "only clarify/restate/apply opening advice" framing, "no
     outside knowledge"/"no sales doctrine" blanket ban, the 55-word cap,
     180 maxTokens / 0.1 temperature, and the canned "I can only clarify
     today's field brief..." always-return fallback line.
   - Raised to 600 maxTokens / 0.6 temperature.
   - `recentTurns` are now passed as real alternating `user`/`assistant`
     messages (via the new `invokeTextLLM` support), not just serialized
     into the JSON user blob.
   - Added the business-fact-vs-general-knowledge distinction explicitly
     (see prompt text: "Business-specific claims... must be grounded...
     General professional knowledge... is allowed and encouraged as
     clearly-framed advice... never asserted as a fact").
   - Added explicit authenticated-operator-vs-untrusted-third-party-text
     framing.
   - New fallback line: `"Give me a second—ask me that once more. In the
     meantime, the brief is: ..."` — replaces the canned line. (Spec asked
     for *varied* fallback phrasing across call sites; this PR only touched
     one fallback site — see "What is NOT done".)
   - **`assertPostGenerationStateVerbs(text, inventory)` call preserved**
     (Slice 3 wiring, unchanged call site, still runs on every model
     response before it's accepted).

4. **`server/claire/reasoning.ts`** (`writeClairePreDriveBrief`):
   - Removed the 70-word/3-sentence cap and the blanket "no sales
     doctrine/frameworks/outside knowledge" prohibition (replaced with the
     same business-fact-vs-general-knowledge distinction as above).
   - Raised to 500 maxTokens / 0.6 temperature.
   - Replaced the hard `.slice(0, 900)` character cut with
     `trimToSentenceBoundary()`, a generous (1600 char) sentence-boundary
     cut that only trims if genuinely over budget, so a real answer isn't
     chopped mid-word.
   - **`assertPostGenerationStateVerbs(trimmed, inventory)`,
     `lintDisappointmentFraming(trimmed)`, `lintCeoLanguage(trimmed)` all
     preserved**, now running against the (still-capped) trimmed text
     rather than the pre-cut raw text — same guardrail sequence, correct
     order (generate → cut → verify → lint → accept/fallback).

5. **Prompt composition reorder** — both system prompts above are now
   composed in the spec's order: (1) who Claire is → (2) eligible
   relationship/canon context (`compiled.promptSection`) → (3) verified
   business context + fact inventory (`inventory.toPromptSection()`) → (4)
   what she's helping with → (5) truth/action boundaries → (6)/(7) recent
   conversation + latest operator turn (now real message-history turns in
   `preDriveConversation.ts`, and the compact JSON context payload as the
   final user turn in both). No new biography was invented; the character
   voice/canon text itself (`compiled.promptSection`) is untouched — only
   its position in the array changed.

## Slice 3 fact-verification wiring — explicitly confirmed intact

Per the corrective note, before touching these files I grepped for
`assertionGuard`, `verifiedFactInventoryFromContext`,
`lintPostGenerationStateVerbs`, and `toPromptSection` across `server/`.
Hits: `assertionGuard.ts`, `businessConversation.ts`,
`character/relationshipHistory.ts`, `preDriveConversation.ts`,
`reasoning.ts`, `slice01SafetyBaseline.test.ts`,
`slice03AssertionGuardWiring.test.ts`, `slice06RelationshipHistory.test.ts`,
`turn/claireTurn.ts`, `verifiedFactInventoryFromContext.ts`,
`strategy/slice05ClaireReadsSnapshot.test.ts`.

In the files this PR edited, the wiring points that remain, by name, after
this PR's changes:

- `preDriveConversation.ts`: `buildClaireVerifiedFactInventory(input.context)`
  builds `inventory`; `inventory.toPromptSection()` is injected into the
  system prompt (still present, position (3) in the reordered prompt);
  `assertPostGenerationStateVerbs(text, inventory)` still runs on the raw
  model output before it is accepted, inside the same `try` block, still
  throwing into the `catch` → fallback path on violation (verified by the
  passing `slice03AssertionGuardWiring.test.ts` test
  `"pre-drive follow-up falls back when the model claims a queued send"`).
- `reasoning.ts`: same pattern — `buildClaireVerifiedFactInventory`,
  `inventory.toPromptSection()` injected, `assertPostGenerationStateVerbs`
  called on the trimmed text before the G2/CEO lints and before acceptance
  (verified by `"writeClairePreDriveBrief injects G4 inventory and falls
  back on unverified 'sent'"` in the same test file, still passing).
- `businessConversation.ts` and `turn/claireTurn.ts` were **not modified**
  in this PR — their existing wiring to `verifiedFactInventoryFromContext`
  and `assertionGuard` is untouched, and `slice03AssertionGuardWiring.test.ts`
  (14 tests) and `slice01SafetyBaseline.test.ts` still pass unchanged.

I did not rebuild or bypass `assertionGuard.ts`. `operator_avoidance`
remains untouched (still absent from `WARMTH_EMISSION_ALLOWLIST` /
`CLAIRE_ATTESTABLE_EVENT_TYPES` per `server/claire/character/relationshipEmitters.ts`
— not touched by this PR).

## Resident-app integration surface — confirmed untouched

Per corrective note A, before finishing I ran:

```
git diff --stat main -- server/agents/permissions.ts server/agents/s2sEndpoint.ts server/agents/tools/
git diff main | grep -n "ADMIN_AGENT_SHARED_SECRET\|APP_SHARED_API_SECRET"
```

Both come back empty — **zero diff** to `server/agents/permissions.ts`,
`server/agents/s2sEndpoint.ts`, or anything under `server/agents/tools/`,
and no occurrence of either shared-secret env var name anywhere in this
PR's diff. The 8 resident-facing tools (`createLaundryOrderTool`,
`getResidentContextTool`, `draftCustomerMessageTool`,
`createResidentAgentPlanTool`, `updateResidentAgentPlanTool`,
`createResidentCoordinatedRequestTool`, `createOrderFollowupTaskTool`,
`cancelResidentOrderTool`) are unchanged in name, allowlist membership,
input shape, and output shape. This PR does not touch that surface at all.

## Tests added/changed

- `server/_core/llm.test.ts`: two new tests —
  "accepts assistant messages and preserves user/assistant order to the
  Anthropic adapter" and "does not merge or drop assistant turns when
  relaying multi-turn history." One existing test
  ("fails closed... unsupported roles") updated to use `role: "tool"`
  instead of `"assistant"` as the now-invalid role, since assistant is now
  valid.
- `server/claire/generationPaths.test.ts`: updated the opening-brief prompt
  assertion to assert *absence* of `"never exceed 70 words"` and *presence*
  of the new `"General professional/strategic knowledge"` distinction
  language.
- `server/claire/slice03AssertionGuardWiring.test.ts`: updated the
  follow-up fallback-text assertion to match the new fallback copy while
  keeping the assertion-guard behavioral check (falls back, never emits the
  model's "queued" claim).
- Full `server/claire` + `server/_core` suite: **369 passed, 0 failed**
  after these changes (`npx vitest run server/claire server/_core`).

## What is NOT done in this PR (explicitly open)

This is a large multi-day program; given the scope of what was tractable
here, the following spec items are **not** done and should not be assumed
complete:

- **Phase-0 before/after scripted exam (categories A–G), full transcripts,
  and `before-metrics.json` / `after-pr1-metrics.json`** were not built.
  This requires a running app + LLM credentials + a scripted harness driving
  many real conversational turns end-to-end, which was out of reach in this
  pass. `docs/goldline/claire-intelligence/` contains only this note, not
  the exam artifacts the spec calls for. **Do not treat this PR as having
  measured a fallback-rate or continuity improvement — it has not been
  measured, only implemented.**
- **Production `claire_generation_logs` baseline** was not queried. Per
  corrective note B: no existing read-only prod-query tooling was found in
  this repo/environment, so per the note's explicit instruction, no
  fabricated log numbers are reported anywhere in this repo. This should be
  done by someone with production DB access before or alongside merge.
- **`businessConversation.ts` and `turn/claireTurn.ts`** were audited (no
  additional over-constraint patterns of the kind targeted by this PR were
  found in them — `businessConversation.ts`'s 400-token/temp-0 call is a
  structured query-plan parser, correctly left alone per the spec's
  "extraction/classifiers stay low-temp/deterministic" carve-out) but were
  **not otherwise modified**.
- **Shared `ClaireConversationCore` refactor** (one reasoning path with
  voice/desktop surface adapters) was not attempted — this PR keeps the
  existing per-function structure and only edits prompt content/generation
  parameters within it.
- **Telemetry extension** (conversation/session id, surface, route/responder
  fields on `recordClaireGeneration`) was not implemented — the existing
  `ClaireGenerationDiagnostic`/`recordClaireGeneration` shape and call sites
  are unchanged.
- **Fallback-line variation** was only done for
  `preDriveConversation.ts`'s single fallback string; `reasoning.ts`,
  `writeClairePostStopOpening`, and `writeClaireOutcomeConfirmation` retain
  their existing hand-written fallback strings, which were already
  reasonably human (not the "I can only clarify..." canned pattern) and
  were not touched.
- **Twilio voice latency path documentation** (speech-end → webhook →
  routing → context assembly → model request → completion → TTS start →
  first spoken word) was not produced in this pass.

## Truth statement (per spec step 8)

Automated tests added/verified in this PR confirm: transport-layer
assistant-role correctness, the presence/absence of specific prompt strings
(old suppression language removed, new business-fact-vs-general-knowledge
distinction present), that the Slice 3 assertion-guard fallback path still
fires on an unverified state-verb claim, and that the full existing
`server/claire` + `server/_core` suite (369 tests) still passes. **They do
not, and cannot, confirm that Claire "sounds intelligent."** That is a
subjective quality judgment reserved for Adam's own review of real
conversation output. This handoff makes no claim that "Claire is now
smart" — only that a bounded, tested subset of the described repair is
implemented, and broader completion (exam harness, telemetry, shared core,
latency doc) remains open work, listed above.

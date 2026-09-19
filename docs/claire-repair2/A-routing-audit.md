# Slice A — Routing Audit and Measurement

**Program:** Claire Intelligence Repair, Part 2
**Status:** measurement only; no runtime behavior changed
**Flag:** `claire.repair2.a_routing_telemetry` (`CLAIRE_REPAIR2_A_ROUTING_TELEMETRY`), tenant-scoped, default off in production
**Admin page:** `/claire/routing-audit` (admin-only)
**Date:** 2026-09-19

---

## 0. What this document can and cannot say

Four of Slice A's eight items are answerable from the code and from
production configuration, and are answered here with measured numbers. Four
require thirty days of production rows that **do not exist yet**, because the
telemetry that produces them is what this slice builds.

| Item | Status |
|---|---|
| 1. Answer-path instrumentation | **Built.** Every path recorded per turn. |
| 2. 30-day distribution | **Not yet measurable.** No rows exist before this ships. A static route probe (§3) is given instead. |
| 3. Renderer inventory | **Done**, from the code. |
| 4. Production model check | **Done**, read from Railway's own variable list. |
| 5. Prompt size | **Done**, measured from the real assembly path. |
| 6. Latency breakdown | **Instrumented**, not yet measured. First-token is *not measurable at all* today; see §6. |
| 7. Unanswerable / weak-answer inventory | **Not yet measurable.** Needs the transcript corpus. |
| 8. Blend census | **Classifier built and wired**; the census needs production rows. A static probe result is given in §3. |

There is no database in this build environment (Railway MySQL is
private-network only) and the admin app is behind a password gate, so nothing
below was exercised against live data. Where a number is measured, the command
that produced it is named. Where it is not, it says so.

---

## 1. Corrected diagnosis

The working diagnosis in the program document is **confirmed on every point**,
with three corrections and one addition that changes the ordering advice.

### Confirmed

1. **Retrieval returns finished speech, not facts.** `answerQuestion()` in
   `server/claire/turn/claireTurn.ts:540+` tries, in order:
   `answerClaireBusinessTurn` → `speakDayWork` → `speakUnpaidOrders` →
   `speakAccountHistory` → the memory-quote branch → the encyclopedia, and
   returns the first renderer's sentence verbatim. Those strings never pass
   through Claire's character, relationship canon, or PR 1's repaired prompt.
   `answerClairePreDriveFollowUp` runs only at
   `claireTurn.ts` §"after every reader declined", and only when
   `input.context && input.brief` are both present.
2. **The encyclopedia has the same shape, plus the old persona.**
   `answerWithEncyclopedia` plans ≤3 read-only lookups, concatenates the tool
   sentences, and its optional rewrite runs at temperature 0, `maxTokens: 220`,
   under "You are Claire, a concise operations partner … Spoken English, at
   most 60 words." With one tool answer, or past the 9-second deadline, the raw
   concatenation is spoken.
3. **No blending.** First match wins; the judgment half is never reached. See
   §3 — both blended probe questions lost their judgment half.
4. **The model is the default.** Confirmed authoritatively; see §4.
5. **Prompt bloat.** Worse than reported: **13,314 characters** across **20
   sections** on the follow-up path, with an *empty* context. See §5.
6. **The live turn is still a JSON packet.**
   `preDriveConversation.ts` sends
   `JSON.stringify({ openingBrief, currentContext, operatorUtterance })` as the
   final user message.
7. **Voice dead air.** `speechTimeout: "3"` on the pre-drive gather
   (`claireTwilio.ts:277`) against `"auto"` on the two other paths
   (`:574`, `:881`); the pre-drive handler waits for the entire
   `runClaireTurn()` before any `<Say>` is constructed; nothing streams.
8. **Cross-call memory is regex-gated.** `MEMORY_QUESTION` in `claireTurn.ts`
   matches six fixed phrasings. "Remind me what we decided about the Greystar
   campaign" does not match any of them (§3).

### Corrections

- **The encyclopedia does not merely answer badly — it can refuse on Claire's
  behalf.** When the planner returns zero calls, `answerWithEncyclopedia`
  returns `"I can't answer that from Goldline's records: <missing>."` That is
  a *non-null* answer, so `answerQuestion` returns it and the repaired
  conversational path is never reached. A pure judgment question
  ("should I push for the full building or start with a pilot floor?") that the
  planner correctly judges unanswerable *from records* is therefore answered
  with a refusal instead of with Claire's judgment. This is the single
  highest-leverage line in the whole ladder and the diagnosis did not name it.
- **The conversational path is gated on `brief` *and* `context`.** Without
  both, the turn ends on a hard-coded "I don't have a record that answers
  that" sentence rather than on a model answer. Both production callers —
  `claireTwilio.ts` and the desk's `claire.talk` — do pass both today, so this
  is a latent gate rather than a live loss; it is named here because Slice D
  moves this code and must not drop the guarantee.
- **The prompt is larger than measured before**, not smaller: 13,314 characters
  empty-context, against the ~10,475 in the program document.

### Addition

- `invokeTextLLM` was a non-streaming `messages.create` and did not return the
  provider's `response.model` to callers. Requested-vs-served was therefore
  unobservable. Slice A adds `onModelServed`; Slice B needs it.

---

## 2. What the instrumentation records

Per turn, one row, written to `claire_generation_logs` (extended, not
duplicated — new columns are additive and nullable; migration
`drizzle/0089_claire_answer_path_telemetry.sql` and the matching block in
`scripts/migrate.mjs`):

- `answerPath` — one of the sixteen paths in
  `server/claire/answerPathTelemetry.ts`
- `businessReader` — for `business_reader`, which reader inside
  `businessConversation.ts` answered (`query`, `planned_query`, `order_focus`,
  `combine`, `compare_customers`, `clarify`, `unsupported`)
- `rendererProse` — true when the spoken sentence came from a deterministic
  `speak*` function verbatim
- `surface`, `turnKind`, `modelRequested`, `modelServed`, `promptChars`
- `answerPathDetailJson` — encyclopedia plan (tools planned, whether the
  rewrite or the raw concatenation was spoken and why, plan/tool/rewrite
  timings), memory-search flag, blend classification, latency marks, and the
  per-section prompt breakdown

Turns that never reach a model wrote nothing before this slice; they now write
a row with `generationKind = 'turn_route'` and
`generationSource = 'deterministic'`. Their `disclosureTier` and relationship
columns are placeholders, not observations, and the audit reader ignores them.

**Contract:** fire-and-forget, fail-open, flag-gated. A telemetry failure
cannot change or delay an answer. Nothing in the turn reads the trace back.

---

## 3. Static route probe (stands in for item 2 until rows exist)

`npx tsx scripts/claire-repair2-route-probe.ts` runs the **real** matchers —
`parseBusinessTurn`, `operationsQuestion`, `isUnpaidQuestion`,
`isAccountQuestion`, `matchAccounts`, `MEMORY_QUESTION` — over seventeen
questions an operator actually asks, and reports which one claims each first.

```
What was revenue last month?                                    business_reader (query)
How many orders did we do last week?                            business_reader (query)
Who are my top customers this quarter?                          business_reader (query)
What's left on the day line today?                              day_work
What did I finish yesterday?                                    day_work
How many unpaid orders are there?                               business_reader (query)
What happened at The Louise last time?                          account_history
What did I tell you about The Louise?                           account_history
What should I say to them about pricing?                        encyclopedia, else follow_up_model
What happened at The Louise last time, and what should I do?    BLEND  account_history
How many orders did they place, and is it worth another visit?  BLEND  business_reader (query)
Should I push for the full building or start with a pilot floor?       encyclopedia, else follow_up_model
Why do property managers keep stalling on this?                        encyclopedia, else follow_up_model
What's a good way to handle the "we already have a vendor" objection?  encyclopedia, else follow_up_model
Is it worth going back to Century Park East this week?                 encyclopedia, else follow_up_model
Remind me what we decided about the Greystar campaign.                 encyclopedia, else follow_up_model
What do you think I'm avoiding today?                                  encyclopedia, else follow_up_model

10/17 claimed by a deterministic matcher before the conversational path is reachable.
2/2 blended fact+judgment questions are claimed by a fact-only matcher.
```

Read carefully, this is worse than 10/17. The remaining seven reach the
*encyclopedia* first, not the repaired path — and the encyclopedia either
speaks a tool concatenation, a 60-word capped rewrite, or a refusal sentence.
The repaired conversational path is reached only when the encyclopedia planner
both declines **and** returns a `missing` string that is empty or contains a
digit. On the evidence of the code, the conversational path is close to
unreachable for a business-shaped question.

"Remind me what we decided about the Greystar campaign" confirms diagnosis 8:
it is a memory question in plain English and `MEMORY_QUESTION` does not match
it.

---

## 4. Production model check (item 4 — answered)

Read from Railway's variable list for `bldg-admin-api` / `production`
(project `supportive-creation`), 2026-09-19:

- `ANTHROPIC_MODEL_CLAIRE` — **not set**
- `ANTHROPIC_MODEL` — **not set**

`server/_core/env.ts` falls back to `DEFAULT_ANTHROPIC_MODEL`.

> **Production runs `claude-sonnet-4-6` on every Claire path.** Nobody chose
> it; it is the built-in default, and it has been the default since the
> variable was introduced.

Two further model findings for Slice B:

- The encyclopedia's **planner** (`invokeLLM`) and its **rewrite**
  (`invokeTextLLM`) pass no `model` at all, so they inherit
  `ENV.anthropicModel` — the generic variable, not the Claire one. Setting
  `ANTHROPIC_MODEL_CLAIRE` alone will **not** move them. PR 1 touched only two
  call sites; these are the two it missed.
- Requested-vs-served is now observable (`onModelServed`), and the audit page
  shows them side by side.

---

## 5. Prompt size (item 5 — answered)

`npx tsx scripts/claire-repair2-prompt-size.ts`. Sections are measured from
the real assembly path, with an empty drive context — production values are
larger, because `compiled_canon`, `few_shot_voice` and `fact_inventory` grow
with the operator's history and the day's facts.

**Follow-up path: 13,314 characters, 20 sections.** Target for Slice E is
≤2,500 characters of static instruction.

| chars | section |
|---:|---|
| 2,015 | compiled_canon *(dynamic)* |
| 1,750 | delivery_voice |
| 1,498 | reasoning_policy |
| 1,452 | offer_context |
| 1,413 | few_shot_voice *(dynamic)* |
| 678 | blocker_repetition |
| 494 | general_knowledge_allowance |
| 486 | personal_canon_limit |
| 458 | fact_inventory *(dynamic)* |
| 402 | commitment_local_time |
| 372 | truth_business_claims |
| 359 | input_trust |
| 344 | temporal_authority |
| 341 | mission_sales_brief |
| 323 | recent_conversation_rule |
| 277 | task_framing |
| 259 | capability_briefing |
| 171 | mission_sales_brief_unknowns |
| 119 | identity |
| 84 | no_architecture_talk |

**Opening brief: 13,188 characters, 26 sections.** Same dynamic blocks, plus
twelve short single-rule directives (`no_ceo_language`, `no_disappointment`,
`no_game_narration`, `real_work_language`, `unknown_macro_goal`,
`no_self_introduction`, `partial_metric_rule`, `day_state_viability`,
`spoken_english`, `no_engineering_talk`, and two mission-brief rules).

**Encyclopedia rewrite: 368 characters (voice), 352 (text).** Small, and that
is the problem — it contains the word-cap and the pre-PR-1 persona and nothing
else. There is no character, no canon, no fact inventory.

Two observations for Slice E:

- After the dynamic blocks, the four largest static sections —
  `delivery_voice`, `reasoning_policy`, `offer_context`,
  `blocker_repetition` — are **5,378 characters**, already more than twice the
  2,500 target on their own. The diet cannot be achieved by trimming the
  small directives.
- `reasoning_policy` (`CLAIRE_V1_REASONING_POLICY`, 1,498 chars) and
  `delivery_voice` (`VOICE_NATIVE_ANSWER_GUIDANCE`, 1,750 chars) are the
  length contradiction named in the program document, and they are the first
  and second largest static blocks. Slice E item 5 is correctly targeted.

---

## 6. Latency (item 6 — instrumented, not measured)

Recorded per turn, from Twilio's webhook arrival (the closest observable proxy
for end-of-speech — Twilio does not report the moment speech stopped):

- webhook receipt → route decision (`routeMs`)
- route decision → generation start (`generationStartMs`)
- → generation complete (`generationCompleteMs`)
- → spoken text ready (`answerReadyMs`)
- webhook receipt → TwiML handed back, plus whether the turn overran the
  budget into a "One second." continuation (`claire_voice_timing` log event)
- encyclopedia plan / tool / rewrite times, separately, in the detail JSON

**First token is not measurable and is recorded as `null` deliberately.**
`invokeTextLLM` is a non-streaming `messages.create`; there is no first-token
event to record. Likewise, true first-audio timing needs a media stream, which
this deployment does not have. Both are Slice F's problem, and Slice F should
not be asked to report a before/after on a number that did not exist before.

What the code already tells us about where the dead air is, without a single
production row:

1. `speechTimeout: "3"` — up to **3 seconds** of silence before the turn even
   starts, on the pre-drive path only.
2. The whole of `runClaireTurn()` completes before any `<Say>` is built.
3. `TURN_BUDGET_MS = 11_000`. Past it, the operator hears "One second." and a
   redirect, and waits another round trip.
4. The encyclopedia's own deadline is 9 seconds, inside that 11.

---

## 7. Renderer inventory (item 3 — answered)

This determines whether Slice C is cheap or expensive. It is **cheap for four
of the six**, because a loader already exists and already has the numbers; the
work is exposing them rather than computing them.

| Renderer | Loader | Facts in hand before rendering | Structural? |
|---|---|---|---|
| `speakDayWork` | `loadDayWork` | Day Line items with status, timing, detail state, business date | **Yes** — items are structured; the *counts* the sentence quotes are derived inside the renderer |
| `speakUnpaidOrders` | `loadUnpaidOrders` | Open orders, totals, awaiting-payment count | **Yes** |
| `speakAccountHistory` | `loadAccountHistory` | Contacts, visits, orders, last-contact dates | **Mostly** — "last visit" phrasing is derived in the renderer |
| `speakBusinessResult` | `runBusinessQuery` | A `BusinessQueryResult` with typed data, plus a `facts: string[]` the turn already returns | **Yes**, and it already carries a fact list — the closest thing to the Slice C contract that exists |
| memory-quote branch | `searchOperatorConversation` | Operator turns with text and timestamp | **Yes** — but they are the operator's words, not verified facts, and must stay labelled as such |
| encyclopedia `evidence` | up to three of the above | **Prose only.** The tools return finished sentences; the structure is lost before the concatenation | **No** — this is the expensive one |

So: **Slice C is cheap for the five deterministic readers and expensive for
the encyclopedia**, exactly because the encyclopedia's tools are wrappers that
call the renderers and keep only their output. Slice C item 7 ("its tools
become fact providers") is the real work of that slice.

`answerClaireBusinessTurn` already returns `facts: string[]`. That is a
string list, not the `ClaireFact` contract Slice C specifies, but it proves
the seam exists and that a parallel query layer is not needed.

---

## 8. Items 7 and 8 — not yet measurable

Item 7 (unanswerable / weak-answer inventory) and item 8 (blend census)
require thirty days of real transcripts from `claire_generation_logs` and the
call ledger. Neither can be produced from this environment, and inventing a
ranking from memory would be exactly the kind of upgrade-a-guess-to-a-fact
this program exists to stop.

What ships instead:

- `classifyClaireBlend` / `isBlendedClaireQuestion`, applied to **every** turn
  and stored in the detail JSON, so the census assembles itself once the flag
  is on. It is a heuristic over two clause patterns, and it is reported as an
  estimate, never as a parse.
- `memorySearched`, recorded per turn (regex branch *or* the encyclopedia's
  `call_memory` tool), so "does memory fire when it should?" becomes an
  answerable question rather than an assumption.
- The encyclopedia detail (tools planned, rewrite vs. raw concatenation, and
  the reason), which is item 7's "encyclopedia deadline / one-tool
  concatenation" category, counted directly.

**These take one operating week of real calls with the flag on before they say
anything.** That is the honest cost of Slice A.

---

## 9. Recommendation on B–G

The evidence changes the ordering. Three recommendations:

### Do Slice B now, and widen it

`claude-sonnet-4-6` is the default nobody chose. Setting the variable is a
one-line change with a real chance of moving live quality on its own, and it
costs nothing to try before any refactor. **Widen it** to the encyclopedia
planner and rewrite, which PR 1 missed and which inherit the *generic*
variable — setting `ANTHROPIC_MODEL_CLAIRE` alone leaves them behind.

### Merge C and D, and put the encyclopedia refusal first

C ("facts, not speech") and D ("routing repair") are one change, not two. The
first-match-wins ladder and the renderers-speak-directly problem are the same
line of code: `answerQuestion` returning a renderer's sentence. Splitting them
means shipping a fact contract nothing consumes (C without D), or a router
with nothing but prose to route (D without C).

Inside that merged slice, one line is worth more than the rest combined: the
encyclopedia's zero-call refusal (§1, Corrections). A judgment question today
gets `"I can't answer that from Goldline's records"` instead of Claire's
judgment. Changing that single branch to fall through to the conversational
path is a small, testable change that should land first, before any fact
contract exists.

### Keep E, F, G as specified; do not reorder them ahead of C+D

The prompt is 13,314 characters, and cutting it is worth doing — but on the
evidence of §3, **most turns never see that prompt at all**. Cutting a prompt
that does not run cannot change live quality. E is a real slice; it is not
the intelligence fix, and doing it first would produce a clean prompt and an
unchanged phone call.

F's `speechTimeout` fix is two characters and should ride along with whatever
ships next rather than waiting for its own slice; the streaming work is the
substance of F and should stay where it is.

G stays last, and stays the arbiter. The Slice A baseline it compares against
does not exist until the flag has been on for a week.

### Nothing should be dropped

No slice in B–G is redundant on this evidence.

---

## 10. How to see it

1. **Turn the flag on for the tenant:** set
   `CLAIRE_REPAIR2_A_ROUTING_TELEMETRY=<tenantId>` (or `*`) on the
   `bldg-admin-api` production service. Unset means off in production, on
   everywhere else.
2. **Run the migration** — it runs automatically on boot (`npm start` →
   `scripts/migrate.mjs`). The columns are additive and nullable; the
   `assertRequiredColumns` check fails the boot loudly if they did not apply.
3. **Read the numbers:** `/claire/routing-audit` (admin-only), or the tRPC
   query `system.claire.routingAudit`.
4. **Reproduce the static findings with no database:**
   - `npx tsx scripts/claire-repair2-route-probe.ts`
   - `npx tsx scripts/claire-repair2-prompt-size.ts`
5. **Tests:** `npx vitest run server/claire/repair2SliceA.test.ts`

---

## 11. Verification reality

- Every number in §3, §5 and §7 is reproducible from this repository with the
  two commands above, and §4 was read from Railway's own variable list.
- Nothing in §2, §6 or §8 has been exercised against live data. There is no
  database in this build environment and the admin app is behind a password
  gate, so the admin page and the persistence path are **unverified against
  production**; they are covered by unit tests only.
- The full test suite passes (649 files, 6,065 tests), including all 443
  existing Claire tests, which is the evidence that no answer changed.

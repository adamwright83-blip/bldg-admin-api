# Claire Brain V2 Handoff

This file is for the next coding agent. Do not rely on any Cursor chat. If you cloned the repo, checked out `cursor/claire-brain-v2`, and read `server/claire/brain/STATUS.md`, `docs/claire-brain-v2.md`, this file, and draft PR https://github.com/adamwright83-blip/bldg-admin-api/pull/193, you have the full state.

## Current branch

`cursor/claire-brain-v2`

Draft PR (do **not** merge): https://github.com/adamwright83-blip/bldg-admin-api/pull/193
PR #192 remains open as a parts bin: https://github.com/adamwright83-blip/bldg-admin-api/pull/192

## Current head

Phases C-F + H landed by Claude Code. Trust `git rev-parse origin/cursor/claire-brain-v2`.

Handoff verification (Claude Code, 2026-09-20): Cursor's handoff was checked against the
actual branch and found **truthful** — head SHA, base SHA, zero production imports,
`37 passed / 10 todo`, `tsc` green, `retrieveBusinessEvidence` returning `[]`, and the
`void hasBusiness` governor gap all reproduced exactly as described.

Earlier implementation-with-tests head: `bc27e6659a94861894603e1fb6c1fe3d4fb8d1f6`

## Base

`ac2f973117fcd929c04f5c61309ab3563a6af53e`

Verified `origin/main` at branch creation: merge of PR #191 (`Merge pull request #191 from adamwright83-blip/claude/claire-kernel-completion`).

Local `main` may lag (`ed73cd61`). Always treat `origin/main` / this SHA as production base, not the stale local `main` ref.

## Architecture status

Canonical design in `docs/claire-brain-v2.md` is **finalized for implementation**. Do not reverse the governing invariant or the V1/V2 split.

Finalized:

- Why V2 exists (control plane is wrong; organs are valuable)
- Governing invariant: everything may inform; only Executive Function may decide
- Compartment map onto existing files
- Old control plane inventory (what to retire after cutover, not now)
- Authority contracts (branded grants, evidence refs, plan-before-prose)
- Shadow-mode boundary (`runClaireBrainTurn` exists, not production-wired)
- Cutover criteria and phases A–J
- Directory layout under `server/claire/brain/`
- PR #192 is a parts bin, not the destination

Open design choices (allowed to refine, not reverse):

- Exact field names on contracts if a cleaner shape appears
- When (not whether) to move `shouldHoldForContinuation` out of `claireTurn.ts`
- Shadow telemetry persistence store (in-memory / existing answer-path telemetry first; no new secret logs)
- ~~How to port `OrderedQueryCursor.resolved` vs `.presented`~~ — done: `workingMemory/orderedQuery.ts`

## Completed

- [x] Stop converting `runClaireTurn()` into the new architecture
- [x] Leave PR #192 open/unmerged as a reference branch (`cursor/claire-kernel-repair-b699` @ `a1c4f5735514c1b88a600e93f56a5b629889eeaf`)
- [x] Fetch and verify production `main` SHA `ac2f9731`
- [x] Create `cursor/claire-brain-v2` from that SHA (not from #192)
- [x] Architecture audit of current Claire subsystems
- [x] Canonical architecture document `docs/claire-brain-v2.md`
- [x] Phase A — contracts + compartment adapters (thin; no live readers)
- [x] Phase B — Perception wrap + Working Memory snapshot (ordered query still null)
- [x] Executive skeleton — attention, branded grant minting, governor, `decideTurn`
- [x] ResponsePlan concatenation renderer (not character voice yet)
- [x] Action gateway that refuses live mutations
- [x] `runClaireBrainTurn()` shadow runner (not imported by Twilio/desk)
- [x] Authority / isolation / corpus tests (`37 passed`, `10 todo`)
- [x] Phase C — Business Memory live read-only retrieval through existing readers
- [x] Phase D — Executive retrieval orchestration, integration, inhibition, evidenced segments
- [x] Phase E — Ordered-query continuation (resolved ≠ presented), prior claims, pending lifecycle
- [x] Governor fix — mixed business/personal firewall now **enforced**, not computed and dropped
- [x] Phase H — Regression corpus: all 10 todos implemented (100 brain tests, 0 todo)
- [x] Phase F — Episodic / Self / Goals adapters wrapped read-only with injected readers
- [x] Phase G — Character renderer fed only by ResponsePlan (`assertRenderedFromPlan` lint)
- [x] Phase I mechanism — `observeShadowTurn`: default off, cannot throw, cannot delay
- [x] Phase I wiring — one-way observation from BOTH `claireTwilio.ts` and `claireRouter.ts`,
      authorized by Adam; flag stays OFF
- [ ] Guarded operator-only cutover (**authorization required**)
- [ ] Phase J — Retire old control plane

## In progress

The character renderer is still concatenation rather than Claire's voice. Episodic, self
and goals adapters return `[]` although the executive already plans and consumes their
typed requests. Shadow is invocable in tests only and is not wired to Twilio/desk — which
is correct for this phase.

## Next task

**Turning the flag on is the next decision, and it is Adam's.**

Shadow observation is wired on both surfaces and is inert until
`CLAIRE_BRAIN_V2_SHADOW=1`. With the flag off there is no V2 execution, no added model
calls, no added DB reads, and no behavioural difference.

Read `docs/claire-brain-v2.md` §19a (authority lifecycle) before touching either
transport file. The binding rules there — V1 completes first, return values ignored,
fire-and-forget, frozen state copy, zero action/speech/call-control authority, default
off, fails open to V1, safe telemetry only — are enforced by
`server/claire/brain/tests/shadowWiring.test.ts`. Those tests read the production call
sites as text on purpose, so a later edit that starts awaiting V2 or feeds a V2 value
into a V1 decision fails there rather than in someone's phone call.

Note the superseded rule: the old "do not import Brain V2 from claireTwilio/claireRouter"
was a **construction-phase** isolation rule (stage A). Stage B supersedes it for
read-only observation only. The decision path (`runClaireBrainTurn`, `decideTurn`, grant
minting) must still never be imported by production.

Remaining model work: `correctionTarget`, `personalProbe` and `narrativeProbe` are still
stubbed in Perception, so no turn currently opens a personal lane in practice. The
mixed-lane firewall that governs such turns is implemented and tested directly against
the governor, but it has not yet been exercised by a real perceived personal probe.

### Retrieval safety invariant (do not regress)

`decideTurn` retrieves **nothing** by default (`noRetrieval`). A caller wanting live reads
must pass `liveReadOnlyRetrieval(ctx)` explicitly. This is deliberate: no code path can
reach the database just by calling the brain, and every test is hermetic by construction.

## Files added

| File | Purpose |
|---|---|
| `docs/claire-brain-v2.md` | Canonical architecture. Binding. |
| `docs/claire-brain-v2-handoff.md` | This file. Update before every meaningful push. |
| `server/claire/brain/STATUS.md` | One-screen phase board. |
| `server/claire/brain/README.md` | Pointers into the three docs and the new tree. |
| `server/claire/brain/contracts/*` | Authority types. |
| `server/claire/brain/perception/perceive.ts` | `interpretTurn` → `PerceivedTurn`. |
| `server/claire/brain/workingMemory/snapshot.ts` | V1 state → `WorkingMemorySnapshot`. |
| `server/claire/brain/businessMemory/sourceVisibility.ts` | Write-path provenance filter (from PR #192). |
| `server/claire/brain/businessMemory/adapter.ts` | Live read-only retrieval + synthetic admit-filter + prior-claim recheck. |
| `server/claire/brain/businessMemory/evidence.ts` | Reader results → `EvidenceItem` with provenance/freshness/coverage preserved. |
| `server/claire/brain/workingMemory/orderedQuery.ts` | Ordered-query continuation: resolved ≠ presented. |
| `server/claire/brain/executive/retrievalPlan.ts` | Typed retrieval requests; honours `doNotRetrieve`. |
| `server/claire/brain/executive/integrate.ts` | Evidence → segments, conclusions, inhibition. |
| `server/claire/brain/episodicMemory/adapter.ts` | History ≠ current truth helper. |
| `server/claire/brain/selfMemory/adapter.ts` | Disclosure stub. |
| `server/claire/brain/goals/adapter.ts` | Scoped turns return no board inputs. |
| `server/claire/brain/executive/attention.ts` | Retrieval + pending disposition. |
| `server/claire/brain/executive/grants.ts` | **Only** minting site. |
| `server/claire/brain/executive/governor.ts` | Deterministic validation; mixed-lane firewall enforced. |
| `server/claire/brain/executive/decide.ts` | The executive loop; retrieval injected, defaults to none. |
| `server/claire/brain/response/render.ts` | Concatenate plan text. |
| `server/claire/brain/actions/gateway.ts` | Grant required; live mutate refused. |
| `server/claire/brain/shadow/runClaireBrainTurn.ts` | Read-only entry. |
| `server/claire/brain/telemetry/comparison.ts` | Safe comparison record (no secrets). |
| `server/claire/brain/tests/*.test.ts` | Authority, isolation, corpus, ordered query, business memory, firewall, executive loop. |

## Files modified

None on production Claire paths. V1 (`runClaireTurn`, Twilio, hangup grammar) is untouched.

## Reused existing systems

Wrapped, not rewritten:

- Perception fields: `server/claire/turn/interpretTurn.ts` (informs; not sovereign)
- Business truth (not called yet): `server/analytics/businessQuery.ts`, ledger, sourceBindings, account/ops/open-order knowledge
- Provenance (not called yet): `server/claire/provenance/claimReceipts.ts`
- Transport: `claireTwilio.ts` / `claireRouter.ts` still call **only** `runClaireTurn`

Not yet wrapped: fragment hold (`shouldHoldForContinuation`), conversation ledger, progression entitlements, Day Director commits.

## Authority migration

| Authority | Old owner | New owner | Migration status |
|---|---|---|---|
| Interpretation | Competing parsers | Perception informs; Executive decides | Perception wrap exists. V1 still interprets for production. |
| Top-level routing | `runClaireTurn` + `decideClaireAnswerRoute` + board | Executive attention | Skeleton attention exists. V1 still routes production. |
| Business truth | `businessQuery` / knowledge readers (keep) | Business Memory adapter → Executive | Filter exists. Retrieve still `[]`. |
| Prior claim adjudication | `verifyPriorClaim` inside V1 | Executive + wrapped `verifyPriorClaim` | Governor rejects stale receipts. No live recheck yet. |
| Pending-state handling | `runClaireTurn` replyDecision (pending as interpreter) | Working Memory informs; Executive dispositions | Skeleton: yes/no/revise/supersede. Not production. |
| Action authority | Parsers + `mayProposeWork` + voice loop | `ExecutiveActionGrant` minted only in `executive/grants.ts` | Minting + gateway exist. Shadow-only. |
| Personal disclosure | progression controller + topic routing | Self Memory + Executive grant | Types exist. Adapter stub. `personalProbe` always false so far. |
| Call control | `shouldEndClaireCallOnUtterance` in Twilio **before** kernel | Executive `CallControlGrant` | Candidate endCall in shadow. V1 hangup unchanged. |
| Final response rendering | Lanes speak; #192 `planFromSpeak` labels | ResponsePlan first, renderer phrases | Concatenation renderer only. No `planFromSpeak`. |

## Tests

Command:

```
pnpm exec vitest run server/claire/brain
pnpm check
```

Last run (Claude Code session): **brain 148 passed, 0 todo, 0 failed.**
Full repo suite: **697 files, 7060 passed, 7 skipped, 0 failed.** `tsc --noEmit` green.
V1 Claire suite specifically: 1401 passed.

Passing files:

- `server/claire/brain/tests/contracts.test.ts` (2)
- `server/claire/brain/tests/authority.test.ts` (21)
- `server/claire/brain/tests/corpus.test.ts` (30 — all former todos implemented)
- `server/claire/brain/tests/orderedQuery.test.ts` (10)
- `server/claire/brain/tests/businessMemory.test.ts` (14)
- `server/claire/brain/tests/firewall.test.ts` (9)
- `server/claire/brain/tests/executiveLoop.test.ts` (14)
- `server/claire/brain/tests/compartments.test.ts` (10)
- `server/claire/brain/tests/renderer.test.ts` (9)
- `server/claire/brain/tests/shadow.test.ts` (11)
- `server/claire/brain/tests/shadowWiring.test.ts` (17 — asserts the absence of a return path)

## Known failing tests

None.

## Known incomplete work

- Episodic / self / goals adapters are wrapped read-only, but their readers must be
  INJECTED. With no context supplied a compartment stays silent rather than reading
  more than the caller intended.
- `correctionTarget` always `null` (PR #192 field not on main `interpretTurn`)
- `personalProbe` / `narrativeProbe` always `false`, so no turn currently opens a personal
  lane in practice. The firewall that governs mixed turns is implemented and tested
  directly against the governor.
- Fragment completeness not wired; caller must pass `completeness` (shadow defaults to `"complete"`)
- Shadow IS hooked to both Twilio and desk, one-way, behind a default-off flag. It has
  never been run with the flag on, so no real comparison telemetry exists yet.
- Live Dana → The Louise never verified (no `DATABASE_URL`). Do not hardcode the pair.
  Nothing in the code hardcodes it; resolution goes through `contact_account_resolution`.
- **No live database verification was performed.** This environment has no `DATABASE_URL`
  (Railway MySQL is private-network only), so every business-memory test injects readers.
  The adapter's wiring to `runBusinessQuery` is type-checked and unit-tested, not
  exercised against production data.

## Decisions made

1. **Do not merge PR #192.** Parts bin. Last known useful head: `a1c4f573`.
2. **Do not grow `runClaireTurn()` into Brain V2.** Entry is `runClaireBrainTurn()`.
3. **Zero production behavioral authority** until explicit authorization.
4. **ResponsePlan exists before spoken prose.** No `planFromSpeak`.
5. **Compartments are adapters**, not second databases.
6. **Do not reimplement `businessQuery`.**
7. **Grant factories live only in `server/claire/brain/executive/grants.ts`.** Runtime brand check, not TypeScript-only.
8. **Synthetic filter uses write-path provenance**, not display names / Day Line titles. `CODEX` in a name is not a stamp.
9. **Episodic memory is not current truth.** Governor throws if `conversation_turn` is `authoritativeFor: current_business_truth`.
10. **Pending state binds yes/no/revise; a new genuine question supersedes.** Bare `"do"` in `interpretTurn.hasBusinessQuestion` is not a new topic.
11. **Minting a grant with `mutationAllowed: true` throws** while V2 has no production authority.
12. **Branch is `cursor/claire-brain-v2` from `ac2f9731`, not from #192.** Keep this name.
13. **Do not merge this PR without explicit authorization.**

## Do not do

- Do not merge PR #192 or this PR
- Do not continue the strangler rewrite of `runClaireTurn`
- Do not import Brain V2's DECISION path (`runClaireBrainTurn`, `decideTurn`, grant
  minting) from `claireTwilio.ts` / `claireRouter.ts`. The shadow observer and the
  snapshot boundary are the only permitted imports, and only for one-way observation.
- Do not enable `CLAIRE_BRAIN_V2_SHADOW` without Adam
- Do not call the real operator phone
- Do not log secrets, phone numbers, provider ids, tokens, or env values
- Do not broaden transcript logging
- Do not treat model confidence as evidence
- Do not let rapport/narrative suppress business facts
- Do not let the global board answer a scoped Dana question
- Do not search “Dana Tuesday” as a customer name
- Do not use `CODEX` / `E2E` / `SAFE TO ARCHIVE` substrings as provenance
- Do not delete production rows to hide synthetic data
- Do not rewrite Narrative OS
- Do not enable `operator_avoidance` (Adam’s call; see `CLAUDE.md`)
- Do not rename or reshape resident-app tools (`CLAUDE.md` integration)
- Do not add `planFromSpeak`

## PR #192 reusable pieces

PR: https://github.com/adamwright83-blip/bldg-admin-api/pull/192
Branch: `cursor/claire-kernel-repair-b699` @ `a1c4f5735514c1b88a600e93f56a5b629889eeaf`

Already adapted:

| Piece | Where |
|---|---|
| `sourceVisibility.ts` write-path provenance | `server/claire/brain/businessMemory/sourceVisibility.ts` |
| ResponsePlan segment type names | `server/claire/brain/contracts/responsePlan.ts` (no `planFromSpeak`) |
| Corpus utterance list | `server/claire/brain/tests/corpus.test.ts` |

Copy/adapt next:

| Piece | Use in V2 |
|---|---|
| `interpretTurn` correction target / prior-query / greeting remainder | Perception |
| `contactAccountResolution.ts` | Business Memory entity resolution |
| `OrderedQueryCursor` **resolved vs presented** | Working Memory. Do **not** port delivered=full query window |
| `pendingIdentity.ts` | Working Memory pending identity |
| `claireKernelCorpus.test.ts` assertions | Remaining todos in `corpus.test.ts` |
| Voice-continuation tests | Perception completeness |

Do not inherit: growing `runClaireTurn`, string-then-label plans, `ConversationalSegment` as a dump, `answerRouter` as a second mind, display-name provenance.

## Production status

**Brain V2 has ZERO production authority.**

`BRAIN_V2_PRODUCTION_AUTHORITY === false`. `runClaireBrainTurn` always returns `productionAuthority: false` and `mutations: []`. Tests assert `claireTwilio.ts` and `claireRouter.ts` do not import `server/claire/brain` or `runClaireBrainTurn`.

V1 remains the only system that may speak to the operator or mutate. Twilio still hangs up via `shouldEndClaireCallOnUtterance` before the kernel; that is V1 behavior and must not change in this PR.

## Security notes

- No secrets in this branch’s docs or code comments
- This environment has no Railway MySQL (`DATABASE_URL` unset). Do not claim live DB verification
- Do not print phone numbers if a later agent gains DB access
- Shadow telemetry stores evidence **ids and types**, not provider payloads or credentials

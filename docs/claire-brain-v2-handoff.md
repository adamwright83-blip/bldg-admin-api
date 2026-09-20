# Claire Brain V2 Handoff

This file is for the next coding agent. Do not rely on any Cursor chat. If you cloned the repo, checked out `cursor/claire-brain-v2`, and read `server/claire/brain/STATUS.md`, `docs/claire-brain-v2.md`, this file, and the draft PR, you have the full state.

## Current branch

`cursor/claire-brain-v2`

## Current head

Unpushed at document creation. After each push, this section is rewritten to the exact SHA. Base is below; run `git log -1 --format='%H %s'` if this section and git disagree — git wins, then update this file.

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
- Authority contracts (grants, evidence, plan-before-prose)
- Shadow-mode boundary
- Cutover criteria and phases A–J
- Directory layout under `server/claire/brain/`
- PR #192 is a parts bin, not the destination

Open design choices (allowed to refine, not reverse):

- Exact field names on contracts if a cleaner shape appears
- When (not whether) to move `shouldHoldForContinuation` out of `claireTurn.ts`
- Shadow telemetry persistence store (in-memory / existing answer-path telemetry first; no new secret logs)

## Completed

- [x] Stop converting `runClaireTurn()` into the new architecture
- [x] Leave PR #192 open/unmerged as a reference branch (`cursor/claire-kernel-repair-b699`, last known head `a1c4f5735514c1b88a600e93f56a5b629889eeaf`)
- [x] Fetch and verify production `main` SHA `ac2f9731`
- [x] Create `cursor/claire-brain-v2` from that SHA (not from #192)
- [x] Architecture audit of current Claire subsystems
- [x] Canonical architecture document `docs/claire-brain-v2.md`
- [ ] Phase A — contracts + compartment adapters
- [ ] Phase B — Perception + Working Memory
- [ ] Phase C — Executive attention + retrieval orchestration
- [ ] Phase D — Executive integration / inhibition / authority
- [ ] Phase E — ResponsePlan + renderer (plan upstream of prose)
- [ ] Phase F — Action gateway (mutations require grant)
- [ ] Phase G — Shadow mode on real turns
- [ ] Phase H — Regression / adversarial corpus
- [ ] Phase I — Guarded operator-only cutover (**authorization required**)
- [ ] Phase J — Retire old control plane

## In progress

Architecture documentation landing on `cursor/claire-brain-v2`. Contracts and adapters are the next implementation checkpoint, not started in the first docs-only commit.

## Next task

**Phase A: add TypeScript contracts under `server/claire/brain/contracts/`** (branded grants, PerceivedTurn, WorkingMemorySnapshot, EvidenceItem, ExecutiveDecision, ResponsePlan with segment types that require evidence/grants). Then thin compartment adapters that wrap existing readers and do not reimplement `businessQuery`. Do not wire production.

## Files added

| File | Purpose |
|---|---|
| `docs/claire-brain-v2.md` | Canonical architecture. Binding. Update if implementation changes the design. |
| `docs/claire-brain-v2-handoff.md` | This file. Update before every meaningful push. |
| `server/claire/brain/STATUS.md` | One-screen phase board. |
| `server/claire/brain/README.md` | Pointers into the three docs and the new tree. |

## Files modified

None on production Claire paths in the architecture-docs checkpoint. V1 (`runClaireTurn`, Twilio, hangup grammar) must stay behaviorally untouched.

## Reused existing systems

Not wrapped in code yet. The architecture maps them as follows (wrap, do not rewrite):

- Business truth: `server/analytics/businessQuery.ts`, `paidOrderLedger.ts`, `sourceBindings.ts`, account/ops/open-order knowledge
- Provenance: `server/claire/provenance/claimReceipts.ts`, `assertionGuard.ts`
- Perception fields: `server/claire/turn/interpretTurn.ts` (informs; not sovereign)
- Fragment hold: `shouldHoldForContinuation` in `claireTurn.ts`
- Episodic: conversation ledger + `conversationMemory.ts`
- Self: `server/claire/character/*`, `server/claire/progression/*`
- Goals: `macroGoalService.ts`, campaign awareness, board **inputs**
- Actions: Day Director, `briefingCommit.ts`, account follow-up commit
- Transport: `claireTwilio.ts`, `claireRouter.ts` (V1 remains live)

## Authority migration

| Authority | Old owner | New owner | Migration status |
|---|---|---|---|
| Interpretation | Competing: `interpretTurn`, `parseBusinessTurn`, `classifyVoiceWorkStatement`, `classifyOpenDialogueAct`, `shared/claireRuntime`, topic detectors | Perception informs; Executive decides | Not started. `interpretTurn` stays as organ. |
| Top-level routing | `runClaireTurn` + `decideClaireAnswerRoute` + board as answer | Executive attention | Not started. V1 still routes production. |
| Business truth | `businessQuery` / knowledge readers (keep) | Business Memory adapter → Executive | Readers stay. Adapter not written. |
| Prior claim adjudication | `verifyPriorClaim` inside V1 turn | Executive + wrapped `verifyPriorClaim` | Not started. |
| Pending-state handling | `runClaireTurn` replyDecision / briefing hold (pending used as interpreter) | Working Memory informs; Executive dispositions | Not started. |
| Action authority | Parsers + `mayProposeWork` + voice loop | `ExecutiveActionGrant` minted only in `executive/` | Not started. |
| Personal disclosure | progression controller + topic routing | Self Memory entitlement + Executive grant | Not started. |
| Call control | `shouldEndClaireCallOnUtterance` in Twilio **before** `runClaireTurn` | Executive `CallControlGrant`; transport honors it after cutover | Not started. V1 hangup unchanged. |
| Final response rendering | Lanes speak, then (on #192) `planFromSpeak` labels | ResponsePlan first, renderer phrases only | Not started. Do not port `planFromSpeak`. |

## Tests

None specific to Brain V2 until contracts/adapters land. Do not claim the V1 suite as Brain V2 coverage.

Run after code exists:

```
pnpm exec vitest run server/claire/brain
pnpm check
```

## Known failing tests

None for Brain V2 (no Brain V2 tests in the docs-only checkpoint).

Do not run or “fix” PR #192 tests on this branch; those files are not on `main`.

## Known incomplete work

Everything after the architecture document. In particular:

- No `runClaireBrainTurn()` yet
- No branded grants
- No adapters
- No shadow runner
- No production wiring (correct: must stay unwired)
- Live Dana → The Louise was never verified (no `DATABASE_URL` in this environment). Do not hardcode the pair. Resolve from contact rows when Business Memory is wired.
- Full V1 suite / Codex review are not a Brain V2 gate yet
- PR #192 reusable pieces are not copied yet

## Decisions made

1. **Do not merge PR #192.** It is a parts bin. Last known useful head: `a1c4f573`.
2. **Do not grow `runClaireTurn()` into Brain V2.** New entry is `runClaireBrainTurn()`.
3. **Zero production behavioral authority** until explicit authorization. V1 speaks and mutates; V2 does not.
4. **ResponsePlan exists before spoken prose.** No `planFromSpeak`.
5. **Compartments are adapters around existing stores**, not second databases.
6. **Do not reimplement `businessQuery`** (no `brainBusinessQuery.ts`).
7. **Grant factories live only in `server/claire/brain/executive/`.** Downstream cannot mint authority.
8. **Synthetic filter uses write-path provenance**, not display names / Day Line titles.
9. **Episodic memory is not current truth.**
10. **Pending state binds yes/no/revise; it does not interpret a new utterance.**
11. **Branch is `cursor/claire-brain-v2` from `ac2f9731`, not from #192.** User named this branch; keep it.
12. **Do not merge this PR without explicit authorization.**

## Do not do

- Do not merge PR #192 or this PR
- Do not continue the strangler rewrite of `runClaireTurn`
- Do not import Brain V2 from `claireTwilio.ts` / `claireRouter.ts` in this phase
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

## PR #192 reusable pieces

PR: https://github.com/adamwright83-blip/bldg-admin-api/pull/192
Branch: `cursor/claire-kernel-repair-b699` @ `a1c4f5735514c1b88a600e93f56a5b629889eeaf`

Copy/adapt later, do not merge the PR:

| Piece | Use in V2 |
|---|---|
| `interpretTurn` field expansions (greeting remainder, correction target, prior-query reference) | Perception |
| `contactAccountResolution.ts` | Business Memory / entity resolution |
| `OrderedQueryCursor` **resolved vs presented** | Working Memory. Do **not** port delivered=full query window |
| `pendingIdentity.ts` | Working Memory pending identity |
| ResponsePlan **segment type names** | `brain/contracts` / `brain/response`. Not `planFromSpeak`, not `alignPlanSpeak` as architecture |
| `sourceVisibility.ts` write-path provenance | Business Memory evidence boundary |
| `claireKernelCorpus.test.ts` | Behavioral specs to port into `brain/tests` |
| Voice-continuation tests | Perception completeness |

Do not inherit: growing `runClaireTurn`, string-then-label plans, `ConversationalSegment` as a dump, `answerRouter` as a second mind, display-name provenance.

## Production status

**Brain V2 has ZERO production authority.**

V1 (`runClaireTurn`) remains the only system that may speak to the operator or mutate. Twilio still hangs up via `shouldEndClaireCallOnUtterance` before the kernel; that is V1 behavior and must not change in this PR.

## Security notes

- No secrets in this branch’s docs or code comments
- This environment has no Railway MySQL (`DATABASE_URL` unset). Do not claim live DB verification
- Do not print phone numbers if a later agent gains DB access
- Shadow telemetry must store evidence **ids and types**, not provider payloads or credentials

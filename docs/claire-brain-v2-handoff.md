# Claire Brain V2 Handoff

This file is for the next coding agent. Do not rely on any Cursor chat. If you cloned the repo, checked out `cursor/claire-brain-v2`, and read `server/claire/brain/STATUS.md`, `docs/claire-brain-v2.md`, this file, and draft PR https://github.com/adamwright83-blip/bldg-admin-api/pull/193, you have the full state.

## Current branch

`cursor/claire-brain-v2`

Draft PR (do **not** merge): https://github.com/adamwright83-blip/bldg-admin-api/pull/193
PR #192 remains open as a parts bin: https://github.com/adamwright83-blip/bldg-admin-api/pull/192

## Current head

Trust `git rev-parse origin/cursor/claire-brain-v2` after this push. Do not trust older SHAs quoted in historical sections below.

Production base: `ac2f973117fcd929c04f5c61309ab3563a6af53e`

## Architecture status

Canonical design in `docs/claire-brain-v2.md` is binding. Do not reverse the governing invariant or the V1/V2 split.

```
EVERYTHING MAY INFORM.
ONLY EXECUTIVE FUNCTION MAY DECIDE.
```

The executive is a bounded cognitive cycle, not a router:

Perception → WM Gate → Attention → Retrieval A → Scope Resolution → Conflict + Epistemic Monitor → Control Allocator → optional Pass B / Verify → re-monitor → Integration → Inhibition → Judgment → Authority → one ExecutiveDecision → ResponsePlan / Action Gateway / Call Control → WM update

Do not add a meta-router, executive2, smart router, or alternate decision kernel.

## What is actually implemented (verify in code)

- ExecutiveControlState, TaskSets, change classes, intention lifecycle, hierarchical control
- Working Memory input/output gating (`workingMemoryGate.ts`)
- Two-pass retrieval; Executive-generated episodic terms from resolved identity
- ConflictMonitor, EpistemicState, ControlAllocator (fast / deliberate / verify / clarify)
- Bounded deliberation and duplicate-retrieval fingerprints
- Business Memory real readers: `business_query`, `account_state`, `open_orders` (tenant-wide unpaid only), `operations` / `day_line_read` / `field_today`, contact/account resolution, prior-claim recheck
- Account evidence decomposed current vs historical
- Source provenance classifier with **LEGACY COMPATIBILITY REMAINS** (`UNKNOWN_LEGACY` name shim)
- Read-only Self (`readPersonalProgressionContext`) and Goals (`loadObligations`)
- Shadow observer wired on `claireTwilio.ts` and `claireRouter.ts`, fire-and-forget, default OFF
- Operator allowlist: `isAuthorizedProductionOperator` (`default` + `adam-admin`/`adam`)
- Durable V2 WM under `claire-brain-v2-shadow:<tenant>:<operator>:<hash>` via `claireConversationStateStore` (12h TTL). In-memory store remains for hermetic tests.
- Durable safe telemetry via `appendClaireAnswerPathLog` (`answerPath: "brain_v2_shadow"`, empty spoken text)
- Next V2 turn feeds V2-owned `focusEntities`, `orderedQuery`, `unresolvedReferences`
- Structured `presentedMemberIds` from `speakBusinessResult` (additive; V1 wording unchanged)
- ProductionAuthority false. mutationAllowed false. Action Gateway refuses live mutation.

## Real-path rules that were missing and are now wired

1. **Prior-claim recheck.** WM keeps receipt identity only. Business Memory looks up the authoritative `FactualClaimReceipt` by id from V1 conversation-state receipts supplied on `ShadowRetrievalContext.priorClaimReceipts`. Receipt is what to reread, not proof the old claim remains true.
2. **Operations.** Observer passes Day Director numeric `dayDirectorActorId` separately from operator openId, plus `businessDate` and `timeZone`. Missing identity returns `unsupported_request`, not an empty day.
3. **Open orders / account judgment.** Laundry unpaid orders are not joinable to commercial accounts. Pass B does **not** request `open_orders` for `account_judgment`. An `accountId`-scoped `open_orders` request returns unsupported rather than tenant-wide totals.
4. **Transport does not own episodic terms.** `ShadowRetrievalContext.episodicTerms` is gone. Executive Pass B supplies `request.terms`.
5. **Injected `liveDeps` replace readers, not identity.** Context always comes from the observer's live retrieval context.

## Authority

`BRAIN_V2_PRODUCTION_AUTHORITY === false`. `runClaireBrainTurn` always returns `productionAuthority: false` and `mutations: []`.

V1 remains the only system that may speak, mutate, consume personal entitlements, or hang up.

`CLAIRE_BRAIN_V2_SHADOW` stays **OFF**. Do not enable it. Do not merge this PR. Do not call the operator.

Merging this PR must not silently change V1 Claire's speech, decisions, mutations, or call control. Additive isolated V2 persistence/telemetry is allowed. `presentedMemberIds` on `speakBusinessResult` is additive. Negative-claim wording lives in V2 `judgment.ts` / `integrate.ts` only — do not change V1 `businessSpeech.ts` absence sentences.

## Required before first semantic shadow

No remaining code-path blockers for a **flag-off-until-Adam-says-on** validation trial of the real observer path, provided:

- flag stays off until Adam authorizes
- observation remains operator-scoped
- observer remains read-only
- provenance status stays truthful (legacy shim remains)

Do **not** ask Adam to turn the flag on from this handoff.

## Required before cutover

- Character styling (Claire's voice, not punctuation+concat)
- Granted personal disclosure without empty-segment masquerade: needs a legal read-only authored reveal that does not reserve/consume. Today that path generates then writes. Decline is already authored and read-only.
- V2 Perception must own live voice completeness (provider fragments → assemble thought → hold/complete/forced flush)
- Live DB verification
- A real flag-on comparison trial

## Tests

```
pnpm exec vitest run server/claire/brain
pnpm check
```

Last focused brain run: **248 passed, 0 todo, 0 failed.**
Full repository suite: **707 files, 7160 passed, 7 skipped, 0 failed.** `tsc --noEmit` green.

## Known incomplete / honest gates

- `DATABASE_URL` unset locally. No live contact/account/ops/recheck verification against production.
- `UNKNOWN_LEGACY` compatibility shim remains for rows with no provenance columns. Readers now pass write-path fields when they exist.
- Character renderer is concatenation.
- Granted personal disclosure is `personal_disclosure_preview_unavailable`.
- Default durable WM uses the existing conversation-state table; tests must inject `createInMemoryShadowMemoryStore()`.

## Decisions made

1. **Do not merge PR #192.** Parts bin.
2. **Do not grow `runClaireTurn()` into Brain V2.** Entry is `runClaireBrainTurn()`.
3. **Zero production behavioral authority** until explicit authorization.
4. **ResponsePlan exists before spoken prose.** No `planFromSpeak`.
5. **Compartments are adapters**, not second databases.
6. **Grant factories live only in `executive/grants.ts`.**
7. **Synthetic filter uses write-path provenance**, with an explicit legacy name shim for unstamped rows.
8. **Episodic memory is not current truth.**
9. **Pending state binds yes/no/revise; a new genuine question supersedes.**
10. **Minting a grant with `mutationAllowed: true` throws** while V2 has no production authority.
11. **Commercial-account judgments must not consume tenant-wide unpaid laundry orders.**
12. **Do not merge this PR without explicit authorization.**

## Do not do

- Do not merge PR #192 or this PR
- Do not enable `CLAIRE_BRAIN_V2_SHADOW` without Adam
- Do not call the real operator phone
- Do not change V1 production speech semantics to enforce V2 epistemic policy
- Do not add another decision kernel
- Do not implement research-only control (RL gating, EVC, active inference, MCTS, neurotransmitter analogues)
- Do not log secrets, phone numbers, provider ids, tokens, or env values
- Do not let the global board answer a scoped Dana question
- Do not enable `operator_avoidance` (Adam’s call; see `CLAUDE.md`)
- Do not rename or reshape resident-app tools (`CLAUDE.md` integration)

## Superseded history (do not treat as current)

Earlier handoff drafts described adapters as stubs, shadow as unwired, retrieval as `[]`, Perception probes as always false, and “turn the flag on” as the next task. Those states were true of early construction phases and are **false now**.

Useful historical notes:

- Construction-phase isolation (“do not import Brain V2 from Twilio/desk”) was superseded by Stage B one-way observation. The decision path (`runClaireBrainTurn`, `decideTurn`, grant minting) must still never be imported by production.
- `decideTurn` still retrieves nothing by default (`noRetrieval`). Live reads require `liveReadOnlyRetrieval` / the observer.
- PR #192 reusable pieces that were already adapted: `sourceVisibility.ts`, ResponsePlan segment names, corpus utterances. Do not inherit growing `runClaireTurn` or `planFromSpeak`.

## Security notes

- No secrets in this branch’s docs or code comments
- This environment has no Railway MySQL (`DATABASE_URL` unset). Do not claim live DB verification
- Do not print phone numbers if a later agent gains DB access
- Shadow telemetry stores evidence **ids and types**, not provider payloads or credentials

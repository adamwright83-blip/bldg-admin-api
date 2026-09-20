# Claire truth provenance, character integrity, and call continuity

**This document constrains future Claire work.** Models perform adjudicated truth; models do not adjudicate truth.

## 1. Deterministic claims carry receipts
A factual Claire turn leaves a `FactualClaimReceipt` (`server/claire/provenance/claimReceipts.ts`): claim type, turn
ordinal, spoken text, grounding (`deterministic | retrieved | synthesized | ungrounded`), answer path, reader/metric/
period, source-record refs, a fingerprint of the grounded value, as-of and source-freshness, and whether it can be
re-run (`recheck`). Receipts live in the durable conversation state and are mirrored into the answer-path telemetry
detail (`claimReceipt`). There is no second truth ledger and no schema change.

## 2. A model cannot revise a claim's truth status
- **Prior-claim challenge** ("are you sure?", "did you make that up?", "prove it"…) is recognised semantically
  (`priorClaimChallenge.ts`: a structural gate plus one small act-labelling call; **no phrase inventory**), then routed to
  `prior_claim_verification`. The server re-checks the authoritative evidence (`verifyPriorClaim`) and speaks the
  adjudicated outcome: `verified | superseded | stale_source | changed | unsupported | unverifiable`.
- **Structural invariant:** if a free-form model reply re-characterises a recent claim (made up / invented / lied /
  guessed…), the reply is discarded and replaced by the adjudication of that claim's receipt. The lexical check only
  *detects* the attempt; it is defence in depth and never decides truth.
- **Fail closed:** timeout, error, or unavailable source ⇒ `unverifiable` ⇒ "I can't verify that properly right now."
  Never an affirmation, retraction, apology, or confession; never "I'm checking". Evidence can be established, intent
  cannot: no outcome ever alleges lying.
- Telemetry (`priorClaim`): resolved turn, original path/grounding, outcome, evidence-changed, freshness-affected,
  receipt-only vs fresh query, presentation, verification and classifier latency, timeout.
- A challenge that arrives while the classifier is unavailable falls through to normal routing; only the structural
  invariant protects that turn.

## 3. Character integrity (ontology) — separate from biography entailment
Missing biography is privacy/vagueness/refusal in character — never "I'm not a person", "I don't have weekends",
"As an AI". `progression/ontologyGuard.ts` runs on the general answer path **regardless of the progression flag**, and the
prompt (`CLAIRE_PERSONALITY_LOCK`) is the primary constraint. Constructedness is **not** globally banned
(`GOLDLINE_CANON.md`: the locked constructedness event). Ontology is authorised by exactly two channels: the operator
directly asks what Claire is, or an authored story event is active (`ontologyStoryEventActive`). Invented biography is
still the job of `generalBiographyBoundary.ts`.

## 4. Currencies stay separate
Rapport band (verified effort) ⇒ presentation only. Personal-access rung (effort + verified external progress) ⇒
disclosure eligibility only. **Personal-topic history** (`topicHistory` in `PersonalProgressionContext`, derived from
`claire_personal_ledger`) and the **current-moment stance** (`progression/momentStance.ts`) are presentation
continuity only: they never earn rapport, entitlement, rung, canon, or business progress.

## 5. Same-call coverage
`provenance/callCoverage.ts` keeps compact durable "already covered this call" subjects (account, people, intent) in
conversation state, feeds them to generation, and suppresses a question that restarts a covered subject unless the
operator returns to it.

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
- **Referent resolution** (`resolveReferencedClaim`): an explicit reference (name, order number, figure) resolves
  against every receipt held in state, however old; a bare reaction targets only the immediately preceding Claire
  turn; equal matches are ambiguous and fail closed. It identifies a receipt, never judges it.
- **Semantic referents.** When name/number/adjacent matching fails, the challenge classifier receives compact receipt
  summaries and returns `{act, receiptId, ambiguous, assertsFact}`. It runs in parallel with routing: a deterministic
  reply honours it only if already landed (no added wait); any model reply awaits it. Ambiguity fails closed. If it is
  unavailable and nothing resolves deterministically, no association is invented. It identifies statements; it never
  judges them. "Immediately preceding" is only a default: a classifier-named older receipt outranks it.
- **Judgment is not a factual claim.** Evidence-free replies are stored `ungrounded` with `assertsFact` unknown; when
  probed, the classifier says whether the statement asserted a business fact. Advice/opinion is left to ordinary
  conversation and never answered "I didn't have enough to state that as fact".
- **`verified` means re-read now.** A receipt that cannot be re-run is `grounded_as_stated` (provenance only). A
  model synthesis is never verified because evidence was in its prompt: it is `synthesized`, points at the
  authoritative receipt (`supportedBy`), and is credited only for figures/names that trace to that evidence
  (`synthesis_grounded`); anything else is `unsupported`. Evidence-free model replies are always recorded `ungrounded`.
- **Classifier outage:** if a turn references a held grounded claim and the classifier is unavailable, any model reply
  on that turn is replaced by the adjudication regardless of its wording.
- **Fail closed:** timeout, error, or unavailable source ⇒ `unverifiable` ⇒ "I can't verify that properly right now."
  Never an affirmation, retraction, apology, or confession; never "I'm checking". Evidence can be established, intent
  cannot: no outcome ever alleges lying.
- Telemetry (`priorClaim`): resolved turn, original path/grounding, outcome, evidence-changed, freshness-affected,
  receipt-only vs fresh query, presentation, verification and classifier latency, timeout.
- A challenge that arrives while the classifier is unavailable falls through to normal routing; only the structural
  invariant protects that turn.

## 3. Character integrity (ontology) — separate from biography entailment
Missing biography is privacy/vagueness/refusal in character — never "I'm not a person", "I don't have weekends",
"As an AI". The truth/character firewall does **not** depend on the progression flag: free deterministic checks run on
every answer; the semantic biography verifier runs when progression is ON, or when the operator addresses Claire and the
answer speaks in first person. `progression/ontologyGuard.ts` runs on the general answer path **regardless of the progression flag**, and the
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

## 6. Failure semantics (adversarial-review pass)
- **Every** retained receipt (cap 40; ungrounded shed first) is offered to the semantic resolver as a compressed summary. A
  classifier-named receipt that does not exist is ambiguous, never "the newest".
- **Classifier failure of any kind** (throw, hard turn-level timeout, malformed output, null) is "unavailable". Then, in
  both directions, a model reply on a turn that could be probing a held claim is replaced by an unresolved line:
  a model can neither downgrade a grounded claim nor confidently defend an unsupported one. Only receipts already
  known to be advice/opinion (`assertsFact === false`) are exempt. Usefulness is the price: during an outage Claire says
  "I can't verify that properly right now" on short model-path turns that follow a claim.
- Dollar figures in a synthesis must match dollar figures in the evidence (not a date/time sharing digits).
- A fresh re-read from an incomplete source cannot confirm a claim still holds (`grounded_as_stated`).
- Canned fallbacks/canon recoveries and clarifying questions are not claims and get no receipt.
- Coverage keeps 40 subjects; a question that introduces a topic not yet exchanged is a narrower follow-up, not a restart.
- Known limits: the operator's utterance is classified by a model, so a *misclassification* (`other`) leaves that turn to
  ordinary routing (lexical concession guard only); `ontologyStoryEventActive` is an accepted input but no production
  caller sets it yet; the coverage novelty rule uses a small generic-status word list.

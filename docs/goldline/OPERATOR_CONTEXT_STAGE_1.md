# JOYSTICK Operator Context — Stage 1 Architecture

## What Stage 1 is

A deterministic, typed, read-only read model (`OperatorContextPacket`) assembled strictly from existing persisted operator evidence.

It answers:
> What does JOYSTICK already have defensible evidence for about how this operator works and responds to interventions?

It lives in:
`server/persistentOperator/operatorContext.ts`

## What it is not

- **not Honcho**;
- **not personality modeling**;
- **not durable inferred belief storage**;
- **not business truth**;
- **not a replacement for the Behavioral Ledger**;
- **not a replacement for `goalCycleLearnedDeltas`**;
- **not Claire memory yet**;
- **not LLM reasoning**;
- **not a Mitch subsystem**.

---

## Canonical Rules & Constraints

> **Operator Context may affect how JOYSTICK handles the operator. It may never become proof of what happened in the business.**

An operator-context signal may later affect channel, timing, length, task sizing, intervention presentation, reminder burden, or escalation strategy. It may never become `current_business_truth`.

> **A pattern requires at least three qualifying independent observations. Multiple lifecycle events from one decision point do not count as multiple observations.**

Rows sharing the same `decisionPointId` represent one intervention decision point. Rows sharing the same `correlationId` (when no decision point exists) represent one correlated observation. Multiple lifecycle events (such as `DELIVERED`, `ENGAGED`, and `STARTED`) on the same presentation count as one observation, not three. Pattern derivation for start sequences requires valid assignment data and a persisted outcome window.

> **Behavioral Ledger identity is joined through mapped `operatorUserId` values from canonical operator identity. `canonicalOperatorId` is not a ledger-column substitute.**

Canonical identity is resolved through `server/persistentOperator/identity.ts`. The mapped `operatorUserId` values belonging to that canonical identity are queried against the Behavioral Ledger. `canonicalOperatorId` is never passed into columns whose semantics are `operatorUserId`.

> **No invented outcome windows or channel inferences.**

Outcome windows are never guessed (no 120-minute fallback). If `proximalOutcomeWindowMinutes` is absent, the window status is `unknown` and latency is omitted. `assignedOption` is an intervention arm, not a communication channel; channel conflicts are never inferred by string-matching intervention option names.

---

## Evidence Sources Read in Stage 1

1. **Persistent Operator Identity (`server/persistentOperator/identity.ts`)**:
   - Resolves canonical operator identity, canonical user ID, and mapped alias user IDs.
   - Preserves lineage in `evidenceRefs`.

2. **Goldline Onboarding (`server/goldlineOnboarding/store.ts`)**:
   - Reads declared acquisition answers (`daily_work`, `service_area`, and the persisted field `avoidance`).
   - Translates `avoidance` into the factual kind `declared_avoided_task` with statement `"Declared avoided task: \"...\""`.
   - Onboarding records in `goldline_onboarding_sessions` are tenant-scoped; if a session lacks an explicit, authoritative binding to the operator (`operatorUserId` or `canonicalOperatorId`), answers are omitted from the card and `operator_binding_unavailable` uncertainty is emitted.
   - Declared facts are never transformed into contact preferences, time preferences, or psychological diagnoses.

3. **Behavioral Ledger (`server/behavioralLedger/behavioralLedger.ts`)**:
   - Bounded, index-backed read (`listBehavioralLedgerEventsForOperatorBounded`).
   - Filtered strictly by `tenantId` and authorized mapped `operatorUserId` values.
   - Enforces an explicit fixed limit (default 200, maximum 500 rows).
   - If the query returns the limit ($\ge 200$), `evidence_window_truncated` uncertainty is emitted to signify that older records may exist.
   - Absence claims are bounded to the window read: `"No verified action or commercial outcome was observed within the bounded Behavioral Ledger evidence read used for this packet."`
   - Only computes `startedWithinWindow` and `startLatencySeconds` when paired with an actual assignment event and a persisted `proximalOutcomeWindowMinutes`. Missing window emits `proximal_outcome_window_unavailable`.

4. **Goal Cycle Learned Deltas (`server/persistentOperator/learningStore.ts`)**:
   - Normalizes existing rows from `goalCycleLearnedDeltas`.
   - Preserves `learningKind`, `targetKey`, `confidence`, `evidenceReference`, `afterState`.
   - Generated explanation prose is not exposed as Claire-ready dialogue.

5. **Tenant Timezone (`legacyDayforgeSaasTenants.timeZone`)**:
   - Uses authoritative stored tenant timezone if present.
   - If absent, emits `timezone_unavailable` and suppresses local-time claims (e.g., morning / before 10:00 AM).

---

## Packet Structure

```ts
export type OperatorContextPacket = {
  tenantId: string;
  canonicalOperatorId: string;
  generatedAt: string;
  mappedUserIds: string[];

  card: {
    explicitFacts: OperatorExplicitFact[];
    explicitPreferences: OperatorExplicitPreference[];
  };

  observedPatterns: OperatorObservedPattern[];
  learnedSignals: OperatorLearnedSignal[];
  interventionEvidence: OperatorInterventionEvidence[];
  uncertainty: OperatorContextUncertainty[];
  evidenceRefs: OperatorContextEvidenceRef[];
};
```

---

## Truth and Launch Protection Invariants

- **Zero Schema Changes**: `drizzle/schema.ts` is untouched.
- **Zero Migrations**: No database tables or migrations added.
- **Zero Mitch Dependencies**: No imports from `server/mitch/`.
- **Zero Claire Production Mutations**: `server/claire/turn/brainV3.ts` does not import or consume Operator Context; Claire character and speech files are untouched.
- **Protected Launch Paths Intact**: Acquisition, onboarding pages, Stripe, SaaS billing, and pricing configuration remain unmodified.
- **Test Safety**: All unit tests run against disposable in-memory fixtures with no connection to live MySQL or live tenants.

---

## Stage 2 Evaluation & Path Forward

Run and evaluate Stage 1 against real authorized operator evidence. Determine which useful operator-context questions cannot be answered safely or efficiently by the deterministic read model. Only then specify the smallest Stage 2 capability required by those demonstrated gaps.

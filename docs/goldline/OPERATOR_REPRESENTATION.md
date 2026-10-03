**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# OPERATOR REPRESENTATION

**Status:** LOCKED architecture  
**Locked:** 2026-10-01  
**Audience:** implementation agents, engineers, product owner  
**Canonical path:** `docs/goldline/OPERATOR_REPRESENTATION.md`

## Purpose

Operator Representation is JOYSTICK's durable, evidence-backed understanding of how to handle a specific operator over time.

It exists to answer:

> What does JOYSTICK have defensible evidence for about how this operator works, responds to interventions, and prefers to be handled?

It does **not** exist to invent personality, diagnose psychology, or manufacture business facts.

## Permanent rule

> **Operator Representation may change how JOYSTICK handles the operator. It may never become proof of what happened in the business.**

Operator Representation may eventually influence:

- channel;
- timing;
- length;
- task sizing;
- intervention presentation;
- reminder burden;
- escalation strategy.

It may not independently authorize:

- revenue;
- whether a call happened;
- whether a visit happened;
- whether a customer replied;
- whether an invoice was paid;
- whether an objective was completed;
- current account state;
- current business state.

Those claims remain governed by the existing authoritative business readers and evidence contracts.

An operator utterance proves only that the operator said something. Example:

`"I never call anyone."`

proves:

`operator said "I never call anyone"`

It does **not** prove that no call occurred.

Operator Representation must never acquire `current_business_truth` authority.

---

## Existing systems are the foundation

Do not rebuild these systems to create Operator Representation:

- canonical operator identity in `server/persistentOperator/identity.ts`;
- immutable Behavioral Ledger;
- behavioral experiment assignment and proximal outcomes;
- `goalCycleLearnedDeltas`;
- Claire business-memory truth/provenance;
- Claire episodic history;
- Claire self-memory;
- current semantic interpretation / Executive Function boundaries.

The existing behavioral-science law remains controlling:

> **Observed behavior is recorded. Interpretation is annotated with provenance and a version. Neither is ever allowed to become the other.**

Operator Representation sits downstream of evidence. It does not replace evidence.

---

# Three-stage architecture

## Stage 1 — Operator Context read model

**Goal:** prove that existing persisted evidence can produce a useful operator packet before creating new durable inferred memory.

Canonical builder:

`server/persistentOperator/operatorContext.ts`

Stage 1 returns a typed `OperatorContextPacket` built from existing records.

Conceptually:

```ts
type OperatorContextPacket = {
  tenantId: string;
  canonicalOperatorId: string;
  generatedAt: string;

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

Stage 1 rules:

- deterministic;
- read only;
- no LLM;
- no new table;
- no migration;
- no durable inferred-belief store;
- no Claire speech change;
- no Claire decision change;
- no `operatorMemory` compartment yet;
- no personality inference;
- no abductive reasoning;
- no regex conversion of free text into preferences;
- no conversation-history ingestion into the Operator Card;
- no unsupported timing claims.

A behavioral pattern requires at least **three qualifying independent source records** for the same canonical operator and tenant.

One record is an observation, not a pattern.

If required evidence is missing, emit uncertainty rather than estimating.

If an authorized operator has no usable records, return empty collections plus an uncertainty item such as `no_records` or `source_unavailable`.

### Stage 1 evidence sources

Use existing sources only where their semantics support the output:

- canonical operator identity;
- explicit persisted onboarding/operator fields whose schema already gives them clear meaning;
- Behavioral Ledger events;
- existing behavioral experiment / proximal-outcome records;
- `goalCycleLearnedDeltas`.

The three acquisition answers — trade, place, avoided task — are not contact preferences.

Do not treat free-form acquisition or Claire conversation text as a structured preference in Stage 1.

### Existing learned deltas

Stage 1 should surface structured fields from existing learned deltas, including where applicable:

- `learningKind`;
- `targetKey`;
- `confidence`;
- `evidenceReference`;
- `afterState`.

Do not turn `goalCycleLearnedDeltas.explanation` into Claire-ready prose.

Do not create a new learned-delta row.

### Stage 1 deletion property

Because Stage 1 is a read model, removing source evidence must remove a dependent Stage 1 signal on the next build.

Do not introduce a cache that becomes an independent truth store.

---

## Stage 2 — Durable Operator Representation

Stage 2 begins only after Stage 1 proves that the existing evidence packet is useful and safe.

Stage 2 may add durable derived representation where raw read-time aggregation is insufficient.

Likely concepts include:

- evidence-backed operator conclusions/signals;
- many-to-many evidence lineage;
- supersession;
- retraction;
- staleness;
- contradiction;
- a compact Operator Card as a read model/materialized view;
- asynchronous derivation;
- consolidation/rebuild jobs.

Do **not** assume these exact tables are required until Stage 1 evidence demonstrates the need.

### Allowed reasoning classes

Default v1 reasoning should remain conservative:

- **explicit** — the operator directly supplied the information;
- **deductive** — the conclusion follows from explicit structured evidence under a defined rule;
- **inductive** — repeated independent observations support a bounded pattern.

Do not introduce general psychological **abduction** as operational truth.

Forbidden examples:

- `operator is avoidant`;
- `operator lacks confidence`;
- `operator is lazy`;
- `operator is fearful`;
- `operator has ADHD`;
- `operator is budget-conscious`;
- `operator is career-focused`;

unless the wording is being preserved strictly as an operator's own statement, with provenance, and not adopted as an independently verified conclusion.

Prefer:

`3 of 4 qualifying starts occurred after intervention X within the predefined window`

over:

`operator responds best to X`.

### Lineage and deletion

Every durable derived representation must preserve evidence lineage.

If source evidence is deleted, retracted, invalidated, or becomes unavailable, dependent conclusions must be:

- retracted; or
- rebuilt from surviving evidence.

A durable conclusion may **not** silently survive after all supporting evidence is gone.

This intentionally differs from memory systems that allow derived conclusions to survive deletion of their source session.

### No second truth system

Operator Representation is not another business-memory store.

It must never become a parallel source of truth for business state.

---

## Stage 3 — Adaptive Claire

Only after Stage 1 and Stage 2 are proven may Claire consume Operator Representation in production.

Integration must be:

- behind an explicit feature flag/cutover gate;
- typed;
- evidence-aware;
- bounded to presentation/intervention decisions;
- subordinate to existing Executive Function and business-truth authority.

Claire may use Operator Representation to choose **how** to intervene.

Claire may not use Operator Representation to prove **what happened**.

Allowed influence:

- channel;
- timing;
- response length;
- task decomposition;
- intervention option;
- reminder burden;
- escalation intensity;
- presentation style.

Forbidden authority:

- visit happened;
- call happened;
- sale happened;
- customer replied;
- payment occurred;
- revenue changed;
- follow-up was missed;
- current account/business state.

An assertion guard must reject any attempt to use Operator Representation as evidence for those business claims.

---

# Data/storage architecture at scale

Operator Representation remains multi-tenant.

Do not create a database per customer.

For 1,000+ customers, durable representation should live in the same tenant-scoped JOYSTICK persistence architecture unless scale measurements justify a later physical split.

Every durable record must be scoped by:

- `tenantId`;
- `canonicalOperatorId`.

At scale, the architecture is conceptually:

```
existing business / behavior evidence
            ↓
deterministic extraction and gating
            ↓
background derivation only when meaningful evidence changes
            ↓
durable compact Operator Representation
            ↓
small typed OperatorContextPacket
            ↓
Claire / intervention selection
```

The system must not reread a customer's entire history through a frontier model on every Claire turn.

---

# LOCKED model-routing strategy

**Decision locked 2026-10-01.**

Operator Representation must remain model-provider agnostic.

The provider interface must be swappable. No core representation schema or truth rule may depend on one model vendor.

## Routing order

1. **Deterministic code first.**
   - Identity resolution.
   - Evidence eligibility.
   - Counts.
   - timestamp pairing.
   - confidence gates where already defined.
   - deletion lineage.
   - simple conflict detection.
   - schema validation.

2. **Routine background derivation/consolidation → inexpensive model tier.**
   - Mistral Small-class models and/or Gemini Flash-class models are current examples.
   - Provider choice is operational, not architectural.

3. **Confidence / contradiction gate.**
   - If the routine tier cannot produce a sufficiently supported schema-bound result, do not guess.
   - Escalate only the ambiguous evidence packet.

4. **Difficult ambiguous cases → frontier model tier.**
   - Claude Sonnet-class or OpenAI frontier-class models are current examples.
   - Frontier inference is an exception path, not the default path.

5. **Validated structured output only.**
   - Model prose is not evidence.
   - A model cannot grant business-truth authority.
   - Outputs must pass deterministic validation before persistence or use.

## Economic target

Target **90%+ of background Operator Representation inference** to be handled by deterministic processing plus the inexpensive model tier once the system is mature.

This is a target, not a license to reduce epistemic quality. Ambiguous cases should escalate or remain uncertain.

## Strategic option

Keep open-weight/self-hostable models as a strategic option at scale.

The architecture must allow JOYSTICK to move routine derivation from an API vendor to infrastructure it controls without redesigning Operator Representation.

Do not hard-code today's model names or prices into core business logic.

---

# What we are explicitly not building

Operator Representation is not:

- Honcho integration;
- a personality engine;
- a psychological diagnosis system;
- a second business-truth store;
- a replacement for the Behavioral Ledger;
- a replacement for `goalCycleLearnedDeltas`;
- an excuse to infer intent from missing events;
- an excuse to turn correlation into causation;
- an LLM transcript-summary database;
- a vector database by default;
- a database per customer;
- a second Claire decision kernel.

Honcho's useful architectural lesson is the separation between fast writes, background reasoning, compact stable representation, and evidence lineage.

Honcho is not a required dependency.

---

# Causal discipline

Observational sequence remains observational.

`intervention delivered → operator started`

does not automatically mean:

`intervention caused operator to start`.

Preserve randomized-assignment metadata where it exists.

Preserve assignment probability, policy version, intervention-definition version, and predefined proximal-outcome windows.

Do not emit causal language unless the existing experiment/evidence contract actually supports it.

---

# Time, channel, and absence rules

Do not use server UTC hour as the operator's local morning.

Use an authoritative stored timezone where available.

If local timezone is unavailable, keep timing timezone-neutral or emit uncertainty.

Do not calculate start latency unless the existing records provide both valid timestamps for the same subject/decision point.

Do not manufacture:

- `IGNORED`;
- `AVOIDED`;
- `REFUSED`;
- `PROCRASTINATED`;

from the absence of an event.

Explicit `DEFERRED`, `DISMISSED`, `EXPIRED`, `NOT_COMPLETED`, and other ledger states retain their distinct meanings.

---

# Operator Card

The eventual Operator Card is a compact retrieval surface, not an independent truth authority.

It should favor:

- stable explicit facts;
- explicit preferences;
- high-confidence evidence-backed operational patterns;
- relevant uncertainty;
- compact evidence references.

It should not contain:

- transient mood;
- speculative personality;
- unsupported psychology;
- stale conclusions without lineage;
- business-state claims merely because the operator said them.

---

# Observability

A mature Operator Representation system should expose at minimum:

- representation jobs attempted/succeeded/failed;
- routine-tier vs frontier-tier routing;
- validation rejection rate;
- contradiction count;
- retraction/rebuild count;
- stale representation count;
- source-unavailable count;
- average evidence items read per update;
- model tokens/cost per operator update;
- packet generation latency.

Observability may describe system operation. It must not manufacture operator facts.

---

# Cost doctrine

The database is not expected to be the dominant marginal cost.

Primary variable cost risk comes from model reasoning frequency.

Therefore:

- reason on meaningful evidence changes, not continuously;
- batch routine work when appropriate;
- run deterministic gates before model calls;
- send compact relevant evidence rather than full lifetime history;
- use inexpensive models for ordinary derivation;
- reserve frontier models for genuine ambiguity;
- keep provider routing swappable;
- measure cost per representation update and per active operator.

Claire voice/telephony, Mitch coding execution, President/autonomous-agent work, and other product inference are separate COGS categories. Do not charge them conceptually to Operator Representation merely because they consume its packet.

---

# Decision history

## 2026-10-01 — Canonical architecture locked

Locked decisions:

- build native JOYSTICK Operator Representation rather than adopting Honcho as a dependency;
- Stage 1 is a read model over existing evidence before new belief tables;
- Stage 2 introduces durable derived representation only where proven necessary;
- Stage 3 allows flagged Claire adaptation only for how to intervene, never as business truth;
- derived representation must retract/rebuild when supporting evidence is deleted;
- no operational psychological abduction/personality inference;
- deterministic code first;
- routine inference goes to an inexpensive model tier;
- ambiguous cases alone escalate to a frontier model;
- provider interface remains swappable;
- target 90%+ of mature background inference through deterministic + inexpensive tier;
- retain an open-weight/self-hosted option for future scale.

Future changes must update this file and append a dated entry here rather than scattering contradictory architectural notes through the codebase.

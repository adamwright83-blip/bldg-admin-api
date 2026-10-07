# Daphne V2 — Slice 0 Current-System Audit and Boundary Contract

> Canonical implementation target for Daphne V2. Audited against `main@e3ecd9f18e7d4796a906bd15bb0e6dad0e7eaee6`.
>
> This document supersedes the earlier *proposed* Daphne V2 representation design where it conflicts with this contract. It does not rename the product or create a V3. The scientifically redesigned target is Daphne V2.

## Mission

Daphne V2 is a closed-loop adaptive user-intelligence system. It must learn how an AI should work with an individual human across person-level tendencies, current state, context, goals, agent-specific relationship history, interventions, outcomes, and time.

The core questions are:

1. What is relatively stable about this person?
2. What appears true right now?
3. What situation and goal are active?
4. What history exists with this specific agent?
5. How has the person responded to different agent behaviors under comparable conditions?
6. What should the agent do now, what remains unknown, and what evidence supports that recommendation?

## Canonical ownership

Daphne V2 ultimately owns or compiles these domain objects:

| Object | Canonical? | Purpose |
| --- | --- | --- |
| Person | yes | slow-moving distributions and context-conditioned tendencies |
| State | yes | fast, expiring operational state estimates |
| Context | yes | structured situation/regime features |
| Goals | yes | current and longer-horizon objectives and constraints |
| Relationship | yes, scoped to agent/user pair | common ground, expectations, corrections, ruptures/repairs, disclosures, shared history |
| MetaPreferences | yes | explicit controls over adaptation, initiative, inference, recall and experimentation |
| HypothesisSet | yes | competing explanations and decomposed uncertainty |
| InterventionLedger | yes | acceptable action set, chosen action, selection mode/probability, policy/version and exposure |
| ResponseModel | yes | conditional response estimates with explicit epistemic status |
| OutcomeLedger | yes | proximal and distal outcomes with authoritative references |
| OperatorCard | **no** | compiled, scoped read model for agent consumption |

**Binding rule:** `OperatorCard` is a cache/read model. It is never the source of truth. If it disagrees with canonical Daphne objects, the canonical objects win.

## Current-system inventory

### 1. Stage 1 Operator Context — KEEP, then WRAP

Current: `server/persistentOperator/operatorContext.ts`.

What it already does correctly:

- canonical tenant/operator identity resolution;
- explicit user facts and declared preferences with provenance;
- bounded Behavioral Ledger evidence;
- descriptive patterns with minimum observation thresholds;
- learned deltas from authoritative outcome-backed learning;
- source/absence uncertainty;
- strict separation from business truth.

Disposition:

- **KEEP** as a legacy evidence reader and compatibility source.
- **WRAP** into Daphne V2 evidence ingestion/read adapters.
- Do not make `OperatorContextPacket` the V2 canonical user model.

### 2. Behavioral Ledger and behavioral-science instrumentation — KEEP

Current behavioral-science law already establishes:

- immutable observations must remain distinct from interpretation;
- causal claims cannot come from observational logs;
- decision points should preserve availability, eligible options, assigned option, assignment probability, policy/version and predefined proximal outcome window;
- burden/fatigue must be measurable;
- randomization among safe eligible options is required for causal learning.

Disposition:

- **KEEP** these laws.
- **MIGRATE/ADAPT** the usable decision/outcome evidence into the V2 InterventionLedger and OutcomeLedger rather than duplicating truth.
- Existing business/behavioral ledgers remain authoritative for what happened in their domains.

### 3. Operator Representative UI/read model — KEEP as compatibility surface

Current: `server/operatorRepresentative/readModel.ts` and related types/router.

It already provides:

- user-inspectable known/pattern/learned/uncertain items;
- evidence references;
- correction/suppress/ask-instead affordances;
- adaptation eligibility presentation.

Disposition:

- **KEEP** the surface.
- **MIGRATE** its backing semantics to compiled Daphne V2 state over time.
- It must not become a second canonical representation.

### 4. Daphne directives and Stage 3B canary — KEEP, later REPLACE WITH V2 ADAPTER

Current:

- `server/operatorRepresentative/adaptation.ts`
- `server/operatorRepresentative/adaptationContract.ts`
- `server/operatorRepresentative/adaptationReceipts.ts`
- `drizzle/0121_daphne_adaptation_receipts.sql`
- `drizzle/0122_daphne_directive_approval.sql`
- `server/claire/turn/daphneAdaptation.test.ts`

Current production adaptation is intentionally narrow: an active `ask_instead` directive for `pattern:explicit_deferral_dismissal` may select Claire's clarification branch for an ambiguous pending continuation. Usage is receipted and explicitly non-business.

Disposition:

- **KEEP** the canary until Slice 19.
- **KEEP** receipts as historical evidence.
- **WRAP** directive/correction semantics into V2 MetaPreferences and user-control APIs where appropriate.
- **REPLACE** the narrow runtime adapter only in the designated Claire integration slice after V2 contracts exist.

### 5. Goal-cycle learned deltas — KEEP as legacy outcome-backed learning input

Current: `server/persistentOperator/learningStore.ts`.

Strengths:

- derives learning from settled authoritative outcomes rather than model prose;
- rejects stale/conflicting/unsettled evidence;
- is idempotent;
- retains evidence references;
- distinguishes positive verified outcomes from failures/constraints.

Disposition:

- **KEEP** as a source of legacy adaptation evidence.
- **MIGRATE/WRAP** into V2 typed evidence and ResponseModel bootstrap.
- Do not treat deterministic historical weights as causal treatment effects unless the required causal design exists.

### 6. Claire relationship/progression — KEEP and preserve authority boundaries

Current relationship and progression code already separates:

- verified growth actions;
- verified business progress;
- rapport/personal-access grants;
- disclosure safety;
- prior disclosure/refusal history;
- durable relationship events.

Disposition:

- **KEEP** existing progression authority.
- Daphne V2 Relationship enriches dyadic continuity but does **not** replace the progression grant system.
- Personality/response inference alone may never mint Narrative OS disclosure permission.

### 7. Narrator OS — KEEP; Daphne is downstream context, not story authority

Current: `shared/narratorOs/**`, including explicit occurrence/visibility/knowledge/disclosure separation and verified-evidence prerequisites.

Disposition:

- **KEEP**.
- Slice 20 may provide relationship/context inputs to authored presentation.
- Daphne may not invent canon, fire beats, mutate story truth, or bypass eligibility.

### 8. Psychology firewall — MIGRATE, do not simply delete

Current Stage 1 forbids diagnostic/causal phrasing and the behavioral-science foundation correctly bans diagnosis and observational causal claims.

Daphne V2 changes one earlier assumption: durable *non-diagnostic, evidence-linked personality/behavioral hypotheses* may exist.

The retained firewall is:

- no diagnosis;
- no unsupported clinical/mental-health labels;
- no causal claim from correlation;
- no hidden psychological state promoted as fact;
- inference remains typed, scoped, revisable, provenance-linked and uncertain.

Disposition:

- **MIGRATE** from “no trait hypotheses at all” to “no untyped or unsupported psychological truth.”
- Existing production paths remain unchanged until the V2 typed epistemic ledger is in place.

## Current gaps relative to Daphne V2

The current tree does **not** yet provide the V2 canonical system for:

1. immutable normalized Daphne observation ingestion across all relevant evidence classes;
2. typed durable epistemic claims;
3. fast expiring State;
4. structured Context/regime modeling;
5. Person distributions and if/then signatures;
6. first-class Goals and MetaPreferences;
7. canonical per-agent dyadic Relationship;
8. competing hypotheses plus decomposed uncertainty;
9. OperatorCard compiled from those objects;
10. complete acceptable-action/selection-probability InterventionLedger;
11. unified proximal/distal OutcomeLedger;
12. explicit conditional ResponseModel with association-vs-causal status;
13. propensity-aware causal evaluation;
14. bounded safe active learning;
15. multi-objective policy constraints;
16. explicit agent-caused-change attribution;
17. V2 consolidation/dreaming over immutable evidence;
18. standalone Daphne query/evidence API;
19. broad Claire V2 runtime adapter;
20. Narrative OS relationship bridge;
21. V2 rupture/repair intelligence;
22. V2 inspector/user controls;
23. V2 privacy/scope hardening;
24. scientific evaluation harness;
25. low-risk production causal canary;
26. hierarchical cross-user priors/cold start;
27. standalone external product boundary;
28. full moat instrumentation.

## Truth boundaries

Daphne V2 may influence **how** an agent works with a user.

It is not authoritative proof of:

- payments;
- revenue;
- customers;
- visits;
- calls;
- order status;
- narrative occurrence;
- narrative disclosure permission;
- medical or psychiatric state.

Those remain owned by their authoritative systems.

## Epistemic rules

The following distinctions are binding:

```
observation != pattern
pattern != causal effect
causal effect != personality
stated preference != revealed response
current state != durable person tendency
global Daphne knowledge != one agent's relationship knowledge
proximal success != distal success
```

`unknown`, `insufficient_evidence`, `association_only`, `context_specific`, `competing_hypotheses`, `possible_regime_change`, and `abstain` are successful truthful outcomes.

## Migration strategy

Daphne V2 is additive and staged.

- Existing Stage 1, Operator Representative and Stage 3B remain live while V2 foundations are built.
- New V2 stores reference existing authoritative evidence rather than copying business truth.
- The Operator Card is introduced only after canonical backing objects exist.
- Claire cutover happens only in Slice 19 with fallback to existing behavior.
- Narrative OS integration happens only in Slice 20.
- Existing adaptation receipts remain valid historical evidence.

## Slice order

Slices 1–28 are executed sequentially from this boundary contract. A slice may not claim a capability whose upstream slice is not implemented and tested.

## Slice 0 acceptance

- [x] Current main audited.
- [x] Existing Daphne/Operator Representative/Claire/Narrator seams identified.
- [x] Canonical V2 objects and ownership declared.
- [x] Operator Card explicitly demoted to compiled read model.
- [x] Existing truth boundaries preserved.
- [x] No production behavior changed by this slice.

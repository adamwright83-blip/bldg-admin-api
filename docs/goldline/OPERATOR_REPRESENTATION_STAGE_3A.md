# Stage 3A — Claire Operator Context Shadow Integration

## 1. Executive Summary

Stage 3A integrates the ephemeral Stage 1 `OperatorContextPacket` into Claire as a **shadow-only adaptation-context reader**.

In accordance with the conclusions of the merged Stage 2 Gap Report (`docs/goldline/OPERATOR_REPRESENTATION_STAGE_2_GAP_REPORT.md`):
> *Current main does not establish a need for durable Stage 2 persistence.*

Consequently, Stage 3A adds **no new database tables, no migrations, no background workers, and no durable belief store**. It introduces a bounded, read-only projection (`ClaireOperatorAdaptationContext`) that evaluates Stage 1 operator context in a deterministic shadow execution seam within the Claire turn lifecycle.

### Core Invariant
**Shadow OFF user-visible output == Shadow ON user-visible output.**

Shadow execution is strictly non-destructive and side-effect free on conversation logic. The adaptation context is evaluated, structural telemetry is emitted, and the context is immediately discarded before prompt assembly, LLM execution, Brain V3 evaluation, or speech rendering.

---

## 2. Architectural Seam & Lifecycle

### Location
The integration seam is located in `runClaireTurn` within `server/claire/turn/claireTurn.ts`:

```ts
// server/claire/turn/claireTurn.ts
const shadowEnabled = (deps.operatorContextShadowEnabled ?? isClaireOperatorContextShadowEnabled)(input.tenantId);
if (shadowEnabled) {
  await runClaireOperatorContextShadow({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    deps: {
      loadOperatorAdaptationContext: deps.loadOperatorAdaptationContext,
      onOperatorContextShadowTelemetry: deps.onOperatorContextShadowTelemetry,
    },
  });
}
```

### Execution Properties
- **Synchronous Await:** Executed within the turn's promise chain. There are no floating or unhandled background promises.
- **Deterministic Measurement:** Wall-clock duration (`durationMs`) is explicitly tracked from start to completion/failure.
- **Immediate Discard:** The returned `ClaireOperatorAdaptationContext` is NOT passed to `invokeLLM`, prompt builders, Brain V3, Executive Function, or business answer paths.

---

## 3. Projection & Bounded Fields

The projection maps an ephemeral Stage 1 `OperatorContextPacket` into `ClaireOperatorAdaptationContext` (`server/claire/operatorAdaptationContext.ts`).

### Fields Exposed
1. **`canonicalOperatorId` & `tenantId`**: Authoritative operator and tenant identifiers.
2. **`explicitPreferences`**: Strictly filtered to preferences with `provenance === "operator_declared"`. System defaults and inferred preferences are rejected.
3. **`learnedSignals`**: Structured goal cycle learned deltas with only:
   - `learningKind`: E.g. `time_preference`, `channel_affinity`, `detail_level`, `friction_tolerance`.
   - `targetKey`: Opaque identifier (e.g. `time:early_morning`, `voice`).
   - `confidence`: `"high" | "medium" | "low"`.
   - `deltaType`: `"boost" | "dampen" | "reinforce" | "attenuate"`.
   - `sourceDeltaId`: Provenance identifier.
   - `evidenceReference`: Upstream reference link.
4. **`uncertaintyReasons`**: Active uncertainty codes (e.g. `no_records`, `insufficient_observations`, `evidence_window_truncated`).
5. **`evidenceWindowTruncated`**: Boolean flag indicating query limit was reached.
6. **`metadata`**: Structural counts for auditing:
   - `generatedAt`, `mappedUserCount`, `evidenceRefCount`, `explicitPreferenceCount`, `learnedSignalCount`, `uncertaintyCount`, `evidenceWindowTruncated`.

### Fields Strictly Excluded
- **Raw Ledger Rows:** `interventionEvidence` and individual Behavioral Ledger event records are never exposed.
- **Explanatory Prose:** Natural language explanations and generated rationale text are stripped from learned signals.
- **Conversation History:** Ephemeral turns and transcripts are excluded.
- **Inferred Preferences:** Unproven preferences lacking explicit operator declaration are excluded.
- **Raw Payloads:** Before/after delta state objects are omitted.

---

## 4. Truth Boundaries & Firewalls

### 1. Business Truth Firewall
- Operator Context is strictly an **adaptation context**, never business evidence or fact proof.
- It never holds `authoritativeFor: ["current_business_truth"]`.
- It cannot prove or authorize statements such as:
  - "invoice paid"
  - "called Dana"
  - "customer replied"
  - "revenue increased"
  - "visit happened"
  - "objective completed"
- It does NOT interface with `VerifiedFactInventory`, `AssertionGuard`, `claimReceipts`, or `BrainV3Input`.
- Architectural invariant: `server/claire/turn/brainV3.ts` contains zero imports of operator context or operator adaptation context.

### 2. Psychology & Diagnosis Firewall
- The adaptation context is validated against `DIAGNOSIS_FORBIDDEN_PATTERNS` from `shared/behavioralInterventionMapping.ts`.
- Any presence of diagnostic, clinical, trait-based, or causal phrasing (e.g., `avoidant`, `lazy`, `adhd`, `unmotivated`, `lacks motivation`, `caused completion`, `works better`) throws an immediate assertion error and fails closed.

### 3. Channel Rule
- `channel_affinity` is preserved solely as an opaque `targetKey` (e.g. `"voice"`, `"sms"`).
- It is never translated into a transport directive or operational recommendation ("prefers phone", "do not call").

---

## 5. Feature Flag & Rollout

Controlled via the environment variable `CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED`:

| Value | Behavior |
| :--- | :--- |
| `unset` / `""` / `"false"` / `"0"` | **Disabled** (default). Shadow execution does not run. |
| `"true"` / `"1"` / `"*"` | **Globally Enabled**. Shadow execution runs on all Claire turns. |
| `"<tenant_a>,<tenant_b>"` | **Tenant Allowlist**. Shadow runs only for specified tenant IDs. |

---

## 6. Telemetry & Structural Observability

Shadow execution emits only **structural telemetry**. Private text, preference values, prompt content, operator utterances, and raw ledger rows are never logged.

### Events
- `operator_context_shadow_started`: Emitted upon initiating the shadow pass.
- `operator_context_shadow_completed`: Emitted on successful load, carrying execution latency and structural metadata.
- `operator_context_shadow_failed`: Emitted on caught error, carrying latency and the error message without failing the turn.
- `operator_context_shadow_skipped`: Emitted when operator identity is missing or unresolved.

### Telemetry Payload Schema
```ts
export type ClaireOperatorContextShadowTelemetryEvent = {
  event:
    | "operator_context_shadow_started"
    | "operator_context_shadow_completed"
    | "operator_context_shadow_failed"
    | "operator_context_shadow_skipped";
  tenantId: string;
  canonicalOperatorId?: string | null;
  operatorUserId?: string | null;
  durationMs?: number;
  skipReason?: "flag_disabled" | "missing_identity" | "identity_unresolved";
  failureReason?: string;
  metadata?: {
    durationMs: number;
    explicitPreferenceCount: number;
    learnedSignalCount: number;
    learnedSignalKinds: string[];
    uncertaintyReasons: string[];
    evidenceWindowTruncated: boolean;
    mappedUserCount: number;
    evidenceRefCount: number;
  };
};
```

---

## 7. Resilience & Safe Failure

Shadow execution is designed for non-destructive resilience:
- **Fail-Open Strategy:** If `loadClaireOperatorAdaptationContext` throws an exception (e.g. database timeout or query error), the error is caught, `operator_context_shadow_failed` telemetry is emitted, and `null` is returned.
- **No Caller Exceptions:** `runClaireOperatorContextShadow` never throws to `runClaireTurn`.
- **Identity Safety:** Missing or unmapped operator IDs result in `operator_context_shadow_skipped` without disruption.

---

## 8. Status & Next Steps

> [!IMPORTANT]
> **Stage 3 is NOT complete.** Stage 3A establishes the observational shadow seam and telemetry foundation only.
> There is **no approved Stage 3B plan**. Active conversational adaptation, prompt injection, and response steering remain unapproved and strictly blocked until production telemetry from Stage 3A is collected, analyzed, and reviewed.

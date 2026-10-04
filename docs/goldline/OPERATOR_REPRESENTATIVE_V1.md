# JOYSTICK Operator Representative V1

Status: implementation on `chatgpt/operator-representative-end-to-end-v1`.

## Product

Operator Representative is JOYSTICK's visible, auditable model of how the system currently understands how to work with the authenticated operator.

It is not a business-truth reader, a second Claire, a second Executive Function, a personality profiler, or a durable inferred-belief database.

The production surface is:

- route: `/operator`
- label: **OPERATOR REPRESENTATIVE**
- primary interaction: **TALK TO MY OPERATOR**
- categories: **KNOWN / LEARNING / UNCERTAIN / CHANGED**

## Permanent truth boundary

Operator Context can constrain how JOYSTICK works with the operator. It cannot establish what happened in the business.

Operator Representative therefore never treats a Behavioral Ledger `VERIFIED` classification as authority to assert that revenue, payment, a call, a visit, a customer reply, an order state, or an objective happened. Those facts remain governed by their authoritative business readers.

Every evidence detail returned by the Operator Representative product projection carries `businessTruthSupport: false`.

## Stage 1 source

The product is derived on demand from the existing deterministic `OperatorContextPacket` in:

`server/persistentOperator/operatorContext.ts`

No durable inferred Operator Representation store was added.

## Stage 3A — Claire shadow seam

`server/claire/operatorAdaptationContext.ts` projects a deliberately bounded adaptation context containing only:

- authenticated tenant and canonical operator identifiers;
- operator-declared explicit preferences;
- structured learned-signal metadata:
  - `learningKind`
  - `targetKey`
  - `confidence`
  - `deltaType`
  - `sourceDeltaId`
  - `evidenceReference`
- uncertainty reason codes;
- structural counts;
- truncation state.

It excludes raw Behavioral Ledger rows, raw onboarding free text, before/after state JSON, explanatory learned-delta prose, business outcomes, conversation history, psychology, and causal interpretation.

Feature flag:

`CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED`

Default: off.

The shadow read is awaited within the Claire turn after Claire captures its authoritative `now`, `nowMs`, and timezone snapshot. The result is discarded before Brain V3, prompt/model, business reader, assertion guard, fact inventory, and claim-receipt paths.

Structural telemetry events:

- `operator_context_shadow_started`
- `operator_context_shadow_completed`
- `operator_context_shadow_failed`
- `operator_context_shadow_skipped`

Raw exception text is not emitted.

## Product read model

Server modules:

- `server/operatorRepresentative/types.ts`
- `server/operatorRepresentative/readModel.ts`
- `server/operatorRepresentative/directives.ts`
- `server/operatorRepresentative/talk.ts`
- `server/operatorRepresentative/adaptation.ts`
- `server/operatorRepresentative/router.ts`

The authenticated router is mounted as:

`system.operatorRepresentative`

Operations:

- `home`
- `itemDetail`
- `adaptationStatus`
- `directive`
- `revokeDirective`
- `ask`

All operations resolve the authenticated user's canonical operator identity on the server. The client does not choose a canonical operator ID.

## Category semantics

### KNOWN

Only explicit/canonical sources:

- canonical identity;
- operator-declared facts;
- operator-declared preferences;
- active explicit operator corrections as an override of the displayed Operator-context value.

Observational inference is not promoted to KNOWN.

### LEARNING

Descriptive `OperatorObservedPattern` evidence.

A LEARNING item may describe counts/observations. It does not say those observations establish a personality, motive, preference, or causal effect.

### UNCERTAIN

Real `OperatorContextUncertaintyReason` values mapped to human copy, including source-unavailable, insufficient-observations, conflicting-signals, timezone-unavailable, operator-binding-unavailable, invalid temporal evidence, and truncated evidence.

Source failure is not rendered as an empty-data claim.

### CHANGED

Stored `goalCycleLearnedDeltas` and explicit operator directive events.

A stored learned delta is not presented as an active Claire behavior unless a real adaptation integration exists.

## Evidence details

Every item has a deterministic stable ID.

`itemDetail` returns:

- category and user-facing meaning;
- provenance;
- bounded source/evidence references;
- source timestamps;
- verification classification when present as metadata only;
- uncertainty reasons;
- adaptation eligibility/status;
- allowed use;
- forbidden use;
- control eligibility;
- `businessTruthSupport: false`.

The home payload does not ship raw ledger history to the browser.

## Explicit operator directives

A narrow explicit-user store was added:

`operator_representative_directives`

Migration:

`drizzle/0112_operator_representative_directives.sql`

This is not an inferred-belief store. A row exists only because an authenticated operator explicitly acts.

Supported directive kinds:

- `correction`
- `suppress`
- `ask_instead`

Rows can be revoked.

### THAT ISN'T TRUE

Available only on correctable Operator-context items. An explicit correction overrides the value shown by Operator Representative while leaving the underlying evidence source intact.

This control cannot rewrite authoritative business truth.

### DON'T USE THIS

Marks an eligible signal suppressed for Operator adaptation. It does not delete the underlying evidence.

### ASK ME INSTEAD

Marks an eligible signal ask-first. It instructs the adaptation policy not to silently rely on the signal.

Suppress and ask-first supersede each other for a target. Corrections are independently auditable.

## Grounded Talk

`server/operatorRepresentative/talk.ts` is deterministic in V1.

No new model router or autonomous agent was introduced.

Supported intents include:

- what do you know;
- what have you learned;
- what is uncertain;
- what changed;
- why / where did this come from;
- are you using this;
- communication channel;
- working time;
- correct this;
- don't use this;
- ask me instead.

Channel and working-time questions abstain unless an authoritative operator-declared preference exists.

`channel_affinity.targetKey` remains opaque. `assignedOption` remains an intervention arm and is never translated into SMS/phone/email/push semantics.

Mutating Talk requests require an unambiguous focused item or return a clarification request.

V1 does not persist a separate permanent Talk transcript.

## Psychology boundary

Operator Representative does not infer diagnoses, traits, motives, or psychological causes.

Existing diagnosis/causal forbidden-pattern guards apply to the Claire adaptation projection.

Observed behavior remains descriptive evidence.

## Stage 3B canary

Feature flag:

`CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED`

Default: off.

The product includes a deterministic adaptation-policy projection for explicit directives.

V1 intentionally has **no approved live Claire adaptation target**. The wired-target allowlist is empty.

That means eligible explicit corrections are reported as:

`eligible_not_wired`

rather than falsely claiming Claire changed.

Suppression and ask-first directives are already authoritative constraints on future Operator adaptation. Learned deltas do not become live merely because they exist.

A future live target must be added deliberately with its own truth-preserving Claire integration and tests.

## Client

Files:

- `client/src/pages/operator/OperatorRepresentative.tsx`
- `client/src/pages/operator/OperatorRepresentative.css`

The page is a dedicated full-screen route and does not inherit the generic admin dashboard chrome.

It uses existing JOYSTICK assets without modifying Lantern City or Small Comforts:

- operator art: `client/src/assets/goldline/generated/trailblazer-operator.png`
- atmosphere reference: `/assets/admin/control-room/world/lantern-city-atlas-v2.webp`

The four category panels contain only live API data.

Desktop item inspection uses a side drawer.

Mobile item inspection uses a bottom sheet.

The page has a real text Talk flow. V1 does not display an active press-to-talk microphone because no production-safe in-app transcription transport was added in this work. No Twilio dependency was introduced.

## Navigation

Direct route:

`/operator`

A narrow Operator entry is also present in the existing Home control-room navigation.

The Operator page's own navigation links only to existing routes:

- Lantern City map;
- Operations;
- Operator;
- Claire;
- Settings.

No fake Library or Missions destination was added.

## Isolation

This implementation does not modify:

- `server/mitch/**`
- Mitch shared producer contracts;
- Small Comforts source;
- Lantern City world source;
- President internals.

The Operator page references an existing Lantern City image for atmosphere but does not modify game-world assets or behavior.

## Known limitation

The major deliberate limitation is Stage 3B live adaptation: the infrastructure and explicit directives exist, but no current Claire presentation/action seam is considered safe enough to mark as active without a separate, target-specific contract. V1 reports that truthfully instead of manufacturing an adaptation.

# Operator Representation Stage 3A — Claire Shadow Integration

Stage 3A restores the existing Stage 1 `OperatorContextPacket` to the current Claire turn as a **shadow-only, non-authoritative adaptation projection**.

## Flag

`CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED`

Default: false.

The value may be `true`, `1`, `*`, or a comma-separated tenant allowlist.

## Turn seam

The current Claire turn captures:

1. `now`
2. `nowMs`
3. timezone
4. business clock/date

before it awaits the Stage 3A read.

The read finishes inside the same turn. No unawaited shadow promise is started.

The return value is discarded before any prompt, Brain V3 interpretation, closed-decision projection, business reader, factual inventory, assertion guard, or claim receipt is assembled.

## Projection

Allowed:

- operator-declared explicit preferences;
- structured learned-signal keys and IDs;
- uncertainty reason codes;
- structural counts and truncation status.

Excluded:

- raw ledger rows;
- raw business outcomes;
- onboarding free text;
- conversations;
- learned-delta prose;
- before/after state JSON;
- business facts;
- psychological or causal interpretation.

## Telemetry

Structural only:

- `operator_context_shadow_started`
- `operator_context_shadow_completed`
- `operator_context_shadow_failed`
- `operator_context_shadow_skipped`

Failure telemetry uses a bounded code. Raw `Error.message` and `String(error)` are not emitted.

## Permanent authority boundary

Stage 3A cannot support `current_business_truth`.

A source row's `VERIFIED` classification remains metadata. It does not authorize Operator Context or Claire adaptation code to prove revenue, payment, calls, visits, replies, completed objectives, or order state.

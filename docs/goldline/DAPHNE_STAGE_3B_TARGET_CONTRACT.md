# Daphne Stage 3B Target Contract

Parent main: `dae95e6bd39c7a257d6402fb075b8b27d0f6bb9f`

This contract is recorded before any Claire production edit.

## Existing Daphne target on parent

- Target key: `pattern:explicit_deferral_dismissal`
- Directive kind: `ask_instead`
- Parent source: `server/operatorRepresentative/readModel.ts`
- Pattern source: `server/persistentOperator/operatorContext.ts`
- Parent read model already emits observed-pattern target keys as `pattern:${pattern.kind}`.
- Parent Operator Context already defines the `explicit_deferral_dismissal` pattern.
- Observed-pattern items already allow `ask_instead`.

## Existing Claire behavior on parent

- `server/claire/turn/decisionRecord.ts`
  - `selectClaireClosedDecisionBranch`
  - existing branches: `clarify | incomplete | continue`
- `server/claire/turn/claireTurn.ts`
  - existing `clarify` branch returns the deterministic clarification response
  - existing pending-action abstention falls back to `continues_pending`

## Stage 3B behavior contract

Behavior class: `ask_before_ambiguous_pending_continuation`

Baseline:
- a pending-action-relationship decision abstains;
- its existing fallback is `continues_pending`;
- Claire follows its existing continue path.

Adapted:
- the existing `CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED` flag permits live adaptation;
- an active Daphne `ask_instead` directive exists for `pattern:explicit_deferral_dismissal`;
- the pending-action relationship decision abstains and would otherwise fall back to `continues_pending`;
- Daphne selects Claire's already-existing `clarify` branch.

The Stage 3B PR may switch this existing branch. It may not invent a new Claire conversational behavior.

## Truth boundary

This adaptation may affect only conversational branch selection. It cannot mutate, certify, or substitute for business truth, Planning authority, payment/revenue authority, or Action / Execution Authority.

# President operating-system foundation

This is implementation slice A, not a claim that the full executive operating system exists.

## Live inspection and isolation

Fetched base: `fe958884762ce3c24d38fa46ab410745445a4680`.
Branch: `feat/president-operating-system`; clean managed worktree from that exact base.
PR #359 source: `94e00dcd630944f4dc6bec835c45e83a9f0d162f`, open/conflicting.
PR #371: merged, producer bus and durable execution provider inspected.
PR #358: merged; existing Operator Context is read-only and cannot supply business truth.
PR #355: unmerged at `1fe188e152c3ad5221f32159e4aa0c4d2f1a1f94`; not consumed.

Ported President-owned source files, not the foreign branch or its history. Shared files receive only additive President table declarations, migration registration, script registration and the out-of-game `seat.president` entry. Claire, Mitch, Operator Context and customer runtime behavior are unchanged.

Existing primitives: mysql2 transaction/pool persistence, Drizzle schema, production bootstrap migration runner, `server/durableExecution/worker.ts`, Anthropic provider, metadata-only PostHog observability, platform-admin tRPC authorization. The foundation has no provider calls, worker registration or dispatch.

## Non-production proof

Disposable local MySQL 8.0.46, `127.0.0.1:3411/president_stage1_witness`.
Migration `0109_president_stage1.sql` creates only `president_assessments` and `president_candidate_projects`. It was not applied to production.

Inspected main: `fe958884762ce3c24d38fa46ab410745445a4680`.
Snapshot: `evidence-d17c436a5074b111b3791d3b9c89b1d6a08ce1cbd0e796793b34cff59545a132`.
Assessment: `president-assessment-bd5d70731697fe610e1b5b32`.

1. **Prove production database recovery** (`president-candidate-ca0a31bf42d3bb006a4a50c3`). The immutable launch-operations document states scheduled backups are not configured and no restore drill is proven. Build the authorized backup/isolated-restore proof. Afterward JOYSTICK can demonstrate recovery. It ranks first because irreversible data-loss risk precedes operational activation.
2. **Activate and verify retention safely** (`president-candidate-90b71f2014bf1a0d01bb34f3`). The same document states retention is intentionally inert pending configuration. Build the authorized dry-run/bounded-activation proof. Afterward JOYSTICK can demonstrate retention enforcement. It ranks second because recovery protection precedes data-deletion activation.

These are document-backed facts about the inspected audit, not fresh production telemetry. Priority is explicitly inference. Billing, isolation and log clearance remain UNKNOWN and create no candidate. PostHog live data, production runtime, Railway production and Stripe live are recorded unavailable.

Fresh-adapter rerun recovers the same ID: one assessment and two candidates before/after. Durable state `WAITING_FOR_HUMAN_SELECTION`; execution count zero. Full evidence and provenance are retained in `artifacts/president-stage1/database-witness.json` and the CI witness artifact. No recommendation was executed and no recommendation-implementation PR was created.

## Merge safety

The canonical application start command applies migrations. A production service auto-deploying main could therefore apply this schema merely following merge. Merge is withheld until deployment configuration proves that the user’s no-production-mutation condition is met. No deployment setting was changed to bypass this condition.

## Validation

23 President tests passed, including real MySQL concurrent-retry/idempotency tests. Type checking, nomenclature, default-tenant ratchet and vertical-dependency guards passed. Additional durable-worker/PostHog regressions are recorded in the implementation PR.

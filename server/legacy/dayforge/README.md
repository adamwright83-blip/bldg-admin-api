# Legacy Quarantine — DayForge (`server/legacy/dayforge/`)

## Purpose
This directory contains quarantined compatibility code and fixtures from the historical DayForge application. The active canonical product is **JOYSTICK** and today's work surface is **Day Line**.

## Architectural Invariants
1. **Quarantine Only**: Code in this directory exists solely to maintain backward compatibility for existing deployments, migrations, and legacy integration journeys.
2. **No Production Authority**:
   - Cannot create, mutate, or transition native Orders lifecycle state (owned by `server/domains/orders/`).
   - Cannot admit native payments or record financial authority receipts (owned by `server/domains/payment/`).
   - Cannot create canonical commercial customer conversions (owned by `server/domains/commercial/`).
   - Cannot create or alter live Planning commitments or Agent state.
3. **Persisted Compatibility**:
   - Table names (`legacy_dayforge_*`) in `drizzle/schema.ts` remain unchanged.
   - Historical environment variable names (`DAYFORGE_*`) remain unchanged.
   - Historical API route contracts remain unchanged.

## Subdirectories
- `coaching/`: Legacy coaching artifact generation and policies.
- `demo/`: Disposable demo tenant reset and seeding fixtures.
- `events/`: Historical product event timeline and audit event persistence.
- `proof/`: Legacy proof dashboard metrics projection.
- `release/`: Historical release migration scripts (`applyReleaseMigrations.ts`) and journey test harnesses.
- `retention/`: Legacy customer retention rules and background jobs.
- `security/`: Legacy TRPC origin validation guards (`assertTrpcMutationOrigin`).
- `today/`: Legacy driver day list/sort items service and router.

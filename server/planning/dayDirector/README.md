# Subsystem Contract: Day Director & Day Line

## PURPOSE
Owner of the operator-facing Day Line: today's prioritized schedule, commitments, active appointments, and operational progress.

## OWNS
- Operator Day Line projection.
- Day commitments, appointment tracking, and operator check-ins.
- Workday recurrence state and daily snapshot storage.

## READS
- Deterministically ranked missions from Mission Director.
- Admitted order statuses from Orders.
- Commercial follow-ups from Commercial.
- Operator directives from Daphne.

## WRITES
- `workday_plans`, `workday_commitments`, and recurrence tables.

## LEGAL ENTRYPOINTS
- `dayDirectorService.ts`
- `dayDirectorRouter.ts`

## DOWNSTREAM CONSUMERS
- Operator UI (Day Line board)
- Claire conversational context assembler
- Driver mission execution view

## MUST NEVER OWN
- Native order lifecycle transitions (must call Orders).
- Payment admission or revenue calculation (must call Payment).
- Commercial conversion (must call Commercial).

## LEGACY/COMPATIBILITY EXCEPTIONS
- Historical snapshot schemas preserved for reporting consistency.

# Subsystem Contract: Mission Director

## PURPOSE
Sole deterministic ranker and planner for operational work, field missions, customer outreach, and driver stops.

## OWNS
- Deterministic ranking algorithms for candidate tasks (`missionRank.ts`).
- Mission eligibility scoring and pocket detection.
- Workday plan candidate selection.

## READS
- Candidate tasks from Orders, Commercial, and Persistent Operator.
- Operational constraints (time windows, driver location, truck capacity).

## WRITES
- Deterministic mission rankings and selected plan candidates.

## LEGAL ENTRYPOINTS
- `missionDirectorService.ts`
- `rankRankableWork` (`missionRank.ts`)
- `missionDirectorRouter.ts`

## DOWNSTREAM CONSUMERS
- Day Line / Day Director
- Driver route generation
- Claire daily operational briefing

## MUST NEVER OWN
- Order status lifecycle mutations (owned by Orders).
- Payment admission (owned by Payment).
- Commercial conversion truth (owned by Commercial).
- Game state or unlocks (owned by Experience).

## LEGACY/COMPATIBILITY EXCEPTIONS
- Legacy pocket grouping heuristics retained for route optimization.

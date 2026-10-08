# Planning Subsystem Contract

## Purpose
The Planning subsystem owns deterministic rank ordering, workday scheduling, and live operational task tracking for JOYSTICK:
- **Mission Director** (`missionDirector/`): Sole deterministic work ranker. Consumes candidate missions from Persistent Operator and Commercial pipeline, ranking them against objectives, operator capacity, and spatial/routing constraints.
- **Day Director** (`dayDirector/`): Governs the operator's workday plan, recurrence rules, and day structure.
- **Current Day Line** (`dayline/`): The operator's live execution surface for today's work, providing candidate completion lineage and task progression.
- **Macro Planning** (`macroGoalStore.ts`, `weeklyIntentStore.ts`): Stores high-level operator macro goals and weekly intent vectors.

## Boundaries & Invariants
1. **Deterministic Ranking Authority**: Mission Director is the sole deterministic work ranker. Agents propose candidates; Mission Director ranks.
2. **Read-Only Against Financial Truth**: Planning services consume admitted revenue, customer truth, and pipeline stages; they never mint payment receipts, alter order states, or invent commercial conversion facts.
3. **Domain Mutation Decoupling**: Progressing or completing a mission triggers domain commands through legal write entrypoints (`orders`, `commercial`, `authority`), never direct unverified writes to underlying tables.
4. **Tenant Isolation**: All plan selection, recurrence stores, and Day Line queries require explicit tenant qualification.

## File Structure
- `missionDirector/`: Mission ranking algorithm, prep readiness, pocket detection, plan selection, and tRPC router.
- `dayDirector/`: Workday plan snapshot store, recurrence schedules, actor bindings, and day director service.
- `dayline/`: Current Day Line service, candidate completion lineage, and live operator router.
- `macroGoalStore.ts`: High-level business macro goals and metric targets.
- `weeklyIntentStore.ts`: Weekly operator planning and intent ledger.

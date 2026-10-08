# Agents Subsystem Contract

The **Agents Subsystem** (`server/agents/`, alongside protected agent roots `server/claire/`, `server/president/`, and `server/mitch/`) encompasses the autonomous and conversational agents acting within JOYSTICK.

## Architecture & Subsystems

1. **Persistent Operator (`server/agents/persistentOperator/`)**
   - Autonomous background supervisor executing operator appointments, goal cycles, macro-goal evaluation, and action policy validation.
   - Preserves authoritative receipts for all operations.
   - Enforces strict canonical operator identity resolution (`identity.ts`).

2. **Operator Representative (`server/agents/operatorRepresentative/`)**
   - Deterministic and conversational simulation of operator preferences, directives, and speech models.
   - Evaluates adaptation decisions and maintains read models.

3. **Daphne (`server/agents/daphne/`)**
   - Operator preference learning, intervention ledger, causal estimation, and epistemic store.
   - Captures explicit runtime corrections and maintains learned policies without bypassing core authorities.

4. **Agent Runtime & Tools (`server/agents/`)**
   - Generic agent runtime execution (`agentRuntime.ts`), tool registry (`toolRegistry.ts`), permissions (`permissions.ts`), and resident action authority (`residentActionAuthority.ts`).

5. **Autonomous Seats With Preserved Path Stability:**
   - **Claire (`server/claire/`)**: Operator voice briefing, daily command orchestration, conversational turns. Maintained at top-level `server/claire/` for concurrent PR #476 stability.
   - **President (`server/president/`)**: Executive intelligence and source-backed reasoning. Maintained at top-level `server/president/` for concurrent PRs #411, #375, #374, #359 stability.
   - **Mitch (`server/mitch/`)**: Game producer and autonomous development agent. Maintained at top-level `server/mitch/` for concurrent PR #361 stability.

## Boundary Rules
- Agents NEVER mutate core business facts directly (orders, payments, commercial contracts); they submit actions through domain admission services or authoritative action gateways.
- All agent actions must be attested by canonical operator identity and validated against action policies.
- Diagnostic and background events must not mask missing database or domain invariants.
